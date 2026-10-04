// The attribution rules shared by the browser and the server: missing, oversized, malformed and
// script-like values, and how a page view becomes a "touch".
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTRIBUTION_FIELDS, ATTRIBUTION_LIMITS, ATTRIBUTION_TTL_DAYS, UTM_FIELDS,
  emptyAttribution, sanitizeAttribution, parseTouch, isTagged, hasAttribution,
} from "../assets/js/workflow.js";

const NULLS = Object.fromEntries(ATTRIBUTION_FIELDS.map((f) => [f, null]));
const GOOD = {
  utm_source: "linkedin", utm_medium: "social", utm_campaign: "oct-demo", utm_term: "office cleaning",
  utm_content: "hero_button", referrer: "https://www.linkedin.com/feed/", landing_page: "/",
};

test("the fields, limits and expiry are defined once", () => {
  assert.deepEqual(ATTRIBUTION_FIELDS, ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "referrer", "landing_page"]);
  assert.deepEqual(UTM_FIELDS, ATTRIBUTION_FIELDS.slice(0, 5));
  assert.deepEqual(Object.keys(ATTRIBUTION_LIMITS), ATTRIBUTION_FIELDS);
  assert.equal(ATTRIBUTION_LIMITS.utm_source, 100);
  assert.equal(ATTRIBUTION_LIMITS.referrer, 500);
  assert.equal(ATTRIBUTION_LIMITS.landing_page, 300);
  assert.equal(ATTRIBUTION_TTL_DAYS, 30);
  assert.deepEqual(emptyAttribution(), NULLS);
});

test("good values pass through unchanged and the result always has all seven fields", () => {
  assert.deepEqual(sanitizeAttribution(GOOD), GOOD);
  assert.deepEqual(Object.keys(sanitizeAttribution({ utm_source: "x" })), ATTRIBUTION_FIELDS);
});

// ---- missing ---------------------------------------------------------------------------------

test("missing attribution is all nulls", () => {
  for (const input of [undefined, null, {}, { utm_source: undefined }]) assert.deepEqual(sanitizeAttribution(input), NULLS);
});

test("an input that is not a plain object is all nulls", () => {
  for (const input of ["utm_source=x", 42, true, [], [GOOD], () => GOOD]) assert.deepEqual(sanitizeAttribution(input), NULLS);
});

test("empty and blank values are null, not empty strings", () => {
  const out = sanitizeAttribution({ utm_source: "", utm_medium: "   ", utm_campaign: "\t\n", referrer: "", landing_page: "" });
  assert.deepEqual(out, NULLS);
});

// ---- oversized ---------------------------------------------------------------------------------

test("an oversized UTM value is cut to the limit, not rejected", () => {
  const out = sanitizeAttribution({ utm_source: "a".repeat(101), utm_campaign: "b".repeat(5000) });
  assert.equal(out.utm_source.length, ATTRIBUTION_LIMITS.utm_source);
  assert.equal(out.utm_campaign.length, ATTRIBUTION_LIMITS.utm_campaign);
  assert.equal(sanitizeAttribution({ utm_source: "a".repeat(100) }).utm_source.length, 100);
});

test("an oversized UTM value never splits an emoji or a letter", () => {
  const out = sanitizeAttribution({ utm_source: `a${"é".repeat(300)}` });
  assert.equal(Array.from(out.utm_source).length, 100);
});

test("an oversized referrer and landing page are cut to their limits", () => {
  const out = sanitizeAttribution({
    referrer: `https://example.com/${"a".repeat(3000)}`, landing_page: `/${"b".repeat(3000)}`,
  });
  assert.equal(out.referrer.length, ATTRIBUTION_LIMITS.referrer);
  assert.ok(out.referrer.startsWith("https://example.com/aaa"));
  assert.equal(out.landing_page.length, ATTRIBUTION_LIMITS.landing_page);
});

