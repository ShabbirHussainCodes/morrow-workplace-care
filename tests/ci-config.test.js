// The CI workflow is the safety net for every pull request, so its key
// promises are pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("CI runs on pushes to main and on every pull request", () => {
  assert.match(workflow, /^on:\s*$/m);
  assert.match(workflow, /^\s{2}push:\s*\n\s{4}branches:\s*\[main\]/m);

  // A branch filter on pull_request would skip pull requests that are stacked on another branch.
  const lines = workflow.split("\n");
  const start = lines.findIndex((l) => /^\s{2}pull_request:\s*$/.test(l));
  assert.notEqual(start, -1, "pull_request trigger is missing");
  for (let i = start + 1; i < lines.length && /^\s{3,}/.test(lines[i]); i += 1) {
    assert.doesNotMatch(lines[i], /branches/, "pull_request must not be limited to some base branches");
  }
});

test("CI uses the same Node major version as the package engines field", () => {
  const major = String(pkg.engines.node).match(/^(\d+)/)[1];
  assert.match(workflow, new RegExp(`node-version:\\s*${major}\\b`));
});

test("CI installs from the lockfile and runs npm test", () => {
  assert.match(workflow, /run:\s*npm ci/);
  assert.match(workflow, /run:\s*npm test/);
});

test("CI token is read-only", () => {
  assert.match(workflow, /^permissions:\s*\n\s{2}contents:\s*read\s*$/m);
});
