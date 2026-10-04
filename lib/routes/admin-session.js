// POST /api/admin/session    sign in with the admin password
// DELETE /api/admin/session  sign out
//
// Sign-in order matters, because checking a password costs real CPU and memory (scrypt):
//   same-origin check -> body shape -> per-client limiter -> all-clients limiter -> verify password
// The limiter always runs before the verification, so failed attempts cannot be used to burn CPU.
import { HttpError, checkSameOrigin, clearCookie, readJsonBody, sendJson, serializeCookie } from "../http.js";
import { hashIp } from "../ip.js";
import { logInfo } from "../log.js";
import { MAX_PASSWORD_LENGTH, verifyPassword as defaultVerifyPassword } from "../password.js";
import { checkLimit } from "../ratelimit.js";
import { SESSION_COOKIE, SESSION_SECONDS, createSessionToken } from "../session.js";

const refuseForeignRequest = (res) => sendJson(res, 403, { error: "This request did not come from this site." });

async function signIn(req, res, { env, repo, now }, verifyPassword) {
  if (!checkSameOrigin(req.headers).ok) return refuseForeignRequest(res);

  const { password } = readJsonBody(req);
  if (typeof password !== "string" || password === "" || Array.from(password).length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, "Please enter your password.");
  }

  // Per client first. A client that is already blocked is not counted against everyone else,
  // so one machine cannot lock the admin out by hammering the endpoint.
  const perClient = await checkLimit(repo, "loginIp", hashIp(req.headers, env.IP_SALT), now());
  let blocked = perClient.allowed ? null : perClient;
  if (!blocked) {
    const everyone = await checkLimit(repo, "loginAll", "all", now());
    if (!everyone.allowed) blocked = everyone;
  }
  if (blocked) {
    res.setHeader("Retry-After", String(blocked.retryAfter));
    return sendJson(res, 429, { error: "Too many sign-in attempts. Please try again later." });
  }

  if (!(await verifyPassword(password, env.ADMIN_PASSWORD_HASH))) {
    logInfo("admin.login_failed", { reason: "bad_password" });
    return sendJson(res, 401, { error: "Incorrect password." });
  }

  const token = createSessionToken(env.SESSION_SECRET, now());
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_SECONDS }));
  logInfo("admin.login");
  return sendJson(res, 200, { ok: true });
}

function signOut(req, res) {
  if (!checkSameOrigin(req.headers).ok) return refuseForeignRequest(res);
  res.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
  return sendJson(res, 200, { ok: true });
}

/** `verifyPassword` can be replaced so a test can prove when (and when not) it runs. */
export function createAdminSessionRoute({ verifyPassword = defaultVerifyPassword } = {}) {
  return async function adminSessionRoute(req, res, deps) {
    return req.method === "DELETE" ? signOut(req, res) : signIn(req, res, deps, verifyPassword);
  };
}
