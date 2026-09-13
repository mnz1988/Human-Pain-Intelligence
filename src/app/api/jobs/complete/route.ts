import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerRequest } from "@/lib/worker-auth";
import { markFailed, saveProcessedResult } from "@/lib/processing-result";
import type { ProcessedContribution } from "@/lib/ai/process";

interface CompleteBody {
  contributionId: string;
  success: boolean;
  result?: ProcessedContribution;
  embedding?: number[];
  error?: string;
}

export async function POST(req: NextRequest) {
  const bodyText = await req.text();

  const auth = verifyWorkerRequest(
    req.headers.get("x-worker-timestamp"),
    req.headers.get("x-worker-signature"),
    bodyText
  );
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  let body: CompleteBody;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.contributionId) {
    return NextResponse.json({ ok: false, error: "contributionId is required" }, { status: 400 });
  }

  if (!body.success || !body.result) {
    await markFailed(body.contributionId);
    return NextResponse.json({ ok: true, marked: "failed", error: body.error });
  }

  try {
    const { problemId, matchedExistingCluster, similarity } = await saveProcessedResult(
      body.contributionId,
      body.result,
      body.embedding ?? null
    );
    return NextResponse.json({
      ok: true,
      marked: "processed",
      problemId,
      matchedExistingCluster,
      similarity,
    });
  } catch (err) {
    await markFailed(body.contributionId);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed to save result" },
      { status: 500 }
    );
  }
}
