# ADR 0003 — HubSpot calls live in n8n

Status: Accepted (4 Oct 2026)

## Decision
All HubSpot writes happen in n8n using HTTP Request nodes with the "HubSpot Service Key" credential. The Vercel app never holds a HubSpot token.

## Why
- The project is proof of n8n + CRM execution for RevOps consultants. Raw HTTP calls teach and show the real API.
- Legacy private apps cannot be created on this account (created after 28 Sep 2026). Service Keys are the replacement and send `Authorization: Bearer`.
- Least privilege: one key, only the scopes the workflows use.

## Details (verified 4 Oct 2026; re-verify in P5)
- Dated API paths, current version `2026-09`.
- Contacts: batch upsert with `idProperty=email`. The docs note that partial upserts are not supported with email as the id property. Test what this means in P5.
- Deals: batch upsert with a unique custom property `morrow_lead_id`. This replaces search-then-create, because search results lag.
- Limits: 100 requests per 10 s; search 5 requests per second. HTTP Request has no automatic 429 handling.
- Free account: 10 custom properties in total, one pipeline, 1,000 contacts.

## Trade-off
n8n workflows cannot be unit-tested like code. We use pinned-data test runs, exported workflow JSON in the repo, and end-to-end tests against the demo HubSpot account.
