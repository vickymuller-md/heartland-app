-- Phase 13: Add optional hf_type column to patients for GDMT optimization rate (METR-02)
-- Allows computing GDMT rate specifically for HFrEF patients
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS hf_type text
  CHECK (hf_type IN ('HFrEF', 'HFpEF', 'HFmrEF'));

COMMENT ON COLUMN patients.hf_type IS 'Heart failure subtype for GDMT rate computation. NULL = unclassified.';
