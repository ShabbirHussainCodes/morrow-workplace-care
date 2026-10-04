# Morrow v2 — Plan

Approved by Shabbir on 4 Oct 2026. Decisions are in `docs/decisions/`. Rules for Claude Code are in `CLAUDE.md`.

**Goal:** make Morrow strong proof-of-execution work for RevOps and marketing consultants, easy to show in a 2–3 minute walkthrough. Quality and Shabbir's learning matter more than speed. Nothing fake, nothing superficial.

**Estimate:** 90–130 hours. P3 (n8n learning) runs in parallel with P1 and P2.

## Current phase

**P0 / P1.** Update this line when a phase is finished.

## Target architecture

```
Browser ── form + first-touch UTM/referrer/landing page + submission_id (UUID)
   │ POST /api/lead
Vercel API ── validate → one transaction: leads + lead_events (pending) → 201
   │ waitUntil: signed POST (HMAC over timestamp.rawBody)
n8n WF1 Intake ── verify signature and replay window → SW1 Lead Sync
   SW1: upsert contact (email) → upsert deal (morrow_lead_id) → associate
        → note → owner alert → sandbox auto-reply
   │ signed callback after every step (step name, result, HubSpot IDs)
Vercel API ── verify → update lead_events, lead_activity, HubSpot IDs
```

Supporting workflows in n8n: WF3 Sweeper (pulls pending, failed and stuck events from the app; heartbeat), WF4 Speed-to-lead reminder, WF5 HubSpot retention, WF6 Error workflow.
In Vercel: a daily cron for database retention.

Principles:
- A lead is never lost. Delivery is at-least-once and every step is safe to repeat.
- n8n never has database credentials. The app never has a HubSpot token.
- Each direction has its own signing secret.
- The public dashboard shows no personal data.
- In demo mode, lead-facing email goes to the sandbox inbox.

## Data model (target)

- `leads`: existing columns, plus `public_id` (UUID), `submission_id` (UUID, unique), `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `referrer`, `landing_page`, `crm_contact_id`, `crm_deal_id`, `sync_status`, `synced_at`.
- `lead_events` (outbox): `id` (UUID), `lead_id`, `type`, `status` (`pending`, `dispatched`, `synced`, `failed`, `dead`), `attempts`, `next_attempt_at`, `last_error`, `completed_steps` (JSONB), timestamps.
- `lead_activity` (timeline): `lead_id`, `event_id`, `step`, `result`, `detail`, `created_at`.
- `schema_migrations`: applied migration files.

Column names and types are settled in the P1 and P4 plans.

## HubSpot property budget (Free: 10 custom properties in total)

- Contact (3): UTM source, UTM medium, UTM campaign.
- Deal (5): `morrow_lead_id` (unique), priority, service, space type, timing.
- Two spare. Everything else goes into a deal note.
- Check in P5 whether a standard deal priority property can replace the custom one.

## Environment variables

Vercel: `DATABASE_URL`, `IP_SALT`, `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, `CRON_SECRET`, `N8N_INTAKE_URL` (optional until P9), `APP_TO_N8N_SECRET`, `N8N_TO_APP_SECRET`, `DEMO_MODE`.
n8n credentials: HubSpot Service Key, Resend API key, the two signing secrets, the sandbox inbox address.
Final names are fixed in the phase that introduces them and added to `.env.example` with placeholders only.

## Known issues to fix in P1

1. `PATCH /api/leads` has no authentication.
2. `IP_SALT` falls back to `"morrow"` instead of failing closed.
3. Retention DELETE runs inside user requests.
4. No idempotency; a repeated submit creates two leads.
5. No security headers; no `vercel.json`.
6. One `schema.sql`; no migrations.
7. Tests cover only pure functions; no handler tests; no CI.
8. Future email abuse risk (handled by ADR 0004).
9. Malformed JSON crashes `api/lead.js` (`req.body` is read outside the `try`).
10. The public dashboard exposes names, companies and messages.
11. Control characters are not stripped from user fields.
12. Sequential lead IDs are exposed and used by PATCH.
13. The rate limit is not atomic; `GET /api/leads` has none.
14. Stage names and retention days are defined in several places.
15. Fonts load from an external host; no favicon.

## Phases

Every phase ends with: tests green, a short note of what could not be verified, and a commit message for Shabbir.

### P0 — Accounts and local setup (Shabbir)
- Scope: Resend account; local n8n in Docker; a Neon `dev` branch; local `.env`.
- Done when: all three work and no secret is in the repo or in chat.

### P1 — Harden the foundation (Claude Code)
- Scope: migration runner and `db/migrations/`; `lib/` refactor with thin handlers; env validation that fails closed; fixes for issues 1–7 and 9–15; admin login and session; `vercel.json` headers and CSP; self-hosted fonts and a favicon; daily retention cron; the Vercel firewall rate-limit rule (Shabbir sets it in the dashboard); handler tests; GitHub Actions CI.
- Tests: each fixed issue has a test that failed before and passes after. Handlers are tested with an injected fake database. Malformed JSON → 400. Missing env → 500 without leaking values. PATCH without a session → 401. Same `submission_id` twice → one lead.
- Done when: CI is green on `main`, the live site still works end to end, and the public API returns no personal data.

