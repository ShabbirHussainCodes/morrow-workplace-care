# ADR 0005 — Double submits and repeat enquiries

Status: Accepted (4 Oct 2026)

## Decision
1. **Double submit** (same `submission_id`): the app returns the existing lead. One lead, one event.
2. **Same email, new enquiry**: one HubSpot contact (upsert by email). If that contact has an open deal, add a note to it. Otherwise create a new deal.

## Why
This is how a real sales team wants it: no duplicate contacts and no second deal for the same live conversation.

## Details
- `submission_id` is a UUID created in the browser, with a unique constraint in the database.
- Find the open deal through the contact's deal associations, not through search (search lags).
- Build this in two passes in P6: first the simple path, then the repeat-enquiry branch.
