import dotenv from "dotenv";
import path from "path";
import { createHmac } from "crypto";
import { processContribution } from "../src/lib/ai/process";
import { generateEmbedding } from "../src/lib/ai/embed";

dotenv.config({ path: path.resolve(__dirname, ".env") });

const SERVER_URL = process.env.SERVER_URL;
const WORKER_SECRET = process.env.WORKER_SECRET;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 10000;
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 5;

if (!SERVER_URL || !WORKER_SECRET) {
  console.error("SERVER_URL and WORKER_SECRET must be set in worker/.env — see worker/.env.example");
  process.exit(1);
}

function sign(message: string): { timestamp: string; signature: string } {
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", WORKER_SECRET as string)
    .update(`${timestamp}.${message}`)
    .digest("hex");
  return { timestamp, signature };
}

interface PendingJob {
  contributionId: string;
  rawText: string;
}

async function fetchPendingJobs(): Promise<PendingJob[]> {
  const { timestamp, signature } = sign("GET:/api/jobs/pending");
  const url = new URL("/api/jobs/pending", SERVER_URL);
  url.searchParams.set("limit", String(BATCH_SIZE));

  const res = await fetch(url.toString(), {
    headers: {
      "x-worker-timestamp": timestamp,
      "x-worker-signature": signature,
    },
  });

  if (!res.ok) {
    console.error("Failed to fetch pending jobs:", res.status, await res.text());
    return [];
  }

  const data = await res.json();
  return data.jobs ?? [];
}

async function submitResult(
  contributionId: string,
  success: boolean,
  result?: unknown,
  embedding?: number[] | null,
  error?: string
) {
  const body = JSON.stringify({ contributionId, success, result, embedding, error });
  const { timestamp, signature } = sign(body);

  const res = await fetch(new URL("/api/jobs/complete", SERVER_URL).toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-timestamp": timestamp,
      "x-worker-signature": signature,
    },
    body,
  });

  if (!res.ok) {
    console.error(`Failed to submit result for ${contributionId}:`, res.status, await res.text());
  } else {
    const data = await res.json().catch(() => null);
    if (success && data?.matchedExistingCluster) {
      console.log(
        `✓ Processed: ${contributionId} — merged into existing cluster ${data.problemId} (similarity ${Number(
          data.similarity
        ).toFixed(3)})`
      );
    } else {
      console.log(`${success ? "✓ Processed" : "✗ Marked failed"}: ${contributionId}`);
    }
  }
}

async function processOnce() {
  const jobs = await fetchPendingJobs();
  if (jobs.length === 0) {
    console.log(new Date().toLocaleTimeString(), "— no pending jobs");
    return;
  }

  console.log(new Date().toLocaleTimeString(), `— picked up ${jobs.length} job(s)`);

  for (const job of jobs) {
    try {
      const result = await processContribution(job.rawText);
      const embedding = await generateEmbedding(
        `${result.problem.title}. ${result.problem.summary}`
      );
      await submitResult(job.contributionId, true, result, embedding);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.error(`Failed to process ${job.contributionId}:`, message);
      await submitResult(job.contributionId, false, undefined, null, message);
    }
  }
}

async function main() {
  console.log(`Worker started. Polling ${SERVER_URL} every ${POLL_INTERVAL_MS}ms. Ctrl+C to stop.`);
  for (;;) {
    try {
      await processOnce();
    } catch (err) {
      console.error("Poll cycle failed:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main();
