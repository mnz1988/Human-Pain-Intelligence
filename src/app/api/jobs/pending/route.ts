import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contributions, contributionContent } from "@/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { verifyWorkerRequest } from "@/lib/worker-auth";
import { markProcessing } from "@/lib/processing-result";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

export async function GET(req: NextRequest) {
  const auth = verifyWorkerRequest(
    req.headers.get("x-worker-timestamp"),
    req.headers.get("x-worker-signature"),
    "GET:/api/jobs/pending"
  );
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Math.min(
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT,
    MAX_LIMIT
  );

  const rows = await db
    .select({
      id: contributions.id,
      rawText: contributionContent.rawText,
    })
    .from(contributions)
    .innerJoin(contributionContent, eq(contributionContent.contributionId, contributions.id))
    .where(and(eq(contributions.status, "pending"), isNotNull(contributionContent.rawText)))
    .limit(limit);

  // Claim them immediately so a second worker poll (or a slow one) doesn't
  // pick up the same jobs concurrently.
  for (const row of rows) {
    await markProcessing(row.id);
  }

  return NextResponse.json({
    ok: true,
    jobs: rows.map((r) => ({ contributionId: r.id, rawText: r.rawText })),
  });
}
