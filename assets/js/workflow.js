// Lead workflow rules — shared by the browser (local preview) and the API.
// Plain, explainable rules: every tag and next step can be traced to a form answer.

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Validate and normalise raw form input. Returns { data } or { errors }. */
export function validateLead(input = {}) {
  const clean = (v, max) => String(v ?? "").trim().slice(0, max);
  const data = {
    fullName: clean(input.fullName, 120),
    email: clean(input.email, 200).toLowerCase(),
    company: clean(input.company, 160),
    spaceType: clean(input.spaceType, 40),
    timing: clean(input.timing, 40),
    message: clean(input.message, 2000),
    service: clean(input.service, 40),
  };
  const errors = {};
  if (data.fullName.length < 2) errors.fullName = "Please enter your full name.";
  if (!EMAIL_RE.test(data.email)) errors.email = "Please enter a valid work email.";
  if (data.company.length < 2) errors.company = "Please enter your company name.";
  if (!SPACE_TYPES[data.spaceType]) errors.spaceType = "Please choose a type of space.";
  if (!TIMINGS[data.timing]) errors.timing = "Please choose when you need support.";
  if (data.message.length < 10) errors.message = "Please add a short message (10+ characters).";
  if (data.service && !SERVICES[data.service]) data.service = "";
  return Object.keys(errors).length ? { errors } : { data };
}

/** Infer which service the enquiry is about: clicked card first, then message keywords. */
function inferService(data) {
  if (data.service) return SERVICES[data.service];
  const m = data.message.toLowerCase();
  if (/(move|refurb|renovat|deep clean|one[- ]off|handover|reset)/.test(m)) return SERVICES.reset;
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
    status: "New",
  };
}

/** Mask an email for public display: jane.doe@acme.com → j•••@acme.com */
export function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  if (!domain) return "•••";
  return `${user.slice(0, 1)}•••@${domain}`;
}
