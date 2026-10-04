// Lead workflow rules — shared by the browser (local preview) and the API.
// Plain, explainable rules: every tag and next step can be traced to a form answer.
// This file is the one place that defines stages, retention days and input limits.

export const SPACE_TYPES = {
  office: "Office",
  coworking: "Shared workspace / coworking",
  retail: "Retail or showroom",
  clinic: "Clinic or studio",
  other: "Other commercial space",
};

export const TIMINGS = {
  asap: "As soon as possible",
  "two-weeks": "Within 2 weeks",
  month: "Within a month",
  exploring: "Just exploring options",
};

const SERVICES = {
  routine: "Routine office care",
  shared: "Shared-space detailing",
  reset: "One-off reset",
};

/** Pipeline stages, in order. The database CHECK constraint must list the same names. */
export const STAGES = ["New", "Walkthrough booked", "Proposal sent"];

/** Demo leads are removed after this many days. */
export const RETENTION_DAYS = 7;

/** Maximum length of each user-supplied field, counted in characters (code points). */
export const LIMITS = {
  fullName: 120,
  email: 200,
  company: 160,
  spaceType: 40,
  timing: 40,
  message: 2000,
  service: 40,
};

export const isStage = (value) => STAGES.includes(value);

// Own-property lookups only: a plain object also answers to "constructor" or "toString".
const has = (table, key) => typeof key === "string" && Object.hasOwn(table, key);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Control characters, bidirectional overrides and the byte-order mark. A NUL byte makes
// Postgres reject the row, and CR/LF in a name could be used to inject mail headers later.
const BLOCKED = /[\p{Cc}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{FEFF}]/gu;

/**
 * Clean one user-supplied text value: strip control characters, drop broken surrogate
 * halves, trim, and cut to `max` characters. Only strings are accepted; anything else
 * becomes an empty string. A multi-line field keeps its line breaks and tabs.
 */
export function cleanText(value, max, { multiline = false } = {}) {
  if (typeof value !== "string") return "";

  let text = value.replace(/\r\n?|\u{2028}|\u{2029}/gu, "\n");
  text = text.replace(BLOCKED, (ch) => (ch === "\n" || ch === "\t" ? (multiline ? ch : " ") : ""));
  if (!multiline) text = text.replace(/ {2,}/g, " ");

  // Walk by code point so a limit never splits an emoji, and lone surrogates are dropped.
  const kept = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) continue;
    if (kept.length >= max) break;
    kept.push(ch);
  }
  return kept.join("").trim();
}

/** Return the UUID in lower case, or null when the value is not a UUID. */
export function validateSubmissionId(value) {
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : null;
}

export const isUuid = (value) => validateSubmissionId(value) !== null;

/** A fresh random UUID (version 4) for one form submission. */
export function newSubmissionId(cryptoObj = globalThis.crypto) {
  if (typeof cryptoObj?.randomUUID === "function") return cryptoObj.randomUUID();
  if (typeof cryptoObj?.getRandomValues !== "function") {
    throw new Error("No secure random source is available in this browser.");
  }
  const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;   // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80;   // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Validate and normalise raw form input. Returns { data } or { errors }. */
export function validateLead(input = {}) {
  const source = input !== null && typeof input === "object" ? input : {};
  const data = {
    fullName: cleanText(source.fullName, LIMITS.fullName),
    email: cleanText(source.email, LIMITS.email).toLowerCase(),
    company: cleanText(source.company, LIMITS.company),
    spaceType: cleanText(source.spaceType, LIMITS.spaceType),
    timing: cleanText(source.timing, LIMITS.timing),
    message: cleanText(source.message, LIMITS.message, { multiline: true }),
    service: cleanText(source.service, LIMITS.service),
  };
  const errors = {};
  if (data.fullName.length < 2) errors.fullName = "Please enter your full name.";
  if (!EMAIL_RE.test(data.email)) errors.email = "Please enter a valid work email.";
  if (data.company.length < 2) errors.company = "Please enter your company name.";
  if (!has(SPACE_TYPES, data.spaceType)) errors.spaceType = "Please choose a type of space.";
  if (!has(TIMINGS, data.timing)) errors.timing = "Please choose when you need support.";
  if (data.message.length < 10) errors.message = "Please add a short message (10+ characters).";
  if (data.service && !has(SERVICES, data.service)) data.service = "";
  return Object.keys(errors).length ? { errors } : { data };
}

/** Infer which service the enquiry is about: clicked card first, then message keywords. */
function inferService(data) {
  if (data.service) return SERVICES[data.service];
  const m = data.message.toLowerCase();
  if (/(moving|\bmove\b|refurb|renovat|deep clean|one[- ]off|handover|\breset\b|fit[- ]?out)/.test(m)) return SERVICES.reset;
  if (data.spaceType === "coworking" || /(meeting room|reception|cowork|shared)/.test(m)) return SERVICES.shared;
  return SERVICES.routine;
}

/** Turn a validated lead into tags, a priority, a next step and a follow-up draft. */
export function processLead(data) {
  const priority =
    data.timing === "asap" ? "High" :
    data.timing === "two-weeks" ? "High" :
    data.timing === "month" ? "Medium" : "Low";

  const nextStep = {
    High: "Reply within 1 business day and offer two walkthrough slots this week.",
    Medium: "Reply within 2 business days with walkthrough slots for the next fortnight.",
    Low: "Send a short overview now and check in again in 2 weeks.",
  }[priority];

  const service = inferService(data);
  const firstName = data.fullName.split(/\s+/)[0];
  const space = SPACE_TYPES[data.spaceType].toLowerCase();
  const timing = TIMINGS[data.timing].toLowerCase();

  const followUp = {
    subject: `Walkthrough for ${data.company} — Morrow Workplace Care`,
    body:
`Hi ${firstName},

Thanks for getting in touch about ${service.toLowerCase()} for your ${space} at ${data.company}. You mentioned you need support ${timing}.

${priority === "Low"
  ? "No rush at all. I've attached a short overview of how we work. When you're ready, a 30-minute walkthrough is the easiest way to scope things properly."
  : "The quickest way to get you a clear plan is a short walkthrough of the space. Would either of these work for you?\n\n  • [Slot 1]\n  • [Slot 2]"}

Best regards,
[Name]
Morrow Workplace Care`,
  };

  return {
    tags: [SPACE_TYPES[data.spaceType], service, `Priority: ${priority}`],
    priority,
    service,
    nextStep,
    followUp,
    status: STAGES[0],
  };
}

/** Mask an email for public display: jane.doe@acme.com → j•••@acme.com */
export function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  if (!domain) return "•••";
  return `${user.slice(0, 1)}•••@${domain}`;
}

