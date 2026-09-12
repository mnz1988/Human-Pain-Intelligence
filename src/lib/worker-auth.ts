import { createHmac, timingSafeEqual } from "crypto";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes — rejects replayed requests older than this

export function signWorkerRequest(secret: string, timestamp: number, message: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${message}`).digest("hex");
}

export function verifyWorkerRequest(
  timestampHeader: string | null,
  signatureHeader: string | null,
  message: string
): { ok: boolean; error?: string } {
  const secret = process.env.WORKER_SECRET;
  if (!secret) {
    return { ok: false, error: "WORKER_SECRET not configured on server" };
  }
  if (!timestampHeader || !signatureHeader) {
    return { ok: false, error: "missing signature headers" };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, error: "invalid timestamp" };
  }
  if (Math.abs(Date.now() - timestamp) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, error: "timestamp outside allowed window" };
  }

  const expected = signWorkerRequest(secret, timestamp, message);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(signatureHeader, "hex");

  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, error: "invalid signature" };
  }

  return { ok: true };
}
