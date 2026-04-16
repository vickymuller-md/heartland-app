-- Phase 14: Intelligent Alerts Engine
-- Adds alert_preferences, scheduled_followups tables and extends alerts severity constraint

-- 1. Extend alerts severity CHECK to include 'informational'
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_severity_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_severity_check
  CHECK (severity IN ('warning', 'critical', 'informational'));

-- 2. Alert preferences: providers can mute specific alert types per patient
CREATE TABLE IF NOT EXISTS alert_preferences (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id   uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  alert_type   text NOT NULL,
  muted        boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, patient_id, alert_type)
);

ALTER TABLE alert_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "provider_manage_own_preferences"
  ON alert_preferences FOR ALL TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND (SELECT auth.jwt() ->> 'user_role') = 'provider'
  )
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND (SELECT auth.jwt() ->> 'user_role') = 'provider'
  );

CREATE INDEX IF NOT EXISTS idx_alert_preferences_lookup
  ON alert_preferences (provider_id, patient_id, alert_type);

-- 3. Scheduled followups: track post-discharge and routine follow-up contacts
CREATE TABLE IF NOT EXISTS scheduled_followups (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id   uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  provider_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  type         text NOT NULL,
  notes        text,
  completed    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scheduled_followups ENABLE ROW LEVEL SECURITY;

-- Providers can manage their own follow-ups
CREATE POLICY "provider_manage_own_followups"
  ON scheduled_followups FOR ALL TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND (SELECT auth.jwt() ->> 'user_role') = 'provider'
  )
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND (SELECT auth.jwt() ->> 'user_role') = 'provider'
  );

-- Patients can read their own follow-ups
CREATE POLICY "patient_read_own_followups"
  ON scheduled_followups FOR SELECT TO authenticated
  USING (
    patient_id = (SELECT auth.uid())
    AND (SELECT auth.jwt() ->> 'user_role') = 'patient'
  );

CREATE INDEX IF NOT EXISTS idx_scheduled_followups_patient
  ON scheduled_followups (patient_id, scheduled_at);
