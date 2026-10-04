// lib/repo.js against a recording `sql`. These tests prove how the queries are built (values
// are bound parameters, public reads select no personal column, nothing writes the IP). That
// the SQL itself runs is checked separately against a real Postgres.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRepo } from "../lib/repo.js";

const ROOT = new URL("../", import.meta.url).pathname;

/** A tagged-template function that records the text (with $1, $2 ...) and values it receives. */
function recordingSql(replies = []) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""), "");
    calls.push({ text: text.replace(/\s+/g, " ").trim(), values });
    return Promise.resolve(replies.shift() ?? []);
  };
  sql.calls = calls;
  return sql;
}

const lead = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  data: { fullName: "Jane", email: "jane@example.com", company: "Acme", spaceType: "office", timing: "asap", message: "A long enough message" },
  outcome: {
    service: "Routine office care", priority: "High", tags: ["Office"], nextStep: "Reply",
    followUp: { subject: "Subject", body: "Body" }, status: "New",
  },
};
const row = {
  public_id: "22222222-2222-4222-8222-222222222222", tags: ["Office"], priority: "High", service: "Routine office care",
  next_step: "Reply", follow_up_subject: "Subject", follow_up_body: "Body", status: "New",
};

test("a rate-limit hit is one statement with the bucket and window as parameters", async () => {
  const sql = recordingSql([[{ count: 3 }]]);
  const count = await createRepo(sql).hitRateLimit("lead:abc", 600);
  assert.equal(count, 3);
  assert.equal(sql.calls.length, 1);
  assert.match(sql.calls[0].text, /ON CONFLICT \(bucket, window_start\) DO UPDATE SET count = rate_limits\.count \+ 1/);
  assert.equal(sql.calls[0].values[0], "lead:abc");
  assert.ok(sql.calls[0].values.includes(600));
  assert.ok(!sql.calls[0].text.includes("lead:abc"));
});

test("user text only ever travels as a bound parameter", async () => {
  const hostile = "'; DROP TABLE leads; --";
  const sql = recordingSql([[row]]);
  await createRepo(sql).insertLead({ ...lead, data: { ...lead.data, fullName: hostile, message: hostile } });
  const { text, values } = sql.calls[0];
  assert.ok(!text.includes("DROP TABLE"));
  assert.ok(values.includes(hostile));
});

test("a new lead is inserted in one statement and returns its public id", async () => {
  const sql = recordingSql([[row]]);
  const result = await createRepo(sql).insertLead(lead);
  assert.equal(sql.calls.length, 1);
  assert.match(sql.calls[0].text, /ON CONFLICT \(submission_id\) DO NOTHING/);
  assert.equal(result.created, true);
  assert.equal(result.outcome.id, row.public_id);
  assert.deepEqual(result.outcome.followUp, { subject: "Subject", body: "Body" });
});

test("a repeated submission reads the existing lead instead of inserting again", async () => {
  const sql = recordingSql([[], [row]]);
  const result = await createRepo(sql).insertLead(lead);
  assert.equal(sql.calls.length, 2);
  assert.match(sql.calls[1].text, /^SELECT .* FROM leads WHERE submission_id = \$1$/);
  assert.deepEqual(sql.calls[1].values, [lead.submissionId]);
  assert.equal(result.created, false);
  assert.equal(result.outcome.id, row.public_id);
});

test("a lead that disappears between the two statements is an error, not a silent success", async () => {
  await assert.rejects(() => createRepo(recordingSql([[], []])).insertLead(lead), /gone/);
});

test("attribution is written to its own columns as bound parameters, in order", async () => {
  const sql = recordingSql([[row]]);
  const attribution = {
    utm_source: "linkedin", utm_medium: "social", utm_campaign: "oct-demo", utm_term: null,
    utm_content: "hero", referrer: "https://www.linkedin.com/feed/", landing_page: "/",
  };
  await createRepo(sql).insertLead({ ...lead, attribution });
  const { text, values } = sql.calls[0];
  assert.match(text, /utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer, landing_page\s*\)/);
  assert.deepEqual(values.slice(-7), ["linkedin", "social", "oct-demo", null, "hero", "https://www.linkedin.com/feed/", "/"]);
  for (const value of ["linkedin", "oct-demo", "feed"]) assert.ok(!text.includes(value));
});

