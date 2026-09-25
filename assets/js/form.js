// Enquiry form: validation, submission and the "behind the scenes" result view.
import { validateLead, processLead } from "./workflow.js";

const form = document.getElementById("lead-form");
const result = document.getElementById("lead-result");
const statusEl = document.getElementById("form-status");
const submitBtn = document.getElementById("submit-btn");
const FIELDS = ["fullName", "email", "company", "spaceType", "timing", "message"];
const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

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
    : `Stored in the database as lead #${outcome.id}.`;

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
    const res = await fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, website: raw.website }),
    });

    // No backend when previewing with a simple local server: show the workflow without saving
    if (IS_LOCAL && [404, 405, 501].includes(res.status)) {
      renderResult(processLead(data), { preview: true });
      return;
    }

    const body = await res.json().catch(() => ({}));
    if (res.status === 422 && body.errors) { showErrors(body.errors); return; }
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
  document.getElementById("service").value = "";
  showErrors({});
  result.hidden = true;
  form.hidden = false;
  document.getElementById("fullName").focus();
});
