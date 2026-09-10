import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { db } from "@/db";
import {
  contributions,
  contributionContent,
  contributionEntities,
  problemClusters,
  problemClusterMembers,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { processContribution } from "@/lib/ai/process";

const receiver =
  process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY
    ? new Receiver({
        currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
      })
    : null;

export async function POST(req: NextRequest) {
  const bodyText = await req.text();

  // Verify this request genuinely came from QStash (skipped only if signing keys
  // aren't configured yet, e.g. local dev without QStash set up).
  if (receiver) {
    const signature = req.headers.get("upstash-signature");
    if (!signature) {
      return NextResponse.json({ ok: false, error: "missing signature" }, { status: 401 });
    }
    try {
      await receiver.verify({ signature, body: bodyText });
    } catch {
      return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
    }
  }

  const { contributionId } = JSON.parse(bodyText) as { contributionId?: string };
  if (!contributionId) {
    return NextResponse.json({ ok: false, error: "contributionId is required" }, { status: 400 });
  }

  const [content] = await db
    .select()
    .from(contributionContent)
    .where(eq(contributionContent.contributionId, contributionId))
    .limit(1);

  if (!content?.rawText) {
    return NextResponse.json({ ok: false, error: "contribution content not found" }, { status: 404 });
  }

  try {
    await db
      .update(contributions)
      .set({ status: "processing" })
      .where(eq(contributions.id, contributionId));

    const result = await processContribution(content.rawText);

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

    return NextResponse.json({ ok: true, problemId: cluster.id });
  } catch (err) {
    await db
      .update(contributions)
      .set({ status: "failed" })
      .where(eq(contributions.id, contributionId));

    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "processing failed" },
      { status: 500 }
    );
  }
}
