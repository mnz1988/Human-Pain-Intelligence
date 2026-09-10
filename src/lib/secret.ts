import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const WORDS = [
  "willow", "granite", "ember", "salt", "cedar", "brook", "marble", "flint",
  "moss", "coral", "birch", "amber", "clay", "reed", "frost", "slate",
  "linen", "copper", "pearl", "ash", "maple", "quartz", "ivory", "storm",
];

// Human-typeable recovery secret, e.g. "willow-granite-ember-42"
export function generateRecoverySecret(): string {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  const number = Math.floor(10 + Math.random() * 90);
  return `${pick()}-${pick()}-${pick()}-${number}`;
}

// Format: salt:hash, both hex
export function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(secret, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(secret, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
