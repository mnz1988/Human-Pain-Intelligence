import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerRequest } from "@/lib/worker-auth";
import { recomputeClusterStats } from "@/lib/processing-result";

export async function POST(req: NextRequest) {
  const auth = verifyWorkerRequest(
    req.headers.get("x-worker-timestamp"),
    req.headers.get("x-worker-signature"),
    "POST:/api/jobs/recompute-stats"
  );
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const result = await recomputeClusterStats();
  return NextResponse.json({ ok: true, ...result });
}
