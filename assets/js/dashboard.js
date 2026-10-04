// Demo lead dashboard. Two views of the same data:
//   - Public monitor: time, priority, service, space type, timing and stage. No personal details.
//   - Admin mode (after signing in): full details, drafted follow-ups and stage changes.
// The server decides which view a visitor gets and sends only that data. This script just draws
// what it receives, and shows every value with textContent, never innerHTML.
import { processLead, maskEmail, describeAttribution, SPACE_TYPES, TIMINGS, STAGES } from "./workflow.js";

const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const $ = (id) => document.getElementById(id);

const list = $("lead-list");
const notice = $("dash-notice");
const template = $("lead-template");
const statsEl = $("stats");
const filtersEl = $("filters");
const modeLabel = $("mode-label");
const modeLede = $("mode-lede");
const openBtn = $("admin-open-btn");
const signoutBtn = $("admin-signout-btn");
const loginForm = $("login-form");
const loginPassword = $("login-password");
const loginStatus = $("login-status");
const loginSubmit = $("login-submit");

const LEDE = {
  public: "Every enquiry from the website appears here with its priority and stage. Names, companies, emails and messages are only visible to the site owner.",
  detailed: "Every enquiry from the website lands here with tags, a priority and a drafted follow-up, so nothing sits unread in an inbox.",
};

