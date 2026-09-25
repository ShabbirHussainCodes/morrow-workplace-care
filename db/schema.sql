-- Morrow Workplace Care (concept) — lead table
-- Run once in the Neon SQL Editor after creating the database.

CREATE TABLE IF NOT EXISTS leads (
  id                 BIGSERIAL PRIMARY KEY,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- What the visitor submitted
  full_name          TEXT NOT NULL,
  email              TEXT NOT NULL,
  company            TEXT NOT NULL,
  space_type         TEXT NOT NULL,
  timing             TEXT NOT NULL,
  message            TEXT NOT NULL,

  -- What the workflow added
  service            TEXT NOT NULL,
  priority           TEXT NOT NULL CHECK (priority IN ('High', 'Medium', 'Low')),
  tags               JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_step          TEXT NOT NULL,
  follow_up_subject  TEXT NOT NULL,
  follow_up_body     TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'New'
                     CHECK (status IN ('New', 'Walkthrough booked', 'Proposal sent')),

  -- Hashed (never raw) IP, used only for basic rate limiting
  ip_hash            TEXT
);

CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_ip_hash_idx    ON leads (ip_hash, created_at DESC);
