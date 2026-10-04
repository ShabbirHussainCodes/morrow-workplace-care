// Apply the numbered SQL files in db/migrations to the database named by DATABASE_URL.
//
//   npm run migrate              dry run: shows the target and what would run, changes nothing
//   npm run migrate -- --apply   runs the pending migrations, one transaction per file
//
// Point DATABASE_URL (in your local .env) at the Neon dev branch first. Check the host and
// database printed by the dry run before you ever pass --apply.
//
// This file only holds the Neon connection code. The rules live in lib/migrations.js.
import { fileURLToPath } from "node:url";
import { Pool, neonConfig } from "@neondatabase/serverless";
import {
  MigrationError, SCHEMA_MIGRATIONS_SQL, describeTarget, formatPlan,
  loadMigrationFiles, parseMigrateArgs, runMigrations,
} from "../lib/migrations.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations/", import.meta.url));

// The text of one migration is sent as a single simple query, which Postgres runs as several
// statements. It is wrapped in BEGIN/COMMIT here so a failed file leaves nothing half applied.
function neonExecutor(pool) {
  return {
    async tableExists() {
      const { rows } = await pool.query("SELECT to_regclass('schema_migrations') AS found");
      return rows[0].found !== null;
    },
    async listApplied() {
      const { rows } = await pool.query("SELECT name, checksum FROM schema_migrations ORDER BY name");
      return rows;
    },
    async ensureTable() {
      await pool.query(SCHEMA_MIGRATIONS_SQL);
    },
    async applyMigration({ name, sql, checksum }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

async function main() {
  const { apply } = parseMigrateArgs(process.argv.slice(2));

  const url = process.env.DATABASE_URL;
  if (!url) throw new MigrationError("DATABASE_URL is not set. Add it to your local .env file (see .env.example).");
  const target = describeTarget(url);          // checked before any connection is opened

  // Node 22 and newer ship a WebSocket; the driver needs one to hold a session.
  if (typeof WebSocket === "undefined") {
    throw new MigrationError("This script needs Node 22 or newer, which has a built-in WebSocket.");
  }
  neonConfig.webSocketConstructor = WebSocket;

  const files = loadMigrationFiles(MIGRATIONS_DIR);
  const pool = new Pool({ connectionString: url });
  try {
    const executor = neonExecutor(pool);

    const first = await runMigrations({ files, executor, apply: false });
    console.log(formatPlan({ target, apply, tableExists: first.tableExists, plan: first.plan }));
    if (!apply) return;

    console.log("");
    const result = await runMigrations({
      files, executor, apply: true,
      onApplied: (name) => console.log(`  applied ${name}`),
    });
    console.log(result.ran.length ? `Done. ${result.ran.length} migration(s) applied.` : "Nothing to apply.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // Never print the connection string: it contains the password.
  const url = process.env.DATABASE_URL;
  const message = url ? String(err.message).split(url).join("[DATABASE_URL]") : String(err.message);
  console.error(`Migration stopped: ${message}`);
  process.exitCode = 1;
});
