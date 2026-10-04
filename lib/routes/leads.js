// GET /api/leads    the lead list. Public visitors get the monitor view with no personal data;
//                   a signed-in admin gets full details.
// PATCH /api/leads  move a lead to another stage. Admin only.
import { RETENTION_DAYS, SPACE_TYPES, TIMINGS, isStage, isUuid } from "../../assets/js/workflow.js";
import { HttpError, checkSameOrigin, readJsonBody, sendJson } from "../http.js";
import { hashIp } from "../ip.js";
import { logInfo } from "../log.js";
import { checkLimit } from "../ratelimit.js";
import { sessionFromRequest } from "../session.js";

const LIST_LIMIT = 50;
const label = (table, code) => (Object.hasOwn(table, code) ? table[code] : code);
const withLabels = (lead) => ({ ...lead, spaceType: label(SPACE_TYPES, lead.spaceType), timing: label(TIMINGS, lead.timing) });

async function listLeads(req, res, { env, repo, now }) {
  const limit = await checkLimit(repo, "leadsRead", hashIp(req.headers, env.IP_SALT), now());
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfter));
    return sendJson(res, 429, { error: "Too many requests. Please wait a moment and refresh." });
  }

  const admin = Boolean(sessionFromRequest(req, env.SESSION_SECRET, now()));
  const query = { retentionDays: RETENTION_DAYS, limit: LIST_LIMIT };

  // The public branch never calls the admin query, so personal data is never even loaded.
  const rows = admin ? await repo.listAdminLeads(query) : await repo.listPublicLeads(query);
  const leads = rows.map(withLabels);

  res.setHeader("Vary", "Cookie");
  return sendJson(res, 200, { leads, admin, retentionDays: RETENTION_DAYS });
}

async function changeStage(req, res, { env, repo, now }) {
  // 1. Who is asking? No valid session means no change, whatever the request says.
  if (!sessionFromRequest(req, env.SESSION_SECRET, now())) {
    return sendJson(res, 401, { error: "Sign in as admin to change a stage." });
  }
  // 2. Did it come from our own page? Stops a request forged by another site.
  if (!checkSameOrigin(req.headers).ok) {
    return sendJson(res, 403, { error: "This request did not come from this site." });
  }

  // 3. Public ids are UUIDs. Sequential numbers are not accepted (they were guessable).
  const id = req.query?.id;
  if (typeof id !== "string" || !isUuid(id)) throw new HttpError(400, "Invalid lead id");

  const { status } = readJsonBody(req);
  if (!isStage(status)) throw new HttpError(400, "Invalid status");

  const updated = await repo.updateStage(id.toLowerCase(), status);
  if (!updated) return sendJson(res, 404, { error: "Lead not found" });
  logInfo("lead.stage_changed", { leadId: updated.id, status: updated.status });
  return sendJson(res, 200, updated);
}

export async function leadsRoute(req, res, deps) {
  return req.method === "PATCH" ? changeStage(req, res, deps) : listLeads(req, res, deps);
}
