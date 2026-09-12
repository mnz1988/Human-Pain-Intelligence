import { db } from "@/db";
import {
  contributions,
  contributionContent,
  contributionEntities,
  problemClusters,
  problemClusterMembers,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ProcessedContribution } from "@/lib/ai/process";

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

export async function saveProcessedResult(
  contributionId: string,
  result: ProcessedContribution
): Promise<{ problemId: string }> {
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
    })
    .returning();

  await db.insert(problemClusterMembers).values({
    clusterId: cluster.id,
    contributionId,
    membershipConfidence: "1.0",
  });

  await db
    .update(contributions)
    .set({ status: "processed", processedAt: new Date() })
    .where(eq(contributions.id, contributionId));

  return { problemId: cluster.id };
}
