import dotenv from "dotenv";
import path from "path";
import { createHmac } from "crypto";
import { generateEmbedding } from "../src/lib/ai/embed";

dotenv.config({ path: path.resolve(__dirname, ".env") });

const SERVER_URL = process.env.SERVER_URL;
const WORKER_SECRET = process.env.WORKER_SECRET;

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

interface ClusterMissingEmbedding {
  id: string;
  title: string;
  summary: string | null;
}

async function fetchClustersMissingEmbedding(): Promise<ClusterMissingEmbedding[]> {
  const { timestamp, signature } = sign("GET:/api/jobs/clusters-missing-embedding");
  const res = await fetch(new URL("/api/jobs/clusters-missing-embedding", SERVER_URL).toString(), {
    headers: { "x-worker-timestamp": timestamp, "x-worker-signature": signature },
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Failed to fetch clusters missing embeddings:", res.status, data);
    process.exit(1);
  }
  return data.clusters;
}

async function mergeOrEmbed(clusterId: string, embedding: number[]) {
  const body = JSON.stringify({ clusterId, embedding });
  const { timestamp, signature } = sign(body);
  const res = await fetch(new URL("/api/jobs/merge-cluster", SERVER_URL).toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-timestamp": timestamp,
      "x-worker-signature": signature,
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Failed for cluster ${clusterId}:`, res.status, data);
    return;
  }
  if (data.merged) {
    console.log(`Merged cluster ${clusterId} into ${data.mergedInto} (similarity ${Number(data.similarity).toFixed(3)})`);
  } else {
    console.log(`Embedded cluster ${clusterId} — no match found, kept as its own cluster`);
  }
}

async function recomputeStats() {
  const { timestamp, signature } = sign("POST:/api/jobs/recompute-stats");
  const res = await fetch(new URL("/api/jobs/recompute-stats", SERVER_URL).toString(), {
    method: "POST",
    headers: { "x-worker-timestamp": timestamp, "x-worker-signature": signature },
  });
  const data = await res.json();
  if (res.ok) {
    console.log(`Repaired member_count/demand_score for ${data.clustersUpdated} cluster(s).`);
  }
}

async function main() {
  const clusters = await fetchClustersMissingEmbedding();
  if (clusters.length === 0) {
    console.log("No clusters are missing embeddings — nothing to backfill.");
    return;
  }

  console.log(`Found ${clusters.length} cluster(s) missing an embedding. Backfilling...`);

  // Sequential on purpose: a merge changes which clusters exist, so
  // processing one at a time keeps every step working from current state.
  for (const cluster of clusters) {
    const text = `${cluster.title}. ${cluster.summary ?? ""}`;
    const embedding = await generateEmbedding(text);
    if (!embedding) {
      console.error("EMBEDDING_MODEL not set in worker/.env — cannot backfill. Set it and retry.");
      process.exit(1);
    }
    await mergeOrEmbed(cluster.id, embedding);
  }

  await recomputeStats();
  console.log("Done.");
}

main();
