// Migration planning and running. This file never opens a database connection itself:
// the caller passes an "executor", which keeps the rules testable without Postgres and
// keeps the dry run provably read-only (it only ever calls the two read methods).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export class MigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationError";
  }
}

const FILE_RE = /^(\d{4})_([a-z0-9][a-z0-9_]*)\.sql$/;

/** Created by the runner itself (not by a migration), because migrations are recorded in it. */
export const SCHEMA_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT PRIMARY KEY,
  checksum    TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

/** SHA-256 of the file text. Line endings are normalised so a Windows checkout matches. */
export function checksum(text) {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

/** Read db/migrations: numbered 0001_name.sql files, no gaps, no duplicates. */
export function loadMigrationFiles(dir) {
  const names = readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
  const files = names.map((name, index) => {
    const match = FILE_RE.exec(name);
    if (!match) {
      throw new MigrationError(`"${name}" is not a valid migration name. Use four digits, an underscore and lower-case words: 0001_name.sql`);
    }
    const number = Number(match[1]);
    if (number !== index + 1) {
      throw new MigrationError(`Migration numbers must run 0001, 0002, ... with no gaps or repeats. Found "${name}" where ${String(index + 1).padStart(4, "0")} was expected.`);
    }
    const sql = readFileSync(join(dir, name), "utf8");
    return { name, number, sql, checksum: checksum(sql) };
  });
  return files;
}

/**
 * Compare the files with what the database says is applied. Throws when history was
 * rewritten (a file edited or removed after it was applied, or applied out of order).
 */
export function planMigrations(files, applied) {
  const byName = new Map(files.map((f) => [f.name, f]));
  for (const row of applied) {
    const file = byName.get(row.name);
    if (!file) {
      throw new MigrationError(`${row.name} is recorded as applied, but its file is missing from db/migrations.`);
    }
    if (file.checksum !== row.checksum) {
      throw new MigrationError(`${row.name} was edited after it was applied. Never edit an applied migration; add a new numbered file instead.`);
    }
  }

  const appliedNames = new Set(applied.map((row) => row.name));
  const firstPending = files.findIndex((f) => !appliedNames.has(f.name));
  const lastApplied = files.reduce((last, f, i) => (appliedNames.has(f.name) ? i : last), -1);
  if (firstPending !== -1 && firstPending < lastApplied) {
    throw new MigrationError(`${files[firstPending].name} is not applied, but a later migration is. Migrations must be applied in order.`);
  }

  return {
    applied: files.filter((f) => appliedNames.has(f.name)),
    pending: files.filter((f) => !appliedNames.has(f.name)),
  };
}

/**
 * Host and database name from a connection string, for the person to check before
 * anything is changed. The user name, password and options are never returned, and a
 * bad value is never echoed back (it may contain a password).
 */
export function describeTarget(connectionString) {
  let url;
  try {
    url = new URL(String(connectionString ?? ""));
  } catch {
    throw new MigrationError("DATABASE_URL is not a valid connection string.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new MigrationError("DATABASE_URL must start with postgres:// or postgresql://");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !database) {
    throw new MigrationError("DATABASE_URL must include a host and a database name.");
  }
  return { host: url.host, database };
}

/** Only --apply may write. Anything else is rejected rather than ignored. */
export function parseMigrateArgs(argv) {
  const unknown = argv.filter((a) => a !== "--apply");
  if (unknown.length) {
    throw new MigrationError(`Unknown argument: ${unknown[0]}. The only option is --apply.`);
  }
  return { apply: argv.includes("--apply") };
}

/**
 * Plan, and with apply:true run, the pending migrations.
 * Executor: { tableExists(), listApplied(), ensureTable(), applyMigration({ name, sql, checksum }) }.
 * Without apply, only tableExists() and listApplied() are ever called.
 */
export async function runMigrations({ files, executor, apply = false, onApplied = () => {} }) {
  const tableExists = await executor.tableExists();
  const applied = tableExists ? await executor.listApplied() : [];
  const plan = planMigrations(files, applied);

  if (!apply) return { tableExists, plan, ran: [] };

  if (!tableExists) await executor.ensureTable();
  const ran = [];
  for (const file of plan.pending) {
    await executor.applyMigration({ name: file.name, sql: file.sql, checksum: file.checksum });
    ran.push(file.name);
    onApplied(file.name);
  }
  return { tableExists, plan, ran };
}

/** The text shown before anything is changed. */
export function formatPlan({ target, apply, tableExists, plan }) {
  const lines = [
    "Morrow migrations",
    `  Target host:      ${target.host}`,
    `  Target database:  ${target.database}`,
    apply
      ? "  Mode:             APPLY. Pending migrations run now, one transaction each."
      : "  Mode:             DRY RUN. Nothing will be changed. Add --apply to apply.",
    "",
    tableExists
      ? "  schema_migrations table: found"
      : `  schema_migrations table: not created yet (${apply ? "it will be created now" : "--apply will create it"})`,
    `  Already applied (${plan.applied.length}): ${plan.applied.length ? plan.applied.map((f) => f.name).join(", ") : "none"}`,
    `  Pending (${plan.pending.length}):${plan.pending.length ? "" : " none, the database is up to date"}`,
    ...plan.pending.map((f) => `    ${f.name}`),
  ];
  return lines.join("\n");
}
