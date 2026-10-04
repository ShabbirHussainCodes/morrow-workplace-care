// The one place a database connection is created. Everything else receives a repo, so tests
// never need this file.
import { neon } from "@neondatabase/serverless";

export function createSql(connectionString) {
  return neon(connectionString);
}
