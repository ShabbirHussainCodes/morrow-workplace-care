// Admin password hashing with scrypt from Node's built-in crypto module.
// Stored form: scrypt$N$r$p$salt$hash (salt and hash in base64url). The cost settings travel
// inside the string, so they can be raised later without breaking an existing hash.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { PASSWORD_HASH_PATTERN } from "./env.js";

const scryptAsync = promisify(scrypt);

// N=2^17, r=8, p=1 uses about 128 MiB and roughly 0.8 s of CPU on a developer machine.
// These numbers are from memory of the OWASP guidance, which I could not open to confirm.
export const SCRYPT = { N: 2 ** 17, r: 8, p: 1 };
export const KEY_BYTES = 32;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;   // also bounds the work an attacker can ask for

// A hash read from the environment is trusted, but a typo must not be able to ask for
// gigabytes of memory, so the settings are kept inside a sane range.
const N_RANGE = [2 ** 14, 2 ** 20];

const normalise = (password) => password.normalize("NFKC");
const isPowerOfTwo = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
// Node refuses to run scrypt when the memory it needs exceeds maxmem
const maxmem = (N, r) => Math.max(32 * 1024 * 1024, 256 * N * r);

/** Hash a new password. Throws when it is too short or too long to be accepted. */
export async function hashPassword(password, { N, r, p } = SCRYPT) {
  if (typeof password !== "string") throw new TypeError("The password must be text.");
  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_LENGTH) throw new RangeError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (length > MAX_PASSWORD_LENGTH) throw new RangeError(`The password must be at most ${MAX_PASSWORD_LENGTH} characters.`);

  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(normalise(password), salt, KEY_BYTES, { N, r, p, maxmem: maxmem(N, r) });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/**
 * Check a password against a stored hash. Never throws: anything that is not a well-formed
 * hash, or a password that is not text of an acceptable length, is simply "no". The cost
 * of scrypt is only paid for an input that could be right.
 * `derive` is replaceable so a test can prove when scrypt is (not) called.
 */
export async function verifyPassword(password, stored, derive = scryptAsync) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const length = Array.from(password).length;
  if (length < 1 || length > MAX_PASSWORD_LENGTH) return false;

  const match = PASSWORD_HASH_PATTERN.exec(stored);
  if (!match) return false;
  const [N, r, p] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!isPowerOfTwo(N) || N < N_RANGE[0] || N > N_RANGE[1]) return false;
  if (!Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4) return false;

  const salt = Buffer.from(match[4], "base64url");
  const expected = Buffer.from(match[5], "base64url");
  if (salt.length < 8 || expected.length < 16 || expected.length > 64) return false;

  try {
    const actual = await derive(normalise(password), salt, expected.length, { N, r, p, maxmem: maxmem(N, r) });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
