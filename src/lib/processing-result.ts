import { db } from "@/db";
import {
  contributions,
  contributionContent,
  contributionEntities,
  problemClusters,
  problemClusterMembers,
} from "@/db/schema";
import { eq, and, ne, isNotNull, desc, inArray, sql } from "drizzle-orm";
import type { ProcessedContribution } from "@/lib/ai/process";

const SIMILARITY_THRESHOLD = Number(process.env.CLUSTER_SIMILARITY_THRESHOLD) || 0.82;
const MAX_CANDIDATE_CLUSTERS = 500;

export async function markProcessing(contributionId: string) {
  await db
    .update(contributions)
    .set({ status: "processing" })
    .where(eq(contributions.id, contributionId));
}

export async function markFailed(contributionId: string) {
  await db
    .update(contributions)
    .set({ status: "failed" })
    .where(eq(contributions.id, contributionId));
}

export async function dedupeFailedSubmissions(): Promise<{ duplicateGroups: number; deleted: number }> {
  const result = await db.execute<{ ids: string[] }>(sql`
    SELECT array_agg(c.id ORDER BY c.created_at) AS ids
    FROM contributions c
    JOIN contribution_content cc ON cc.contribution_id = c.id
    WHERE c.status = 'failed' AND c.user_id IS NOT NULL AND cc.raw_text IS NOT NULL
    GROUP BY c.user_id, cc.raw_text
    HAVING count(*) > 1
  `);

  const rows = result.rows ?? (result as unknown as { ids: string[] }[]);
  let deleted = 0;

  for (const row of rows) {
    const ids = row.ids;
    const idsToDelete = ids.slice(1);
    if (idsToDelete.length === 0) continue;

    await db.delete(contributionContent).where(inArray(contributionContent.contributionId, idsToDelete));
    await db.delete(contributions).where(inArray(contributions.id, idsToDelete));
    deleted += idsToDelete.length;
  }

  return { duplicateGroups: rows.length, deleted };
}

export async function requeueFailed(): Promise<{
  duplicateGroups: number;
  duplicatesDeleted: number;
  requeued: number;
}> {
  const { duplicateGroups, deleted } = await dedupeFailedSubmissions();

  const rows = await db
    .update(contributions)
    .set({ status: "pending" })
    .where(eq(contributions.status, "failed"))
    .returning({ id: contributions.id });

  return { duplicateGroups, duplicatesDeleted: deleted, requeued: rows.length };
}

export async function recomputeClusterStats(): Promise<{ clustersUpdated: number }> {
  const result = await db.execute<{ id: string; distinct_users: number }>(sql`
    UPDATE problem_clusters pc
    SET member_count = sub.distinct_users,
        demand_score = sub.distinct_users,
        updated_at = now()
    FROM (
      SELECT pcm.cluster_id, count(DISTINCT c.user_id) AS distinct_users
      FROM problem_cluster_members pcm
      JOIN contributions c ON c.id = pcm.contribution_id
      GROUP BY pcm.cluster_id
    ) sub
    WHERE pc.id = sub.cluster_id
    RETURNING pc.id
  `);
  const rows = result.rows ?? (result as unknown as { id: string }[]);
  return { clustersUpdated: rows.length };
}

export async function getClustersMissingEmbedding(): Promise<
  Array<{ id: string; title: string; summary: string | null }>
> {
  return db
    .select({ id: problemClusters.id, title: problemClusters.title, summary: problemClusters.summary })
    .from(problemClusters)
    .where(sql`${problemClusters.embedding} IS NULL`)
    .orderBy(problemClusters.createdAt);
}

export async function mergeOrEmbedCluster(
  clusterId: string,
  embedding: number[]
): Promise<{ merged: boolean; mergedInto?: string; similarity?: number }> {
  const match = await findBestMatchingCluster(embedding, clusterId);

  if (match) {
    await db
      .update(problemClusterMembers)
      .set({ clusterId: match.id })
      .where(eq(problemClusterMembers.clusterId, clusterId));

    const newEmbedding = averageEmbeddings(match.embedding, embedding, match.memberCount);
    await db
      .update(problemClusters)
      .set({ embedding: newEmbedding, updatedAt: new Date() })
      .where(eq(problemClusters.id, match.id));

    await db.delete(problemClusters).where(eq(problemClusters.id, clusterId));

    return { merged: true, mergedInto: match.id, similarity: match.similarity };
  }

  await db
    .update(problemClusters)
    .set({ embedding, updatedAt: new Date() })
    .where(eq(problemClusters.id, clusterId));

  return { merged: false };
}

