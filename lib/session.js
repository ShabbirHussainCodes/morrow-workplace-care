// The admin session: a signed token kept in an HttpOnly cookie. Nothing is stored on the
// server, so a session cannot be revoked early. It simply expires, and changing
// SESSION_SECRET signs everyone out at once.
import { createHmac, randomBytes } from "node:crypto";
import { parseCookies } from "./http.js";
import { safeEqual } from "./safe-equal.js";

export const SESSION_COOKIE = "morrow_admin";
export const SESSION_SECONDS = 8 * 60 * 60;
const CLOCK_SKEW_SECONDS = 60;

const sign = (secret, body) => createHmac("sha256", secret).update(body).digest("base64url");

/** A new session token: base64url(payload).base64url(HMAC-SHA256 of the payload). */
export function createSessionToken(secret, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const payload = { iat, exp: iat + SESSION_SECONDS, sid: randomBytes(12).toString("base64url") };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

/** The payload of a valid, unexpired token, or null. Never throws, whatever it is given. */
export function verifySessionToken(token, secret, now = Date.now()) {
  if (typeof token !== "string" || typeof secret !== "string" || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, signature] = parts;
  if (!safeEqual(signature, sign(secret, body))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload === null || typeof payload !== "object") return null;
  const { iat, exp } = payload;
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return null;

  const seconds = now / 1000;
  if (exp <= seconds) return null;                       // expired
  if (iat > seconds + CLOCK_SKEW_SECONDS) return null;   // issued in the future
  if (exp - iat > SESSION_SECONDS) return null;          // longer than any token we issue
  return payload;
}

/** The session carried by a request's cookie, or null. */
export function sessionFromRequest(req, secret, now = Date.now()) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return token ? verifySessionToken(token, secret, now) : null;
}
