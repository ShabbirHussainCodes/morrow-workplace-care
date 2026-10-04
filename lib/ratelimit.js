// Rate limiting on top of the atomic counter in the repo. Windows are fixed, so a determined
// client can send up to twice the limit around a window boundary. The Vercel firewall rule
// is the outer layer; this one protects the database and the admin password.

export const RATE_RULES = {
  lead:      { limit: 5,  windowSeconds: 10 * 60 },   // enquiries per client
  leadsRead: { limit: 60, windowSeconds: 60 },        // dashboard reads per client
  loginIp:   { limit: 5,  windowSeconds: 10 * 60 },   // login attempts per client
  loginAll:  { limit: 30, windowSeconds: 10 * 60 },   // login attempts from everywhere combined
};

/**
 * Count one hit against a rule and say whether it may go on.
 * The hit is counted whether or not it is allowed, and `retryAfter` is the number of seconds
 * until the window ends.
 */
export async function checkLimit(repo, ruleName, key, now = Date.now()) {
  const rule = RATE_RULES[ruleName];
  if (!rule) throw new Error(`Unknown rate limit rule: ${ruleName}`);
  const count = await repo.hitRateLimit(`${ruleName}:${key}`, rule.windowSeconds);
  const seconds = Math.floor(now / 1000);
  return {
    allowed: count <= rule.limit,
    count,
    retryAfter: rule.windowSeconds - (seconds % rule.windowSeconds),
  };
}
