// Turns a route into a Vercel handler. The order is fixed and fails closed:
//   1. method check (so a wrong method is a 405 even when the server is misconfigured)
//   2. environment check (a missing or weak variable is a 500 that names the variable only)
//   3. build the repo and run the route
// Anything the route throws becomes a safe answer here: HttpError keeps its status, and every
// other error is logged by class and code only and answered with a generic 500.
import { ConfigError, loadEnv } from "./env.js";
import { HttpError, allowMethods, sendJson } from "./http.js";
import { createSql } from "./db.js";
import { createRepo } from "./repo.js";
import { logError } from "./log.js";

function respondToFailure(res, err, failureMessage) {
  if (res.headersSent) return;
  if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
  if (err instanceof ConfigError) {
    logError("config", err, { names: err.names });
    return sendJson(res, 500, { error: "Server is not configured" });
  }
  logError("handler", err);
  return sendJson(res, 500, { error: failureMessage });
}

/**
 * @param route    async (req, res, { env, repo, now }) => void
 * @param options  { methods, env: [variable names], failure: message for an unexpected error }
 * @param deps     replaceable in tests: { source (the env), makeRepo(env), now }
 */
export function wire(route, { methods, env: names, failure = "Something went wrong" }, deps = {}) {
  return async function handler(req, res) {
    try {
      if (!allowMethods(req, res, methods)) return;
      const env = loadEnv(deps.source ?? process.env, names);
      const repo = (deps.makeRepo ?? ((e) => createRepo(createSql(e.DATABASE_URL))))(env);
      await route(req, res, { env, repo, now: deps.now ?? Date.now });
    } catch (err) {
      respondToFailure(res, err, failure);
    }
  };
}
