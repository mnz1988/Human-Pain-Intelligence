import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerRequest } from "@/lib/worker-auth";
import { db } from "@/db";
import { contributions, contributionContent, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createHash } from "crypto";

interface ImportItem {
  text: string;
  sourceType: string; // e.g. "reddit", "twitter", "forum" — required
  senderId?: string; // external user handle/ID on that site — same senderId + sourceType always maps to the same internal identity
}

interface Body {
  items: ImportItem[];
}

const MIN_LENGTH = 10;
const MAX_LENGTH = 10000;

/**
 * Derives a deterministic, unique publicAlias for an imported identity —
 * reuses the existing unique constraint on users.publicAlias as our "find or
 * create" key, so no new table/column is needed. The same (sourceType,
 * senderId) pair always produces the same alias, which is how repeat
 * senders resolve to the same user row.
 */
function deriveImportedAlias(sourceType: string, senderId: string): string {
  const hash = createHash("sha256").update(`${sourceType}:${senderId}`).digest("hex").slice(0, 12);
  const prefix = sourceType.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase();
  return `imp_${prefix}_${hash}`.slice(0, 32);
}

async function resolveIdentity(sourceType: string, senderId: string): Promise<string> {
  const alias = deriveImportedAlias(sourceType, senderId);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.publicAlias, alias))
    .limit(1);
  if (existing) return existing.id;

  const [user] = await db.insert(users).values({ publicAlias: alias }).returning();
  return user.id;
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

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ ok: false, error: "items array is required" }, { status: 400 });
  }
  if (body.items.length > 200) {
    return NextResponse.json(
      { ok: false, error: "max 200 items per request — send in smaller batches" },
      { status: 400 }
    );
  }

  let imported = 0;
  let skippedDuplicate = 0;
  let skippedInvalid = 0;
  const errors: string[] = [];

  for (const item of body.items) {
    const text = typeof item.text === "string" ? item.text.trim() : "";
    const sourceType = typeof item.sourceType === "string" ? item.sourceType.trim() : "";

    if (text.length < MIN_LENGTH || text.length > MAX_LENGTH || !sourceType) {
      skippedInvalid++;
      continue;
    }

    try {
      // Dedup: same sourceType + identical raw text already imported.
      const [dup] = await db
        .select({ id: contributions.id })
        .from(contributions)
        .innerJoin(contributionContent, eq(contributionContent.contributionId, contributions.id))
        .where(and(eq(contributions.sourceType, sourceType), eq(contributionContent.rawText, text)))
        .limit(1);
      if (dup) {
        skippedDuplicate++;
        continue;
      }

      const userId = item.senderId ? await resolveIdentity(sourceType, item.senderId) : null;

      const [contribution] = await db
        .insert(contributions)
        .values({ userId, sourceType, status: "pending" })
        .returning();

      await db.insert(contributionContent).values({
        contributionId: contribution.id,
        rawText: text,
        sanitizedText: text, // placeholder until the worker processes it
        piiProcessed: false,
      });

      imported++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "unknown error");
    }
  }

  return NextResponse.json({
    ok: true,
    imported,
    skippedDuplicate,
    skippedInvalid,
    errors: errors.slice(0, 10),
  });
}
