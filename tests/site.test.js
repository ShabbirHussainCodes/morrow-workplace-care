// Rules about the whole site that no single feature owns: how user text is rendered, that stages
// and retention are defined once, that every page carries the concept labelling, and how many
// serverless functions we ship.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { RETENTION_DAYS, STAGES } from "../assets/js/workflow.js";

const ROOT = new URL("../", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".git", ".vercel"]);

function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}
const read = (file) => readFileSync(file, "utf8");
const rel = (file) => relative(ROOT, file);
const stripJsComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const pages = walk(ROOT, (f) => f.endsWith(".html"));
const browserScripts = walk(join(ROOT, "assets/js"), (f) => f.endsWith(".js"));
const serverScripts = [...walk(join(ROOT, "api"), (f) => f.endsWith(".js")), ...walk(join(ROOT, "lib"), (f) => f.endsWith(".js"))];

test("the site has at least the homepage and the dashboard", () => {
  assert.ok(pages.map(rel).includes("index.html"));
  assert.ok(pages.map(rel).includes("demo/index.html"));
});

test("visitor text is never rendered as HTML: no innerHTML, outerHTML, insertAdjacentHTML or document.write", () => {
  for (const file of browserScripts) {
    const code = stripJsComments(read(file));
    assert.doesNotMatch(code, /\b(innerHTML|outerHTML|insertAdjacentHTML)\b/, `${rel(file)} writes HTML`);
    assert.doesNotMatch(code, /document\.write\s*\(/, `${rel(file)} uses document.write`);
  }
});

test("stage names are defined only in workflow.js", () => {
  const places = [...browserScripts, ...serverScripts, ...pages].filter((f) => !f.endsWith("assets/js/workflow.js"));
  for (const file of places) {
    const text = read(file);
    for (const stage of STAGES.filter((s) => s !== STAGES[0])) {
      assert.ok(!text.includes(stage), `${rel(file)} repeats the stage name "${stage}"`);
    }
  }
});

test("the retention period is defined only in workflow.js", () => {
  for (const file of [...browserScripts, ...serverScripts].filter((f) => !f.endsWith("assets/js/workflow.js"))) {
    assert.doesNotMatch(read(file), /RETENTION_DAYS\s*=/, `${rel(file)} defines its own retention period`);
  }
});

test("copy that says when leads are deleted agrees with RETENTION_DAYS", () => {
  // Only sentences about deleting, removing or hiding count; other durations are not retention.
  const mentions = [...pages, join(ROOT, "README.md")].flatMap((file) =>
    read(file).split(/(?<=[.!?])\s+|\n/)
      .filter((sentence) => /delet|remov|hidden/i.test(sentence))
      .flatMap((sentence) => [...sentence.matchAll(/(\d+)\s+days/g)].map((m) => ({ file: rel(file), days: Number(m[1]) }))));
  assert.ok(mentions.length >= 3, "expected the copy to mention the retention period");
  for (const { file, days } of mentions) assert.equal(days, RETENTION_DAYS, `${file} says ${days} days`);
});

test("every page carries the concept strip and the footer disclosure", () => {
  for (const file of pages) {
    const html = read(file);
    assert.match(html, /class="concept-strip"/, `${rel(file)} has no concept strip`);
    assert.match(html, /Portfolio concept|portfolio concept/, `${rel(file)} concept strip does not say it is a portfolio concept`);
    assert.match(html, /class="[^"]*\bdisclosure\b[^"]*"/, `${rel(file)} has no footer disclosure`);
    assert.match(html, /not a real cleaning company/, `${rel(file)} footer does not say the company is fictional`);
  }
});

test("every page tells visitors to use test details or that the data is test data", () => {
  for (const file of pages) {
    assert.match(read(file), /use test details|test data only/i, `${rel(file)} has no test-data note`);
  }
  assert.match(read(join(ROOT, "index.html")), /Please use test details/);
});

test("the number of serverless functions stays small (Hobby plan limits are unverified)", () => {
  const functions = walk(join(ROOT, "api"), (f) => f.endsWith(".js")).map(rel).sort();
  assert.deepEqual(functions, ["api/admin/session.js", "api/cron/retention.js", "api/lead.js", "api/leads.js"]);
  // Going past six must be a deliberate decision: change this number in the same pull request.
  assert.ok(functions.length <= 6, `${functions.length} functions in api/`);
});
