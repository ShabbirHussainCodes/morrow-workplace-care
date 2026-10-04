// GET and PATCH /api/leads: the public monitor never carries personal data, and only a
// signed-in admin may change a stage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { REQUIRED } from "../lib/env.js";
import { wire } from "../lib/wire.js";
import { leadsRoute } from "../lib/routes/leads.js";
import { RATE_RULES } from "../lib/ratelimit.js";
import { SESSION_COOKIE, createSessionToken } from "../lib/session.js";
import { RETENTION_DAYS, STAGES } from "../assets/js/workflow.js";
import { fakeReq, fakeRes } from "./helpers/fakes.js";
import { fakeRepo } from "./helpers/fake-repo.js";

const strong = () => randomBytes(32).toString("hex");
const ENV = {
  DATABASE_URL: "postgresql://alice:DBPASSWORD123@ep-test.neon.tech/neondb?sslmode=require",
  IP_SALT: strong(),
  SESSION_SECRET: strong(),
};
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const DAY = 86400 * 1000;
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" };

// Personal details that must never appear in a public answer
const PII = {
  name: "Zed Zebrowski", email: "zed.zebrowski@zebra-holdings.example", company: "Zebra Holdings Ltd",
  message: "Our zebra crossing lobby needs cleaning", followUp: { subject: "Walkthrough for Zebra Holdings Ltd", body: "Hi Zed, thanks for writing about Zebra Holdings" },
};

function setup({ env = ENV, clock = { t: T0 } } = {}) {
  const repo = fakeRepo({ now: () => clock.t });
  const handler = wire(
    leadsRoute,
    { methods: ["GET", "PATCH"], env: REQUIRED.leads, failure: "Could not load leads" },
    { source: env, makeRepo: () => repo, now: () => clock.t },
  );
  const cookie = (secret = ENV.SESSION_SECRET, at = clock.t) => `${SESSION_COOKIE}=${createSessionToken(secret, at)}`;
  const call = async ({ method = "GET", headers = {}, query = {}, body, bodyThrows = false, ip = "203.0.113.7" } = {}) => {
    const res = fakeRes();
    await handler(fakeReq({ method, headers: { "x-forwarded-for": ip, ...headers }, query, body, bodyThrows }), res);
    return res;
  };
  return { repo, call, cookie, clock };
}

function capture(t) {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(String(line)));
  t.mock.method(console, "error", (line) => lines.push(String(line)));
  return lines;
}

// ---- GET: public monitor ---------------------------------------------------------------------

test("the public list holds no names, emails, companies, messages or drafts (known issue 10)", async () => {
  const { repo, call } = setup();
  repo.seedLead(PII);
  repo.seedLead({ ...PII, name: "Second Person", email: "second@example.com" });
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.admin, false);
  assert.equal(res.body.leads.length, 2);

  const everything = JSON.stringify(res.body);
  for (const secret of [PII.name, PII.email, PII.company, "zebra", "Zebra", "Second Person", "second@example.com", "Hi Zed", "Walkthrough for"]) {
    assert.ok(!everything.includes(secret), `public answer contains "${secret}"`);
  }
});

