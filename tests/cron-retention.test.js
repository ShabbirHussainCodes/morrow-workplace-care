// The daily retention job: only the scheduler may run it, and it deletes with the shared
// retention window. Also checks that vercel.json really schedules it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { REQUIRED } from "../lib/env.js";
import { wire } from "../lib/wire.js";
import { cronRetentionRoute } from "../lib/routes/cron-retention.js";
import { RETENTION_DAYS } from "../assets/js/workflow.js";
import { fakeReq, fakeRes } from "./helpers/fakes.js";
import { fakeRepo } from "./helpers/fake-repo.js";

const SECRET = randomBytes(32).toString("hex");
const ENV = { DATABASE_URL: "postgresql://alice:DBPASSWORD123@ep-test.neon.tech/neondb?sslmode=require", CRON_SECRET: SECRET };
const T0 = Date.UTC(2026, 9, 4, 3, 17, 0);
const DAY = 86400 * 1000;

function setup(env = ENV) {
  const repo = fakeRepo({ now: () => T0 });
  const retentionArgs = [];
  const original = repo.deleteExpiredLeads;
  repo.deleteExpiredLeads = (days) => { retentionArgs.push(days); return original(days); };
  let built = false;
  const handler = wire(cronRetentionRoute, { methods: ["GET"], env: REQUIRED.cronRetention }, { source: env, makeRepo: () => { built = true; return repo; } });
  const call = async ({ method = "GET", headers = {} } = {}) => {
    const res = fakeRes();
    await handler(fakeReq({ method, headers }), res);
    return res;
  };
  return { repo, call, retentionArgs, built: () => built };
}

test("the scheduler's request, with the right bearer secret, runs the clean-up", async () => {
  const { call, repo } = setup();
  repo.seedLead({ createdAt: T0 - (RETENTION_DAYS * DAY + 60000) });
  repo.seedLead({ createdAt: T0 - (RETENTION_DAYS * DAY + 3 * DAY) });
  repo.seedLead({ createdAt: T0 - 1000 });
  const res = await call({ headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { deletedLeads: 2, prunedRateLimits: 0 });
  assert.equal(repo.state.leads.length, 1);
  assert.equal(res.getHeader("Cache-Control"), "no-store");
});

test("it deletes with the shared retention window and not a number of its own", async () => {
  const { call, retentionArgs } = setup();
  await call({ headers: { authorization: `Bearer ${SECRET}` } });
  assert.deepEqual(retentionArgs, [RETENTION_DAYS]);
  assert.equal(RETENTION_DAYS, 7);
});

test("a lead just inside the window is kept", async () => {
  const { call, repo } = setup();
  repo.seedLead({ createdAt: T0 - (RETENTION_DAYS * DAY - 60000) });
  await call({ headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(repo.state.leads.length, 1);
});

test("no Authorization header, a wrong secret, or a different format is a 401 and deletes nothing", async () => {
  const { call, repo } = setup();
  repo.seedLead({ createdAt: T0 - 30 * DAY });
  for (const headers of [
    {},
    { authorization: "" },
    { authorization: `Bearer ${randomBytes(32).toString("hex")}` },
    { authorization: SECRET },                       // no "Bearer "
    { authorization: `bearer ${SECRET}` },           // exact format only
    { authorization: `Bearer ${SECRET} ` },          // trailing space
    { authorization: `Bearer ${SECRET}x` },          // longer
    { authorization: `Bearer ${SECRET.slice(0, -1)}` },   // shorter
    { authorization: ["Bearer " + SECRET] },
    { "x-vercel-cron": "1" },                        // a header anyone can send is not proof
  ]) {
    const res = await call({ headers });
    assert.equal(res.statusCode, 401, JSON.stringify(headers).slice(0, 40));
    assert.deepEqual(res.body, { error: "Unauthorized" });
  }
  assert.ok(!repo.state.calls.includes("deleteExpiredLeads"));
  assert.equal(repo.state.leads.length, 1);
});

test("a missing or weak CRON_SECRET is a 500 that never deletes, and an empty Bearer cannot match it", async (t) => {
  const logged = [];
  t.mock.method(console, "error", (line) => logged.push(String(line)));
  for (const CRON_SECRET of [undefined, "", "Bearer", "short", "change-me-to-a-long-random-string-12345"]) {
    const { call, repo, built } = setup({ ...ENV, CRON_SECRET });
    const res = await call({ headers: { authorization: "Bearer " } });
    assert.equal(res.statusCode, 500, String(CRON_SECRET));
    assert.deepEqual(res.body, { error: "Server is not configured" });
    assert.equal(built(), false);
    assert.deepEqual(repo.state.calls, []);
  }
  assert.ok(logged.join("\n").includes("CRON_SECRET"));
});

test("only GET is allowed, and the secret is never echoed", async (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(String(line)));
  t.mock.method(console, "error", (line) => lines.push(String(line)));
  const { call } = setup();
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const res = await call({ method, headers: { authorization: `Bearer ${SECRET}` } });
    assert.equal(res.statusCode, 405, method);
    assert.equal(res.getHeader("Allow"), "GET");
  }
  const bad = await call({ headers: { authorization: `Bearer ${SECRET}wrong` } });
  const everything = lines.join("\n") + JSON.stringify(bad.body);
  assert.ok(!everything.includes(SECRET));
});

test("the log line holds counts only", async (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(JSON.parse(line)));
  const { call, repo } = setup();
  repo.seedLead({ name: "Distinctive Person", createdAt: T0 - 30 * DAY });
  await call({ headers: { authorization: `Bearer ${SECRET}` } });
  assert.deepEqual(lines, [{ level: "info", scope: "retention.done", deletedLeads: 1, prunedRateLimits: 0 }]);
});

// ---- the schedule in vercel.json ---------------------------------------------------------------

const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

test("vercel.json schedules the retention job once a day", () => {
  const cron = vercel.crons.find((c) => c.path === "/api/cron/retention");
  assert.ok(cron, "no cron entry for /api/cron/retention");
  assert.match(cron.schedule, /^\d{1,2} \d{1,2} \* \* \*$/, "must be a plain daily schedule");
  assert.equal(vercel.crons.length, 1);
});

test("every cron path points at a function that exists", () => {
  for (const { path } of vercel.crons) {
    assert.ok(path.startsWith("/"));
    assert.ok(existsSync(new URL(`..${path}.js`, import.meta.url)), `${path} has no file under api/`);
  }
});
