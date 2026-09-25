// Demo lead dashboard: loads leads from /api/leads and lets the team move them through stages.
import { processLead, maskEmail, SPACE_TYPES, TIMINGS } from "./workflow.js";

const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const list = document.getElementById("lead-list");
const notice = document.getElementById("dash-notice");
const template = document.getElementById("lead-template");
let leads = [];
let filter = "all";
let previewMode = false;

// Sample data used ONLY for local preview, when no backend is running. Clearly labelled on screen.
function sampleLeads() {
  const samples = [
    { fullName: "Sample Person", email: "sample@example.com", company: "Sample Studio (sample)", spaceType: "coworking", timing: "asap", message: "Our meeting rooms need resetting between bookings." },
    { fullName: "Demo Contact", email: "demo@example.com", company: "Demo Office (sample)", spaceType: "office", timing: "exploring", message: "Looking for a weekly clean for a small office." },
  ];
  return samples.map((s, i) => {
    const o = processLead(s);
    return {
      id: i + 1, createdAt: new Date(Date.now() - (i + 1) * 3600e3).toISOString(),
      name: s.fullName, email: maskEmail(s.email), company: s.company,
      spaceType: SPACE_TYPES[s.spaceType], timing: TIMINGS[s.timing], message: s.message,
      service: o.service, priority: o.priority, tags: o.tags, nextStep: o.nextStep,
      followUp: o.followUp, status: i === 0 ? "New" : "Walkthrough booked",
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

function showNotice(text) {
  notice.textContent = text;
  notice.hidden = !text;
}

function renderStats() {
  const count = (fn) => leads.filter(fn).length;
  document.querySelectorAll("[data-stat]").forEach((el) => {
    const key = el.dataset.stat;
    el.textContent = key === "High" ? count((l) => l.priority === "High") : count((l) => l.status === key);
  });
}

function renderList() {
  const visible = filter === "all" ? leads : leads.filter((l) => l.status === filter);
  if (!visible.length) {
    list.innerHTML = leads.length
      ? `<p class="dash__empty">No leads in this stage.</p>`
      : `<p class="dash__empty">No test enquiries yet. <a href="/#enquire">Send one from the homepage</a> and it will appear here.</p>`;
    return;
  }
  list.replaceChildren(...visible.map(renderLead));
}

function renderLead(lead) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.querySelector(".lead__company").textContent = lead.company;
  node.querySelector(".lead__meta").textContent = `${lead.name} · ${lead.email} · ${timeAgo(lead.createdAt)} · needs support: ${lead.timing.toLowerCase()}`;

  const pr = node.querySelector(".priority");
  pr.textContent = `${lead.priority} priority`;
  pr.dataset.level = lead.priority;

  node.querySelector(".lead__tags").replaceChildren(...lead.tags.filter((t) => !t.startsWith("Priority")).map((t) => {
    const el = document.createElement("span");
    el.className = "tag";
    el.textContent = t;
    return el;
  }));
  node.querySelector(".lead__message").textContent = `“${lead.message}”`;
  node.querySelector(".lead__next span").textContent = lead.nextStep;
  node.querySelector(".draft__subject").textContent = `Subject: ${lead.followUp.subject}`;
  node.querySelector(".draft__body").textContent = lead.followUp.body;

  const select = node.querySelector("select");
  const saved = node.querySelector(".lead__saved");
  select.value = lead.status;
  select.addEventListener("change", async () => {
    const previous = lead.status;
    lead.status = select.value;
    renderStats();
    if (previewMode) { saved.textContent = "Preview only — not saved"; return; }
    saved.textContent = "Saving…";
    try {
      const res = await fetch(`/api/leads?id=${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: lead.status }),
      });
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
  list.innerHTML = `<p class="dash__loading">Loading leads…</p>`;
  try {
    const res = await fetch("/api/leads", { cache: "no-store" });
    if (IS_LOCAL && [404, 405, 501].includes(res.status)) {
      previewMode = true;
      leads = sampleLeads();
      showNotice("Local preview: showing labelled sample leads because no backend is running. Nothing here is saved.");
    } else {
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      leads = data.leads;
      showNotice("");
    }
    renderStats();
    renderList();
  } catch (err) {
    console.error(err);
    list.innerHTML = `<p class="dash__empty">Could not load leads right now. Please refresh in a moment.</p>`;
  }
}

document.querySelectorAll(".filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    filter = btn.dataset.filter;
    document.querySelectorAll(".filter").forEach((b) => {
      const active = b === btn;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    renderList();
  });
});
document.getElementById("refresh-btn").addEventListener("click", load);

load();
