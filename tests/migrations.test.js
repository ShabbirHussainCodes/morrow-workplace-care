// Migration rules: numbering, history protection, a read-only dry run, and what the
// dry run prints. The Neon connection code in scripts/migrate.js is not covered here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MigrationError, checksum, loadMigrationFiles, planMigrations, describeTarget,
  parseMigrateArgs, runMigrations, formatPlan,
} from "../lib/migrations.js";

const REAL_DIR = new URL("../db/migrations/", import.meta.url).pathname;

function tempMigrations(t, files) {
  const dir = mkdtempSync(join(tmpdir(), "morrow-mig-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

/** An in-memory stand-in for the database that remembers every call it receives. */
function fakeExecutor({ exists = false, applied = [], failOn = null } = {}) {
  const state = { exists, applied: [...applied], calls: [] };
  return {
    state,
    async tableExists() { state.calls.push("tableExists"); return state.exists; },
    async listApplied() { state.calls.push("listApplied"); return state.applied.map((r) => ({ ...r })); },
    async ensureTable() { state.calls.push("ensureTable"); state.exists = true; },
    async applyMigration({ name, sql, checksum: sum }) {
      state.calls.push(`apply:${name}`);
      if (name === failOn) throw new Error("boom");
      state.applied.push({ name, checksum: sum, sql });
    },
  };
}

const file = (number, name = "step") => {
  const sql = `SELECT ${number};`;
  const full = `${String(number).padStart(4, "0")}_${name}.sql`;
  return { name: full, number, sql, checksum: checksum(sql) };
};

test("the real db/migrations folder loads in order with no gaps", () => {
  const files = loadMigrationFiles(REAL_DIR);
  assert.ok(files.length >= 1);
  assert.equal(files[0].name, "0001_baseline.sql");
  files.forEach((f, i) => assert.equal(f.number, i + 1));
});

test("files load in numeric order and other file types are ignored", (t) => {
  const dir = tempMigrations(t, { "0002_b.sql": "SELECT 2;", "0001_a.sql": "SELECT 1;", "README.md": "notes" });
  assert.deepEqual(loadMigrationFiles(dir).map((f) => f.name), ["0001_a.sql", "0002_b.sql"]);
});

test("a gap, a repeat or a badly named file is refused", (t) => {
  assert.throws(() => loadMigrationFiles(tempMigrations(t, { "0001_a.sql": "x", "0003_c.sql": "x" })), /no gaps/);
  assert.throws(() => loadMigrationFiles(tempMigrations(t, { "0001_a.sql": "x", "0001_b.sql": "x" })), /no gaps or repeats/);
  assert.throws(() => loadMigrationFiles(tempMigrations(t, { "0001_a.sql": "x", "2_two.sql": "x" })), /not a valid migration name/);
  assert.throws(() => loadMigrationFiles(tempMigrations(t, { "0001_Bad-Name.sql": "x" })), /not a valid migration name/);
  assert.throws(() => loadMigrationFiles(tempMigrations(t, { "1_first.sql": "x" })), MigrationError);
});

test("the checksum ignores line-ending differences", () => {
  assert.equal(checksum("a\r\nb\r\n"), checksum("a\nb\n"));
  assert.notEqual(checksum("a\nb\n"), checksum("a\nc\n"));
});

test("with nothing applied every file is pending, in order", () => {
  const plan = planMigrations([file(1), file(2)], []);
  assert.deepEqual(plan.pending.map((f) => f.number), [1, 2]);
  assert.deepEqual(plan.applied, []);
});

test("applied files are not pending again", () => {
  const files = [file(1), file(2), file(3)];
  const plan = planMigrations(files, [{ name: files[0].name, checksum: files[0].checksum }]);
  assert.deepEqual(plan.pending.map((f) => f.number), [2, 3]);
  assert.deepEqual(plan.applied.map((f) => f.number), [1]);
});

test("a migration edited after it was applied is refused", () => {
  const files = [file(1)];
  assert.throws(
    () => planMigrations(files, [{ name: files[0].name, checksum: "not-the-same" }]),
    /edited after it was applied/,
  );
});

test("an applied migration whose file has gone is refused", () => {
  assert.throws(() => planMigrations([file(1)], [{ name: "0002_gone.sql", checksum: "x" }]), /file is missing/);
});

test("applying out of order is refused", () => {
  const files = [file(1), file(2)];
  assert.throws(() => planMigrations(files, [{ name: files[1].name, checksum: files[1].checksum }]), /in order/);
});

test("a dry run reads only: it never creates the table or applies anything", async () => {
  const files = [file(1), file(2)];
  const executor = fakeExecutor({ exists: true });
  const result = await runMigrations({ files, executor, apply: false });
  assert.deepEqual(executor.state.calls, ["tableExists", "listApplied"]);
  assert.equal(result.plan.pending.length, 2);
  assert.deepEqual(result.ran, []);
});

test("a dry run on a database without schema_migrations reads nothing else and reports all pending", async () => {
  const executor = fakeExecutor({ exists: false });
  const result = await runMigrations({ files: [file(1)], executor });   // apply defaults to false
  assert.deepEqual(executor.state.calls, ["tableExists"]);
  assert.equal(result.tableExists, false);
  assert.equal(result.plan.pending.length, 1);
});

test("--apply is the only way to write: it creates the table, then applies in order", async () => {
  const files = [file(1), file(2)];
  const executor = fakeExecutor({ exists: false });
  const seen = [];
  const result = await runMigrations({ files, executor, apply: true, onApplied: (n) => seen.push(n) });
  assert.deepEqual(executor.state.calls, ["tableExists", "ensureTable", `apply:${files[0].name}`, `apply:${files[1].name}`]);
  assert.deepEqual(result.ran, files.map((f) => f.name));
  assert.deepEqual(seen, files.map((f) => f.name));
  assert.deepEqual(executor.state.applied.map((r) => r.checksum), files.map((f) => f.checksum));
});

test("running again after --apply changes nothing", async () => {
  const files = [file(1), file(2)];
  const executor = fakeExecutor({ exists: false });
  await runMigrations({ files, executor, apply: true });
  executor.state.calls.length = 0;
  const again = await runMigrations({ files, executor, apply: true });
  assert.deepEqual(again.ran, []);
  assert.ok(!executor.state.calls.some((c) => c.startsWith("apply:") || c === "ensureTable"));
});

test("a failing migration stops the run and later files are not attempted", async () => {
  const files = [file(1), file(2), file(3)];
  const executor = fakeExecutor({ exists: true, failOn: files[1].name });
  await assert.rejects(() => runMigrations({ files, executor, apply: true }), /boom/);
  assert.deepEqual(executor.state.applied.map((r) => r.name), [files[0].name]);
  assert.ok(!executor.state.calls.includes(`apply:${files[2].name}`));
});

test("history problems are found before anything is written", async () => {
  const files = [file(1)];
  const executor = fakeExecutor({ exists: true, applied: [{ name: files[0].name, checksum: "edited" }] });
  await assert.rejects(() => runMigrations({ files, executor, apply: true }), /edited after it was applied/);
  assert.ok(!executor.state.calls.some((c) => c.startsWith("apply:") || c === "ensureTable"));
});

test("only --apply is accepted as an argument", () => {
  assert.deepEqual(parseMigrateArgs([]), { apply: false });
  assert.deepEqual(parseMigrateArgs(["--apply"]), { apply: true });
  assert.throws(() => parseMigrateArgs(["--force"]), /Unknown argument/);
  assert.throws(() => parseMigrateArgs(["apply"]), /Unknown argument/);
});

test("the target shows host and database name and nothing else", () => {
  const url = "postgresql://alice:s3cretPW@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb?sslmode=require";
  assert.deepEqual(describeTarget(url), { host: "ep-cool-name-123.eu-central-1.aws.neon.tech", database: "neondb" });
  assert.deepEqual(describeTarget("postgres://u:p@localhost:5432/scratch"), { host: "localhost:5432", database: "scratch" });
});

test("the dry-run text names the target clearly and never leaks credentials", () => {
  const url = "postgresql://alice:s3cretPW@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb?sslmode=require";
  const plan = planMigrations([file(1), file(2)], []);
  const text = formatPlan({ target: describeTarget(url), apply: false, tableExists: false, plan });
  assert.match(text, /Target host:\s+ep-cool-name-123\.eu-central-1\.aws\.neon\.tech/);
  assert.match(text, /Target database:\s+neondb/);
  assert.match(text, /DRY RUN\. Nothing will be changed\. Add --apply/);
  assert.match(text, /not created yet \(--apply will create it\)/);
  assert.match(text, /Pending \(2\)/);
  for (const secret of ["alice", "s3cretPW", "sslmode", "postgresql://"]) {
    assert.ok(!text.includes(secret), `output must not contain ${secret}`);
  }
});

test("the apply text says it will write", () => {
  const plan = planMigrations([file(1)], []);
  const text = formatPlan({ target: { host: "h", database: "d" }, apply: true, tableExists: true, plan });
  assert.match(text, /Mode:\s+APPLY/);
  assert.doesNotMatch(text, /DRY RUN/);
});

test("an up-to-date database says so", () => {
  const files = [file(1)];
  const plan = planMigrations(files, [{ name: files[0].name, checksum: files[0].checksum }]);
  const text = formatPlan({ target: { host: "h", database: "d" }, apply: false, tableExists: true, plan });
  assert.match(text, /Pending \(0\): none, the database is up to date/);
});

test("bad connection strings are rejected without echoing them", () => {
  for (const bad of ["not-a-url-secret123", "https://user:pw-secret456@example.com/db", "postgresql://u:pw-secret789@host", "", undefined]) {
    let message = "";
    try { describeTarget(bad); } catch (err) { message = err.message; assert.ok(err instanceof MigrationError); }
    assert.notEqual(message, "", `expected a rejection for ${bad}`);
    for (const piece of ["secret123", "secret456", "secret789"]) assert.ok(!message.includes(piece));
  }
});

test("every migration is wrapped by the runner, so none may open its own transaction", () => {
  for (const name of readdirSync(REAL_DIR).filter((n) => n.endsWith(".sql"))) {
    const sql = readFileSync(join(REAL_DIR, name), "utf8");
    assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT|ROLLBACK)\b/im, `${name} must not manage transactions`);
  }
});

test("the baseline migration is idempotent: every CREATE says IF NOT EXISTS", () => {
  const sql = readFileSync(join(REAL_DIR, "0001_baseline.sql"), "utf8").replace(/--.*$/gm, "");
  const creates = sql.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b[^;]*/gi) ?? [];
  assert.ok(creates.length >= 3, "expected the table and its two indexes");
  for (const statement of creates) assert.match(statement, /IF NOT EXISTS/i, statement.slice(0, 60));
});
