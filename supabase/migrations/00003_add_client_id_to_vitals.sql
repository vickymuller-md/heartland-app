-- Phase 8: Add client_id for idempotent offline sync
-- Each offline vitals/symptoms record gets a client-generated UUID.
-- Supabase upsert with onConflict: 'client_id' makes retries idempotent.

ALTER TABLE vitals ADD COLUMN client_id uuid UNIQUE;

-- Partial index for upsert performance (only non-null values)
CREATE INDEX idx_vitals_client_id ON vitals(client_id) WHERE client_id IS NOT NULL;

-- Also add to symptoms table for future offline symptom sync
ALTER TABLE symptoms ADD COLUMN client_id uuid UNIQUE;
CREATE INDEX idx_symptoms_client_id ON symptoms(client_id) WHERE client_id IS NOT NULL;
