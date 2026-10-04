// The rate limiter and the IP hashing it depends on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RATE_RULES, checkLimit } from "../lib/ratelimit.js";
import { clientIp, hashIp } from "../lib/ip.js";
import { fakeRepo } from "./helpers/fake-repo.js";

const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);

test("the first five enquiries from one client pass and the sixth does not", async () => {
  const repo = fakeRepo({ now: () => T0 });
  const results = [];
  for (let i = 0; i < 6; i += 1) results.push(await checkLimit(repo, "lead", "client-a", T0));
  assert.deepEqual(results.map((r) => r.allowed), [true, true, true, true, true, false]);
  assert.deepEqual(results.map((r) => r.count), [1, 2, 3, 4, 5, 6]);
  assert.equal(RATE_RULES.lead.limit, 5);
});

test("clients and rules count separately", async () => {
  const repo = fakeRepo({ now: () => T0 });
  for (let i = 0; i < 6; i += 1) await checkLimit(repo, "lead", "client-a", T0);
  assert.equal((await checkLimit(repo, "lead", "client-b", T0)).allowed, true);
  assert.equal((await checkLimit(repo, "leadsRead", "client-a", T0)).allowed, true);
  assert.deepEqual(repo.state.hitBuckets.slice(-2), ["lead:client-b", "leadsRead:client-a"]);
});

test("a new window starts a new count", async () => {
  let clock = T0;
  const repo = fakeRepo({ now: () => clock });
  for (let i = 0; i < 6; i += 1) await checkLimit(repo, "lead", "client-a", clock);
  assert.equal((await checkLimit(repo, "lead", "client-a", clock)).allowed, false);
  clock += RATE_RULES.lead.windowSeconds * 1000;
  assert.equal((await checkLimit(repo, "lead", "client-a", clock)).allowed, true);
});

test("retryAfter counts the seconds left in the window", async () => {
  const repo = fakeRepo({ now: () => T0 });
  const start = Date.UTC(2026, 9, 4, 12, 0, 0);   // exactly on a ten-minute boundary
  assert.equal((await checkLimit(repo, "loginIp", "x", start)).retryAfter, 600);
  assert.equal((await checkLimit(repo, "loginIp", "x", start + 90 * 1000)).retryAfter, 510);
});

test("a hit is counted even when it is refused", async () => {
  const repo = fakeRepo({ now: () => T0 });
  for (let i = 0; i < 8; i += 1) await checkLimit(repo, "lead", "client-a", T0);
  assert.equal((await checkLimit(repo, "lead", "client-a", T0)).count, 9);
});

test("an unknown rule is a programming error", async () => {
  await assert.rejects(() => checkLimit(fakeRepo(), "nope", "x"), /Unknown rate limit rule/);
});

test("login is limited per client and across all clients", () => {
  assert.equal(RATE_RULES.loginIp.limit, 5);
  assert.ok(RATE_RULES.loginAll.limit > RATE_RULES.loginIp.limit);
});

// ---- IP hashing -------------------------------------------------------------------------

test("the client IP is the first X-Forwarded-For entry", () => {
  assert.equal(clientIp({ "x-forwarded-for": "203.0.113.7" }), "203.0.113.7");
  assert.equal(clientIp({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }), "203.0.113.7");
  assert.equal(clientIp({}), "unknown");
  assert.equal(clientIp({ "x-forwarded-for": "" }), "unknown");
  assert.equal(clientIp({ "x-forwarded-for": ["203.0.113.7"] }), "unknown");
});

test("the hash is stable, depends on the salt and the address, and hides the address", () => {
  const headers = { "x-forwarded-for": "203.0.113.7" };
  const salt = "a-long-random-salt-value";
  assert.equal(hashIp(headers, salt), hashIp(headers, salt));
  assert.notEqual(hashIp(headers, salt), hashIp(headers, "another-long-random-salt"));
  assert.notEqual(hashIp(headers, salt), hashIp({ "x-forwarded-for": "203.0.113.8" }, salt));
  assert.match(hashIp(headers, salt), /^[0-9a-f]{64}$/);
  assert.ok(!hashIp(headers, salt).includes("203"));
});

test("there is no default salt: a missing or empty one throws", () => {
  for (const salt of [undefined, null, "", 0, {}]) {
    assert.throws(() => hashIp({ "x-forwarded-for": "203.0.113.7" }, salt), /IP_SALT is required/);
  }
});
