// POST /api/lead with first-touch attribution: stored when good, dropped when bad, and never able
// to make an enquiry fail or to be overwritten by a repeat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { REQUIRED } from "../lib/env.js";
import { wire } from "../lib/wire.js";
import { leadRoute } from "../lib/routes/lead.js";
import { ATTRIBUTION_FIELDS, ATTRIBUTION_LIMITS } from "../assets/js/workflow.js";
import { fakeReq, fakeRes } from "./helpers/fakes.js";
import { fakeRepo } from "./helpers/fake-repo.js";

const strong = () => randomBytes(32).toString("hex");
const ENV = { DATABASE_URL: "postgresql://alice:DBPASSWORD123@ep-test.neon.tech/neondb?sslmode=require", IP_SALT: strong() };
const NULLS = Object.fromEntries(ATTRIBUTION_FIELDS.map((f) => [f, null]));
const GOOD = {
  utm_source: "linkedin", utm_medium: "social", utm_campaign: "oct-demo", utm_term: "office cleaning",
  utm_content: "hero_button", referrer: "https://www.linkedin.com/feed/", landing_page: "/",
};

const form = (extra = {}) => ({
  fullName: "Jane Visitor", email: "jane@example.com", company: "Acme Test Ltd", spaceType: "office",
  timing: "asap", message: "We are moving into a new floor next month.", submissionId: randomUUID(), ...extra,
});

function setup() {
  const repo = fakeRepo();
  const handler = wire(leadRoute, { methods: ["POST"], env: REQUIRED.lead }, { source: ENV, makeRepo: () => repo });
  let n = 0;
  const send = async (body) => {
    const res = fakeRes();
    // A new client address each time, so the limiter never gets in the way of these tests
    await handler(fakeReq({ method: "POST", headers: { "x-forwarded-for": `198.51.100.${(n += 1)}` }, body }), res);
    return res;
  };
  return { repo, send };
}

test("a tagged first touch is saved with the lead", async () => {
  const { repo, send } = setup();
  const res = await send(form({ attribution: GOOD }));
  assert.equal(res.statusCode, 201);
  assert.deepEqual(repo.state.leads[0].attribution, GOOD);
});

test("an enquiry with no attribution is saved with all attribution fields empty", async () => {
  const { repo, send } = setup();
  for (const attribution of [undefined, null, {}]) {
    const res = await send(form({ attribution }));
    assert.equal(res.statusCode, 201);
  }
  assert.ok(repo.state.leads.every((l) => JSON.stringify(l.attribution) === JSON.stringify(NULLS)));
});

test("attribution of the wrong type never fails the enquiry", async () => {
  const { repo, send } = setup();
  for (const attribution of ["utm_source=x", 42, true, [GOOD], [], () => GOOD]) {
    const res = await send(form({ attribution }));
    assert.equal(res.statusCode, 201, String(attribution));
  }
  assert.ok(repo.state.leads.every((l) => JSON.stringify(l.attribution) === JSON.stringify(NULLS)));
});

test("script-like and malformed fields are dropped one by one, and the rest is kept", async () => {
  const { repo, send } = setup();
  const res = await send(form({
    attribution: { ...GOOD, utm_source: "<script>alert(1)</script>", utm_term: ["a"], referrer: "javascript:alert(1)", landing_page: "//evil.example/x" },
  }));
  assert.equal(res.statusCode, 201);
  assert.deepEqual(repo.state.leads[0].attribution, {
    ...GOOD, utm_source: null, utm_term: null, referrer: null, landing_page: null,
  });
});

test("oversized values are cut to the limits instead of being refused", async () => {
  const { repo, send } = setup();
  const res = await send(form({
    attribution: { utm_campaign: "c".repeat(5000), referrer: `https://example.com/${"p".repeat(5000)}`, landing_page: `/${"l".repeat(5000)}` },
  }));
  assert.equal(res.statusCode, 201);
  const stored = repo.state.leads[0].attribution;
  assert.equal(stored.utm_campaign.length, ATTRIBUTION_LIMITS.utm_campaign);
  assert.equal(stored.referrer.length, ATTRIBUTION_LIMITS.referrer);
  assert.equal(stored.landing_page.length, ATTRIBUTION_LIMITS.landing_page);
});

