// GET /api/cron/retention: the daily clean-up, run by Vercel's cron scheduler.
//
// Retention used to run inside visitors' requests. It now runs here, once a day, and only for a
// caller that knows CRON_SECRET (Vercel sends it as "Authorization: Bearer <secret>"). Reads
// already hide anything past the retention window, so a late run never shows expired data.
import { RETENTION_DAYS } from "../../assets/js/workflow.js";
import { sendJson } from "../http.js";
import { logInfo } from "../log.js";
import { safeEqual } from "../safe-equal.js";

// Rate-limit windows last at most ten minutes; a day of history is plenty.
const KEEP_RATE_LIMIT_HOURS = 24;

export async function cronRetentionRoute(req, res, { env, repo }) {
  if (!safeEqual(req.headers.authorization, `Bearer ${env.CRON_SECRET}`)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const deletedLeads = await repo.deleteExpiredLeads(RETENTION_DAYS);
  const prunedRateLimits = await repo.pruneRateLimits(KEEP_RATE_LIMIT_HOURS);
  logInfo("retention.done", { deletedLeads, prunedRateLimits });
  return sendJson(res, 200, { deletedLeads, prunedRateLimits });
}
