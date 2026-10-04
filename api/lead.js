// POST /api/lead. The logic lives in lib/routes/lead.js; this file only wires it up.
import { REQUIRED } from "../lib/env.js";
import { wire } from "../lib/wire.js";
import { leadRoute } from "../lib/routes/lead.js";

export default wire(leadRoute, {
  methods: ["POST"],
  env: REQUIRED.lead,
  failure: "Could not save the enquiry",
});
