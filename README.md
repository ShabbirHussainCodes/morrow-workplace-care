# Morrow Workplace Care — Concept Website

**Live demo:** https://morrow-workplace-care.vercel.app · **Lead dashboard:** https://morrow-workplace-care.vercel.app/demo/

> **Portfolio concept.** Morrow Workplace Care is a fictional company. This site was designed and built by **Shabbir Hussain** to demonstrate a conversion-focused service-business website with a working lead-capture and follow-up workflow. It is not a real cleaning company, and no real customer data should be submitted.

## What this project demonstrates

1. **A clear service offer** — a B2B homepage that explains what the business does and who it is for.
2. **A strong call to action** — every section leads to one action: request a walkthrough.
3. **Lead capture** — an enquiry form with validation and spam protection.
4. **A follow-up workflow** — each enquiry is saved, tagged by space type and urgency, and given an auto-drafted follow-up message, visible on a small demo dashboard.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Plain HTML, CSS, JavaScript | Fast on mobile, no build step, easy to read |
| API | Vercel Serverless Function (`/api/lead`) | Keeps database credentials on the server |
| Database | Neon Postgres (via Vercel) | Real SQL, free tier, wakes automatically |
| Hosting | Vercel | Deploys from GitHub on every push |

## Project structure

```
.
├── index.html          # Homepage
├── demo/               # Lead dashboard (demo data only)
├── api/                # Serverless functions
├── db/                 # SQL schema
└── assets/
    ├── css/            # Styles and design tokens
    ├── js/             # Form + dashboard logic
    └── images/         # Workspace imagery (added separately)
```

## Privacy

This is a demonstration. The form asks visitors to use test details, emails are masked on the dashboard, and test leads older than 7 days are deleted automatically.

## Author

Designed and built by **Shabbir Hussain** — conversion-focused websites, lead capture, and practical AI automation.
- LinkedIn: https://www.linkedin.com/in/shabbir-h-9b13a7370
- Email: shabbirtech110@gmail.com
