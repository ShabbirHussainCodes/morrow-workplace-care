// GET /api/cron/retention, called daily by Vercel (see "crons" in vercel.json).
// The logic lives in lib/routes/cron-retention.js; this file only wires it up.
import { REQUIRED } from "../../lib/env.js";
import { wire } from "../../lib/wire.js";
import { cronRetentionRoute } from "../../lib/routes/cron-retention.js";

export default wire(cronRetentionRoute, {
  methods: ["GET"],
  env: REQUIRED.cronRetention,
  failure: "Retention job failed",
});
