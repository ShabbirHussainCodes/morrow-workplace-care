// Small HTTP helpers shared by every function: body reading, replies, the same-origin check
// and cookies. Handlers stay thin by using these instead of repeating the details.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * The request body as a plain JSON object.
 * On Vercel, reading req.body parses the JSON and THROWS when it is malformed, so the read
 * must happen inside this try block. Anything that is not a JSON object is a 400 as well.
 */
export function readJsonBody(req) {
  let body;
  try {
    body = req.body;
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.");
  }
  const isPlainObject = body !== null && typeof body === "object" && !Array.isArray(body) && !Buffer.isBuffer(body);
  if (!isPlainObject) throw new HttpError(400, "Expected a JSON object in the request body.");
  return body;
}

/** Send JSON. API answers are never cached, because they can depend on who is asking. */
export function sendJson(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

/** True when the method is allowed. Otherwise a 405 with an Allow header has been sent. */
export function allowMethods(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader("Allow", methods.join(", "));
  sendJson(res, 405, { error: "Method not allowed" });
  return false;
}

/**
 * Is this request from a page on our own origin? Used before anything that changes state.
 *
 * Browsers add Sec-Fetch-Site and page scripts cannot change it, so when it is present it
 * decides: only "same-origin" passes ("same-site", "cross-site" and "none" do not).
 * Without it (older browsers, other clients) the Origin header must name the same host as
 * the Host header. A missing, "null" or unparseable Origin is refused.
 */
export function checkSameOrigin(headers) {
  const site = headers["sec-fetch-site"];
  if (site !== undefined) {
    return site === "same-origin" ? { ok: true, via: "sec-fetch-site" } : { ok: false, via: "sec-fetch-site" };
  }

  const origin = headers.origin;
  const host = headers.host;
  if (typeof origin !== "string" || typeof host !== "string" || host === "") return { ok: false, via: "origin" };
  try {
    return { ok: new URL(origin).host === host.toLowerCase(), via: "origin" };
  } catch {
    return { ok: false, via: "origin" };
  }
}

/** Read cookies from a Cookie header. Bad pairs are skipped and nothing here throws. */
export function parseCookies(header) {
  const cookies = {};
  if (typeof header !== "string") return cookies;
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index < 1) continue;
    const name = pair.slice(0, index).trim();
    const raw = pair.slice(index + 1).trim();
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }
  return cookies;
}

const COOKIE_NAME = /^[A-Za-z0-9_-]+$/;
const COOKIE_VALUE = /^[A-Za-z0-9._~-]*$/;

/**
 * A Set-Cookie value. Always HttpOnly, Secure and SameSite=Strict: the admin cookie is
 * never readable by page scripts, never sent over plain HTTP and never sent cross-site.
 */
export function serializeCookie(name, value, { maxAge }) {
  if (!COOKIE_NAME.test(name)) throw new Error("Invalid cookie name");
  if (!COOKIE_VALUE.test(value)) throw new Error("Invalid cookie value");
  if (!Number.isInteger(maxAge) || maxAge < 0) throw new Error("Invalid cookie lifetime");
  return `${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

/** A Set-Cookie value that removes the cookie. */
export function clearCookie(name) {
  return serializeCookie(name, "", { maxAge: 0 });
}
