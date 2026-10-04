// POST /api/admin/session signs in, DELETE signs out. One function for both keeps the number of
// serverless functions low. The logic lives in lib/routes/admin-session.js.
import { REQUIRED } from "../../lib/env.js";
import { wire } from "../../lib/wire.js";
import { createAdminSessionRoute } from "../../lib/routes/admin-session.js";

export default wire(createAdminSessionRoute(), {
  methods: ["POST", "DELETE"],
  env: REQUIRED.adminSession,
  failure: "Could not complete the request",
});