test("the referrer and landing page are stored without query strings, fragments or credentials", async () => {
  const { repo, send } = setup();
  await send(form({ attribution: { referrer: "https://user:pw@www.google.com/search?q=private+words#x", landing_page: "/demo/?email=a@b.c&utm_source=x#top" } }));
  const stored = repo.state.leads[0].attribution;
  assert.equal(stored.referrer, "https://www.google.com/search");
  assert.equal(stored.landing_page, "/demo/");
});

test("control characters are removed before storing", async () => {
  const { repo, send } = setup();
  await send(form({ attribution: { utm_source: "goo\u{0}gle", utm_campaign: "spring\r\nsale\u{202E}" } }));
  const stored = repo.state.leads[0].attribution;
  assert.equal(stored.utm_source, "google");
  assert.equal(stored.utm_campaign, "spring sale");
});

test("unknown keys, and UTM fields outside the attribution object, are ignored", async () => {
  const { repo, send } = setup();
  await send(form({ utm_source: "outside", referrer: "https://outside.example/", attribution: { ...GOOD, isAdmin: true, status: "Won", id: "forged" } }));
  const lead = repo.state.leads[0];
  assert.deepEqual(lead.attribution, GOOD);
  assert.equal(lead.status, "New");
});

test("a __proto__ payload cannot plant attribution", async () => {
  const { repo, send } = setup();
  const body = JSON.parse(`{"fullName":"Jane Visitor","email":"jane@example.com","company":"Acme Test Ltd","spaceType":"office","timing":"asap","message":"We are moving into a new floor next month.","submissionId":"${randomUUID()}","attribution":{"__proto__":{"utm_source":"evil"},"constructor":{"x":1}}}`);
  const res = await send(body);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(repo.state.leads[0].attribution, NULLS);
  assert.equal(Object.prototype.utm_source, undefined);
});

test("a repeat of the same submission never overwrites the stored attribution", async () => {
  const { repo, send } = setup();
  const submissionId = randomUUID();
  const first = await send(form({ submissionId, attribution: GOOD }));
  const second = await send(form({ submissionId, attribution: { utm_source: "changed", utm_medium: "changed" } }));
  assert.equal(second.body.id, first.body.id);
  assert.equal(repo.state.leads.length, 1);
  assert.deepEqual(repo.state.leads[0].attribution, GOOD);
});

test("attribution does not change how the lead is tagged or prioritised", async () => {
  const { repo, send } = setup();
  const plain = await send(form());
  const tagged = await send(form({ attribution: { ...GOOD, utm_source: "urgent", utm_campaign: "reset" } }));
  assert.deepEqual({ ...tagged.body, id: 0 }, { ...plain.body, id: 0 });
  assert.equal(repo.state.leads.length, 2);
});

test("the answer to the visitor is unchanged and does not echo attribution", async () => {
  const { send } = setup();
  const res = await send(form({ attribution: GOOD }));
  assert.deepEqual(Object.keys(res.body).sort(), ["followUp", "id", "nextStep", "priority", "service", "status", "tags"]);
  assert.ok(!JSON.stringify(res.body).includes("linkedin"));
});

test("a refused enquiry (honeypot or validation) stores nothing, attribution included", async () => {
  const { repo, send } = setup();
  assert.equal((await send(form({ website: "http://spam", attribution: GOOD }))).statusCode, 200);
  assert.equal((await send(form({ fullName: "", attribution: GOOD }))).statusCode, 422);
  assert.equal(repo.state.leads.length, 0);
});

test("attribution values never appear in a log line", async (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(String(line)));
  t.mock.method(console, "error", (line) => lines.push(String(line)));
  const { send } = setup();
  await send(form({ attribution: { ...GOOD, utm_campaign: "distinctive-campaign-name", referrer: "https://distinctive-referrer.example/page" } }));
  const logged = lines.join("\n");
  assert.ok(logged.includes("lead.created"));
  assert.ok(!logged.includes("distinctive"));
  assert.ok(!logged.includes("linkedin"));
});