// ---- malformed ---------------------------------------------------------------------------------

test("values of the wrong type are dropped, and the other fields are kept", () => {
  for (const bad of [42, true, [], ["linkedin"], { toString: () => "linkedin" }, () => "x", Symbol("x")]) {
    const out = sanitizeAttribution({ ...GOOD, utm_source: bad });
    assert.equal(out.utm_source, null, String(typeof bad));
    assert.equal(out.utm_medium, "social");
    assert.equal(out.landing_page, "/");
  }
});

test("control characters are removed and line breaks become spaces", () => {
  assert.equal(sanitizeAttribution({ utm_source: "goo\u{0}gle" }).utm_source, "google");
  assert.equal(sanitizeAttribution({ utm_source: "goo\u{7}gle\u{202E}" }).utm_source, "google");
  assert.equal(sanitizeAttribution({ utm_campaign: "spring\r\nsale" }).utm_campaign, "spring sale");
});

test("real campaign names are kept: letters in any script, numbers, spaces and usual punctuation", () => {
  for (const name of ["spring_sale-2026", "email newsletter", "q4+launch", "café-été", "東京 オフィス", "50%25-off", "a/b test", "brand|search", "user@example", "Mother's Day", "(not set)", "utm=1&x=2", "#top!"]) {
    assert.equal(sanitizeAttribution({ utm_campaign: name }).utm_campaign, name, name);
  }
});

test("keys we do not know are ignored, including inherited and __proto__ ones", () => {
  const out = sanitizeAttribution({ ...GOOD, isAdmin: true, status: "Won", extra: "x" });
  assert.deepEqual(out, GOOD);
  const polluted = sanitizeAttribution(JSON.parse('{"__proto__":{"utm_source":"evil"},"constructor":{"x":1}}'));
  assert.deepEqual(polluted, NULLS);
  const inherited = Object.create({ utm_source: "inherited" });
  assert.equal(sanitizeAttribution(inherited).utm_source, null);
  assert.equal(Object.prototype.utm_source, undefined);
});

// ---- script-like -------------------------------------------------------------------------------

test("script-like UTM values are dropped", () => {
  const hostile = [
    "<script>alert(1)</script>", '"><img src=x onerror=alert(1)>', "<svg/onload=alert(1)>", "javascript:alert(1)",
    " JavaScript:alert(1)", "vbscript:msgbox(1)", "data:text/html;base64,PHNjcmlwdD4=", "'; DROP TABLE leads; --",
    "${7*7}", "{{7*7}}", "`touch /tmp/x`", "a;b", "a\\b", "x?y", "[x]", "$(whoami)", "{x}",
  ];
  for (const value of hostile) {
    const out = sanitizeAttribution({ ...GOOD, utm_source: value, utm_content: value });
    assert.equal(out.utm_source, null, value);
    assert.equal(out.utm_content, null, value);
    assert.equal(out.utm_medium, "social", "a bad field must not wipe the good ones");
  }
});

test("a script word inside an ordinary campaign name is fine", () => {
  assert.equal(sanitizeAttribution({ utm_campaign: "javascript-course" }).utm_campaign, "javascript-course");
  assert.equal(sanitizeAttribution({ utm_campaign: "big data day" }).utm_campaign, "big data day");
});

test("a script-like referrer or landing page is dropped", () => {
  for (const referrer of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd", "ftp://example.com/x", "android-app://com.google.android.gm", "not a url", "//evil.example/x", "example.com/path"]) {
    assert.equal(sanitizeAttribution({ referrer }).referrer, null, referrer);
  }
  for (const landing_page of ["javascript:alert(1)", "https://evil.example/x", "//evil.example/x", "/\\evil.example", "demo", "<script>", ""]) {
    assert.equal(sanitizeAttribution({ landing_page }).landing_page, null, landing_page);
  }
});

