// Logging that cannot leak personal data. Driver and database errors often quote the value
// that caused them ("Key (email)=(jane@acme.com) already exists"), so the error message and
// its details are never printed. Only the error class, a short code and ids are.

const SAFE_KEYS = ["leadId", "eventId", "names", "count", "deleted", "status", "reason"];

function safeContext(context) {
  const out = {};
  for (const key of SAFE_KEYS) {
    const value = context[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) out[key] = value.map((v) => String(v).slice(0, 80)).slice(0, 20);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else out[key] = String(value).slice(0, 80);
  }
  return out;
}

/** Log a failure: where it happened, the error class, a Postgres-style code, and ids. */
export function logError(scope, err, context = {}) {
  const code = typeof err?.code === "string" && /^[A-Za-z0-9_]{1,12}$/.test(err.code) ? err.code : undefined;
  console.error(JSON.stringify({ level: "error", scope, error: err?.name ?? "Error", code, ...safeContext(context) }));
}

/** Log a normal event, for example how many rows the retention job removed. */
export function logInfo(scope, context = {}) {
  console.log(JSON.stringify({ level: "info", scope, ...safeContext(context) }));
}
