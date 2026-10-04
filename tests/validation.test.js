// Input cleaning, shared constants and the submission id helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAGES, RETENTION_DAYS, LIMITS, isStage, cleanText, validateLead, processLead,
  validateSubmissionId, isUuid, newSubmissionId,
} from "../assets/js/workflow.js";

const valid = {
  fullName: "Test User",
  email: "test@example.com",
  company: "Acme Test Ltd",
  spaceType: "office",
  timing: "asap",
  message: "We are moving into a new floor next month.",
};

// A string that holds a surrogate half on its own (not part of a pair)
const hasLoneSurrogate = (s) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

test("stages, retention days and limits are defined once and exported", () => {
  assert.deepEqual(STAGES, ["New", "Walkthrough booked", "Proposal sent"]);
  assert.equal(RETENTION_DAYS, 7);
  assert.equal(LIMITS.fullName, 120);
  assert.equal(LIMITS.message, 2000);
  assert.ok(isStage("New"));
  assert.ok(!isStage("Won"));
  assert.equal(processLead(validateLead(valid).data).status, STAGES[0]);
});

test("a NUL byte is removed instead of reaching the database", () => {
  const { data } = validateLead({ ...valid, fullName: "Test\u{0} User", company: "Ac\u{0}me Ltd" });
  assert.equal(data.fullName, "Test User");
  assert.equal(data.company, "Acme Ltd");
});

test("line breaks cannot be smuggled into single-line fields", () => {
  const { data } = validateLead({ ...valid, fullName: "Jane\r\nBcc: evil@example.com", company: "Acme\nLtd\t(UK)" });
  assert.doesNotMatch(data.fullName, /[\r\n]/);
  assert.equal(data.fullName, "Jane Bcc: evil@example.com");
  assert.equal(data.company, "Acme Ltd (UK)");
});

test("bidirectional overrides and the byte-order mark are removed", () => {
  assert.equal(cleanText("A\u{202E}bc\u{2066}d\u{FEFF}e", 50), "Abcde");
});

test("the message keeps its line breaks and tabs, and drops other control characters", () => {
  const { data } = validateLead({ ...valid, message: "Line one\r\nLine two\u{7}\n\tindented\u{2028}end" });
  assert.equal(data.message, "Line one\nLine two\n\tindented\nend");
});

test("length limits count characters, never split an emoji and leave no lone surrogate", () => {
  // The leading "a" makes the cut fall in the middle of an emoji if text is cut by UTF-16 unit
  const long = "a" + "😀".repeat(LIMITS.fullName + 30);
  const { data } = validateLead({ ...valid, fullName: long });
  assert.equal(Array.from(data.fullName).length, LIMITS.fullName);
  assert.ok(data.fullName.startsWith("a😀"));
  assert.ok(!hasLoneSurrogate(data.fullName));
});

test("a lone surrogate in the input is dropped", () => {
  const text = cleanText("ab\u{D83D}cd", 50);
  assert.equal(text, "abcd");
  assert.ok(!hasLoneSurrogate(text));
});

test("values that are not strings count as empty", () => {
  const { errors } = validateLead({ ...valid, fullName: { a: 1 }, company: ["Acme"], message: 12345678901234 });
  assert.ok(errors.fullName);
  assert.ok(errors.company);
  assert.ok(errors.message);
  assert.ok(validateLead(null).errors);
  assert.ok(validateLead("text").errors);
});

test("names that exist on every JavaScript object are not valid choices", () => {
  for (const word of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const { errors } = validateLead({ ...valid, spaceType: word, timing: word });
    assert.ok(errors.spaceType, `spaceType ${word}`);
    assert.ok(errors.timing, `timing ${word}`);
  }
  const { data } = validateLead({ ...valid, service: "constructor" });
  assert.equal(data.service, "");
  assert.doesNotThrow(() => processLead(data));
});

test("validateSubmissionId accepts a UUID in any case and returns it in lower case", () => {
  assert.equal(
    validateSubmissionId("9B1DEB4D-3B7D-4BAD-9BDD-2B0D7B3DCB6D"),
    "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  );
  assert.ok(isUuid("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"));
});

test("validateSubmissionId rejects anything else", () => {
  for (const bad of [undefined, null, 5, {}, [], "", "123", "9b1deb4d3b7d4bad9bdd2b0d7b3dcb6d",
    "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6", "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6dd", "zzzzzzzz-3b7d-4bad-9bdd-2b0d7b3dcb6d"]) {
    assert.equal(validateSubmissionId(bad), null, String(bad));
  }
});

test("newSubmissionId uses crypto.randomUUID when it exists", () => {
  assert.equal(newSubmissionId({ randomUUID: () => "from-native" }), "from-native");
  assert.ok(isUuid(newSubmissionId()));
});

test("newSubmissionId falls back to getRandomValues and still returns a version 4 UUID", () => {
  const fake = { getRandomValues: (bytes) => { bytes.fill(255); return bytes; } };
  const id = newSubmissionId(fake);
  assert.ok(isUuid(id));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("newSubmissionId refuses to invent an id without a secure random source", () => {
  assert.throws(() => newSubmissionId({}), /secure random/i);
  assert.throws(() => newSubmissionId(null), /secure random/i);
});