test("a lead without attribution is stored with NULL in every attribution column", async () => {
  const sql = recordingSql([[row], [row]]);
  await createRepo(sql).insertLead(lead);
  await createRepo(sql).insertLead({ ...lead, attribution: { utm_source: undefined } });
  for (const call of sql.calls) assert.deepEqual(call.values.slice(-7), [null, null, null, null, null, null, null]);
});

test("a repeat reads the lead back without writing attribution again", async () => {
  const sql = recordingSql([[], [row]]);
  await createRepo(sql).insertLead({ ...lead, attribution: { utm_source: "second" } });
  assert.doesNotMatch(sql.calls[1].text, /utm_|referrer|landing_page/);
  assert.deepEqual(sql.calls[1].values, [lead.submissionId]);
});

test("the insert does not store the IP hash", async () => {
  const sql = recordingSql([[row]]);
  await createRepo(sql).insertLead(lead);
  assert.ok(!/ip_hash/i.test(sql.calls[0].text));
});

test("the public list selects no personal column", async () => {
  const sql = recordingSql([[{ public_id: "id", created_at: "t", priority: "High", service: "S", space_type: "office", timing: "asap", status: "New" }]]);
  const rows = await createRepo(sql).listPublicLeads({ retentionDays: 7, limit: 50 });
  assert.doesNotMatch(sql.calls[0].text, /full_name|email|company|message|follow_up|next_step|tags|ip_hash/i);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["createdAt", "id", "priority", "service", "spaceType", "status", "timing"]);
  assert.deepEqual(sql.calls[0].values, [7, 50]);
});

test("the admin list has the full detail, and both lists hide expired leads", async () => {
  const sql = recordingSql([[{ public_id: "id", full_name: "Jane", email: "j@example.com", company: "Acme", message: "m", follow_up_subject: "s", follow_up_body: "b", next_step: "n", tags: [] }]]);
  const [lead] = await createRepo(sql).listAdminLeads({ retentionDays: 7, limit: 50 });
  assert.match(sql.calls[0].text, /full_name, email, company/);
  assert.equal(lead.name, "Jane");
  assert.equal(lead.followUp.subject, "s");

  const publicSql = recordingSql([[]]);
  await createRepo(publicSql).listPublicLeads({ retentionDays: 7, limit: 50 });
  for (const call of [sql.calls[0], publicSql.calls[0]]) {
    assert.match(call.text, /created_at > now\(\) - make_interval\(days => \$1\)/);
  }
});

test("a stage change is addressed by public id and says when nothing matched", async () => {
  const hit = recordingSql([[{ public_id: "abc", status: "Proposal sent" }]]);
  assert.deepEqual(await createRepo(hit).updateStage("abc", "Proposal sent"), { id: "abc", status: "Proposal sent" });
  assert.match(hit.calls[0].text, /WHERE public_id = \$2/);
  assert.equal(await createRepo(recordingSql([[]])).updateStage("abc", "New"), null);
});

test("retention deletes are parameterised and return a count", async () => {
  const leads = recordingSql([[{ count: 4 }]]);
  assert.equal(await createRepo(leads).deleteExpiredLeads(7), 4);
  assert.deepEqual(leads.calls[0].values, [7]);
  const limits = recordingSql([[{ count: 9 }]]);
  assert.equal(await createRepo(limits).pruneRateLimits(24), 9);
  assert.deepEqual(limits.calls[0].values, [24]);
});

test("only the retention functions may delete anything", () => {
  const source = readFileSync(join(ROOT, "lib/repo.js"), "utf8");
  assert.equal((source.match(/DELETE\s+FROM/g) ?? []).length, 2);
  assert.match(source, /deleteExpiredLeads[\s\S]*DELETE FROM leads/);
  assert.match(source, /pruneRateLimits[\s\S]*DELETE FROM rate_limits/);
});

function jsFiles(dir) {
  const out = [];
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...jsFiles(path));
    else if (name.endsWith(".js")) out.push(path);
  }
  return out;
}

test("no SQL is built from strings anywhere in lib or api", () => {
  for (const file of [...jsFiles(join(ROOT, "lib")), ...jsFiles(join(ROOT, "api"))]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\.unsafe\s*\(/, `${file} uses sql.unsafe`);
    assert.doesNotMatch(source, /\bsql\s*\(/, `${file} calls sql() as a function`);
    assert.doesNotMatch(source, /\bsql\.query\s*\(/, `${file} calls sql.query with a string`);
    assert.doesNotMatch(source, /sql`[^`]*`\s*\+|\+\s*sql`/, `${file} concatenates SQL`);
  }
});
