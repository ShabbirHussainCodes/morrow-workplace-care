// Environment validation fails closed and never reveals a value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ConfigError, REQUIRED, isAcceptable, loadEnv } from "../lib/env.js";
import { logError, logInfo } from "../lib/log.js";

const ROOT = new URL("../", import.meta.url).pathname;
const strong = (bytes = 32) => randomBytes(bytes).toString("hex");
const GOOD_HASH = `scrypt$131072$8$1$${strong(8)}$${strong(16)}`;

const goodEnv = () => ({
  DATABASE_URL: "postgresql://alice:pw@ep-test.neon.tech/neondb?sslmode=require",
  IP_SALT: strong(),
  SESSION_SECRET: strong(),
  CRON_SECRET: strong(),
  ADMIN_PASSWORD_HASH: GOOD_HASH,
});

function exampleFile() {
  const rows = readFileSync(join(ROOT, ".env.example"), "utf8").split("\n")
    .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]);
  return Object.fromEntries(rows);
}

function sourceFiles(dir) {
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith(".js")) out.push(path);
  }
  return out;
}

test("strong values for every route are accepted and returned", () => {
  for (const [route, names] of Object.entries(REQUIRED)) {
    const env = loadEnv(goodEnv(), names);
    assert.deepEqual(Object.keys(env), names, route);
  }
});

test("a missing variable throws ConfigError naming it", () => {
  const source = goodEnv();
  delete source.IP_SALT;
  assert.throws(() => loadEnv(source, REQUIRED.lead), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.deepEqual(err.names, ["IP_SALT"]);
    return true;
  });
});

test("every bad variable is reported at once", () => {
  assert.throws(() => loadEnv({}, REQUIRED.adminSession), (err) => {
    assert.deepEqual(err.names, REQUIRED.adminSession);
    return true;
  });
});

test("empty, blank and non-string values count as missing", () => {
  for (const bad of [undefined, null, "", "   ", 12345, {}, []]) {
    assert.equal(isAcceptable("IP_SALT", bad), false, String(bad));
  }
});

test("short secrets are weak, and the limit is exact", () => {
  assert.equal(isAcceptable("IP_SALT", "a1".repeat(7) + "b"), false);   // 15 characters
  assert.equal(isAcceptable("IP_SALT", "a1".repeat(8)), true);           // 16 characters
  assert.equal(isAcceptable("SESSION_SECRET", strong().slice(0, 31)), false);
  assert.equal(isAcceptable("SESSION_SECRET", strong().slice(0, 32)), true);
  assert.equal(isAcceptable("CRON_SECRET", strong().slice(0, 31)), false);
  assert.equal(isAcceptable("CRON_SECRET", strong().slice(0, 32)), true);
});

test("one repeated character is weak even when it is long", () => {
  assert.equal(isAcceptable("SESSION_SECRET", "a".repeat(64)), false);
  assert.equal(isAcceptable("IP_SALT", "0".repeat(32)), false);
});

test("placeholder text from the examples is never accepted", () => {
  for (const value of ["replace-with-a-random-value-that-is-long-enough-1234", "change-me-to-a-long-random-string-123456", "CHANGEME-CHANGEME-CHANGEME-CHANGEME", "<your-secret-here-long-enough-123456>"]) {
    assert.equal(isAcceptable("SESSION_SECRET", value), false, value);
  }
});

test("DATABASE_URL must be a real postgres connection string", () => {
  assert.equal(isAcceptable("DATABASE_URL", "postgres://u:p@ep-1.neon.tech/db"), true);
  assert.equal(isAcceptable("DATABASE_URL", "postgresql://u:p@ep-1.neon.tech/db?sslmode=require"), true);
  assert.equal(isAcceptable("DATABASE_URL", "postgresql://user:password@host/dbname?sslmode=require"), false);
  for (const bad of ["mysql://u:p@h/db", "ep-1.neon.tech", "postgresql://u:p@host", "postgresql://host/db"]) {
    assert.equal(isAcceptable("DATABASE_URL", bad), false, bad);
  }
});

test("ADMIN_PASSWORD_HASH must be a scrypt hash, so a pasted plain password is rejected", () => {
  assert.equal(isAcceptable("ADMIN_PASSWORD_HASH", GOOD_HASH), true);
  for (const bad of ["hunter2hunter2hunter2", "scrypt$1$2$3", "bcrypt$10$abc$def", "scrypt$x$8$1$abc$def"]) {
    assert.equal(isAcceptable("ADMIN_PASSWORD_HASH", bad), false, bad);
  }
});

test("every value in .env.example is rejected, so a copied example can never run the site", () => {
  const example = exampleFile();
  assert.ok(Object.keys(example).length >= 5);
  for (const [name, value] of Object.entries(example)) {
    assert.equal(isAcceptable(name, value), false, `${name} placeholder must not be accepted`);
  }
});

test(".env.example lists exactly the variables the functions require", () => {
  const documented = Object.keys(exampleFile()).sort();
  const required = [...new Set(Object.values(REQUIRED).flat())].sort();
  assert.deepEqual(documented, required);
});

test("code reads only documented variables", () => {
  const documented = new Set(Object.keys(exampleFile()));
  for (const dir of ["lib", "api", "scripts"]) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      for (const [, name] of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        assert.ok(documented.has(name), `${file} reads ${name}, which is not in .env.example`);
      }
    }
  }
});

test("a rejected secret never appears in the error, its JSON or the log", (t) => {
  const logged = [];
  t.mock.method(console, "error", (line) => logged.push(String(line)));
  const secret = "SUPERSECRETVALUE-too-short";
  let caught;
  try { loadEnv({ ...goodEnv(), SESSION_SECRET: secret }, REQUIRED.leads); } catch (err) { caught = err; }
  assert.ok(caught instanceof ConfigError);
  logError("config", caught, { names: caught.names });

  const everything = [caught.message, String(caught), JSON.stringify(caught), caught.stack, ...logged].join("\n");
  assert.ok(!everything.includes("SUPERSECRETVALUE"));
  assert.ok(everything.includes("SESSION_SECRET"));
});

test("logError prints the class, a code and allowed ids, never the message or personal data", (t) => {
  const logged = [];
  t.mock.method(console, "error", (line) => logged.push(JSON.parse(line)));
  const err = Object.assign(new Error('duplicate key: Key (email)=(jane@acme.com) already exists'), { name: "NeonDbError", code: "23505", detail: "Key (email)=(jane@acme.com)" });
  logError("lead", err, { leadId: "11111111-1111-4111-8111-111111111111", email: "jane@acme.com", fullName: "Jane", message: "hello" });

  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0], { level: "error", scope: "lead", error: "NeonDbError", code: "23505", leadId: "11111111-1111-4111-8111-111111111111" });
  assert.ok(!JSON.stringify(logged).includes("jane"));
});

test("logError ignores odd error values and long codes", (t) => {
  const logged = [];
  t.mock.method(console, "error", (line) => logged.push(JSON.parse(line)));
  logError("x", null);
  logError("x", "just a string with jane@acme.com");
  logError("x", { name: "E", code: "this is not a short code with jane@acme.com" });
  assert.ok(logged.every((l) => l.error && !JSON.stringify(l).includes("jane")));
  assert.equal(logged[2].code, undefined);
});

test("logInfo records counts but only for allowed keys", (t) => {
  const logged = [];
  t.mock.method(console, "log", (line) => logged.push(JSON.parse(line)));
  logInfo("retention", { deleted: 3, email: "jane@acme.com" });
  assert.deepEqual(logged[0], { level: "info", scope: "retention", deleted: 3 });
});