test("markup that survives inside a URL path is percent-encoded, never raw", () => {
  const out = sanitizeAttribution({ referrer: "https://example.com/<script>alert(1)</script>", landing_page: "/<script>alert(1)</script>" });
  assert.doesNotMatch(out.referrer, /[<>"']/);
  assert.doesNotMatch(out.landing_page, /[<>"']/);
});

// ---- referrer and landing page: privacy ---------------------------------------------------------------

test("a referrer keeps only its origin and path: no query, fragment or credentials", () => {
  const out = sanitizeAttribution({ referrer: "https://user:secret@www.google.com/search?q=my+private+search&token=abc#frag" });
  assert.equal(out.referrer, "https://www.google.com/search");
  assert.equal(sanitizeAttribution({ referrer: "https://example.com:8443/a/b" }).referrer, "https://example.com:8443/a/b");
  assert.equal(sanitizeAttribution({ referrer: "https://example.com" }).referrer, "https://example.com/");
  assert.equal(sanitizeAttribution({ referrer: "http://example.com/x" }).referrer, "http://example.com/x");
});

test("a landing page keeps only the path", () => {
  assert.equal(sanitizeAttribution({ landing_page: "/demo/?utm_source=x&email=a@b.c#top" }).landing_page, "/demo/");
  assert.equal(sanitizeAttribution({ landing_page: "/" }).landing_page, "/");
});

// ---- from a page view ------------------------------------------------------------------------------------

test("a tagged page view becomes a touch with the UTM tags, referrer and path", () => {
  const touch = parseTouch({
    search: "?utm_source=linkedin&utm_medium=social&utm_campaign=oct-demo&utm_term=office+cleaning&utm_content=hero_button",
    referrer: "https://www.linkedin.com/feed/?trk=abc#x", pathname: "/", ownOrigin: "https://morrow.example",
  });
  assert.deepEqual(touch, GOOD);
});

test("an untagged page view still records the referrer and landing page", () => {
  const touch = parseTouch({ search: "", referrer: "https://www.google.com/", pathname: "/demo/", ownOrigin: "https://morrow.example" });
  assert.deepEqual(touch, { ...NULLS, referrer: "https://www.google.com/", landing_page: "/demo/" });
});

test("a referrer from our own site is not a source", () => {
  const touch = parseTouch({ search: "", referrer: "https://morrow.example/demo/", pathname: "/", ownOrigin: "https://morrow.example" });
  assert.equal(touch.referrer, null);
});

test("the first value wins when a UTM name repeats, and names are matched in lower case", () => {
  const touch = parseTouch({ search: "?utm_source=first&utm_source=second&UTM_MEDIUM=upper", pathname: "/" });
  assert.equal(touch.utm_source, "first");
  assert.equal(touch.utm_medium, null);
});

test("script-like tags in the address bar are not carried into the touch", () => {
  const touch = parseTouch({ search: "?utm_source=%3Cscript%3Ealert(1)%3C/script%3E&utm_medium=email", pathname: "/" });
  assert.equal(touch.utm_source, null);
  assert.equal(touch.utm_medium, "email");
});

test("a page view with no input at all is safe", () => {
  assert.deepEqual(parseTouch(), { ...NULLS, landing_page: "/" });
  assert.deepEqual(parseTouch({ search: 5, referrer: null, pathname: undefined }), { ...NULLS, landing_page: "/" });
});

test("isTagged and hasAttribution", () => {
  assert.equal(isTagged(GOOD), true);
  assert.equal(isTagged({ ...NULLS, referrer: "https://www.google.com/", landing_page: "/" }), false);
  assert.equal(isTagged(NULLS), false);
  assert.equal(isTagged(null), false);
  assert.equal(isTagged({ utm_term: "x" }), true);
  assert.equal(hasAttribution({ ...NULLS, landing_page: "/" }), true);
  assert.equal(hasAttribution(NULLS), false);
  assert.equal(hasAttribution(undefined), false);
});
