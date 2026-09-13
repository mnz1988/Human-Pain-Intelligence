import { db } from "@/db";
import {
  contributions,
  contributionContent,
  contributionEntities,
  problemClusters,
  problemClusterMembers,
} from "@/db/schema";
import { eq, isNotNull, desc } from "drizzle-orm";
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
  embedding: number[]
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

export async function saveProcessedResult(
  contributionId: string,
  result: ProcessedContribution,
  embedding: number[] | null
): Promise<{ problemId: string; matchedExistingCluster: boolean; similarity?: number }> {
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
    // Join the existing cluster instead of creating a new one.
    const newEmbedding = averageEmbeddings(match.embedding, embedding, match.memberCount);
    const newMemberCount = match.memberCount + 1;

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

  await db.insert(problemClusterMembers).values({
    clusterId,
    contributionId,
    membershipConfidence: similarity ? String(similarity) : "1.0",
  });

  await db
    .update(contributions)
    .set({ status: "processed", processedAt: new Date() })
    .where(eq(contributions.id, contributionId));

  return { problemId: clusterId, matchedExistingCluster, similarity };
}
