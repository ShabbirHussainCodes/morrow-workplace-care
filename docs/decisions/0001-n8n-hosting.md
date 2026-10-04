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
