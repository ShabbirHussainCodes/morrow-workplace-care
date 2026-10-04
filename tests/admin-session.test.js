// POST and DELETE /api/admin/session. The central promise: the rate limit is checked BEFORE the
// password is verified, so failed attempts cannot be used to burn CPU on scrypt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { REQUIRED } from "../lib/env.js";
import { wire } from "../lib/wire.js";
import { createAdminSessionRoute } from "../lib/routes/admin-session.js";
import { hashPassword, verifyPassword as realVerify } from "../lib/password.js";
import { hashIp } from "../lib/ip.js";
import { RATE_RULES } from "../lib/ratelimit.js";
import { SESSION_COOKIE, SESSION_SECONDS, sessionFromRequest } from "../lib/session.js";
import { fakeReq, fakeRes } from "./helpers/fakes.js";
import { fakeRepo } from "./helpers/fake-repo.js";

const strong = () => randomBytes(32).toString("hex");
const PASSWORD = "Sup3rSecret-admin-passw0rd";
const CHEAP = { N: 2 ** 14, r: 8, p: 1 };
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" };
const HASH = await hashPassword(PASSWORD, CHEAP);

const ENV = {
  DATABASE_URL: "postgresql://alice:DBPASSWORD123@ep-test.neon.tech/neondb?sslmode=require",
  IP_SALT: strong(),
  SESSION_SECRET: strong(),
  ADMIN_PASSWORD_HASH: HASH,
};

/**
 * A handler whose repo and password check write to one shared event log, so a test can read the
 * exact order in which the limiter and the verification ran.
 */
function setup({ env = ENV, clock = { t: T0 }, verify } = {}) {
  const events = [];
  const repo = fakeRepo({ now: () => clock.t });
  const hit = repo.hitRateLimit;
  repo.hitRateLimit = async (bucket, windowSeconds) => {
    events.push(`limit:${bucket.split(":")[0]}`);
    return hit(bucket, windowSeconds);
  };
  // By default the spy checks the password for real; a test can pass its own result
  const verifyPassword = async (password, stored) => {
    events.push("verify");
    return verify ? verify(password, stored) : realVerify(password, stored);
  };
  const handler = wire(
    createAdminSessionRoute({ verifyPassword }),
    { methods: ["POST", "DELETE"], env: REQUIRED.adminSession, failure: "Could not complete the request" },
    { source: env, makeRepo: () => repo, now: () => clock.t },
  );
  const call = async ({ method = "POST", headers = SAME_ORIGIN, body, bodyThrows = false, ip = "203.0.113.7" } = {}) => {
    const res = fakeRes();
    await handler(fakeReq({ method, headers: { "x-forwarded-for": ip, ...headers }, body, bodyThrows }), res);
    return res;
  };
  const login = (password, ip) => call({ body: { password }, ip });
  const verifyCount = () => events.filter((e) => e === "verify").length;
  return { call, login, events, repo, verifyCount, clock };
}

function capture(t) {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(String(line)));
  t.mock.method(console, "error", (line) => lines.push(String(line)));
  return lines;
}

// ---- signing in ------------------------------------------------------------------------------

