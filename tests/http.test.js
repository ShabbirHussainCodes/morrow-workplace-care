// Body reading, replies, the same-origin check (both paths) and cookies.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HttpError, readJsonBody, sendJson, allowMethods, checkSameOrigin,
  parseCookies, serializeCookie, clearCookie,
} from "../lib/http.js";
import { fakeReq, fakeRes } from "./helpers/fakes.js";

// ---- JSON body -------------------------------------------------------------------------

test("a JSON object body is returned as it is", () => {
  const body = { fullName: "Test User" };
  assert.equal(readJsonBody(fakeReq({ body })), body);
});

test("malformed JSON is a 400 and does not escape as a crash", () => {
  // Vercel's req.body getter throws when the JSON cannot be parsed
  assert.throws(() => readJsonBody(fakeReq({ bodyThrows: true })), (err) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 400);
    return true;
  });
});

test("a body that is not a JSON object is a 400", () => {
  for (const body of [undefined, null, "text", 42, true, [], [{ a: 1 }], Buffer.from("{}")]) {
    assert.throws(() => readJsonBody(fakeReq({ body })), (err) => err instanceof HttpError && err.status === 400, String(body));
  }
});

// ---- replies ---------------------------------------------------------------------------

test("sendJson sets the status and forbids caching", () => {
  const res = fakeRes();
  sendJson(res, 201, { ok: true });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(res.getHeader("Cache-Control"), "no-store");
});

test("allowMethods lets listed methods through and answers 405 with Allow for the rest", () => {
  const ok = fakeRes();
  assert.equal(allowMethods(fakeReq({ method: "POST" }), ok, ["POST"]), true);
  assert.equal(ok.ended, false);

  const refused = fakeRes();
  assert.equal(allowMethods(fakeReq({ method: "GET" }), refused, ["POST", "DELETE"]), false);
  assert.equal(refused.statusCode, 405);
  assert.equal(refused.getHeader("Allow"), "POST, DELETE");
});

// ---- same-origin check: path 1, Sec-Fetch-Site is present ---------------------------------

test("Sec-Fetch-Site same-origin passes, even without an Origin header", () => {
  const result = checkSameOrigin({ "sec-fetch-site": "same-origin", host: "morrow.example" });
  assert.deepEqual(result, { ok: true, via: "sec-fetch-site" });
});

test("Sec-Fetch-Site same-site, cross-site and none are refused", () => {
  for (const value of ["same-site", "cross-site", "none", "", "Same-Origin", "same-origin, cross-site"]) {
    assert.equal(checkSameOrigin({ "sec-fetch-site": value }).ok, false, `"${value}"`);
  }
});

test("a header that is not a plain string is refused", () => {
  assert.equal(checkSameOrigin({ "sec-fetch-site": ["same-origin"] }).ok, false);
});

test("when Sec-Fetch-Site is present it wins over a matching Origin", () => {
  for (const value of ["cross-site", "same-site", "none"]) {
    const result = checkSameOrigin({ "sec-fetch-site": value, origin: "https://morrow.example", host: "morrow.example" });
    assert.deepEqual(result, { ok: false, via: "sec-fetch-site" }, value);
  }
});

// ---- same-origin check: path 2, fall back to Origin and Host ----------------------------------

test("without Sec-Fetch-Site, an Origin whose host equals Host passes", () => {
  const result = checkSameOrigin({ origin: "https://morrow.example", host: "morrow.example" });
  assert.deepEqual(result, { ok: true, via: "origin" });
  assert.equal(checkSameOrigin({ origin: "http://localhost:3000", host: "localhost:3000" }).ok, true);
  assert.equal(checkSameOrigin({ origin: "https://Morrow.Example", host: "MORROW.example" }).ok, true);
});

test("without Sec-Fetch-Site, a different host is refused", () => {
  for (const origin of ["https://evil.example", "https://morrow.example.evil.example", "https://evilmorrow.example", "http://localhost:4000"]) {
    assert.equal(checkSameOrigin({ origin, host: "morrow.example" }).ok, false, origin);
  }
  assert.equal(checkSameOrigin({ origin: "http://localhost:4000", host: "localhost:3000" }).ok, false);
});

test("without Sec-Fetch-Site, a missing, null or unparseable Origin is refused", () => {
  assert.equal(checkSameOrigin({ host: "morrow.example" }).ok, false);
  assert.equal(checkSameOrigin({ origin: "null", host: "morrow.example" }).ok, false);
  assert.equal(checkSameOrigin({ origin: "not a url", host: "morrow.example" }).ok, false);
  assert.equal(checkSameOrigin({ origin: "", host: "morrow.example" }).ok, false);
  assert.equal(checkSameOrigin({ origin: ["https://morrow.example"], host: "morrow.example" }).ok, false);
});

test("without Sec-Fetch-Site, a missing Host is refused", () => {
  assert.equal(checkSameOrigin({ origin: "https://morrow.example" }).ok, false);
  assert.equal(checkSameOrigin({ origin: "https://morrow.example", host: "" }).ok, false);
});

// ---- cookies ---------------------------------------------------------------------------

test("a cookie is always HttpOnly, Secure, SameSite=Strict and scoped to /", () => {
  assert.equal(
    serializeCookie("morrow_admin", "abc.def", { maxAge: 28800 }),
    "morrow_admin=abc.def; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800",
  );
});

test("clearCookie expires the cookie at once", () => {
  assert.equal(clearCookie("morrow_admin"), "morrow_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
});

test("a cookie value or name that could break the header is refused", () => {
  assert.throws(() => serializeCookie("a", "x; Path=/evil", { maxAge: 1 }));
  assert.throws(() => serializeCookie("a", "x\r\nSet-Cookie: b=1", { maxAge: 1 }));
  assert.throws(() => serializeCookie("bad name", "x", { maxAge: 1 }));
  assert.throws(() => serializeCookie("a", "x", { maxAge: -1 }));
  assert.throws(() => serializeCookie("a", "x", { maxAge: 1.5 }));
});

test("parseCookies reads several cookies and never throws", () => {
  assert.deepEqual(parseCookies("a=1; morrow_admin=tok.sig;  b=two"), { a: "1", morrow_admin: "tok.sig", b: "two" });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(""), {});
  assert.deepEqual(parseCookies("novalue; =empty; ok=1"), { ok: "1" });
  assert.deepEqual(parseCookies("bad=%E0%A4%A"), { bad: "%E0%A4%A" });
});

test("when a cookie name repeats, the first one wins", () => {
  assert.deepEqual(parseCookies("morrow_admin=first; morrow_admin=second"), { morrow_admin: "first" });
});
