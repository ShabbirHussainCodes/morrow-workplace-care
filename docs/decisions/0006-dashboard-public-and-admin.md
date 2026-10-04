# ADR 0006 — Public monitor and admin mode

Status: Accepted (4 Oct 2026)

## Decision
The dashboard has two modes.
- **Public monitor** (read-only): time, priority, service, sync status, activity timeline, counts, "automation online" heartbeat. No names, companies, emails or messages.
- **Admin mode** (login): full lead details, stage changes, retry of failed events.

## Why
Today anything a visitor types is public apart from the email. With a real CRM behind it, that is not acceptable.

## Details
- Admin session: signed cookie, `HttpOnly`, `Secure`, `SameSite=Strict`, with an expiry. Origin check on state-changing requests. Rate-limited login.
- Public IDs are UUIDs, not sequential integers.
- Syncing stage changes from the app to HubSpot is optional and comes later.