test("the right password sets a signed, HttpOnly, Secure, SameSite=Strict cookie for eight hours", async () => {
  const { login, clock } = setup();
  const res = await login(PASSWORD);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  const cookie = res.getHeader("Set-Cookie");
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9._~-]+; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}$`));
  assert.equal(SESSION_SECONDS, 28800);
  assert.equal(res.getHeader("Cache-Control"), "no-store");

  const token = cookie.split(";")[0];
  assert.ok(sessionFromRequest(fakeReq({ headers: { cookie: token } }), ENV.SESSION_SECRET, clock.t));
});

test("a wrong password is a 401 with no cookie", async () => {
  const { login } = setup();
  const res = await login("not the password at all");
  assert.equal(res.statusCode, 401);
  assert.equal(res.getHeader("Set-Cookie"), undefined);
  assert.deepEqual(res.body, { error: "Incorrect password." });
});

// ---- the order: limiter first, scrypt second ----------------------------------------------------

test("when the limiter allows the attempt it runs first, both buckets, then exactly one verification", async () => {
  const { login, events } = setup();
  await login(PASSWORD);
  assert.deepEqual(events, ["limit:loginIp", "limit:loginAll", "verify"]);
});

test("every verification is immediately preceded by both limiter checks", async () => {
  const { login, events } = setup();
  for (const [i, pw] of ["wrong one", PASSWORD, "wrong two"].entries()) await login(pw, `198.51.100.${i + 1}`);
  const verifyAt = events.flatMap((e, i) => (e === "verify" ? [i] : []));
  assert.equal(verifyAt.length, 3);
  for (const at of verifyAt) assert.deepEqual(events.slice(at - 2, at + 1), ["limit:loginIp", "limit:loginAll", "verify"]);
});

test("a blocked client with the CORRECT password is refused and the password is never verified", async () => {
  const { login, events, verifyCount } = setup();
  for (let i = 0; i < RATE_RULES.loginIp.limit; i += 1) await login("wrong password guess");
  events.length = 0;

  const res = await login(PASSWORD);
  assert.equal(res.statusCode, 429);
  assert.equal(res.getHeader("Set-Cookie"), undefined);
  assert.match(res.getHeader("Retry-After"), /^\d+$/);
  assert.equal(verifyCount(), 0);
  assert.deepEqual(events, ["limit:loginIp"]);
});

test("a blocked client with a WRONG password is refused without verification too", async () => {
  const { login, events, verifyCount } = setup();
  for (let i = 0; i < RATE_RULES.loginIp.limit; i += 1) await login("wrong password guess");
  events.length = 0;

  const res = await login("another wrong guess");
  assert.equal(res.statusCode, 429);
  assert.equal(verifyCount(), 0);
});

test("many blocked attempts in a row cost no verification at all", async () => {
  const { login, verifyCount } = setup();
  for (let i = 0; i < RATE_RULES.loginIp.limit; i += 1) await login("wrong password guess");
  const before = verifyCount();
  for (let i = 0; i < 50; i += 1) assert.equal((await login(`guess ${i} of many`)).statusCode, 429);
  assert.equal(verifyCount(), before);
});

test("a successful sign-in counts against the limit too (every attempt is counted)", async () => {
  const { login, verifyCount } = setup();
  for (let i = 0; i < RATE_RULES.loginIp.limit; i += 1) assert.equal((await login(PASSWORD)).statusCode, 200);
  assert.equal((await login(PASSWORD)).statusCode, 429);
  assert.equal(verifyCount(), RATE_RULES.loginIp.limit);
});

test("the all-clients limit blocks on its own, before any verification", async () => {
  const { login, events, verifyCount } = setup();
  // Six clients use up five attempts each: 30 attempts, the all-clients limit
  for (let client = 1; client <= 6; client += 1) {
    for (let i = 0; i < RATE_RULES.loginIp.limit; i += 1) await login("wrong password guess", `198.51.100.${client}`);
  }
  assert.equal(verifyCount(), RATE_RULES.loginAll.limit);
  events.length = 0;

  const res = await login(PASSWORD, "198.51.100.200");      // a seventh client, never seen before
  assert.equal(res.statusCode, 429);
  assert.equal(verifyCount(), 0);
  assert.deepEqual(events, ["limit:loginIp", "limit:loginAll"]);
});

test("a client that is already blocked does not use up the all-clients limit", async () => {
  const { login, repo } = setup();
  for (let i = 0; i < RATE_RULES.loginIp.limit + 25; i += 1) await login("wrong password guess");
  const allClients = repo.state.hitBuckets.filter((b) => b.startsWith("loginAll:")).length;
  assert.equal(allClients, RATE_RULES.loginIp.limit);
});

test("another client can still sign in while one is blocked", async () => {
  const { login } = setup();
  for (let i = 0; i < RATE_RULES.loginIp.limit + 1; i += 1) await login("wrong password guess");
  assert.equal((await login(PASSWORD, "198.51.100.99")).statusCode, 200);
});

test("the limit resets in the next window", async () => {
  const { login, clock } = setup();
  for (let i = 0; i < RATE_RULES.loginIp.limit + 1; i += 1) await login("wrong password guess");
  clock.t += RATE_RULES.loginIp.windowSeconds * 1000;
  assert.equal((await login(PASSWORD)).statusCode, 200);
});

test("a missing, empty, over-long or non-text password is a 400 that touches neither the limiter nor scrypt", async () => {
  const { call, events } = setup();
  for (const body of [{}, { password: "" }, { password: 12345678 }, { password: ["x"] }, { password: null }, { password: "a".repeat(257) }, { other: PASSWORD }]) {
    assert.equal((await call({ body })).statusCode, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal((await call({ bodyThrows: true })).statusCode, 400);
  assert.equal((await call({ body: [] })).statusCode, 400);
  assert.deepEqual(events, []);
});

test("a password of exactly the maximum length is checked", async () => {
  const { login, verifyCount } = setup();
  assert.equal((await login("a".repeat(256))).statusCode, 401);
  assert.equal(verifyCount(), 1);
});

// ---- same-origin on sign-in and sign-out -------------------------------------------------------

test("a sign-in that did not come from this site is a 403 before anything else runs", async () => {
  const { call, events } = setup();
  for (const headers of [
    { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "none" },
    {}, { origin: "https://evil.example", host: "morrow.example" },
  ]) {
    assert.equal((await call({ headers, body: { password: PASSWORD } })).statusCode, 403, JSON.stringify(headers));
  }
  assert.deepEqual(events, []);
});

test("the Origin and Host fallback signs in when Sec-Fetch-Site is absent", async () => {
  const { call } = setup();
  const res = await call({ headers: { origin: "https://morrow.example", host: "morrow.example" }, body: { password: PASSWORD } });
  assert.equal(res.statusCode, 200);
});

// ---- signing out -------------------------------------------------------------------------------

test("signing out clears the cookie, with or without a session", async () => {
  const { call } = setup();
  const res = await call({ method: "DELETE" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader("Set-Cookie"), `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
});

