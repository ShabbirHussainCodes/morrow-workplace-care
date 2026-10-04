// The signed admin session token and the cookie lookup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import {
  SESSION_COOKIE, SESSION_SECONDS, createSessionToken, verifySessionToken, sessionFromRequest,
} from "../lib/session.js";
import { fakeReq } from "./helpers/fakes.js";

const SECRET = randomBytes(32).toString("hex");
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

// A token with any payload, correctly signed, so tests can reach the checks after the signature
const signed = (payload, secret = SECRET) => {
  const body = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
};
const flip = (text, index) => text.slice(0, index) + (text[index] === "A" ? "B" : "A") + text.slice(index + 1);

test("a new token verifies and lasts eight hours", () => {
  const token = createSessionToken(SECRET, NOW);
  const payload = verifySessionToken(token, SECRET, NOW + 1000);
  assert.ok(payload);
  assert.equal(payload.exp - payload.iat, SESSION_SECONDS);
  assert.equal(SESSION_SECONDS, 8 * 60 * 60);
  assert.ok(typeof payload.sid === "string" && payload.sid.length >= 16);
});

test("two tokens made at the same moment are different", () => {
  assert.notEqual(createSessionToken(SECRET, NOW), createSessionToken(SECRET, NOW));
});

test("a token is refused once it has expired, to the second", () => {
  const token = createSessionToken(SECRET, NOW);
  assert.ok(verifySessionToken(token, SECRET, NOW + (SESSION_SECONDS - 1) * 1000));
  assert.equal(verifySessionToken(token, SECRET, NOW + SESSION_SECONDS * 1000), null);
  assert.equal(verifySessionToken(token, SECRET, NOW + (SESSION_SECONDS + 3600) * 1000), null);
});

test("a token signed with another secret is refused", () => {
  const token = createSessionToken(SECRET, NOW);
  assert.equal(verifySessionToken(token, randomBytes(32).toString("hex"), NOW), null);
});

test("a changed payload or a changed signature is refused", () => {
  const token = createSessionToken(SECRET, NOW);
  const [body, signature] = token.split(".");
  assert.equal(verifySessionToken(`${flip(body, 5)}.${signature}`, SECRET, NOW), null);
  assert.equal(verifySessionToken(`${body}.${flip(signature, 5)}`, SECRET, NOW), null);
  assert.equal(verifySessionToken(`${body}.${signature.slice(0, -1)}`, SECRET, NOW), null);
});

test("a payload edited to last longer is refused because the signature no longer matches", () => {
  const token = createSessionToken(SECRET, NOW);
  const [body, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  payload.exp += 86400;
  const forged = Buffer.from(JSON.stringify(payload)).toString("base64url");
  assert.equal(verifySessionToken(`${forged}.${signature}`, SECRET, NOW), null);
});

test("a correctly signed token that lasts longer than we ever issue is refused", () => {
  const iat = Math.floor(NOW / 1000);
  assert.equal(verifySessionToken(signed({ iat, exp: iat + SESSION_SECONDS + 1 }), SECRET, NOW), null);
  assert.ok(verifySessionToken(signed({ iat, exp: iat + SESSION_SECONDS }), SECRET, NOW));
});

test("a token from the future is refused", () => {
  const iat = Math.floor(NOW / 1000) + 3600;
  assert.equal(verifySessionToken(signed({ iat, exp: iat + 60 }), SECRET, NOW), null);
});

test("a signed payload that is not the expected shape is refused", () => {
  const iat = Math.floor(NOW / 1000);
  for (const payload of ["not json", "null", "[]", "42", { iat }, { exp: iat + 60 }, { iat: "1", exp: "2" }, { iat: 1.5, exp: iat + 60 }]) {
    assert.equal(verifySessionToken(signed(payload), SECRET, NOW), null, JSON.stringify(payload));
  }
});

test("garbage never throws and never verifies", () => {
  const token = createSessionToken(SECRET, NOW);
  for (const junk of [undefined, null, 5, {}, [], "", ".", "a", "a.", ".b", "a.b.c", "x".repeat(5000), `${token}.extra`, token.replace(".", "..")]) {
    assert.equal(verifySessionToken(junk, SECRET, NOW), null, String(junk).slice(0, 30));
  }
  assert.equal(verifySessionToken(token, undefined, NOW), null);
  assert.equal(verifySessionToken(token, 12345, NOW), null);
});

test("the session is read from the request's cookie", () => {
  const token = createSessionToken(SECRET, NOW);
  const withCookie = fakeReq({ headers: { cookie: `other=1; ${SESSION_COOKIE}=${token}; more=2` } });
  assert.ok(sessionFromRequest(withCookie, SECRET, NOW));
  assert.equal(sessionFromRequest(fakeReq({ headers: {} }), SECRET, NOW), null);
  assert.equal(sessionFromRequest(fakeReq({ headers: { cookie: `other=${token}` } }), SECRET, NOW), null);
  assert.equal(sessionFromRequest(fakeReq({ headers: { cookie: `${SESSION_COOKIE}=${flip(token, 3)}` } }), SECRET, NOW), null);
});
