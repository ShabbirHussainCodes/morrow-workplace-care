# ADR 0009 — Retention as two independent jobs

Status: Accepted (4 Oct 2026)

## Decision
- **Database:** a daily Vercel cron (authenticated with `CRON_SECRET`) deletes leads, events and activity older than 7 days. The DELETE no longer runs inside user requests.
- **HubSpot:** a daily n8n workflow deletes deals that carry `morrow_lead_id` and are older than 7 days, then contacts with no deals left.

## Why
Each store cleans itself from its own data, so one job failing cannot block the other. A contact shared by several leads is only removed when its last deal is gone.

## Open point (test in P5)
A normal HubSpot delete is an archive and can be restored. The permanent delete endpoint is documented only under `/crm/v3/`. Test it, then word the public retention promise to match what really happens.
