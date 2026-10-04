// First-touch attribution in the browser.
//
// On every page view we look at the address (UTM tags), the referrer and the landing path, and
// keep the FIRST useful touch in localStorage so it survives later page views. The enquiry form
// sends it along with the lead. The rules, limits and cleaning live in workflow.js and are
// shared with the server, which cleans the value again: localStorage can be edited by anyone.
//
// Which touch is kept:
//   - the first visit is always stored, tagged or not
//   - an untagged first visit is replaced by the first TAGGED visit that follows it, so a tagged
//     demo link still counts in a browser that opened the site plainly earlier
//   - a tagged touch is never replaced
//   - a stored touch is forgotten after ATTRIBUTION_TTL_DAYS
import { ATTRIBUTION_TTL_DAYS, isTagged, parseTouch, sanitizeAttribution } from "./workflow.js";

export const STORAGE_KEY = "morrow_first_touch_v1";
const DAY_MS = 24 * 60 * 60 * 1000;

/** The stored first touch, or null when there is none, it expired, or it is not valid. */
export function readFirstTouch({ storage, now = Date.now() } = {}) {
  let stored;
  try {
    stored = JSON.parse(storage.getItem(STORAGE_KEY));
  } catch {
    return null;                       // no storage, access denied, or not JSON
  }
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return null;

  const { capturedAt, touch } = stored;
  if (!Number.isFinite(capturedAt)) return null;
  const age = now - capturedAt;
  if (age < 0 || age > ATTRIBUTION_TTL_DAYS * DAY_MS) return null;
  return sanitizeAttribution(touch);   // cleaned again: anyone can edit localStorage
}

/**
 * Record this page view if it should become the first touch. Returns the touch that now counts.
 * Never throws: when storage is blocked (some private modes) the touch is still returned, so it
 * can be used for the rest of this page view.
 */
export function captureFirstTouch({ storage, location, referrer, now = Date.now() }) {
  const existing = readFirstTouch({ storage, now });
  if (existing && isTagged(existing)) return existing;

  const current = parseTouch({
    search: location.search, referrer, pathname: location.pathname, ownOrigin: location.origin,
  });
  if (existing && !isTagged(current)) return existing;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ capturedAt: now, touch: current }));
  } catch {
    // Storage is full or blocked. The touch is still returned below.
  }
  return current;
}

// Reading window.localStorage itself can throw (for example when site data is blocked)
function browserStorage() {
  try { return window.localStorage; } catch { return undefined; }
}

let remembered = null;   // only used when storage does not work

/** The first touch for the form to send, or null. */
export function getFirstTouch() {
  return readFirstTouch({ storage: browserStorage() }) ?? remembered;
}

// Runs once per page view in a browser. In Node (tests) there is no document, so nothing runs.
if (typeof document !== "undefined") {
  remembered = captureFirstTouch({
    storage: browserStorage(), location: window.location, referrer: document.referrer,
  });
}
