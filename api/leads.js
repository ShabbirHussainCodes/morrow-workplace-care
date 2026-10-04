// GET and PATCH /api/leads. The logic lives in lib/routes/leads.js; this file only wires it up.
import { REQUIRED } from "../lib/env.js";
import { wire } from "../lib/wire.js";
import { leadsRoute } from "../lib/routes/leads.js";

export default wire(leadsRoute, {
  methods: ["GET", "PATCH"],
  env: REQUIRED.leads,
  failure: "Could not load leads",
});
