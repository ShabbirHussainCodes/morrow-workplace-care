# ADR 0002 — Personal domain

Status: Accepted (4 Oct 2026)

## Decision
Buy one personal domain at P9, not earlier.

## Why
- n8n needs HTTPS on a stable hostname. The future portfolio site and a sending domain need it too.
- Nothing before P9 needs it: Resend sandbox works without a verified domain, and P3–P8 run locally.

## Consequences
- `n8n.<domain>` for automation. Morrow may move to a subdomain later; that is a separate decision.
- Vercel Hobby is for non-commercial use. Re-check the fair-use terms before hosting a portfolio that advertises paid services there.
