// POST /api/lead through the real wiring (method check, env check, error mapping), with an
// injected env and an in-memory fake database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { REQUIRED } from "../lib/env.js";
import { wire } from "../lib/wire.js";
import { leadRoute } from "../lib/routes/lead.js";
import { RATE_RULES } from "../lib/ratelimit.js";
import { fakeReq, fakeRes } from "./helpers/fakes.js";
import { fakeRepo } from "./helpers/fake-repo.js";

const strong = () => randomBytes(32).toString("hex");
const ENV = {
  DATABASE_URL: "postgresql://alice:DBPASSWORD123@ep-test.neon.tech/neondb?sslmode=require",
  IP_SALT: strong(),
};
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const IP = "203.0.113.7";

const form = (overrides = {}) => ({
  fullName: "Jane Visitor", email: "Jane@Example.com", company: "Acme Test Ltd", spaceType: "office",
  timing: "asap", message: "We are moving into a new floor next month.", submissionId: randomUUID(),
  ...overrides,
});

function setup({ env = ENV, clock = { t: T0 } } = {}) {
  const repo = fakeRepo({ now: () => clock.t });
  let repoBuilt = false;
  const handler = wire(
    leadRoute,
    { methods: ["POST"], env: REQUIRED.lead, failure: "Could not save the enquiry" },
    { source: env, makeRepo: () => { repoBuilt = true; return repo; }, now: () => clock.t },
  );
  const send = async (body, { ip = IP, method = "POST", bodyThrows = false } = {}) => {
    const res = fakeRes();
    await handler(fakeReq({ method, headers: { "x-forwarded-for": ip }, body, bodyThrows }), res);
    return res;
  };
  return { repo, send, handler, clock, repoBuilt: () => repoBuilt };
}

function capture(t) {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(String(line)));
  t.mock.method(console, "error", (line) => lines.push(String(line)));
  return lines;
}

test("a valid enquiry is saved and answered 201 with a UUID reference, never a counter", async () => {
  const { repo, send } = setup();
  const res = await send(form());
  assert.equal(res.statusCode, 201);
  assert.match(res.body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(res.body.priority, "High");
  assert.equal(res.body.status, "New");
  assert.ok(res.body.followUp.subject.includes("Acme Test Ltd"));
  assert.equal(res.getHeader("Cache-Control"), "no-store");
  assert.equal(repo.state.leads.length, 1);
  assert.equal(repo.state.leads[0].email, "jane@example.com");
});

test("malformed JSON is a 400 and nothing is touched (known issue 9)", async () => {
  const { repo, send } = setup();
  const res = await send(undefined, { bodyThrows: true });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /not valid JSON/);
  assert.deepEqual(repo.state.calls, []);
});

test("a body that is not an object is a 400", async () => {
  const { send } = setup();
  for (const body of [[], "text", null, 5]) assert.equal((await send(body)).statusCode, 400);
});

test("other methods are a 405 with Allow: POST, even when the server is misconfigured", async () => {
  const { send, repoBuilt } = setup({ env: {} });
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    const res = await send(form(), { method });
    assert.equal(res.statusCode, 405, method);
    assert.equal(res.getHeader("Allow"), "POST");
  }
  assert.equal(repoBuilt(), false);
});

test("the honeypot answers 200, saves nothing and does not even count against the limit", async () => {
  const { repo, send } = setup();
  const res = await send(form({ website: "http://spam.example" }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(repo.state.calls, []);
});

test("a form with mistakes is a 422 that lists each field and saves nothing", async () => {
  const { repo, send } = setup();
  const res = await send(form({ fullName: "", email: "not-an-email", spaceType: "castle", message: "hi" }));
  assert.equal(res.statusCode, 422);
  assert.deepEqual(Object.keys(res.body.errors).sort(), ["email", "fullName", "message", "spaceType"]);
  assert.equal(repo.state.leads.length, 0);
});

test("names that exist on every object are a 422, not a crash", async () => {
  const { send } = setup();
  const res = await send(form({ spaceType: "constructor", timing: "__proto__" }));
  assert.equal(res.statusCode, 422);
  assert.ok(res.body.errors.spaceType && res.body.errors.timing);
});

test("a missing or invalid submissionId is a 422 and saves nothing", async () => {
  const { repo, send } = setup();
  // Every request that reaches the limiter counts, so each case uses its own client address
  const cases = [undefined, null, "", "123", 42, "not-a-uuid", {}];
  for (const [i, submissionId] of cases.entries()) {
    const res = await send(form({ submissionId }), { ip: `198.51.100.${i + 1}` });
    assert.equal(res.statusCode, 422, String(submissionId));
    assert.ok(res.body.errors.submissionId);
  }
  assert.equal(repo.state.leads.length, 0);
});

test("the same submissionId twice gives one lead and the same reference (known issue 4)", async () => {
  const { repo, send } = setup();
  const body = form();
  const first = await send(body);
  const second = await send(body);
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.id, first.body.id);
  assert.equal(repo.state.leads.length, 1);
  assert.equal(repo.state.calls.filter((c) => c === "insertLead").length, 2);
});

test("a repeat with the same id but different content returns the original lead", async () => {
  const { repo, send } = setup();
  const submissionId = randomUUID();
  const first = await send(form({ submissionId, company: "First Company" }));
  const second = await send(form({ submissionId, company: "Changed Company" }));
  assert.equal(second.body.id, first.body.id);
  assert.equal(repo.state.leads.length, 1);
  assert.equal(repo.state.leads[0].company, "First Company");
});

test("different submission ids make different leads", async () => {
  const { repo, send } = setup();
  const a = await send(form());
  const b = await send(form());
  assert.notEqual(a.body.id, b.body.id);
  assert.equal(repo.state.leads.length, 2);
});

test("the sixth enquiry from one client in a window is a 429 and is not saved (known issue 13)", async () => {
  const { repo, send } = setup();
  const statuses = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await send(form())).statusCode);
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);
  assert.equal(repo.state.leads.length, 5);
  assert.equal(RATE_RULES.lead.limit, 5);
});

