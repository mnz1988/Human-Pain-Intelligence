import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { db } from "@/db";
import { contributionContent } from "@/db/schema";
import { eq } from "drizzle-orm";
import { processContribution } from "@/lib/ai/process";
import { markProcessing, markFailed, saveProcessedResult } from "@/lib/processing-result";

const receiver =
  process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY
    ? new Receiver({
        currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
      })
    : null;

// Push-based processing via QStash. Currently unused in favor of the local
// pull worker (/api/jobs/pending + /api/jobs/complete), kept for future use
// if/when the AI backend is reachable from the public internet again.
export async function POST(req: NextRequest) {
  const bodyText = await req.text();

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
    await markProcessing(contributionId);
    const result = await processContribution(content.rawText);
    const { problemId } = await saveProcessedResult(contributionId, result);
    return NextResponse.json({ ok: true, problemId });
  } catch (err) {
    await markFailed(contributionId);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "processing failed" },
      { status: 500 }
    );
  }
}
