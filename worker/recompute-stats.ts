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

function sign(message: string): { timestamp: string; signature: string } {
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", WORKER_SECRET as string)
    .update(`${timestamp}.${message}`)
    .digest("hex");
  return { timestamp, signature };
}

async function main() {
  const { timestamp, signature } = sign("POST:/api/jobs/recompute-stats");
  const res = await fetch(new URL("/api/jobs/recompute-stats", SERVER_URL).toString(), {
    method: "POST",
    headers: {
      "x-worker-timestamp": timestamp,
      "x-worker-signature": signature,
    },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error("Failed to recompute stats:", res.status, data);
    process.exit(1);
  }

  console.log(`Repaired member_count/demand_score for ${data.clustersUpdated} cluster(s).`);
}

main();