// ---- Attribution: where a visitor came from ----------------------------------------------------
// The browser keeps the first touch (UTM tags, referrer, landing page) and sends it with the
// enquiry. The server runs the same sanitizer again, because nothing from the browser is trusted.
// A bad value is dropped, never an error: a lead must not be lost over a mistyped campaign tag.

/** What is stored with a lead, in this order. The database columns have the same names. */
export const ATTRIBUTION_FIELDS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "referrer", "landing_page",
];
export const UTM_FIELDS = ATTRIBUTION_FIELDS.slice(0, 5);

/** Longest value kept for each field, in characters. Longer values are cut. */
export const ATTRIBUTION_LIMITS = {
  utm_source: 100, utm_medium: 100, utm_campaign: 100, utm_term: 100, utm_content: 100,
  referrer: 500, landing_page: 300,
};

/** The browser forgets a stored first touch after this many days. */
export const ATTRIBUTION_TTL_DAYS = 30;

// Letters and numbers in any script, spaces, and the punctuation real campaign names use.
// Anything else (< > " ` { } ; $ \ ? [ ]) makes the whole value suspect, so it is dropped.
const UTM_ALLOWED = /^[\p{L}\p{N}\p{M} _.\-+:\/~%@,()|&=#!*']+$/u;
// Letters and digits pass the pattern above, so a script scheme needs its own check.
const SCRIPT_SCHEME = /(^|[^a-z])(javascript|vbscript|data)\s*:/i;

export const emptyAttribution = () => Object.fromEntries(ATTRIBUTION_FIELDS.map((field) => [field, null]));

function cleanUtm(value, max) {
  const text = cleanText(value, max);
  if (!text || !UTM_ALLOWED.test(text) || SCRIPT_SCHEME.test(text)) return null;
  return text;
}

// Only the origin and path are kept. A query string or fragment can carry personal data
// (search terms, tokens, email addresses), and credentials in a URL are never wanted.
function cleanReferrer(value) {
  const text = cleanText(value, 2000);
  if (!text) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return cleanText(`${url.protocol}//${url.host}${url.pathname}`, ATTRIBUTION_LIMITS.referrer) || null;
}

// A path on this site, without its query or fragment.
function cleanLandingPage(value) {
  const text = cleanText(value, 2000);
  if (!text.startsWith("/") || text.startsWith("//") || text.includes("\\")) return null;
  let url;
  try { url = new URL(text, "https://placeholder.invalid"); } catch { return null; }
  if (url.origin !== "https://placeholder.invalid") return null;
  return cleanText(url.pathname, ATTRIBUTION_LIMITS.landing_page) || null;
}

/**
 * Clean attribution from the browser. Always returns all seven fields, each a string or null.
 * Anything that is not a plain object gives all nulls, and keys we do not know are ignored.
 */
export function sanitizeAttribution(input) {
  const out = emptyAttribution();
  if (input === null || typeof input !== "object" || Array.isArray(input)) return out;
  const own = (key) => (Object.hasOwn(input, key) ? input[key] : undefined);   // never inherited keys
  for (const field of UTM_FIELDS) out[field] = cleanUtm(own(field), ATTRIBUTION_LIMITS[field]);
  out.referrer = cleanReferrer(own("referrer"));
  out.landing_page = cleanLandingPage(own("landing_page"));
  return out;
}

/** True when at least one UTM tag is present: the visit came from a tagged link. */
export const isTagged = (attribution) => UTM_FIELDS.some((field) => Boolean(attribution?.[field]));

/** True when any attribution value is present at all. */
export const hasAttribution = (attribution) => ATTRIBUTION_FIELDS.some((field) => Boolean(attribution?.[field]));

const sameSite = (referrer, ownOrigin) => {
  try { return Boolean(ownOrigin) && new URL(referrer).origin === ownOrigin; } catch { return false; }
};

/**
 * Attribution for one page view. `search` is location.search, `referrer` is document.referrer
 * and `pathname` is location.pathname. A referrer from our own site is a click between our
 * pages, not a source, so it is ignored. UTM names are matched in lower case, as tools write them.
 */
export function parseTouch({ search = "", referrer = "", pathname = "/", ownOrigin = "" } = {}) {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  const raw = {};
  for (const field of UTM_FIELDS) raw[field] = params.get(field) ?? undefined;   // first value wins
  raw.referrer = sameSite(referrer, ownOrigin) ? undefined : referrer;
  raw.landing_page = pathname;
  return sanitizeAttribution(raw);
}
