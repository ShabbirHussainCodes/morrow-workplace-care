// Environment validation. Every function checks the variables it needs before it does any
// work. A missing or weak value fails closed: the caller answers 500 and logs the variable
// NAME. A value is never put into an error, a log line or a response, and there are no
// fallback defaults for secrets.

/** Thrown with the names of the variables that are missing or too weak. Never their values. */
export class ConfigError extends Error {
  constructor(names) {
    super(`Missing or weak environment variable(s): ${names.join(", ")}`);
    this.name = "ConfigError";
    this.names = names;
  }
}

/** scrypt$N$r$p$salt$hash, with salt and hash in base64url. Written by scripts/hash-password.js. */
export const PASSWORD_HASH_PATTERN = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

// Text that only appears in the examples. A copied .env.example must never count as configured.
const PLACEHOLDER = /replace-with|change-me|changeme|user:password@host|^<.*>$/i;

const longEnough = (min) => (value) => value.length >= min && !/^(.)\1+$/.test(value);

const RULES = {
  DATABASE_URL: (value) => /^postgres(ql)?:\/\/[^\s/@]+@[^\s/]+\/[^\s?]+/.test(value),
  IP_SALT: longEnough(16),
  SESSION_SECRET: longEnough(32),
  CRON_SECRET: longEnough(32),
  ADMIN_PASSWORD_HASH: (value) => PASSWORD_HASH_PATTERN.test(value),
};

/** The variables each function needs. */
export const REQUIRED = {
  lead: ["DATABASE_URL", "IP_SALT"],
  leads: ["DATABASE_URL", "IP_SALT", "SESSION_SECRET"],
  adminSession: ["DATABASE_URL", "IP_SALT", "SESSION_SECRET", "ADMIN_PASSWORD_HASH"],
  cronRetention: ["DATABASE_URL", "CRON_SECRET"],
};

/** True when the value is present, not a placeholder and strong enough for its purpose. */
export function isAcceptable(name, value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  if (PLACEHOLDER.test(value)) return false;
  const rule = RULES[name];
  return rule ? rule(value) : true;
}

/**
 * Read the named variables from `source` (normally process.env).
 * Returns { NAME: value }. Throws ConfigError listing every bad name, so one fix is enough.
 */
export function loadEnv(source, names) {
  const bad = names.filter((name) => !isAcceptable(name, source[name]));
  if (bad.length) throw new ConfigError(bad);
  return Object.fromEntries(names.map((name) => [name, source[name]]));
}