let leads = [];
let filter = "all";
let admin = false;          // the server says this visitor is signed in as admin
let previewMode = false;    // no backend (local preview): labelled sample data in the admin layout

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Sample data used ONLY for local preview, when no backend is running. Clearly labelled on screen.
function sampleLeads() {
  const samples = [
    { fullName: "Sample Person", email: "sample@example.com", company: "Sample Studio (sample)", spaceType: "coworking", timing: "asap", message: "Our meeting rooms need resetting between bookings.", attribution: { utm_source: "sample-source", utm_medium: "sample-medium", utm_campaign: "sample-campaign", referrer: "https://sample.example/page", landing_page: "/" } },
    { fullName: "Demo Contact", email: "demo@example.com", company: "Demo Office (sample)", spaceType: "office", timing: "exploring", message: "Looking for a weekly clean for a small office.", attribution: { landing_page: "/" } },
  ];
  return samples.map((s, i) => {
    const o = processLead(s);
    return {
      id: String(i + 1), createdAt: new Date(Date.now() - (i + 1) * 3600e3).toISOString(),
      name: s.fullName, email: maskEmail(s.email), company: s.company,
      spaceType: SPACE_TYPES[s.spaceType], timing: TIMINGS[s.timing], message: s.message,
      service: o.service, priority: o.priority, tags: o.tags, nextStep: o.nextStep,
      followUp: o.followUp, status: i === 0 ? STAGES[0] : STAGES[1],
      attribution: s.attribution,
    };
  });
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

// Copy to clipboard, with a fallback for browsers that block the Clipboard API
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el("textarea", "copy-fallback");
    area.value = text;
    area.setAttribute("readonly", "");
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

function showNotice(text) {
  notice.textContent = text;
  notice.hidden = !text;
}

const detailedView = () => admin || previewMode;

function setMode() {
  modeLabel.textContent = previewMode ? "Local preview" : admin ? "Admin mode · demo" : "Public monitor · demo";
  modeLede.textContent = detailedView() ? LEDE.detailed : LEDE.public;
  openBtn.hidden = detailedView();          // nothing to sign in to in a local preview
  signoutBtn.hidden = !admin;
  if (detailedView()) hideLogin();
}

function statTile(label, value) {
  const tile = el("div", "stat");
  tile.append(el("span", "stat__label", label), el("span", "stat__value", String(value)));
  return tile;
}

function renderStats() {
  statsEl.replaceChildren(
    ...STAGES.map((stage) => statTile(stage, leads.filter((l) => l.status === stage).length)),
    statTile("High priority", leads.filter((l) => l.priority === "High").length),
  );
}

// The filter buttons are built once from STAGES; clicking only changes which one is active.
const filterButtons = [["all", "All"], ...STAGES.map((stage) => [stage, stage])].map(([value, text]) => {
  const btn = el("button", "filter", text);
  btn.type = "button";
  btn.setAttribute("role", "tab");
  btn.dataset.filter = value;
  btn.addEventListener("click", () => {
    filter = value;
    updateFilterButtons();
    renderList();
  });
  return btn;
});
function updateFilterButtons() {
  for (const btn of filterButtons) {
    const active = btn.dataset.filter === filter;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
  }
}
filtersEl.replaceChildren(...filterButtons);
updateFilterButtons();

function renderList() {
  const visible = filter === "all" ? leads : leads.filter((l) => l.status === filter);
  if (!visible.length) {
    if (leads.length) {
      list.replaceChildren(el("p", "dash__empty", "No leads in this stage."));
      return;
    }
    const message = el("p", "dash__empty");
    const link = el("a", "", "Send one from the homepage");
    link.href = "/#enquire";
    message.append("No test enquiries yet. ", link, " and it will appear here.");
    list.replaceChildren(message);
    return;
  }
  list.replaceChildren(...visible.map(renderLead));
}

function renderLead(lead) {
  const node = template.content.firstElementChild.cloneNode(true);
  const detailed = detailedView();
  node.querySelectorAll(detailed ? "[data-public]" : "[data-admin]").forEach((part) => part.remove());

  const pr = node.querySelector(".priority");
  pr.textContent = `${lead.priority} priority`;
  pr.dataset.level = lead.priority;

  if (!detailed) {
    // Public monitor: no name, company, email or message exists in the data we were sent
    node.querySelector(".lead__company").textContent = lead.service;
    node.querySelector(".lead__meta").textContent = `${timeAgo(lead.createdAt)} · ${lead.spaceType} · needs support: ${lead.timing.toLowerCase()}`;
    node.querySelector(".lead__stage-name").textContent = lead.status;
    return node;
  }

  node.querySelector(".lead__company").textContent = lead.company;
  node.querySelector(".lead__meta").textContent = `${lead.name} · ${lead.email} · ${timeAgo(lead.createdAt)} · needs support: ${lead.timing.toLowerCase()}`;
  node.querySelector(".lead__tags").replaceChildren(...lead.tags.filter((t) => !t.startsWith("Priority")).map((t) => el("span", "tag", t)));
  node.querySelector(".lead__message").textContent = `“${lead.message}”`;
  node.querySelector(".lead__next span").textContent = lead.nextStep;
  const source = describeAttribution(lead.attribution);
  node.querySelector(".lead__source-summary").textContent = source.summary;
  const sourceDetails = node.querySelector(".lead__source-details");
  if (source.details.length) sourceDetails.textContent = source.details.join(" · ");
  else sourceDetails.remove();
  node.querySelector(".draft__subject").textContent = `Subject: ${lead.followUp.subject}`;
  node.querySelector(".draft__body").textContent = lead.followUp.body;

  const copyBtn = node.querySelector("[data-copy]");
  const copied = node.querySelector(".draft__copied");
  copyBtn.addEventListener("click", async () => {
    const text = `Subject: ${lead.followUp.subject}\n\n${lead.followUp.body}`;
    const ok = await copyText(text);
    copied.textContent = ok ? "Copied — paste it into your email" : "Could not copy. Select the text and copy it manually.";
    if (ok) setTimeout(() => { copied.textContent = ""; }, 4000);
  });

  const select = node.querySelector("select");
  const saved = node.querySelector(".lead__saved");
  for (const stage of STAGES) {
    const option = el("option", "", stage);
    option.value = stage;
    select.append(option);
  }
  select.value = lead.status;
  select.addEventListener("change", async () => {
    const previous = lead.status;
    lead.status = select.value;
    renderStats();
    if (previewMode) { saved.textContent = "Preview only — not saved"; return; }
    saved.textContent = "Saving…";
    try {
      const res = await fetch(`/api/leads?id=${encodeURIComponent(lead.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: lead.status }),
      });
      await res.text();               // read the body so the connection is released
      if (res.status === 401) {
        // The admin session ended (it lasts 8 hours). Fall back to the public view.
        await load();
        showNotice("Your admin session has ended. Sign in again to change a stage.");
        return;
      }
      if (!res.ok) throw new Error(`Status ${res.status}`);
      saved.textContent = "Saved";
      if (filter !== "all") renderList();
    } catch (err) {
      console.error(err);
      lead.status = previous;
      select.value = previous;
      renderStats();
      saved.textContent = "Could not save — try again";
    }
  });
  return node;
}

async function load() {
  list.replaceChildren(el("p", "dash__loading", "Loading leads…"));
  try {
    const res = await fetch("/api/leads", { cache: "no-store" });
    if (IS_LOCAL && [404, 405, 501].includes(res.status)) {
      previewMode = true;
      admin = false;
      leads = sampleLeads();
      showNotice("Local preview: showing labelled sample leads because no backend is running. Nothing here is saved.");
    } else {
      if (res.status === 429) {
        list.replaceChildren(el("p", "dash__empty", "Too many refreshes. Please wait a moment and try again."));
        return;
      }
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      previewMode = false;
      admin = Boolean(data.admin);
      leads = data.leads;
      showNotice("");
    }
    setMode();
    renderStats();
    renderList();
  } catch (err) {
    console.error(err);
    list.replaceChildren(el("p", "dash__empty", "Could not load leads right now. Please refresh in a moment."));
  }
}

// ---- admin sign-in and sign-out ----------------------------------------------------------------

function hideLogin() {
  loginForm.hidden = true;
  openBtn.setAttribute("aria-expanded", "false");
  loginStatus.textContent = "";
}

openBtn.addEventListener("click", () => {
  const opening = loginForm.hidden;
  loginForm.hidden = !opening;
  openBtn.setAttribute("aria-expanded", String(opening));
  if (opening) loginPassword.focus();
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = loginPassword.value;
  if (!password) {
    loginStatus.textContent = "Please enter the admin password.";
    loginPassword.focus();
    return;
  }
  loginSubmit.disabled = true;
  loginStatus.textContent = "";
  try {
    const res = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    await res.text();                 // read the body so the connection is released
    if (res.ok) {
      hideLogin();
      await load();
      return;
    }
    loginStatus.textContent =
      res.status === 401 ? "That password is not correct." :
      res.status === 429 ? "Too many attempts. Please wait a few minutes and try again." :
      "Sign-in is not available right now.";
  } catch (err) {
    console.error(err);
    loginStatus.textContent = "Sign-in is not available right now.";
  } finally {
    loginPassword.value = "";        // never keep the password in the page longer than needed
    loginSubmit.disabled = false;
  }
});

signoutBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/admin/session", { method: "DELETE" });
    await res.text();                 // read the body so the connection is released
  } catch (err) {
    console.error(err);
  }
  await load();
});

$("refresh-btn").addEventListener("click", load);

load();
