-- 0002: public ids, an idempotency key and a rate-limit counter.
--
-- Additive only, so the code that is already deployed keeps working while this is applied:
-- the old INSERT simply gets a generated public_id and a NULL submission_id.

-- Visitors and the dashboard see public_id. The sequential id stays internal, so nobody can
-- count or guess leads. The default fills in a different value for every existing row.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS public_id     UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS submission_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS leads_public_id_key     ON leads (public_id);

-- The browser creates one submission_id per form fill. The unique index makes a repeated
-- submit land on the same lead (INSERT ... ON CONFLICT (submission_id)). It stays nullable
-- because leads created before this migration have none.
CREATE UNIQUE INDEX IF NOT EXISTS leads_submission_id_key ON leads (submission_id);

-- One counter per bucket and time window. A single INSERT ... ON CONFLICT DO UPDATE bumps it,
-- which is atomic, unlike counting rows and then inserting.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket        TEXT        NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- Lets the daily retention job find old windows without scanning the table.
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx ON rate_limits (window_start);
