# CLAUDE.md — Morrow Workplace Care

Read this file, then `docs/PLAN.md`, then the ADRs in `docs/decisions/` before doing anything.
These files are the source of truth. If a prompt conflicts with them, stop and ask.

## What this project is

A portfolio CONCEPT site for a fictional commercial cleaning company, built by Shabbir Hussain.
It is being extended into proof-of-execution work for RevOps and marketing consultants:
landing page → lead capture → reliable storage → HubSpot contact + deal → UTM attribution →
follow-up and notification automation in n8n → proper failure handling.

- Live: https://morrow-workplace-care.vercel.app (dashboard at `/demo/`)
- Repo: github.com/ShabbirHussainCodes/morrow-workplace-care (public)

## Stack

- Plain HTML, CSS and JavaScript (ES modules). No framework and no build step. Keep it that way.
- Vercel serverless functions in `api/` (Node 24, `"type": "module"`).
- Neon Postgres through `@neondatabase/serverless` (`neon()` tagged templates; `sql.transaction([...])` for multi-statement writes).
- Tests: `node --test`. Run with `npm test`.
- Outside this repo: n8n (self-hosted), HubSpot Free CRM (demo account), Resend (sandbox).
- Add a dependency only when the plan names it or Shabbir approves it.

## Roles

- **Shabbir** approves plans, builds the n8n workflows himself, and runs every git command.
- **Cowork (planning session)** owns architecture, decisions, docs and review.
- **Claude Code (you)** writes code and tests, runs local servers and Docker, applies review fixes.

## Hard rules

1. **Never run `git commit`, `git push`, `git merge`, `git rebase`, `git reset` or any command that changes history or the remote.** Read-only git is fine. When work is ready, print the exact commit message and stop. Shabbir commits.
2. **Use plan mode.** Show the plan and wait for approval before editing any file.
3. **Stay inside the current phase** in `docs/PLAN.md`. Do not start the next phase or add unplanned features.
4. **Architecture changes need an ADR and Shabbir's approval first.** Never silently change a decision in `docs/decisions/`.
5. **No fabricated anything.** No fake clients, reviews, logos, metrics, testimonials or sample data presented as real. No feature that only looks like it works. If something is not built, the UI must not claim it.
6. **Concept labelling stays.** The concept strip, the footer disclosure and the "use test details" note must remain on every page. New pages get the same labelling.
7. **Verify before you rely.** Check current official docs before using any API path, option, env var or node setting. Never invent a function, endpoint or config key. If you could not verify something, say so plainly.
8. **Done means tested.** Every change ships with tests. Run `npm test` and report the real result. Never mark work done with failing or skipped tests.

## Security rules

- Never print, log, paste or commit a secret. Never ask Shabbir to paste one into chat. Secrets live only in Vercel env vars, n8n credentials and a local `.env` (git-ignored).
- `.env.example` lists every variable with a placeholder value only.
- Required env vars are validated at startup of each function and **fail closed**: a missing or weak value returns 500 and logs the variable name (never the value). No fallback defaults for secrets.
- All SQL is parameterized. No string-built queries.
- All user text is rendered with `textContent`, never `innerHTML`.
- Strip control characters from every user field. Enforce length limits on the server.
- State-changing endpoints require the admin session or a valid signature. Compare signatures in constant time.
- n8n never gets database credentials. It talks to the app only through signed internal endpoints.
- Exported n8n workflow JSON must contain no secrets. Check every export before it is committed.
- Demo mode: any email addressed to a lead goes to the sandbox inbox, never to the address typed in the form.
- The public dashboard shows no personal data (no names, companies, emails or messages).
- Preview deployments use the Neon dev branch and must never call production HubSpot or n8n.
- Do not log personal data. Log lead IDs and event IDs.

## Conventions

- Shared validation and rules live in `assets/js/workflow.js` and are imported by both browser and API. Keep one definition of each constant (stages, retention days, limits).
- Server-only code goes in `lib/`. Handlers in `api/` stay thin.
- Database changes are numbered SQL files in `db/migrations/`. Never edit an applied migration.
- Clear, plain English in UI copy, comments and docs. Comments explain why, not what.
- Commit messages follow the existing style: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.

## When you finish a task

Report: what changed, the test result, anything you could not verify, and the exact commit message. Then stop.