export async function inspectClustersByTitle(titleContains: string): Promise<{
  clusters: Array<{ id: string; title: string; hasEmbedding: boolean }>;
  similarities: Array<{ a: string; b: string; similarity: number }>;
}> {
  const rows = await db
    .select({
      id: problemClusters.id,
      title: problemClusters.title,
      embedding: problemClusters.embedding,
    })
    .from(problemClusters)
    .where(sql`${problemClusters.title} ILIKE ${"%" + titleContains + "%"}`);

  const similarities: Array<{ a: string; b: string; similarity: number }> = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (!a.embedding || !b.embedding) continue;
      similarities.push({ a: a.id, b: b.id, similarity: cosineSimilarity(a.embedding, b.embedding) });
    }
  }

  return {
    clusters: rows.map((r) => ({ id: r.id, title: r.title, hasEmbedding: !!r.embedding })),
    similarities,
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function findBestMatchingCluster(
  embedding: number[],
  excludeClusterId?: string
): Promise<
  | {
      id: string;
      embedding: number[];
      memberCount: number;
      similarity: number;
      canonicalQuality: number;
    }
  | null
> {
  const candidates = await db
    .select({
      id: problemClusters.id,
      embedding: problemClusters.embedding,
      memberCount: problemClusters.memberCount,
      canonicalQuality: problemClusters.canonicalQuality,
    })
    .from(problemClusters)
    .where(isNotNull(problemClusters.embedding))
    .orderBy(desc(problemClusters.updatedAt))
    .limit(MAX_CANDIDATE_CLUSTERS);

  let best:
    | {
        id: string;
        embedding: number[];
        memberCount: number;
        similarity: number;
        canonicalQuality: number;
      }
    | null = null;

  for (const candidate of candidates) {
    if (!candidate.embedding) continue;
    if (excludeClusterId && candidate.id === excludeClusterId) continue;
    const similarity = cosineSimilarity(embedding, candidate.embedding);
    if (similarity >= SIMILARITY_THRESHOLD && (!best || similarity > best.similarity)) {
      best = {
        id: candidate.id,
        embedding: candidate.embedding,
        memberCount: candidate.memberCount,
        similarity,
        canonicalQuality: Number(candidate.canonicalQuality ?? 0),
      };
    }
  }

  return best;
}

function averageEmbeddings(existing: number[], incoming: number[], existingCount: number): number[] {
  const n = existingCount;
  return existing.map((value, i) => (value * n + incoming[i]) / (n + 1));
}

async function userAlreadyRepresented(
  clusterId: string,
  userId: string | null,
  excludeContributionId?: string
): Promise<boolean> {
  if (!userId) return false;

  const conditions = [
    eq(problemClusterMembers.clusterId, clusterId),
    eq(contributions.userId, userId),
  ];
  if (excludeContributionId) {
    conditions.push(ne(problemClusterMembers.contributionId, excludeContributionId));
  }

  const [row] = await db
    .select({ id: problemClusterMembers.contributionId })
    .from(problemClusterMembers)
    .innerJoin(contributions, eq(contributions.id, problemClusterMembers.contributionId))
    .where(and(...conditions))
    .limit(1);

  return !!row;
}

async function detachPriorMembership(
  contributionId: string,
  userId: string | null
): Promise<string | undefined> {
  const [existing] = await db
    .select({ clusterId: problemClusterMembers.clusterId })
    .from(problemClusterMembers)
    .where(eq(problemClusterMembers.contributionId, contributionId))
    .limit(1);

  if (!existing?.clusterId) return undefined;
  const clusterId = existing.clusterId;

  const stillRepresented = await userAlreadyRepresented(clusterId, userId, contributionId);

  await db
    .delete(problemClusterMembers)
    .where(eq(problemClusterMembers.contributionId, contributionId));

  if (stillRepresented) return clusterId;

  const [clusterRow] = await db
    .select({ memberCount: problemClusters.memberCount })
    .from(problemClusters)
    .where(eq(problemClusters.id, clusterId))
    .limit(1);
  const currentCount = clusterRow?.memberCount ?? 1;
  const remaining = Math.max(currentCount - 1, 0);

  if (remaining === 0) {
    await db.delete(problemClusters).where(eq(problemClusters.id, clusterId));
  } else {
    await db
      .update(problemClusters)
      .set({ memberCount: remaining, demandScore: String(remaining), updatedAt: new Date() })
      .where(eq(problemClusters.id, clusterId));
  }

  return clusterId;
}

export async function saveProcessedResult(
  contributionId: string,
  result: ProcessedContribution,
  embedding: number[] | null
): Promise<{ problemId: string; matchedExistingCluster: boolean; similarity?: number }> {
  const [contributionRow] = await db
    .select({ userId: contributions.userId })
    .from(contributions)
    .where(eq(contributions.id, contributionId))
    .limit(1);
  const userId = contributionRow?.userId ?? null;

  await db
    .update(contributions)
    .set({ language: result.language })
    .where(eq(contributions.id, contributionId));

  await db
    .update(contributionContent)
    .set({
      sanitizedText: result.sanitizedText,
      piiProcessed: true,
      privacyRiskScore: String(result.privacyRiskScore),
    })
    .where(eq(contributionContent.contributionId, contributionId));

  await detachPriorMembership(contributionId, userId);
  await db.delete(contributionEntities).where(eq(contributionEntities.contributionId, contributionId));

  if (result.entities.length > 0) {
    await db.insert(contributionEntities).values(
      result.entities.map((e) => ({
        contributionId,
        entityType: e.entityType,
        normalizedValue: e.normalizedValue,
        confidence: String(e.confidence),
      }))
    );
  }

  const match = embedding ? await findBestMatchingCluster(embedding) : null;

  let clusterId: string;
  let matchedExistingCluster = false;
  let similarity: number | undefined;

  if (match && embedding) {
    const newEmbedding = averageEmbeddings(match.embedding, embedding, match.memberCount);
    const isNewReporter = !(await userAlreadyRepresented(match.id, userId));
    const newMemberCount = isNewReporter ? match.memberCount + 1 : match.memberCount;

    const isBetterDescription = result.problem.descriptionQuality > match.canonicalQuality;

    await db
      .update(problemClusters)
      .set({
        embedding: newEmbedding,
        memberCount: newMemberCount,
        demandScore: String(newMemberCount),
        updatedAt: new Date(),
        ...(isBetterDescription
          ? {
              title: result.problem.title,
              summary: result.problem.summary,
              primaryCategory: result.problem.primaryCategory,
              secondaryCategory: result.problem.secondaryCategory ?? null,
              tags: result.problem.tags,
              scale: result.problem.scale,
              durationPattern: result.problem.durationPattern,
              genderSpecificTopic: result.problem.genderSpecificTopic,
              affectedParty: result.problem.affectedParty,
              trend: result.problem.trend,
              submitterConfidence: result.problem.submitterConfidence,
              emotions: result.problem.emotions,
              tradeoffBenefit: result.problem.tradeoff?.benefit ?? null,
              tradeoffCost: result.problem.tradeoff?.cost ?? null,
              underlyingNeed: result.problem.underlyingNeed ?? null,
              actionable: result.problem.actionable,
              willingnessToPay: result.problem.willingnessToPay,
              existingAlternatives: result.problem.existingAlternatives,
              impactSeverity: result.problem.impactSeverity,
              canonicalQuality: String(result.problem.descriptionQuality),
            }
          : {}),
      })
      .where(eq(problemClusters.id, match.id));

    clusterId = match.id;
    matchedExistingCluster = true;
    similarity = match.similarity;
  } else {
    const [cluster] = await db
      .insert(problemClusters)
      .values({
        title: result.problem.title,
        summary: result.problem.summary,
        primaryCategory: result.problem.primaryCategory,
        secondaryCategory: result.problem.secondaryCategory ?? undefined,
        urgency: result.problem.urgency,
        perspective: result.problem.perspective,
        geographicScope: result.problem.geographicScope ?? undefined,
        tags: result.problem.tags,
        scale: result.problem.scale,
        durationPattern: result.problem.durationPattern,
        genderSpecificTopic: result.problem.genderSpecificTopic,
        affectedParty: result.problem.affectedParty,
        trend: result.problem.trend,
        submitterConfidence: result.problem.submitterConfidence,
        emotions: result.problem.emotions,
        tradeoffBenefit: result.problem.tradeoff?.benefit ?? undefined,
        tradeoffCost: result.problem.tradeoff?.cost ?? undefined,
        underlyingNeed: result.problem.underlyingNeed ?? undefined,
        actionable: result.problem.actionable,
        willingnessToPay: result.problem.willingnessToPay,
        existingAlternatives: result.problem.existingAlternatives,
        impactSeverity: result.problem.impactSeverity,
        canonicalQuality: String(result.problem.descriptionQuality),
        embedding: embedding ?? undefined,
        memberCount: 1,
        demandScore: "1",
      })
      .returning();

    clusterId = cluster.id;
  }

  await db
    .insert(problemClusterMembers)
    .values({
      clusterId,
      contributionId,
      membershipConfidence: similarity ? String(similarity) : "1.0",
    })
    .onConflictDoUpdate({
      target: problemClusterMembers.contributionId,
      set: { clusterId, membershipConfidence: similarity ? String(similarity) : "1.0" },
    });

  await db
    .update(contributions)
    .set({ status: "processed", processedAt: new Date() })
    .where(eq(contributions.id, contributionId));

  return { problemId: clusterId, matchedExistingCluster, similarity };
}
