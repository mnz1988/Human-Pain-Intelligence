import { getSessionUserId } from "@/lib/session";
import { db } from "@/db";
import {
  users,
  contributions,
  contributionContent,
  problemClusters,
  problemClusterMembers,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import Link from "next/link";

export default async function ProfilePage() {
  const userId = await getSessionUserId();

  if (!userId) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-xl font-semibold mb-2">No account found</h1>
        <p className="text-sm text-neutral-600 mb-6">
          This browser doesn&apos;t have an active session yet.
        </p>
        <Link href="/submit" className="text-sm underline">
          Submit something to get started
        </Link>
      </main>
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-xl font-semibold mb-2">Account not found</h1>
        <p className="text-sm text-neutral-600">This session is no longer valid.</p>
      </main>
    );
  }

  const rows = await db
    .select({
      id: contributions.id,
      status: contributions.status,
      createdAt: contributions.createdAt,
      language: contributions.language,
      sanitizedText: contributionContent.sanitizedText,
      problemTitle: problemClusters.title,
      problemCategory: problemClusters.primaryCategory,
      urgency: problemClusters.urgency,
      geographicScope: problemClusters.geographicScope,
      tags: problemClusters.tags,
      memberCount: problemClusters.memberCount,
    })
    .from(contributions)
    .leftJoin(contributionContent, eq(contributionContent.contributionId, contributions.id))
    .leftJoin(problemClusterMembers, eq(problemClusterMembers.contributionId, contributions.id))
    .leftJoin(problemClusters, eq(problemClusters.id, problemClusterMembers.clusterId))
    .where(eq(contributions.userId, userId))
    .orderBy(desc(contributions.createdAt));

  const urgencyStyles: Record<string, string> = {
    high: "bg-red-100 text-red-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-neutral-100 text-neutral-600",
  };

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-xl font-semibold mb-1">{user.publicAlias}</h1>
      <p className="text-sm text-neutral-500 mb-8">
        Reputation {user.reputationScore} · Level {user.level}
      </p>

      <h2 className="text-sm font-medium text-neutral-700 mb-3">Your submissions</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing submitted yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-md border border-neutral-200 p-3">
              <div className="text-xs text-neutral-500 mb-1 flex items-center gap-2 flex-wrap">
                <span>{row.status}</span>
                <span>·</span>
                <span>{row.createdAt?.toLocaleString()}</span>
                {row.language && (
                  <span className="uppercase text-[10px] tracking-wide bg-neutral-100 px-1.5 py-0.5 rounded">
                    {row.language}
                  </span>
                )}
                {row.urgency && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      urgencyStyles[row.urgency] ?? "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {row.urgency} urgency
                  </span>
                )}
              </div>
              {row.problemTitle && (
                <div className="text-sm font-medium mb-1 flex items-center gap-2">
                  <span>{row.problemTitle}</span>
                  {row.problemCategory && (
                    <span className="text-xs font-normal text-neutral-500">
                      {row.problemCategory}
                    </span>
                  )}
                  {row.memberCount && row.memberCount > 1 && (
                    <span className="text-[10px] font-medium bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                      {row.memberCount} people reported this
                    </span>
                  )}
                </div>
              )}
              <p className="text-sm line-clamp-3 text-neutral-700 mb-2">{row.sanitizedText}</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {row.geographicScope && (
                  <span className="text-[10px] text-neutral-500 border border-neutral-200 px-1.5 py-0.5 rounded">
                    📍 {row.geographicScope}
                  </span>
                )}
                {row.tags?.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] text-neutral-500 border border-neutral-200 px-1.5 py-0.5 rounded"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
