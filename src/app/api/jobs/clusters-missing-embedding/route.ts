import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerRequest } from "@/lib/worker-auth";
import { getClustersMissingEmbedding } from "@/lib/processing-result";

export async function GET(req: NextRequest) {
  const auth = verifyWorkerRequest(
    req.headers.get("x-worker-timestamp"),
    req.headers.get("x-worker-signature"),
    "GET:/api/jobs/clusters-missing-embedding"
  );
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const clusters = await getClustersMissingEmbedding();
  return NextResponse.json({ ok: true, clusters });
}