test("signing out from another site is a 403 and does not touch the cookie", async () => {
  const { call } = setup();
  for (const headers of [{ "sec-fetch-site": "cross-site" }, {}, { origin: "https://evil.example", host: "morrow.example" }]) {
    const res = await call({ method: "DELETE", headers });
    assert.equal(res.statusCode, 403);
    assert.equal(res.getHeader("Set-Cookie"), undefined);
  }
});

test("only POST and DELETE are allowed", async () => {
  const { call } = setup();
  for (const method of ["GET", "PUT", "PATCH"]) {
    const res = await call({ method });
    assert.equal(res.statusCode, 405, method);
    assert.equal(res.getHeader("Allow"), "POST, DELETE");
  }
});

// ---- configuration and secrecy -------------------------------------------------------------------

test("a missing or weak setting is a 500 and the password is never checked", async () => {
  for (const patch of [{ ADMIN_PASSWORD_HASH: undefined }, { ADMIN_PASSWORD_HASH: "plain-text-password" }, { SESSION_SECRET: undefined }, { SESSION_SECRET: "short" }, { IP_SALT: undefined }]) {
    const { login, events } = setup({ env: { ...ENV, ...patch } });
    const res = await login(PASSWORD);
    assert.equal(res.statusCode, 500, JSON.stringify(Object.keys(patch)));
    assert.deepEqual(res.body, { error: "Server is not configured" });
    assert.deepEqual(events, []);
  }
});

test("the password and the hash never appear in a response or a log line", async (t) => {
  const lines = capture(t);
  const { login } = setup();
  const responses = [await login(PASSWORD), await login("a wrong password 123")];
  const everything = lines.join("\n") + JSON.stringify(responses.map((r) => r.body)) + JSON.stringify(responses.map((r) => r.headers));
  assert.ok(!everything.includes("Sup3rSecret"));
  assert.ok(!everything.includes("a wrong password 123"));
  assert.ok(!everything.includes(HASH));
  assert.ok(!everything.includes("203.0.113.7"));
  assert.ok(lines.some((l) => l.includes("admin.login")));
});

test("the limiter keys on a hash of the address, never the address itself", async () => {
  const { login, repo } = setup();
  await login(PASSWORD, "203.0.113.7");
  const expected = `loginIp:${hashIp({ "x-forwarded-for": "203.0.113.7" }, ENV.IP_SALT)}`;
  assert.ok(repo.state.hitBuckets.includes(expected));
  assert.ok(repo.state.hitBuckets.every((b) => !b.includes("203.0.113.7")));
});
