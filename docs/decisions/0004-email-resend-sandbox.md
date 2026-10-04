# ADR 0004 — Email through Resend, sandboxed in demo mode

Status: Accepted (4 Oct 2026)

## Decision
n8n sends email through the Resend HTTP API. In demo mode every lead-facing email is routed to Shabbir's sandbox inbox, never to the address typed in the form.

## Why
A public form that emails whatever address a visitor types can be used to spam strangers. Resend's test sender only delivers to the account owner's address, which enforces the sandbox at the provider level too.

## Details
- Send with an `Idempotency-Key` built from the event ID and step name, so a retry cannot send twice.
- The UI must say plainly that emails go to a sandbox inbox in this demo.
- Strip control characters from all fields used in subjects and headers.
