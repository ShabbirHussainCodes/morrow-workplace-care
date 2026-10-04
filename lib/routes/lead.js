// POST /api/lead: validate, save and tag a new enquiry.
//
// Order: body (400) -> honeypot (200, nothing touched) -> rate limit (429) -> validation (422)
// -> save. Saving is idempotent: the browser sends one submissionId per form fill, so a repeated
// submit returns the lead that already exists instead of creating a second one.
// The optional `attribution` object (first-touch UTM tags, referrer, landing page) is cleaned by
// the shared sanitizer; it can only ever be dropped, never make the enquiry fail.
import { processLead, sanitizeAttribution, validateLead, validateSubmissionId } from "../../assets/js/workflow.js";
import { readJsonBody, sendJson } from "../http.js";
import { hashIp } from "../ip.js";
import { logInfo } from "../log.js";
import { checkLimit } from "../ratelimit.js";

export async function leadRoute(req, res, { env, repo, now }) {
  const body = readJsonBody(req);

  // Honeypot: bots fill the hidden "website" field. Pretend success and save nothing.
  if (body.website) return sendJson(res, 200, { ok: true });

  const limit = await checkLimit(repo, "lead", hashIp(req.headers, env.IP_SALT), now());
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfter));
    return sendJson(res, 429, { error: "Too many enquiries. Please try again in a few minutes." });
  }

  const { data, errors } = validateLead(body);
  const submissionId = validateSubmissionId(body.submissionId);
  const problems = { ...(errors ?? {}) };
  if (!submissionId) problems.submissionId = "The form did not send a valid submission id. Please reload the page and try again.";
  if (Object.keys(problems).length) return sendJson(res, 422, { errors: problems });

  // Attribution is best-effort: whatever is wrong with it is dropped, and the lead is saved anyway.
  const attribution = sanitizeAttribution(body.attribution);

  const { created, outcome } = await repo.insertLead({ submissionId, data, outcome: processLead(data), attribution });
  logInfo(created ? "lead.created" : "lead.replayed", { leadId: outcome.id });
  return sendJson(res, created ? 201 : 200, outcome);
}
