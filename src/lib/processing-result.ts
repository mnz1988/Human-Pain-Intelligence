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
// How many recent clusters to compare against. Fine for early-stage volume;
// migrating to pgvector + an ANN index is the natural next step once this
// table gets large enough that fetching all embeddings becomes expensive.
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

/**
 * Removes exact-duplicate failed submissions from the same user (identical
 * raw text) before restoring, keeping only the earliest attempt.
 */
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
    const idsToDelete = ids.slice(1); // keep the earliest, drop the rest
    if (idsToDelete.length === 0) continue;

    await db.delete(contributionContent).where(inArray(contributionContent.contributionId, idsToDelete));
    await db.delete(contributions).where(inArray(contributions.id, idsToDelete));
    deleted += idsToDelete.length;
  }

  return { duplicateGroups: rows.length, deleted };
}

/** Resets every "failed" contribution back to "pending" so the worker picks it up again. */
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

/**
 * Recomputes member_count/demand_score for every cluster from the actual
 * number of DISTINCT reporting users among its current members — repairs
 * drift from any past bug (or from redefining what member_count means).
 */
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
): Promise<{ id: string; embedding: number[]; memberCount: number; similarity: number } | null> {
  const candidates = await db
    .select({
      id: problemClusters.id,
      embedding: problemClusters.embedding,
      memberCount: problemClusters.memberCount,
    })
    .from(problemClusters)
    .where(isNotNull(problemClusters.embedding))
    .orderBy(desc(problemClusters.updatedAt))
    .limit(MAX_CANDIDATE_CLUSTERS);

  let best: { id: string; embedding: number[]; memberCount: number; similarity: number } | null =
    null;

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
      };
    }
  }

  return best;
}

// Running average: new centroid = (old * n + new) / (n + 1)
function averageEmbeddings(existing: number[], incoming: number[], existingCount: number): number[] {
  const n = existingCount;
  return existing.map((value, i) => (value * n + incoming[i]) / (n + 1));
}

/** Does this user already have a different contribution in this cluster? */
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

/**
 * Undoes this contribution's prior cluster membership, if any — needed so
 * reprocessing a contribution doesn't leave stale entities behind or
 * double-count its reporter in an old cluster alongside a new one. Only
 * decrements member_count if this user isn't still represented by another
 * contribution in that same cluster.
 */
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

  // Remove this contribution's own membership row now (the caller inserts a
  // fresh one afterward) — must happen before any cluster deletion below, or
  // the foreign key from this row would block it.
  await db
    .delete(problemClusterMembers)
    .where(eq(problemClusterMembers.contributionId, contributionId));

  if (stillRepresented) return clusterId; // this user still has another entry there — don't touch the count

  const [clusterRow] = await db
    .select({ memberCount: problemClusters.memberCount })
    .from(problemClusters)
    .where(eq(problemClusters.id, clusterId))
    .limit(1);
  const currentCount = clusterRow?.memberCount ?? 1;
  const remaining = Math.max(currentCount - 1, 0);

  if (remaining === 0) {
    // No other distinct reporters left — safe to delete now that this row is gone.
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

  // Idempotency: clear anything left over from a prior attempt at processing
  // this same contribution (retries, manual reprocessing of failed jobs).
  const priorClusterId = await detachPriorMembership(contributionId, userId);
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

  const match = embedding ? await findBestMatchingCluster(embedding, priorClusterId) : null;

  let clusterId: string;
  let matchedExistingCluster = false;
  let similarity: number | undefined;

  if (match && embedding) {
    // Join the existing cluster instead of creating a new one. Always refine
    // the centroid with the new text, but only count this as a new distinct
    // reporter if this user isn't already represented in the cluster.
    const newEmbedding = averageEmbeddings(match.embedding, embedding, match.memberCount);
    const isNewReporter = !(await userAlreadyRepresented(match.id, userId));
    const newMemberCount = isNewReporter ? match.memberCount + 1 : match.memberCount;

    await db
      .update(problemClusters)
      .set({
        embedding: newEmbedding,
        memberCount: newMemberCount,
        demandScore: String(newMemberCount),
        updatedAt: new Date(),
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
