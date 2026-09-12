import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, userCredentials, contributions, contributionContent } from "@/db/schema";
import { generatePublicAlias } from "@/lib/alias";
import { generateRecoverySecret, hashSecret } from "@/lib/secret";
import { createSession, getSessionUserId } from "@/lib/session";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text || text.length < 10) {
    return NextResponse.json(
      { ok: false, error: "text is required and must be at least 10 characters" },
      { status: 400 }
    );
  }
  if (text.length > 10000) {
    return NextResponse.json(
      { ok: false, error: "text exceeds maximum length of 10000 characters" },
      { status: 400 }
    );
  }

  // Resolve existing session, or auto-create a new anonymous user
  let userId = await getSessionUserId();
  let newAccount: { publicAlias: string; recoverySecret: string } | null = null;

  if (userId) {
    const existing = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (existing.length === 0) {
      userId = null; // stale cookie pointing at a deleted user
    }
  }

  if (!userId) {
    const publicAlias = generatePublicAlias();
    const recoverySecret = generateRecoverySecret();

    const [user] = await db
      .insert(users)
      .values({ publicAlias })
      .returning();

    await db.insert(userCredentials).values({
      userId: user.id,
      credentialType: "recovery_secret",
      credentialReference: hashSecret(recoverySecret),
    });

    userId = user.id;
    newAccount = { publicAlias, recoverySecret };
  }

  const [contribution] = await db
    .insert(contributions)
    .values({
      userId,
      sourceType: "user_submission",
      status: "pending",
    })
    .returning();

  await db.insert(contributionContent).values({
    contributionId: contribution.id,
    rawText: text,
    sanitizedText: text, // placeholder until PII sanitization step is built
    piiProcessed: false,
  });

  if (newAccount) {
    await createSession(userId);
  }

  // Processing happens via the local worker, which polls /api/jobs/pending.
  // No push/enqueue step needed here — the submission just sits at "pending".

  return NextResponse.json({
    ok: true,
    contributionId: contribution.id,
    account: newAccount, // only present on first-ever submission for this browser
  });
}
