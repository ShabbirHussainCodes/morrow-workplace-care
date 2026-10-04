// Client IP handling for rate limiting. A raw IP address is never stored or logged: only a
// keyed hash of it is used, and only as a rate-limit bucket name.
import { createHmac } from "node:crypto";

/**
 * The client address. Vercel overwrites X-Forwarded-For, so its first entry is the client's.
 * Without the header (a local run) every request shares the bucket "unknown".
 */
export function clientIp(headers) {
  const value = headers["x-forwarded-for"];
  const first = typeof value === "string" ? value.split(",")[0].trim() : "";
  return first || "unknown";
}

/** HMAC of the client IP with the secret salt. There is deliberately no default salt. */
export function hashIp(headers, salt) {
  if (typeof salt !== "string" || salt === "") throw new Error("IP_SALT is required to hash an IP address");
  return createHmac("sha256", salt).update(clientIp(headers)).digest("hex");
}
