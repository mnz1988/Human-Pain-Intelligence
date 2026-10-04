import dotenv from "dotenv";
import path from "path";
import { createHmac } from "crypto";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const SERVER_URL = process.env.SERVER_URL;
const WORKER_SECRET = process.env.WORKER_SECRET;

if (!SERVER_URL || !WORKER_SECRET) {
  console.error("SERVER_URL and WORKER_SECRET must be set in importer/.env — see importer/.env.example");
  process.exit(1);
}

export interface ImportItem {
  text: string;
  sourceType: string; // e.g. "reddit", "twitter", "forum", "ninisite" — required
  senderId?: string; // external user handle/ID on that site — same person's posts reuse the same senderId
}

interface BatchResult {
  imported: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  errors: string[];
}

function sign(message: string): { timestamp: string; signature: string } {
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", WORKER_SECRET as string)
    .update(`${timestamp}.${message}`)
    .digest("hex");
  return { timestamp, signature };
}

async function submitOneBatch(items: ImportItem[]): Promise<BatchResult> {
  const body = JSON.stringify({ items });
  const { timestamp, signature } = sign(body);

  const res = await fetch(new URL("/api/jobs/bulk-import", SERVER_URL).toString(), {
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
    throw new Error(`Import failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

/**
 * Submits any number of items, automatically chunked into batches of 200
 * (the server's per-request limit). Logs progress as it goes.
 */
export async function submitBatch(items: ImportItem[]): Promise<BatchResult> {
  const CHUNK_SIZE = 200;
  const totals: BatchResult = { imported: 0, skippedDuplicate: 0, skippedInvalid: 0, errors: [] };

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    console.log(`Submitting batch ${i / CHUNK_SIZE + 1} (${chunk.length} items)...`);
    const result = await submitOneBatch(chunk);
    totals.imported += result.imported;
    totals.skippedDuplicate += result.skippedDuplicate;
    totals.skippedInvalid += result.skippedInvalid;
    totals.errors.push(...result.errors);
    console.log(
      `  imported=${result.imported} duplicate=${result.skippedDuplicate} invalid=${result.skippedInvalid} errors=${result.errors.length}`
    );
  }

  return totals;
}
