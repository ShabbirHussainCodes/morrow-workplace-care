// Browser first-touch capture, run with an injected storage, location, referrer and clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ATTRIBUTION_FIELDS, ATTRIBUTION_TTL_DAYS, isTagged } from "../assets/js/workflow.js";
import { STORAGE_KEY, captureFirstTouch, readFirstTouch, getFirstTouch } from "../assets/js/attribution.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const ORIGIN = "https://morrow.example";
const NULLS = Object.fromEntries(ATTRIBUTION_FIELDS.map((f) => [f, null]));

function fakeStorage({ data = {}, getThrows = false, setThrows = false } = {}) {
  const store = new Map(Object.entries(data));
  return {
    store,
    getItem(key) { if (getThrows) throw new Error("access denied"); return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { if (setThrows) throw new Error("quota exceeded"); store.set(key, String(value)); },
  };
}
const page = (search = "", pathname = "/") => ({ search, pathname, origin: ORIGIN });
const visit = (storage, search, { pathname = "/", referrer = "", now = T0 } = {}) =>
  captureFirstTouch({ storage, location: page(search, pathname), referrer, now });
const TAGGED = "?utm_source=linkedin&utm_medium=social&utm_campaign=oct-demo";

test("the first visit is stored, with its tags, referrer and landing page", () => {
  const storage = fakeStorage();
  const touch = visit(storage, `${TAGGED}&utm_term=cleaning&utm_content=hero`, { referrer: "https://www.linkedin.com/feed/?x=1" });
  assert.deepEqual(touch, {
    utm_source: "linkedin", utm_medium: "social", utm_campaign: "oct-demo", utm_term: "cleaning",
    utm_content: "hero", referrer: "https://www.linkedin.com/feed/", landing_page: "/",
  });
  assert.deepEqual(readFirstTouch({ storage, now: T0 }), touch);
  assert.ok(storage.store.has(STORAGE_KEY));
});

test("the first touch is kept across page views: a later tagged link does not overwrite it", () => {
  const storage = fakeStorage();
  const first = visit(storage, TAGGED);
  const later = visit(storage, "?utm_source=google&utm_medium=cpc&utm_campaign=other", { pathname: "/demo/", now: T0 + DAY });
  assert.deepEqual(later, first);
  assert.equal(readFirstTouch({ storage, now: T0 + DAY }).utm_source, "linkedin");
});

test("an untagged page view after a tagged one changes nothing", () => {
  const storage = fakeStorage();
  const first = visit(storage, TAGGED);
  assert.deepEqual(visit(storage, "", { pathname: "/demo/", referrer: "https://example.org/", now: T0 + 1000 }), first);
});

test("an untagged first visit is kept when another untagged visit follows", () => {
  const storage = fakeStorage();
  const first = visit(storage, "", { referrer: "https://www.google.com/" });
  const second = visit(storage, "", { pathname: "/demo/", referrer: "https://news.example/", now: T0 + 1000 });
  assert.deepEqual(second, first);
  assert.equal(first.referrer, "https://www.google.com/");
  assert.equal(first.landing_page, "/");
});

test("a tagged visit replaces an untagged first visit, so a tagged demo link still counts", () => {
  const storage = fakeStorage();
  const direct = visit(storage, "");
  assert.equal(isTagged(direct), false);
  const tagged = visit(storage, TAGGED, { now: T0 + DAY });
  assert.equal(tagged.utm_source, "linkedin");
  assert.deepEqual(readFirstTouch({ storage, now: T0 + DAY }), tagged);
  // and from now on it is never replaced
  assert.deepEqual(visit(storage, "?utm_source=again", { now: T0 + 2 * DAY }), tagged);
});

test("a stored touch is forgotten after the expiry, and the next visit becomes the first touch", () => {
  const storage = fakeStorage();
  visit(storage, TAGGED);
  const justBefore = T0 + ATTRIBUTION_TTL_DAYS * DAY;
  assert.equal(readFirstTouch({ storage, now: justBefore }).utm_source, "linkedin");
  assert.equal(readFirstTouch({ storage, now: justBefore + 1 }), null);

  const fresh = visit(storage, "?utm_source=newsletter&utm_medium=email", { now: justBefore + DAY });
  assert.equal(fresh.utm_source, "newsletter");
  assert.equal(readFirstTouch({ storage, now: justBefore + DAY }).utm_source, "newsletter");
  assert.equal(ATTRIBUTION_TTL_DAYS, 30);
});

test("a referrer from our own site is not recorded as the source", () => {
  const touch = visit(fakeStorage(), "", { referrer: `${ORIGIN}/demo/` });
  assert.equal(touch.referrer, null);
});

test("script-like tags in the address are never stored", () => {
  const storage = fakeStorage();
  const touch = visit(storage, "?utm_source=%3Cscript%3Ealert(1)%3C/script%3E&utm_medium=%22%3E%3Cimg%20src%3Dx%3E&utm_campaign=ok");
  assert.equal(touch.utm_source, null);
  assert.equal(touch.utm_medium, null);
  assert.equal(touch.utm_campaign, "ok");
  assert.doesNotMatch(storage.store.get(STORAGE_KEY), /script|<|>|img/i);
});

test("a script-like referrer is never stored", () => {
  const storage = fakeStorage();
  visit(storage, "", { referrer: "javascript:alert(1)" });
  assert.equal(readFirstTouch({ storage, now: T0 }).referrer, null);
});

test("blocked storage does not crash: the touch is still returned", () => {
  for (const options of [{ getThrows: true }, { setThrows: true }, { getThrows: true, setThrows: true }]) {
    const touch = visit(fakeStorage(options), TAGGED);
    assert.equal(touch.utm_source, "linkedin", JSON.stringify(options));
  }
  assert.equal(readFirstTouch({ storage: fakeStorage({ getThrows: true }), now: T0 }), null);
  assert.equal(readFirstTouch({ storage: undefined, now: T0 }), null);
  assert.equal(readFirstTouch(), null);
  assert.equal(visit(undefined, TAGGED).utm_source, "linkedin");
});

test("corrupt or unexpected stored data is treated as empty and replaced", () => {
  for (const junk of ["", "not json", "null", "42", "[]", '"text"', "{}", '{"capturedAt":"yesterday","touch":{}}', '{"capturedAt":null,"touch":{}}']) {
    const storage = fakeStorage({ data: { [STORAGE_KEY]: junk } });
    assert.equal(readFirstTouch({ storage, now: T0 }), null, junk);
    const touch = visit(storage, TAGGED);
    assert.equal(touch.utm_source, "linkedin", junk);
    assert.equal(readFirstTouch({ storage, now: T0 }).utm_source, "linkedin", junk);
  }
});

test("a stored touch dated in the future is ignored", () => {
  const storage = fakeStorage({ data: { [STORAGE_KEY]: JSON.stringify({ capturedAt: T0 + DAY, touch: { utm_source: "x" } }) } });
  assert.equal(readFirstTouch({ storage, now: T0 }), null);
});

test("a stored value edited by hand is cleaned again when it is read", () => {
  const edited = { capturedAt: T0, touch: { utm_source: "<script>alert(1)</script>", utm_medium: "email", referrer: "javascript:x", landing_page: "/x?secret=1", isAdmin: true } };
  const storage = fakeStorage({ data: { [STORAGE_KEY]: JSON.stringify(edited) } });
  assert.deepEqual(readFirstTouch({ storage, now: T0 }), { ...NULLS, utm_medium: "email", landing_page: "/x" });
});

test("a stored touch whose tags were all removed by cleaning counts as untagged", () => {
  const edited = { capturedAt: T0, touch: { utm_source: "<b>", landing_page: "/" } };
  const storage = fakeStorage({ data: { [STORAGE_KEY]: JSON.stringify(edited) } });
  const touch = visit(storage, TAGGED, { now: T0 + 1000 });
  assert.equal(touch.utm_source, "linkedin");
});

test("importing the module in Node does nothing and getFirstTouch is safe without a browser", () => {
  assert.equal(getFirstTouch(), null);
});

test("both pages load the capture script and say that campaign details go into localStorage", () => {
  for (const page of ["index.html", "demo/index.html"]) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(html, /<script type="module" src="\/assets\/js\/attribution\.js"><\/script>/, page);
    assert.match(html, /stores campaign details \(UTM tags, referrer and landing page\) in your browser's localStorage and saves them with your enquiry\./, page);
  }
});
