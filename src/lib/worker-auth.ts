import { createHmac, timingSafeEqual } from "crypto";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes

function computeSignature(secret: string, timestamp: string, message: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${message}`).digest("hex");
}

export function signWorkerRequest(
  secret: string,
  timestamp: number,
  message: string
): string {
  return computeSignature(secret, String(timestamp), message);
}

export function verifyWorkerRequest(
  timestampHeader: string | null,
  signatureHeader: string | null,
  message: string
): { ok: true } | { ok: false; error: string } {
  const secret = process.env.WORKER_SECRET;
  if (!secret) {
    return { ok: false, error: "WORKER_SECRET is not configured on the server" };
  }

  if (!timestampHeader || !signatureHeader) {
    return { ok: false, error: "missing signature headers" };
  }

  const age = Date.now() - Number(timestampHeader);
  if (!Number.isFinite(age) || Math.abs(age) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, error: "timestamp outside allowed window" };
  }

  const expected = computeSignature(secret, timestampHeader, message);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signatureHeader, "hex");

  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, error: "invalid signature" };
  }

  return { ok: true };
}
