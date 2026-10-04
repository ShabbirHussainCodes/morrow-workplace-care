# ADR 0008 — Outbox, signed webhooks and step checkpoints

Status: Accepted (4 Oct 2026)

## Decision
- The API writes the lead and an outbox event in one transaction, answers 201, then dispatches to n8n with `waitUntil`.
- App → n8n and n8n → app requests are signed with HMAC-SHA256 over `timestamp.rawBody`, with a short replay window. Each direction has its own secret.
- n8n reports every finished step (with HubSpot IDs) to the app. A retry carries the completed steps so n8n skips them.
- The n8n sweeper pulls pending, failed and stuck events from a signed app endpoint every few minutes and re-runs them with backoff.

## Event states
`pending → dispatched → synced`, or `failed` (retried with backoff) `→ dead` after N attempts (alert; admin retry). A `dispatched` event with no callback after 15 minutes is treated as stuck and retried.

## Why
- A lead must never be lost because n8n or HubSpot is down.
- Delivery is at-least-once, so every step must be safe to repeat.
- n8n never holds database credentials.

## Details to verify when building
- n8n Webhook "Raw Body" puts the exact bytes in a binary property. Sign and verify those bytes, never re-serialized JSON.
- n8n's Crypto node has no constant-time compare. The Code node needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto` to use `crypto.timingSafeEqual`.
- Retry On Fail is capped (5 tries, 5 s). Real backoff comes from the sweeper.
