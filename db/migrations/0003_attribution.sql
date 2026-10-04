-- 0003: where each lead came from (first-touch attribution).
--
-- Additive only, and every column is nullable: leads that arrived before this migration, and
-- leads whose attribution was missing or invalid, simply have NULLs. Lengths are enforced by
-- the server (ATTRIBUTION_LIMITS in assets/js/workflow.js), so they are not repeated here.
--
-- Apply this BEFORE deploying the code that writes these columns.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS utm_source   TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium   TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_term     TEXT,
  ADD COLUMN IF NOT EXISTS utm_content  TEXT,
  ADD COLUMN IF NOT EXISTS referrer     TEXT,
  ADD COLUMN IF NOT EXISTS landing_page TEXT;
