# Morrow Workplace Care — Concept Website

**Live demo:** https://morrow-workplace-care.vercel.app · **Lead dashboard:** https://morrow-workplace-care.vercel.app/demo/

> **Portfolio concept.** Morrow Workplace Care is a fictional company. This site was designed and built by **Shabbir Hussain** to demonstrate a conversion-focused service-business website with a working lead-capture and follow-up workflow. It is not a real cleaning company, and no real customer data should be submitted.

## What this project demonstrates

1. **A clear service offer** — a B2B homepage that explains what the business does and who it is for.
2. **A strong call to action** — every section leads to one action: request a walkthrough.
3. **Lead capture** — an enquiry form with validation, spam protection and safe handling of repeated submits.
4. **A follow-up workflow** — each enquiry is saved, tagged by space type and urgency, and given an auto-drafted follow-up message. A public monitor shows the pipeline without personal details; the site owner signs in to see full details and move leads through stages.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Plain HTML, CSS, JavaScript (ES modules), no build step | Fast on mobile, easy to read |
| API | Vercel Serverless Functions in `api/` (4 functions), logic in `lib/` | Handlers stay thin and are tested without a database |
| Database | Neon Postgres, numbered SQL migrations in `db/migrations/` | Real SQL, history that cannot be silently rewritten |
| Hosting | Vercel | Deploys from GitHub |
| Checks | `node --test` locally and in GitHub Actions (Node 24) | Every pull request is tested |

## Project structure

```
.
├── index.html            # Homepage and enquiry form
├── demo/                 # Lead dashboard (public monitor + admin mode)
├── favicon.svg
├── api/                  # Serverless functions: lead, leads, admin/session, cron/retention
├── lib/                  # Server-only code: env checks, routes, SQL, sessions, rate limits
│   └── routes/           # One file per endpoint
├── db/migrations/        # Numbered SQL files (0001_baseline.sql, ...)
├── scripts/              # migrate.js, hash-password.js
├── tests/                # node --test
├── vercel.json           # Security headers, CSP and the daily cron
└── assets/
    ├── css/              # Styles and design tokens
    ├── js/               # Form, dashboard and the rules shared with the API (workflow.js)
    ├── fonts/            # Self-hosted Inter and Fraunces, with licences
    └── images/           # Workspace imagery
```

Validation, stages, input limits and the retention period are defined once, in `assets/js/workflow.js`, and used by both the browser and the API.

## Running it locally

```bash
npm ci
cp .env.example .env     # then fill in real values; .env is git-ignored
npm test
```

Every variable in `.env.example` is required. A function refuses to run (it answers 500 and logs the variable **name**, never the value) when one is missing, still a placeholder, or too weak.

| Variable | What it is | How to make it |
|---|---|---|
| `DATABASE_URL` | Neon connection string. Use the Neon **dev** branch locally and for Preview deployments. | Neon console |
| `IP_SALT` | Secret salt for hashing IP addresses (rate limiting). Raw IPs are never stored. | random, at least 16 characters |
| `SESSION_SECRET` | Signs the admin cookie. Changing it signs every admin out. | random, at least 32 characters |
| `CRON_SECRET` | Lets only Vercel's scheduler run the daily clean-up. | random, at least 32 characters |
| `ADMIN_PASSWORD_HASH` | scrypt hash of the admin password. | `npm run hash-password` |

Make a random value without it appearing anywhere else:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Never paste a secret into chat, an issue or a pull request. For `ADMIN_PASSWORD_HASH`, run `npm run hash-password`, type the password when asked (it is not shown), and copy the printed hash.

To run the functions locally use the Vercel CLI (`vercel dev`) with the variables above available to it; check the Vercel CLI documentation for how it loads them. Opening the HTML with a plain static server works too: the form and dashboard then show a clearly labelled local preview and save nothing.

## Database migrations

Changes to the database are numbered files in `db/migrations/`. **Never edit a migration that has been applied;** add a new numbered file instead. The runner records a checksum of each applied file and refuses to continue if one was changed or removed.

```bash
npm run migrate              # dry run: prints the target host and database, changes nothing
npm run migrate -- --apply   # applies pending migrations, one transaction per file
```

Put the Neon **dev** branch in `.env` first, read the host and database name the dry run prints, and only then use `--apply`. For production, run the same commands with the production connection string set for that one command, before deploying code that needs the change. The current migrations only add things, so the previous version of the code keeps working while they are applied.

`0001_baseline.sql` is the original table and does nothing on a database that already has it; it only records itself.

## Admin mode

The dashboard at `/demo/` opens as a **public monitor**: time, priority, service, space type, timing and stage. It never receives a name, company, email, message or drafted follow-up. The site owner can choose **Admin sign in** and enter the password to see full details, copy drafted follow-ups and change stages.

The session is a signed cookie (`HttpOnly`, `Secure`, `SameSite=Strict`) that lasts 8 hours. It is not stored on the server, so signing out clears the cookie but an already-copied cookie stays valid until it expires; changing `SESSION_SECRET` ends all sessions at once. Changing a stage also requires the request to come from the site itself, and sign-in attempts are rate limited and checked before the password is verified.

## Data retention

Test enquiries are hidden from every view after 7 days. A daily job (`/api/cron/retention`, scheduled in `vercel.json`) deletes leads older than 7 days and old rate-limit counters. It runs only for a caller that sends `Authorization: Bearer <CRON_SECRET>`.

## Deploying: what to set by hand

1. In Vercel, set all five variables for **Production** and **Preview**. Preview must use the Neon dev branch.
2. Apply the migrations to the dev branch, then to production, before the new code goes live.
3. After the first deploy, run the cron once from Vercel and check that it answers 200.
4. Add a Vercel firewall rate-limit rule for `/api/` as an outer layer. The Hobby plan includes one rate-limit rule per project, and the app also limits requests itself.
5. Check that the latest `main` is green in GitHub Actions.

## Privacy

This is a demonstration. The form asks visitors to use test details, the public dashboard shows no personal details, and test leads are hidden after 7 days and deleted by a daily job. Fonts are served from this site, so a visit contacts no font host.

## Author

Designed and built by **Shabbir Hussain** — conversion-focused websites, lead capture, and practical AI automation.
- LinkedIn: https://www.linkedin.com/in/shabbir-h-9b13a7370
- Email: shabbirtech110@gmail.com