test("a 429 says when to retry, and another client is not affected", async () => {
  const { send } = setup();
  for (let i = 0; i < 5; i += 1) await send(form());
  const blocked = await send(form());
  assert.equal(blocked.statusCode, 429);
  assert.match(blocked.getHeader("Retry-After"), /^\d+$/);
  assert.match(blocked.body.error, /Too many enquiries/);
  assert.equal((await send(form(), { ip: "198.51.100.20" })).statusCode, 201);
});

test("the limit resets in the next window", async () => {
  const { send, clock } = setup();
  for (let i = 0; i < 6; i += 1) await send(form());
  clock.t += RATE_RULES.lead.windowSeconds * 1000;
  assert.equal((await send(form())).statusCode, 201);
});

test("a missing IP_SALT is a 500 that names the variable and reveals no values (known issue 2)", async (t) => {
  const lines = capture(t);
  const { repoBuilt, send } = setup({ env: { DATABASE_URL: ENV.DATABASE_URL } });
  const res = await send(form());
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "Server is not configured" });
  assert.equal(repoBuilt(), false);
  const everything = lines.join("\n") + JSON.stringify(res.body);
  assert.ok(lines.join("\n").includes("IP_SALT"));
  assert.ok(!everything.includes("DBPASSWORD123"));
  assert.ok(!everything.includes("alice"));
});

test("a weak or placeholder IP_SALT is a 500 too, and the old 'morrow' fallback is gone", async () => {
  for (const IP_SALT of ["morrow", "change-me-to-a-long-random-string", "short", ""]) {
    const { send } = setup({ env: { ...ENV, IP_SALT } });
    assert.equal((await send(form())).statusCode, 500, IP_SALT);
  }
});

test("a missing database url is a 500 that never tries to save", async () => {
  const { repo, send } = setup({ env: { IP_SALT: ENV.IP_SALT } });
  assert.equal((await send(form())).statusCode, 500);
  assert.deepEqual(repo.state.calls, []);
});

test("no retention delete runs inside a request, on any path (known issue 3)", async () => {
  const { repo, send } = setup();
  await send(form());
  await send(form({ fullName: "" }));
  await send(form({ website: "x" }));
  await send(undefined, { bodyThrows: true });
  for (let i = 0; i < 6; i += 1) await send(form());
  assert.ok(!repo.state.calls.includes("deleteExpiredLeads"));
  assert.ok(!repo.state.calls.includes("pruneRateLimits"));
});

test("control characters never reach storage (known issue 11)", async () => {
  const { repo, send } = setup();
  const res = await send(form({ fullName: "Jane\u{0}\r\nBcc: evil@example.com", company: "Acme\u{7}Ltd", message: "Line one\u{0}\r\nLine two is long enough" }));
  assert.equal(res.statusCode, 201);
  const [saved] = repo.state.leads;
  assert.equal(saved.name, "Jane Bcc: evil@example.com");
  assert.equal(saved.company, "AcmeLtd");
  assert.equal(saved.message, "Line one\nLine two is long enough");
});

test("over-long input is cut to the limits on the server", async () => {
  const { repo, send } = setup();
  await send(form({ fullName: "A".repeat(5000), company: "B".repeat(5000), message: "C".repeat(50000) }));
  const [saved] = repo.state.leads;
  assert.equal(saved.name.length, 120);
  assert.equal(saved.company.length, 160);
  assert.equal(saved.message.length, 2000);
});

test("fields the visitor should not control are ignored", async () => {
  const { repo, send } = setup();
  const res = await send(form({ status: "Proposal sent", priority: "Low", id: "forged", public_id: "forged", tags: ["x"], createdAt: "2001-01-01" }));
  assert.equal(res.statusCode, 201);
  const [saved] = repo.state.leads;
  assert.equal(saved.status, "New");
  assert.equal(saved.priority, "High");
  assert.notEqual(saved.id, "forged");
  assert.notEqual(res.body.id, "forged");
});

test("a database failure is a generic 500 and the log holds only the error class and code", async (t) => {
  const lines = capture(t);
  const { repo, send } = setup();
  repo.insertLead = async () => {
    throw Object.assign(new Error("duplicate key: Key (email)=(jane@example.com) already exists"), { name: "NeonDbError", code: "23505" });
  };
  const res = await send(form());
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "Could not save the enquiry" });
  const logged = lines.join("\n");
  assert.ok(logged.includes("NeonDbError") && logged.includes("23505"));
  assert.ok(!logged.includes("jane@example.com"));
});

test("no personal data or IP address appears in any log line or stored counter name", async (t) => {
  const lines = capture(t);
  const { repo, send } = setup();
  await send(form({ fullName: "Distinctive Name", company: "Distinctive Company" }));
  await send(form({ fullName: "" }));
  const logged = lines.join("\n");
  for (const secret of ["Distinctive Name", "Distinctive Company", "jane@example.com", IP, "floor next month"]) {
    assert.ok(!logged.includes(secret), `log contains ${secret}`);
  }
  assert.ok(repo.state.hitBuckets.every((b) => /^lead:[0-9a-f]{64}$/.test(b)));
  assert.ok(lines.some((l) => l.includes("lead.created")));
});
