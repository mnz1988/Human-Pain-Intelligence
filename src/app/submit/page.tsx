"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SubmitPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newAccount, setNewAccount] = useState<{ publicAlias: string; recoverySecret: string } | null>(
    null
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      if (data.account) {
        // First-ever submission for this browser: show the recovery credential once
        setNewAccount(data.account);
        setSubmitting(false);
      } else {
        router.push("/profile");
      }
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (newAccount) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-xl font-semibold mb-2">Your submission was received</h1>
        <p className="text-sm text-neutral-600 mb-6">
          An anonymous account was created for you. Save these details now — this is the
          only time your recovery secret will be shown. It&apos;s the only way to access
          your account from a different browser or device.
        </p>
        <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-4 mb-6 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Public alias</div>
            <div className="font-mono text-base">{newAccount.publicAlias}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Recovery secret</div>
            <div className="font-mono text-base break-all">{newAccount.recoverySecret}</div>
          </div>
        </div>
        <button
          onClick={() => router.push("/profile")}
          className="rounded-md bg-black text-white px-4 py-2 text-sm font-medium"
        >
          I&apos;ve saved this — go to my profile
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-xl font-semibold mb-6">Describe a problem</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          minLength={10}
          maxLength={10000}
          required
          placeholder="What's the problem you're dealing with?"
          className="w-full rounded-md border border-neutral-300 p-3 text-sm"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-black text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </form>
    </main>
  );
}