### P2 — Attribution (Claude Code)
- Scope: capture first-touch UTM values, referrer and landing page in the browser; validate, limit and store them.
- Tests: missing, oversized, malformed and script-like UTM values; first touch is kept across page views.
- Done when: a tagged URL produces a lead with the right attribution, visible in admin mode.

### P3 — n8n foundations (Shabbir; no Morrow changes)
- Scope: learning levels L0–L8 below, on local Docker.
- Done when: for each level Shabbir has built it, explained it back, broken it on purpose and fixed it.

### P4 — Outbox and signed APIs (Claude Code)
- Scope: `lead_events` and `lead_activity`; transactional write; `waitUntil` dispatch; signing and verification helpers; callback endpoint; pending-events endpoint for the sweeper; status endpoint for the form's live steps.
- Tests: valid signature accepted; wrong, missing, stale and replayed signatures → 401; constant-time compare; event state transitions; a dispatch failure leaves the event `pending`.
- Done when: with n8n switched off, a lead is stored with a `pending` event and nothing is lost.

### P5 — HubSpot by hand (Shabbir, guided)
- Scope: create the Service Key with least-privilege scopes; create the 8 properties; run each API call once with `curl` (contact upsert, deal upsert, association, note, delete). Decide whether to rename the default pipeline stages.
- Done when: `docs/hubspot.md` records every call with its real request and response (no secrets), and the open questions are answered: the email-upsert caveat, permanent delete, and standard priority property.

### P6 — Lead Sync workflow (Shabbir builds; Claude Code supports the app side)
- Scope: WF1 Intake and SW1 Lead Sync with step checkpoints; then the repeat-enquiry branch from ADR 0005.
- Done when: a submitted lead appears in HubSpot as one contact and one deal with a note, the app shows HubSpot IDs and a timeline, and the double-submit and same-email drills pass.

### P7 — Follow-up, notifications, SLA
- Scope: owner alert; sandbox auto-reply with an idempotency key; WF4 speed-to-lead reminder.
- Done when: an email failure is recorded as a failed step while the CRM sync stays recorded as done.

### P8 — Reliability
- Scope: WF6 Error workflow; WF3 Sweeper with backoff and heartbeat; dead-letter after N attempts; admin retry; WF5 HubSpot retention.
- Done when: every failure drill below passes and is written up in `docs/drills.md` with what was done and what was observed.

### P9 — Deploy n8n
- Postponed until a VPS is bought (see ADR 0001 update). P0–P8 run fully on local Docker. P10–P12 can proceed before P9; the live site then shows "automation not connected yet" honestly.
- Scope: VPS, Docker, Caddy, HTTPS, domain; encryption key and data backups; exported workflows in `n8n/` with no secrets.
- Done when: a restore from backup works on a clean machine and the live site syncs through the deployed n8n.

### P10 — UI polish
- Scope: live step status on the form result; public monitor; admin mode; `/build/` page that explains the system to non-developers; accessibility and performance pass.
- Done when: the whole walkthrough works with keyboard only, and the pages state plainly what is real and what is sandboxed.

### P11 — End-to-end tests and docs
- Scope: Playwright tests; README, architecture, runbook.
- Done when: someone new can run the project from the README alone.

### P12 — Proof packaging
- Scope: a 2–3 minute Loom walkthrough; a one-page summary for partners, with FlyRank and BillingMars as supporting proof.
- Done when: both are published and contain no invented clients, results or numbers.

## n8n learning path (P3)

For each level: explain → Shabbir builds it in the editor → explains it back → breaks it on purpose → debugs it.

- L0 Core model: items, expressions, executions, pinned data.
- L1 Webhooks: test and production URLs, publishing.
- L2 Auth: Header Auth, then HMAC with the Crypto node; hit the re-serialized-JSON problem on purpose.
- L3 APIs: HTTP Request with a credential, errors, Retry On Fail, 429.
- L4 Branching and sub-workflows; idempotent create.
- L5 Messaging and sandbox routing.
- L6 Error handling: On Error modes, Stop and Error, Error Trigger.
- L7 Scheduling: sweeper and SLA.
- L8 Operations: self-hosting, encryption key, backups, export and versioning.

## Required failure drills (P8)

1. n8n offline, then recovery.
2. Invalid HubSpot key → failed + alert → fix → retry.
3. Double submit.
4. Same email twice.
5. Bad or stale signature → 401.
6. HubSpot 429.
7. Email step fails while the CRM sync stays recorded.
8. Honeypot, rate limit, bad UTM, oversized input, missing env var.
9. Retention when one contact is shared by several leads.

## Facts to re-verify before use

Platform details change. Check official docs again in the phase that uses them: HubSpot API version and scopes (P5), n8n env vars and node options (P3, P9), Vercel limits (P1, P4), Resend limits (P7).
