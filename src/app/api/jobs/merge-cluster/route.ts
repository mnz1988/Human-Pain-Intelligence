import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerRequest } from "@/lib/worker-auth";
import { mergeOrEmbedCluster } from "@/lib/processing-result";

interface Body {
  clusterId: string;
  embedding: number[];
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

  let body: Body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.clusterId || !Array.isArray(body.embedding)) {
    return NextResponse.json(
      { ok: false, error: "clusterId and embedding are required" },
      { status: 400 }
    );
  }

  try {
    const result = await mergeOrEmbedCluster(body.clusterId, body.embedding);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("merge-cluster failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }
}
