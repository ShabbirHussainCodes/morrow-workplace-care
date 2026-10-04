// Security headers and the rules that keep the site compatible with a strict Content Security
// Policy: no inline scripts or styles, no third-party hosts, fonts and favicon served by us.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const exists = (p) => existsSync(join(ROOT, p));
const vercel = JSON.parse(read("vercel.json"));

const rule = (source) => vercel.headers.find((h) => h.source === source);
const headerOf = (source, key) => rule(source)?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", ".vercel"].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}
const pages = walk(ROOT, (f) => f.endsWith(".html")).map((f) => relative(ROOT, f));
const rel = (page, ref) => (ref.startsWith("/") ? ref.slice(1) : join(dirname(page), ref));

function csp() {
  const value = headerOf("/(.*)", "Content-Security-Policy");
  assert.ok(value, "no Content-Security-Policy header for /(.*)");
  return Object.fromEntries(value.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...sources] = d.split(/\s+/);
    return [name, sources];
  }));
}

// ---- the headers ---------------------------------------------------------------------------

test("every response gets the security headers", () => {
  assert.equal(headerOf("/(.*)", "X-Content-Type-Options"), "nosniff");
  assert.equal(headerOf("/(.*)", "X-Frame-Options"), "DENY");
  assert.equal(headerOf("/(.*)", "Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(headerOf("/(.*)", "Cross-Origin-Opener-Policy"), "same-origin");
  const permissions = headerOf("/(.*)", "Permissions-Policy");
  for (const feature of ["camera", "microphone", "geolocation", "payment"]) assert.match(permissions, new RegExp(`${feature}=\\(\\)`));
});

test("the CSP allows only this site, with no inline code and no eval", () => {
  const policy = csp();
  assert.deepEqual(policy["default-src"], ["'self'"]);
  assert.deepEqual(policy["script-src"], ["'self'"]);
  assert.deepEqual(policy["style-src"], ["'self'"]);
  assert.deepEqual(policy["font-src"], ["'self'"]);
  assert.deepEqual(policy["connect-src"], ["'self'"]);
  assert.deepEqual(policy["form-action"], ["'self'"]);
  assert.deepEqual(policy["img-src"].sort(), ["'self'", "data:"]);
  assert.deepEqual(policy["frame-ancestors"], ["'none'"]);
  assert.deepEqual(policy["object-src"], ["'none'"]);
  assert.deepEqual(policy["base-uri"], ["'self'"]);
});

test("no CSP source is unsafe, wildcard or an outside host", () => {
  for (const [directive, sources] of Object.entries(csp())) {
    for (const source of sources) {
      assert.doesNotMatch(source, /unsafe-inline|unsafe-eval|unsafe-hashes/, `${directive} allows ${source}`);
      assert.doesNotMatch(source, /^\*$|^https?:|^wss?:|\./, `${directive} allows the outside source ${source}`);
    }
  }
  assert.ok(!csp()["script-src"].includes("data:"));
});

test("we do not set HSTS ourselves; Vercel adds its own header", () => {
  assert.equal(headerOf("/(.*)", "Strict-Transport-Security"), undefined);
});

test("fonts are cached for a while", () => {
  assert.match(headerOf("/assets/fonts/(.*)", "Cache-Control"), /^public, max-age=\d+$/);
});

// ---- pages stay compatible with that CSP ---------------------------------------------------------

test("no page has inline scripts, inline styles, style attributes or inline event handlers", () => {
  for (const page of pages) {
    const html = read(page).replace(/<!--[\s\S]*?-->/g, "");
    for (const [, attrs] of html.matchAll(/<script\b([^>]*)>/gi)) assert.match(attrs, /\bsrc=/, `${page} has an inline <script>`);
    assert.doesNotMatch(html, /<style\b/i, `${page} has a <style> block`);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${page} has a style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${page} has an inline event handler`);
    assert.doesNotMatch(html, /javascript:/i, `${page} has a javascript: URL`);
  }
});

test("pages load nothing from outside this site", () => {
  for (const page of pages) {
    const html = read(page);
    for (const [tag, attr] of [["link", "href"], ["script", "src"], ["img", "src"], ["source", "src"], ["iframe", "src"], ["form", "action"], ["base", "href"], ["audio", "src"], ["video", "src"]]) {
      for (const [, attrs] of html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "gi"))) {
        const value = attrs.match(new RegExp(`\\s${attr}="([^"]*)"`, "i"))?.[1];
        if (value) assert.doesNotMatch(value, /^(https?:)?\/\//i, `${page}: <${tag}> loads ${value} from another host`);
      }
    }
  }
});

