// Attribution is for the site owner only: it is in the admin list, and nowhere in the public one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { REQUIRED } from "../lib/env.js";
import { wire } from "../lib/wire.js";
import { leadsRoute } from "../lib/routes/leads.js";
import { SESSION_COOKIE, createSessionToken } from "../lib/session.js";
import { ATTRIBUTION_FIELDS } from "../assets/js/workflow.js";
import { fakeReq, fakeRes } from "./helpers/fakes.js";
import { fakeRepo } from "./helpers/fake-repo.js";

const strong = () => randomBytes(32).toString("hex");
const ENV = {
  DATABASE_URL: "postgresql://alice:DBPASSWORD123@ep-test.neon.tech/neondb?sslmode=require",
  IP_SALT: strong(), SESSION_SECRET: strong(),
};
const ATTRIBUTION = {
  utm_source: "distinctive-source", utm_medium: "distinctive-medium", utm_campaign: "distinctive-campaign",
  utm_term: "distinctive-term", utm_content: "distinctive-content",
  referrer: "https://distinctive-referrer.example/page", landing_page: "/distinctive-landing/",
};

function setup() {
  const repo = fakeRepo();
  const handler = wire(leadsRoute, { methods: ["GET", "PATCH"], env: REQUIRED.leads }, { source: ENV, makeRepo: () => repo });
  let n = 0;
  const get = async ({ cookie } = {}) => {
    const res = fakeRes();
    const headers = { "x-forwarded-for": `198.51.100.${(n += 1)}` };
    if (cookie) headers.cookie = cookie;
    await handler(fakeReq({ method: "GET", headers }), res);
    return res;
  };
  const adminCookie = () => `${SESSION_COOKIE}=${createSessionToken(ENV.SESSION_SECRET)}`;
  return { repo, get, adminCookie };
}

test("the admin list carries each lead's attribution with all seven fields", async () => {
  const { repo, get, adminCookie } = setup();
  repo.seedLead({ attribution: ATTRIBUTION });
  const res = await get({ cookie: adminCookie() });
  assert.equal(res.body.admin, true);
  const [lead] = res.body.leads;
  assert.deepEqual(lead.attribution, ATTRIBUTION);
  assert.deepEqual(Object.keys(lead.attribution).sort(), [...ATTRIBUTION_FIELDS].sort());
});

test("the public list never carries attribution: no key and no value", async () => {
  const { repo, get } = setup();
  repo.seedLead({ attribution: ATTRIBUTION });
  const res = await get();
  assert.equal(res.body.admin, false);
  assert.equal(res.body.leads.length, 1);
  const json = JSON.stringify(res.body);
  assert.ok(!json.includes("attribution"));
  assert.ok(!json.includes("distinctive"));
  for (const field of ATTRIBUTION_FIELDS) assert.ok(!json.includes(field), `public answer mentions ${field}`);
  assert.ok(!repo.state.calls.includes("listAdminLeads"));
});

test("a forged or expired session gets the public list without attribution", async () => {
  const { repo, get } = setup();
  repo.seedLead({ attribution: ATTRIBUTION });
  const expired = `${SESSION_COOKIE}=${createSessionToken(ENV.SESSION_SECRET, Date.now() - 9 * 3600 * 1000)}`;
  for (const cookie of [`${SESSION_COOKIE}=forged.token`, expired]) {
    const res = await get({ cookie });
    assert.equal(res.body.admin, false);
    assert.ok(!JSON.stringify(res.body).includes("distinctive"));
  }
  assert.ok(!repo.state.calls.includes("listAdminLeads"));
});

test("the source lines on the dashboard are admin-only elements, so a visitor's page never has them", () => {
  const html = readFileSync(new URL("../demo/index.html", import.meta.url), "utf8");
  for (const name of ["lead__source", "lead__source-details"]) {
    const tag = html.match(new RegExp(`<p class="${name}"[^>]*>`))?.[0];
    assert.ok(tag, `${name} is missing from the template`);
    assert.match(tag, /\bdata-admin\b/, `${name} must be marked data-admin`);
  }
});