test("a public lead has exactly the monitor fields, with readable labels and a UUID", async () => {
  const { repo, call } = setup();
  repo.seedLead({ spaceType: "coworking", timing: "two-weeks", priority: "Medium", service: "Shared-space detailing" });
  const [lead] = (await call()).body.leads;
  assert.deepEqual(Object.keys(lead).sort(), ["createdAt", "id", "priority", "service", "spaceType", "status", "timing"]);
  assert.equal(lead.spaceType, "Shared workspace / coworking");
  assert.equal(lead.timing, "Within 2 weeks");
  assert.match(lead.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("the public branch never runs the admin query", async () => {
  const { repo, call } = setup();
  repo.seedLead(PII);
  await call();
  assert.ok(repo.state.calls.includes("listPublicLeads"));
  assert.ok(!repo.state.calls.includes("listAdminLeads"));
});

test("a bad, tampered or expired cookie is simply the public view, not an error", async () => {
  const { repo, call, cookie, clock } = setup();
  repo.seedLead(PII);
  const old = createSessionToken(ENV.SESSION_SECRET, clock.t - 9 * 3600 * 1000);
  for (const header of [`${SESSION_COOKIE}=garbage`, cookie(strong()), `${SESSION_COOKIE}=${old}`, "other=1"]) {
    const res = await call({ headers: { cookie: header }, ip: `198.51.100.${Math.floor(Math.random() * 200) + 1}` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.admin, false);
    assert.ok(!JSON.stringify(res.body).includes(PII.name));
  }
});

test("answers are never cached and vary by cookie", async () => {
  const { call } = setup();
  const res = await call();
  assert.equal(res.getHeader("Cache-Control"), "no-store");
  assert.equal(res.getHeader("Vary"), "Cookie");
});

test("leads older than the retention window are hidden at once, before the daily delete runs", async () => {
  const { repo, call, cookie, clock } = setup();
  repo.seedLead({ name: "Fresh" });
  repo.seedLead({ name: "Stale", createdAt: clock.t - (RETENTION_DAYS * DAY + 1000) });
  assert.equal((await call()).body.leads.length, 1);
  const admin = await call({ headers: { cookie: cookie() }, ip: "198.51.100.50" });
  assert.deepEqual(admin.body.leads.map((l) => l.name), ["Fresh"]);
  assert.equal(admin.body.retentionDays, RETENTION_DAYS);
});

test("reading the list is rate limited per client (known issue 13)", async () => {
  const { call } = setup();
  const limit = RATE_RULES.leadsRead.limit;
  let last;
  for (let i = 0; i < limit + 1; i += 1) last = await call();
  assert.equal(last.statusCode, 429);
  assert.match(last.getHeader("Retry-After"), /^\d+$/);
  assert.equal((await call({ ip: "198.51.100.77" })).statusCode, 200);
});

test("a missing or weak SESSION_SECRET is a 500 even for the public view", async () => {
  for (const SESSION_SECRET of [undefined, "short", "change-me-to-a-long-random-string-12345"]) {
    const { call } = setup({ env: { ...ENV, SESSION_SECRET } });
    assert.equal((await call()).statusCode, 500);
  }
});

// ---- GET: admin ------------------------------------------------------------------------------

test("a signed-in admin sees full details", async () => {
  const { repo, call, cookie } = setup();
  repo.seedLead({ ...PII, spaceType: "office", timing: "asap" });
  const res = await call({ headers: { cookie: cookie() } });
  assert.equal(res.body.admin, true);
  const [lead] = res.body.leads;
  assert.equal(lead.name, PII.name);
  assert.equal(lead.email, PII.email);
  assert.equal(lead.company, PII.company);
  assert.equal(lead.message, PII.message);
  assert.deepEqual(lead.followUp, PII.followUp);
  assert.equal(lead.spaceType, "Office");
  assert.ok(repo.state.calls.includes("listAdminLeads"));
  assert.ok(!repo.state.calls.includes("listPublicLeads"));
});

// ---- PATCH -----------------------------------------------------------------------------------

test("changing a stage with no session is a 401 and changes nothing (known issue 1)", async () => {
  const { repo, call } = setup();
  const lead = repo.seedLead();
  const res = await call({ method: "PATCH", headers: SAME_ORIGIN, query: { id: lead.id }, body: { status: "Proposal sent" } });
  assert.equal(res.statusCode, 401);
  assert.ok(!repo.state.calls.includes("updateStage"));
  assert.equal(lead.status, "New");
});

test("a forged, expired or other-secret session is a 401 too", async () => {
  const { repo, call, cookie, clock } = setup();
  const lead = repo.seedLead();
  const expired = `${SESSION_COOKIE}=${createSessionToken(ENV.SESSION_SECRET, clock.t - 9 * 3600 * 1000)}`;
  for (const header of [`${SESSION_COOKIE}=abc.def`, cookie(strong()), expired, `${SESSION_COOKIE}=`]) {
    const res = await call({ method: "PATCH", headers: { ...SAME_ORIGIN, cookie: header }, query: { id: lead.id }, body: { status: "Proposal sent" } });
    assert.equal(res.statusCode, 401, header.slice(0, 30));
  }
  assert.ok(!repo.state.calls.includes("updateStage"));
});

test("a valid session still needs the request to come from this site", async () => {
  const { repo, call, cookie } = setup();
  const lead = repo.seedLead();
  const patch = (headers) => call({ method: "PATCH", headers: { cookie: cookie(), ...headers }, query: { id: lead.id }, body: { status: "Proposal sent" } });

  for (const headers of [
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
    {},                                                     // neither header: refuse
    { origin: "https://evil.example", host: "morrow.example" },
    { origin: "null", host: "morrow.example" },
  ]) {
    assert.equal((await patch(headers)).statusCode, 403, JSON.stringify(headers));
  }
  assert.equal(lead.status, "New");

  assert.equal((await patch({ "sec-fetch-site": "same-origin" })).statusCode, 200);
  assert.equal(lead.status, "Proposal sent");
});

test("the Origin and Host fallback also lets a same-site browser request through", async () => {
  const { repo, call, cookie } = setup();
  const lead = repo.seedLead();
  const res = await call({
    method: "PATCH", headers: { cookie: cookie(), origin: "https://morrow.example", host: "morrow.example" },
    query: { id: lead.id }, body: { status: "Walkthrough booked" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { id: lead.id, status: "Walkthrough booked" });
});

test("sequential numbers and other non-UUID ids are a 400, not a lookup (known issue 12)", async () => {
  const { repo, call, cookie } = setup();
  repo.seedLead();
  for (const id of ["1", "123", "abc", "", "1; DROP TABLE leads", [randomUUID(), randomUUID()], undefined]) {
    const res = await call({ method: "PATCH", headers: { ...SAME_ORIGIN, cookie: cookie() }, query: { id }, body: { status: "New" } });
    assert.equal(res.statusCode, 400, JSON.stringify(id));
  }
  assert.ok(!repo.state.calls.includes("updateStage"));
});

test("an unknown stage, a missing stage or a bad body is a 400", async () => {
  const { repo, call, cookie } = setup();
  const lead = repo.seedLead();
  const patch = (extra) => call({ method: "PATCH", headers: { ...SAME_ORIGIN, cookie: cookie() }, query: { id: lead.id }, ...extra });
  for (const body of [{ status: "Won" }, { status: "" }, { status: 5 }, { status: ["New"] }, {}, { Status: "New" }]) {
    assert.equal((await patch({ body })).statusCode, 400, JSON.stringify(body));
  }
  assert.equal((await patch({ bodyThrows: true })).statusCode, 400);
  assert.equal((await patch({ body: [] })).statusCode, 400);
  assert.ok(!repo.state.calls.includes("updateStage"));
});

test("every real stage is accepted, and an unknown lead is a 404", async () => {
  const { repo, call, cookie } = setup();
  const lead = repo.seedLead();
  for (const status of STAGES) {
    const res = await call({ method: "PATCH", headers: { ...SAME_ORIGIN, cookie: cookie() }, query: { id: lead.id }, body: { status } });
    assert.equal(res.statusCode, 200);
    assert.equal(lead.status, status);
  }
  const missing = await call({ method: "PATCH", headers: { ...SAME_ORIGIN, cookie: cookie() }, query: { id: randomUUID() }, body: { status: "New" } });
  assert.equal(missing.statusCode, 404);
});

test("an upper-case UUID finds the same lead", async () => {
  const { repo, call, cookie } = setup();
  const lead = repo.seedLead();
  const res = await call({ method: "PATCH", headers: { ...SAME_ORIGIN, cookie: cookie() }, query: { id: lead.id.toUpperCase() }, body: { status: "Proposal sent" } });
  assert.equal(res.statusCode, 200);
  assert.equal(lead.status, "Proposal sent");
});

test("a stage change shows up in the next admin list", async () => {
  const { repo, call, cookie } = setup();
  const lead = repo.seedLead();
  await call({ method: "PATCH", headers: { ...SAME_ORIGIN, cookie: cookie() }, query: { id: lead.id }, body: { status: "Walkthrough booked" } });
  const res = await call({ headers: { cookie: cookie() }, ip: "198.51.100.60" });
  assert.equal(res.body.leads[0].status, "Walkthrough booked");
});

test("only GET and PATCH are allowed", async () => {
  const { call } = setup();
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await call({ method });
    assert.equal(res.statusCode, 405, method);
    assert.equal(res.getHeader("Allow"), "GET, PATCH");
  }
});

test("the logs name ids and stages but never personal data", async (t) => {
  const lines = capture(t);
  const { repo, call, cookie } = setup();
  const lead = repo.seedLead(PII);
  await call();
  await call({ headers: { cookie: cookie() }, ip: "198.51.100.61" });
  await call({ method: "PATCH", headers: { ...SAME_ORIGIN, cookie: cookie() }, query: { id: lead.id }, body: { status: "Proposal sent" } });
  const logged = lines.join("\n");
  assert.ok(logged.includes(lead.id));
  for (const secret of [PII.name, PII.email, PII.company, "zebra", "203.0.113.7"]) {
    assert.ok(!logged.includes(secret), `log contains ${secret}`);
  }
});
