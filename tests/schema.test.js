// Static checks on the SQL migrations. They cannot prove the SQL runs (that needs Postgres),
// but they keep the rules we promised: additive changes, and one list of stages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGES } from "../assets/js/workflow.js";

const DIR = new URL("../db/migrations/", import.meta.url).pathname;
const files = readdirSync(DIR).filter((n) => n.endsWith(".sql")).sort();
const read = (name) => readFileSync(join(DIR, name), "utf8");
const withoutComments = (sql) => sql.replace(/--.*$/gm, "");

// While the live site depends on the old code, migrations must not remove or reshape data.
// To allow a deliberate exception, list the file here in the same pull request and say why.
const ALLOW_DESTRUCTIVE = [];

test("migrations only add things: no DROP, TRUNCATE, DELETE, RENAME or column changes", () => {
  const forbidden = /\b(DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)|TRUNCATE|DELETE\s+FROM|RENAME\s+(TO|COLUMN)|ALTER\s+COLUMN)\b/i;
  for (const name of files.filter((n) => !ALLOW_DESTRUCTIVE.includes(n))) {
    const match = withoutComments(read(name)).match(forbidden);
    assert.equal(match, null, `${name} contains "${match?.[0]}". Migrations must be additive.`);
  }
});

test("the stage CHECK in the baseline lists exactly the stages in workflow.js", () => {
  const sql = withoutComments(read("0001_baseline.sql"));
  const list = sql.match(/status\s+IN\s*\(([^)]*)\)/i)?.[1];
  assert.ok(list, "no status CHECK found in 0001_baseline.sql");
  const names = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(names, STAGES);
});

test("0002 adds the public id, the idempotency key and the rate limit counter", () => {
  const sql = withoutComments(read("0002_hardening.sql"));
  assert.match(sql, /ADD COLUMN IF NOT EXISTS public_id\s+UUID NOT NULL DEFAULT gen_random_uuid\(\)/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS submission_id\s+UUID\s*;/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS leads_public_id_key\s+ON leads \(public_id\)/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS leads_submission_id_key\s+ON leads \(submission_id\)/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS rate_limits[\s\S]*PRIMARY KEY \(bucket, window_start\)/i);
});

test("the idempotency key stays nullable so leads from before the migration remain valid", () => {
  const sql = withoutComments(read("0002_hardening.sql"));
  assert.doesNotMatch(sql, /submission_id\s+UUID\s+NOT NULL/i);
});

test("every statement in every migration is safe to run twice", () => {
  for (const name of files) {
    const sql = withoutComments(read(name));
    for (const statement of sql.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b[^;]*/gi) ?? []) {
      assert.match(statement, /IF NOT EXISTS/i, `${name}: ${statement.slice(0, 70)}`);
    }
    for (const statement of sql.match(/ADD\s+COLUMN\b[^,;]*/gi) ?? []) {
      assert.match(statement, /IF NOT EXISTS/i, `${name}: ${statement.slice(0, 70)}`);
    }
  }
});
