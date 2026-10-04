// Password hashing, the constant-time comparison, and the hash-password script.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  SCRYPT, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, hashPassword, verifyPassword,
} from "../lib/password.js";
import { PASSWORD_HASH_PATTERN } from "../lib/env.js";
import { safeEqual } from "../lib/safe-equal.js";

// The lowest cost the verifier accepts keeps these tests fast. The hash carries its own settings.
const CHEAP = { N: 2 ** 14, r: 8, p: 1 };
const PASSWORD = "correct horse battery staple";
const SCRIPT = new URL("../scripts/hash-password.js", import.meta.url).pathname;

test("a hash has the documented format and a fresh salt every time", async () => {
  const [a, b] = await Promise.all([hashPassword(PASSWORD, CHEAP), hashPassword(PASSWORD, CHEAP)]);
  assert.match(a, PASSWORD_HASH_PATTERN);
  assert.ok(a.startsWith("scrypt$16384$8$1$"));
  assert.notEqual(a, b);
});

test("the production cost settings are the documented ones", () => {
  assert.deepEqual(SCRYPT, { N: 131072, r: 8, p: 1 });
});

test("the right password verifies, a wrong one does not", async () => {
  const hash = await hashPassword(PASSWORD, CHEAP);
  assert.equal(await verifyPassword(PASSWORD, hash), true);
  assert.equal(await verifyPassword("correct horse battery stapl", hash), false);
  assert.equal(await verifyPassword(PASSWORD + " ", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("a composed and a decomposed form of the same password match", async () => {
  const hash = await hashPassword("caf\u{e9} au lait 2026", CHEAP);
  assert.equal(await verifyPassword("cafe\u{301} au lait 2026", hash), true);
});

test("passwords that are too short, too long or not text are refused when hashing", async () => {
  await assert.rejects(() => hashPassword("a".repeat(MIN_PASSWORD_LENGTH - 1), CHEAP), RangeError);
  await assert.rejects(() => hashPassword("a".repeat(MAX_PASSWORD_LENGTH + 1), CHEAP), RangeError);
  await assert.rejects(() => hashPassword(12345678901234, CHEAP), TypeError);
  await assert.rejects(() => hashPassword(undefined, CHEAP), TypeError);
});

test("an over-long or non-text password is refused without running scrypt", async () => {
  const hash = await hashPassword(PASSWORD, CHEAP);
  let calls = 0;
  const derive = async () => { calls += 1; return Buffer.alloc(32); };
  assert.equal(await verifyPassword("a".repeat(MAX_PASSWORD_LENGTH + 1), hash, derive), false);
  assert.equal(await verifyPassword("", hash, derive), false);
  assert.equal(await verifyPassword(undefined, hash, derive), false);
  assert.equal(await verifyPassword({ toString: () => PASSWORD }, hash, derive), false);
  assert.equal(calls, 0);
});

test("a malformed stored hash is simply 'no' and never throws or runs scrypt", async () => {
  let calls = 0;
  const derive = async () => { calls += 1; return Buffer.alloc(32); };
  const good = await hashPassword(PASSWORD, CHEAP);
  const [, , , , salt, key] = good.split("$");
  const bad = [
    undefined, null, "", "plaintext-password", "scrypt$1$2$3", "bcrypt$16384$8$1$abc$def",
    `scrypt$16384$8$1$$${key}`,                      // empty salt
    `scrypt$16384$8$1$${salt}$`,                      // empty hash
    `scrypt$16385$8$1$${salt}$${key}`,                // N is not a power of two
    `scrypt$1024$8$1$${salt}$${key}`,                 // N below the allowed range
    `scrypt$${2 ** 21}$8$1$${salt}$${key}`,           // N above the allowed range (would use huge memory)
    `scrypt$16384$0$1$${salt}$${key}`,                // r out of range
    `scrypt$16384$8$99$${salt}$${key}`,               // p out of range
    `scrypt$16384$8$1$${salt}$abc`,                   // hash too short
    `scrypt$16384$8$1$abc$${key}`,                    // salt too short
    `${good}$extra`,
  ];
  for (const stored of bad) {
    assert.equal(await verifyPassword(PASSWORD, stored, derive), false, String(stored));
  }
  assert.equal(calls, 0);
});

test("a hash made with other settings still verifies, because the settings are in the string", async () => {
  const other = await hashPassword(PASSWORD, { N: 2 ** 15, r: 8, p: 1 });
  assert.ok(other.startsWith("scrypt$32768$8$1$"));
  assert.equal(await verifyPassword(PASSWORD, other), true);
});

test("a failure inside scrypt is 'no', not a crash", async () => {
  const hash = await hashPassword(PASSWORD, CHEAP);
  assert.equal(await verifyPassword(PASSWORD, hash, async () => { throw new Error("out of memory"); }), false);
});

// ---- constant-time comparison ------------------------------------------------------------

test("safeEqual is true only for identical strings", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual("abc", "abd"), false);
});

test("safeEqual copes with different lengths, where timingSafeEqual would throw", () => {
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", "a"), false);
  assert.equal(safeEqual("a".repeat(5000), "a"), false);
});

test("safeEqual refuses anything that is not a string", () => {
  for (const [a, b] of [[undefined, "a"], ["a", null], [1, 1], [Buffer.from("a"), "a"], [["a"], ["a"]]]) {
    assert.equal(safeEqual(a, b), false);
  }
});

// ---- scripts/hash-password.js --------------------------------------------------------------

test("the script hashes a password read from stdin, using the production settings", () => {
  const run = spawnSync(process.execPath, [SCRIPT], { input: `${PASSWORD}\n`, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const hash = run.stdout.trim();
  assert.match(hash, PASSWORD_HASH_PATTERN);
  assert.ok(hash.startsWith("scrypt$131072$8$1$"));
  assert.ok(!run.stderr.includes(PASSWORD));
  return verifyPassword(PASSWORD, hash).then((ok) => assert.equal(ok, true));
});

test("the script refuses a password given as an argument and never repeats it", () => {
  const run = spawnSync(process.execPath, [SCRIPT, "my-secret-password-123"], { input: "", encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /Do not pass the password as an argument/);
  assert.ok(!(run.stdout + run.stderr).includes("my-secret-password-123"));
});

test("the script refuses a short password and prints no hash", () => {
  const run = spawnSync(process.execPath, [SCRIPT], { input: "short\n", encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /at least 12 characters/);
});
