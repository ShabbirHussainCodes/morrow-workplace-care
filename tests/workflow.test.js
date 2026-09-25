// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLead, processLead, maskEmail } from "../assets/js/workflow.js";

const valid = {
  fullName: "Test User",
  email: "Test@Example.com",
  company: "Acme Test Ltd",
  spaceType: "office",
  timing: "asap",
  message: "We are moving into a new floor next month.",
};

test("accepts a valid lead and normalises the email", () => {
  const { data, errors } = validateLead(valid);
  assert.equal(errors, undefined);
  assert.equal(data.email, "test@example.com");
});

test("rejects missing and invalid fields", () => {
  const { errors } = validateLead({ ...valid, email: "not-an-email", spaceType: "castle", message: "hi" });
  assert.ok(errors.email);
  assert.ok(errors.spaceType);
  assert.ok(errors.message);
});

test("urgent timing gives High priority", () => {
  const { data } = validateLead(valid);
  assert.equal(processLead(data).priority, "High");
});

test("exploring gives Low priority", () => {
  const { data } = validateLead({ ...valid, timing: "exploring" });
  assert.equal(processLead(data).priority, "Low");
});

test("moving/refurb wording suggests a one-off reset", () => {
  const { data } = validateLead(valid);
  assert.equal(processLead(data).service, "One-off reset");
});

test("clicked service card wins over message keywords", () => {
  const { data } = validateLead({ ...valid, service: "routine" });
  assert.equal(processLead(data).service, "Routine office care");
});

test("follow-up draft uses the first name and company", () => {
  const { data } = validateLead(valid);
  const { followUp } = processLead(data);
  assert.match(followUp.body, /^Hi Test,/);
  assert.match(followUp.subject, /Acme Test Ltd/);
});

test("masks emails for public display", () => {
  assert.equal(maskEmail("jane.doe@acme.com"), "j•••@acme.com");
});
