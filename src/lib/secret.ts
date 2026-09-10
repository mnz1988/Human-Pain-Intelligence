import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

// Crockford base32: 32 symbols, 5 bits each, excludes ambiguous chars (I, L, O, U)
const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// 64-bit random token, base32-encoded, chunked for readability.
// 13 base32 chars * 5 bits = 65 bits of entropy (>= 64 bits requested).
export function generateRecoverySecret(): string {
  const bytes = randomBytes(9); // 72 bits of raw randomness, we only need 65
  let bits = "";
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, "0");
  }

  let token = "";
  for (let i = 0; i < 65; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    token += BASE32_ALPHABET[parseInt(chunk, 2)];
  }

  // Chunk into groups of 4 for readability: XXXX-XXXX-XXXX-X
  return token.match(/.{1,4}/g)!.join("-");
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

