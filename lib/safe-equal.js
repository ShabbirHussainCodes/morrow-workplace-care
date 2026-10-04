// Constant-time string comparison for secrets, tokens and signatures.
//
// crypto.timingSafeEqual throws when the two buffers have different lengths, and checking the
// lengths first would leak them. Both values are therefore hashed to the same size with a
// throwaway key before they are compared.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const key = randomBytes(32);
  const left = createHmac("sha256", key).update(a).digest();
  const right = createHmac("sha256", key).update(b).digest();
  return timingSafeEqual(left, right);
}
