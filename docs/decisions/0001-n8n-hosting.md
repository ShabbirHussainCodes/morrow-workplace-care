# ADR 0001 — n8n hosting

Status: Accepted (4 Oct 2026)

## Decision
Learn and build on local Docker (P3–P8). Go live on a small paid VPS with Docker and Caddy (P9).

## Why
- n8n has no free Cloud plan. The Community Edition is free to self-host and includes Error Trigger and sub-workflows.
- Oracle Always Free was considered and rejected as the primary host: idle instances can be reclaimed (CPU, network and memory under 20% for 7 days) and capacity errors are documented. A quiet n8n box matches that profile.
- The demo must be online when a consultant opens it.

## Consequences
- A small monthly cost. Pick the provider and plan at P9 and verify current prices then.
- Because of the outbox and the pulling sweeper (ADR 0008), no lead is lost while n8n is offline.
- Back up `N8N_ENCRYPTION_KEY` and the n8n data volume. Use `N8N_WEBHOOK_URL` (not the deprecated `WEBHOOK_URL`) and `N8N_PROXY_HOPS=1` behind Caddy.

## Verify at P9
Current n8n version, env var names, RAM guidance, and VPS pricing.

## Update (4 Oct 2026): VPS purchase postponed
The VPS will be chosen and bought later. This does not block P0–P8.
- All n8n work runs on local Docker. The app runs locally (`vercel dev`) against the Neon dev branch and the local n8n.
- The n8n intake URL is an optional setting. When it is not set, the live site still stores every lead with a `pending` event and does not try to dispatch.
- Until n8n is deployed, the live site must say plainly that the automation is not connected yet. It must never show a fake "synced" state.
- Pending events older than 7 days are removed by the normal retention job.
- For a recorded walkthrough before P9, a temporary tunnel from the local n8n is acceptable. It is not a hosting solution.
- P9 only needs configuration (URL, secrets, DNS). No code change should be required to connect the VPS.
