import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerRequest } from "@/lib/worker-auth";
import { requeueFailed } from "@/lib/processing-result";

export async function POST(req: NextRequest) {
  const auth = verifyWorkerRequest(
    req.headers.get("x-worker-timestamp"),
    req.headers.get("x-worker-signature"),
    "POST:/api/jobs/requeue-failed"
  );
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const count = await requeueFailed();
  return NextResponse.json({ ok: true, requeued: count });
}
