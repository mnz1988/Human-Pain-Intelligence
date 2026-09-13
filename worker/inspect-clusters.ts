import dotenv from "dotenv";
import path from "path";
import { createHmac } from "crypto";

dotenv.config({ path: path.resolve(__dirname, ".env") });

const SERVER_URL = process.env.SERVER_URL;
const WORKER_SECRET = process.env.WORKER_SECRET;

if (!SERVER_URL || !WORKER_SECRET) {
  console.error("SERVER_URL and WORKER_SECRET must be set in worker/.env — see worker/.env.example");
  process.exit(1);
}

const titleQuery = process.argv[2];
if (!titleQuery) {
  console.error("Usage: npm run inspect-clusters -- \"title substring\"");
  process.exit(1);
}

function sign(message: string): { timestamp: string; signature: string } {
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", WORKER_SECRET as string)
    .update(`${timestamp}.${message}`)
    .digest("hex");
  return { timestamp, signature };
}

async function main() {
  const signedPath = `GET:/api/jobs/inspect-clusters?title=${titleQuery}`;
  const { timestamp, signature } = sign(signedPath);

  const url = new URL("/api/jobs/inspect-clusters", SERVER_URL);
  url.searchParams.set("title", titleQuery);

  const res = await fetch(url.toString(), {
    headers: { "x-worker-timestamp": timestamp, "x-worker-signature": signature },
  });
  const data = await res.json();

  if (!res.ok) {
    console.error("Failed:", res.status, data);
    process.exit(1);
  }

  console.log(`\nClusters matching "${titleQuery}":`);
  for (const c of data.clusters) {
    console.log(`  ${c.id}  embedding=${c.hasEmbedding ? "yes" : "NO"}  "${c.title}"`);
  }

  console.log(`\nPairwise similarities:`);
  if (data.similarities.length === 0) {
    console.log("  (none — fewer than 2 clusters have embeddings)");
  }
  for (const s of data.similarities) {
    console.log(`  ${s.a} <-> ${s.b}: ${s.similarity.toFixed(4)}`);
  }
}

main();
