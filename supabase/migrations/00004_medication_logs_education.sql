-- ==========================================================================
-- HEARTLAND Protocol App: Medication Logs + Reminders + Education Progress
-- Phase 9 Plan 09-01: 3 new tables with RLS, indexes
-- ==========================================================================

-- ===========================================
-- MEDICATION LOGS: daily dose logging
-- ===========================================
CREATE TABLE medication_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id uuid NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES profiles(id),
  scheduled_date date NOT NULL,
  dose_number smallint NOT NULL CHECK (dose_number BETWEEN 1 AND 4),
  taken boolean NOT NULL DEFAULT false,
  taken_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (medication_id, scheduled_date, dose_number)
);
ALTER TABLE medication_logs ENABLE ROW LEVEL SECURITY;

-- Patient manages own logs; provider reads linked patients' logs
CREATE POLICY "medication_logs_access" ON medication_logs
  FOR ALL USING (
    (select auth.uid()) = patient_id
    OR (
      (select auth.jwt() ->> 'user_role') = 'provider'
      AND EXISTS (
        SELECT 1 FROM provider_patient_links
        WHERE provider_id = (select auth.uid())
        AND patient_id = medication_logs.patient_id
        AND status = 'active'
      )
    )
  );

CREATE INDEX idx_medication_logs_patient ON medication_logs(patient_id);
CREATE INDEX idx_medication_logs_medication_date ON medication_logs(medication_id, scheduled_date);

-- ===========================================
-- MEDICATION REMINDERS: push notification schedule
-- ===========================================
CREATE TABLE medication_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id uuid NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES profiles(id),
  reminder_time time NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  enabled boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE medication_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patients_manage_own_reminders" ON medication_reminders
  FOR ALL USING ((select auth.uid()) = patient_id);

CREATE INDEX idx_reminders_enabled ON medication_reminders(enabled, reminder_time)
  WHERE enabled = true;

-- ===========================================
-- EDUCATION PROGRESS: teach-back completion tracking
-- ===========================================
CREATE TABLE education_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES profiles(id),
  domain_id text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  attempts smallint NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (patient_id, domain_id)
);
ALTER TABLE education_progress ENABLE ROW LEVEL SECURITY;

-- Patient manages own progress; provider reads linked patients' progress
CREATE POLICY "education_progress_access" ON education_progress
  FOR ALL USING (
    (select auth.uid()) = patient_id
    OR (
      (select auth.jwt() ->> 'user_role') = 'provider'
      AND EXISTS (
        SELECT 1 FROM provider_patient_links
        WHERE provider_id = (select auth.uid())
        AND patient_id = education_progress.patient_id
        AND status = 'active'
      )
    )
  );

CREATE INDEX idx_education_progress_patient ON education_progress(patient_id);