test("local files that pages reference exist", () => {
  for (const page of pages) {
    const html = read(page);
    const refs = [
      ...[...html.matchAll(/<link\b[^>]*\shref="([^"]+)"/gi)].map((m) => m[1]),
      ...[...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/gi)].map((m) => m[1]),
      ...[...html.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/gi)].map((m) => m[1]),
    ].filter((r) => !/^(https?:|mailto:|#|data:)/.test(r));
    for (const ref of refs) assert.ok(exists(rel(page, ref)), `${page} references missing ${ref}`);
  }
});

test("scripts never use eval or new Function, which the CSP blocks", () => {
  for (const file of walk(join(ROOT, "assets/js"), (f) => f.endsWith(".js"))) {
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(code, /\beval\s*\(|new\s+Function\s*\(/, relative(ROOT, file));
  }
});

// ---- stylesheet, fonts, favicon ---------------------------------------------------------------------

test("the stylesheet imports nothing and points only at files that exist or data: images", () => {
  const css = read("assets/css/styles.css");
  assert.doesNotMatch(css, /@import/);
  for (const [, ref] of css.matchAll(/url\(\s*["']?([^)"']+)["']?\s*\)/g)) {
    if (ref.startsWith("data:")) continue;
    assert.doesNotMatch(ref, /^(https?:)?\/\//, `stylesheet loads ${ref} from another host`);
    assert.ok(exists(ref.replace(/^\//, "")), `stylesheet references missing ${ref}`);
  }
});

test("each font is declared with font-display and is a real WOFF2 file with its licence next to it", () => {
  const css = read("assets/css/styles.css");
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
  assert.equal(faces.length, 2);
  for (const face of faces) {
    assert.match(face, /font-display:\s*swap/);
    const file = face.match(/url\("([^"]+)"\)/)[1].replace(/^\//, "");
    assert.ok(exists(file), `${file} is missing`);
    assert.equal(readFileSync(join(ROOT, file)).subarray(0, 4).toString("latin1"), "wOF2", `${file} is not WOFF2`);
  }
  assert.ok(exists("assets/fonts/LICENSE-Inter.txt"));
  assert.ok(exists("assets/fonts/LICENSE-Fraunces.txt"));
  assert.match(read("assets/fonts/LICENSE-Inter.txt"), /SIL Open Font License/);
  assert.match(read("assets/fonts/LICENSE-Fraunces.txt"), /SIL Open Font License/);
});

test("preloaded fonts exist, are WOFF2 and carry crossorigin (fonts need it even on the same site)", () => {
  for (const page of pages) {
    for (const [, attrs] of read(page).matchAll(/<link\b([^>]*rel="preload"[^>]*)>/gi)) {
      const href = attrs.match(/href="([^"]+)"/)[1];
      assert.match(attrs, /as="font"/);
      assert.match(attrs, /type="font\/woff2"/);
      assert.match(attrs, /\scrossorigin\b/, `${page}: preload of ${href} needs crossorigin`);
      assert.ok(exists(href.replace(/^\//, "")));
    }
  }
});

test("both pages link the favicon, which is a plain SVG with no scripts or outside references", () => {
  for (const page of pages) assert.match(read(page), /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/, page);
  const svg = read("favicon.svg");
  assert.match(svg, /^<svg\b/);
  assert.doesNotMatch(svg, /<script|href=|xlink:|<image|<foreignObject|https?:\/\/(?!www\.w3\.org)/i);
});
