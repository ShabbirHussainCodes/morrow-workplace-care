// An in-memory stand-in for lib/repo.js with the same behavior the SQL has: a unique
// submission id, fixed-window counters, a retention window on reads, and public reads that
// carry no personal data. Handler tests use it as their "injected fake database".
import { randomUUID } from "node:crypto";

export function fakeRepo({ now = () => Date.now() } = {}) {
  const state = { leads: [], counters: new Map(), calls: [], hitBuckets: [] };

  const outcomeOf = (lead) => ({
    id: lead.id, tags: lead.tags, priority: lead.priority, service: lead.service,
    nextStep: lead.nextStep, followUp: lead.followUp, status: lead.status,
  });

  const repo = {
    state,

    /** Put a lead straight into the store, for tests that need existing rows. */
    seedLead(overrides = {}) {
      const lead = {
        id: randomUUID(), submissionId: randomUUID(), createdAt: now(),
        name: "Seed Person", email: "seed@example.com", company: "Seed Co", message: "Seeded message text",
        spaceType: "office", timing: "asap", service: "Routine office care", priority: "High",
        tags: ["Office", "Routine office care", "Priority: High"], nextStep: "Reply soon",
        followUp: { subject: "Seed subject", body: "Seed body" }, status: "New",
        ...overrides,
      };
      state.leads.push(lead);
      return lead;
    },

    async hitRateLimit(bucket, windowSeconds) {
      state.calls.push("hitRateLimit");
      state.hitBuckets.push(bucket);
      const key = `${bucket}@${Math.floor(now() / 1000 / windowSeconds)}`;
      const count = (state.counters.get(key) ?? 0) + 1;
      state.counters.set(key, count);
      return count;
    },

    async insertLead({ submissionId, data, outcome }) {
      state.calls.push("insertLead");
      const existing = state.leads.find((l) => l.submissionId === submissionId);
      if (existing) return { created: false, outcome: outcomeOf(existing) };
      const lead = {
        id: randomUUID(), submissionId, createdAt: now(),
        name: data.fullName, email: data.email, company: data.company, message: data.message,
        spaceType: data.spaceType, timing: data.timing, service: outcome.service, priority: outcome.priority,
        tags: outcome.tags, nextStep: outcome.nextStep, followUp: outcome.followUp, status: outcome.status,
      };
      state.leads.push(lead);
      return { created: true, outcome: outcomeOf(lead) };
    },

    async listPublicLeads({ retentionDays, limit }) {
      state.calls.push("listPublicLeads");
      const oldest = now() - retentionDays * 86400 * 1000;
      return state.leads
        .filter((l) => l.createdAt > oldest)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
        .map((l) => ({
          id: l.id, createdAt: new Date(l.createdAt).toISOString(), priority: l.priority,
          service: l.service, spaceType: l.spaceType, timing: l.timing, status: l.status,
        }));
    },

    async listAdminLeads({ retentionDays, limit }) {
      state.calls.push("listAdminLeads");
      const oldest = now() - retentionDays * 86400 * 1000;
      return state.leads
        .filter((l) => l.createdAt > oldest)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
        .map((l) => ({ ...l, createdAt: new Date(l.createdAt).toISOString(), submissionId: undefined }));
    },

    async updateStage(publicId, status) {
      state.calls.push("updateStage");
      const lead = state.leads.find((l) => l.id === publicId);
      if (!lead) return null;
      lead.status = status;
      return { id: lead.id, status };
    },

    async deleteExpiredLeads(retentionDays) {
      state.calls.push("deleteExpiredLeads");
      const oldest = now() - retentionDays * 86400 * 1000;
      const before = state.leads.length;
      state.leads = state.leads.filter((l) => l.createdAt >= oldest);
      return before - state.leads.length;
    },

    async pruneRateLimits() {
      state.calls.push("pruneRateLimits");
      return 0;   // the fake keeps counters per window forever; tests do not need them pruned
    },
  };
  return repo;
}
