// Enquiry form: validation, submission and the "behind the scenes" result view.
import { validateLead, processLead, newSubmissionId } from "./workflow.js";
import { getFirstTouch } from "./attribution.js";

const form = document.getElementById("lead-form");
const result = document.getElementById("lead-result");
const statusEl = document.getElementById("form-status");
const submitBtn = document.getElementById("submit-btn");
const FIELDS = ["fullName", "email", "company", "spaceType", "timing", "message"];
const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

// One id per form fill. A retry or a double click sends the same id, so the server returns the
// lead it already saved instead of creating a second one. A new id starts after "send another".
let submissionId = null;

// Clicking "Ask about …" on a service card pre-tags the enquiry with that service
document.querySelectorAll("[data-service]").forEach((link) => {
  link.addEventListener("click", () => {
    document.getElementById("service").value = link.dataset.service;
  });
});

function showErrors(errors = {}) {
  FIELDS.forEach((name) => {
    const field = document.getElementById(name);
    const msg = errors[name] || "";
    field.closest(".field").classList.toggle("has-error", Boolean(msg));
    field.setAttribute("aria-invalid", msg ? "true" : "false");
    field.setAttribute("aria-describedby", `${name}-error`);
    document.getElementById(`${name}-error`).textContent = msg;
  });
  const first = FIELDS.find((n) => errors[n]);
  if (first) document.getElementById(first).focus();
}

function renderResult(outcome, { preview = false } = {}) {
  const badge = document.getElementById("result-badge");
  badge.textContent = preview ? "Local preview — nothing was saved" : "Enquiry received";
  badge.classList.toggle("is-preview", preview);

  document.querySelector("#result-saved span").textContent = preview
    ? "Skipped in local preview. On the live site this is stored in Postgres."
    : `Stored in the database. Reference: ${String(outcome.id).slice(0, 8)}.`;

  const tags = document.getElementById("result-tags");
  tags.replaceChildren(...outcome.tags.map((t) => {
    const el = document.createElement("span");
    el.className = "tag";
    el.textContent = t;
    return el;
  }));

  document.getElementById("result-next").textContent = outcome.nextStep;
  document.getElementById("result-subject").textContent = `Subject: ${outcome.followUp.subject}`;
  document.getElementById("result-body").textContent = outcome.followUp.body;

  form.hidden = true;
  result.hidden = false;
  result.focus();
  result.scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "";

  const raw = Object.fromEntries(new FormData(form).entries());
  if (raw.website) return;                 // bot filled the hidden trap field: ignore silently

  const { data, errors } = validateLead(raw);
  showErrors(errors);
  if (errors) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";

  try {
    submissionId ??= newSubmissionId();
    const res = await fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // attribution is the first touch kept in this browser (or null, which is simply left out)
      body: JSON.stringify({ ...data, submissionId, attribution: getFirstTouch() ?? undefined, website: raw.website }),
    });

    // No backend when previewing with a simple local server: show the workflow without saving
    if (IS_LOCAL && [404, 405, 501].includes(res.status)) {
      renderResult(processLead(data), { preview: true });
      return;
    }

    const body = await res.json().catch(() => ({}));
    if (res.status === 422 && body.errors) {
      showErrors(body.errors);
      // An error that belongs to no visible field (for example a bad submission id) still needs a message
      if (!FIELDS.some((name) => body.errors[name])) statusEl.textContent = body.errors.submissionId || "Please check the form and try again.";
      return;
    }
    if (res.status === 429) { statusEl.textContent = body.error || "Too many enquiries. Please try again in a few minutes."; return; }
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    renderResult(body);
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "Sorry, something went wrong sending your enquiry. Please try again in a moment.";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Request a walkthrough";
  }
});

document.getElementById("reset-btn").addEventListener("click", () => {
  form.reset();
  submissionId = null;
  document.getElementById("service").value = "";
  showErrors({});
  result.hidden = true;
  form.hidden = false;
  document.getElementById("fullName").focus();
});
