import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerRequest } from "@/lib/worker-auth";
import { inspectClustersByTitle } from "@/lib/processing-result";

export async function GET(req: NextRequest) {
  const titleContains = req.nextUrl.searchParams.get("title");

  const auth = verifyWorkerRequest(
    req.headers.get("x-worker-timestamp"),
    req.headers.get("x-worker-signature"),
    `GET:/api/jobs/inspect-clusters?title=${titleContains ?? ""}`
  );
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  if (!titleContains) {
    return NextResponse.json({ ok: false, error: "title query param is required" }, { status: 400 });
  }

  const result = await inspectClustersByTitle(titleContains);
  return NextResponse.json({ ok: true, ...result });
}
