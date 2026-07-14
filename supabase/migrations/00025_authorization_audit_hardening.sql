-- HEARTLAND defense-in-depth authorization and audit hardening.
-- This migration is intentionally fail-closed. Apply only after reviewing the
-- consent rollout for existing users; unconsented accounts lose PHI access.

-- ---------------------------------------------------------------------------
-- 1. Authoritative role, consent, and relationship predicates
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS consents_user_version_type_unique
  ON public.consents (user_id, consent_version, consent_type);

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT profile.role
     FROM public.profiles AS profile
     WHERE profile.id = (SELECT auth.uid())),
    'patient'
  )
$$;

CREATE OR REPLACE FUNCTION public.has_registration_consent()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.consents AS consent
    WHERE consent.user_id = (SELECT auth.uid())
      AND consent.consent_type = 'registration'
      AND consent.consent_version = 'v1.0'
      AND consent.accepted = true
  )
$$;

CREATE OR REPLACE FUNCTION public.provider_has_patient(p_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.get_user_role() = 'provider'
    AND public.has_registration_consent()
    AND EXISTS (
      SELECT 1
      FROM public.provider_patient_links AS link
      WHERE link.provider_id = (SELECT auth.uid())
        AND link.patient_id = p_patient_id
        AND link.status = 'active'
    )
$$;

REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_registration_consent() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_has_patient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_registration_consent() TO authenticated;
GRANT EXECUTE ON FUNCTION public.provider_has_patient(uuid) TO authenticated;

-- Exact-code lookup avoids exposing every provider profile and email to every
-- patient. It returns only the minimum display data.
DROP POLICY IF EXISTS "patients_read_provider_codes" ON public.profiles;

CREATE OR REPLACE FUNCTION public.lookup_provider_by_code(p_code text)
RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT profile.id, profile.full_name
  FROM public.profiles AS profile
  WHERE public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND p_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'
    AND profile.role = 'provider'
    AND profile.provider_code = p_code
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.lookup_provider_by_code(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_provider_by_code(text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Append-only, metadata-only audit ledger
-- ---------------------------------------------------------------------------
CREATE TABLE public.audit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid,
  actor_role    text NOT NULL,
  action        text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  resource_type text NOT NULL,
  resource_id   text,
  patient_id    uuid,
  provider_id   uuid,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX audit_events_occurred_at_idx
  ON public.audit_events (occurred_at DESC);
CREATE INDEX audit_events_patient_idx
  ON public.audit_events (patient_id, occurred_at DESC)
  WHERE patient_id IS NOT NULL;
CREATE INDEX audit_events_provider_idx
  ON public.audit_events (provider_id, occurred_at DESC)
  WHERE provider_id IS NOT NULL;

REVOKE ALL ON TABLE public.audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.audit_events TO service_role;

CREATE OR REPLACE FUNCTION public.reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$;

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_event_mutation();

CREATE OR REPLACE FUNCTION public.write_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  row_data jsonb;
  patient_value text;
  provider_value text;
  patient_uuid uuid;
  provider_uuid uuid;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  patient_value := row_data ->> 'patient_id';
  provider_value := row_data ->> 'provider_id';

  IF patient_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    patient_uuid := patient_value::uuid;
  ELSIF TG_TABLE_NAME = 'patients'
    AND (row_data ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    patient_uuid := (row_data ->> 'id')::uuid;
  END IF;

  IF provider_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    provider_uuid := provider_value::uuid;
  END IF;

  INSERT INTO public.audit_events (
    actor_id,
    actor_role,
    action,
    resource_type,
    resource_id,
    patient_id,
    provider_id
  ) VALUES (
    (SELECT auth.uid()),
    CASE
      WHEN (SELECT auth.uid()) IS NULL THEN 'system'
      ELSE public.get_user_role()
    END,
    TG_OP,
    TG_TABLE_NAME,
    row_data ->> 'id',
    patient_uuid,
    provider_uuid
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_audit_event_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.write_audit_event()
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles',
    'patients',
    'provider_patient_links',
    'vitals',
    'symptoms',
    'medications',
    'medication_logs',
    'medication_reminders',
    'education_progress',
    'alerts',
    'provider_notes',
    'lab_results',
    'alert_preferences',
    'scheduled_followups',
    'discharge_records',
    'discharge_followups',
    'provider_messages',
    'quality_metric_records',
    'consents',
    'access_requests'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.write_audit_event()',
      table_name
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Consent and profile disclosure
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "users_insert_own_consents" ON public.consents;
CREATE POLICY "users_insert_current_registration_consent"
  ON public.consents FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND consent_type = 'registration'
    AND consent_version = 'v1.0'
    AND accepted = true
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.consents
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (user_id, consent_version, consent_type, accepted)
  ON public.consents TO authenticated;

DROP POLICY IF EXISTS "providers_read_linked_profiles" ON public.profiles;
CREATE POLICY "providers_read_linked_profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.provider_has_patient(id));

DROP POLICY IF EXISTS "users_update_own_profile" ON public.profiles;
CREATE POLICY "users_update_own_profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    id = (SELECT auth.uid())
    AND public.has_registration_consent()
  )
  WITH CHECK (id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Patient clinical profile and link ownership
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "patients_read_own" ON public.patients;
DROP POLICY IF EXISTS "patients_update_own" ON public.patients;
DROP POLICY IF EXISTS "providers_read_linked_patients" ON public.patients;
DROP POLICY IF EXISTS "providers_update_linked_patients" ON public.patients;
DROP POLICY IF EXISTS "providers_update_linked_patient_comorbidities" ON public.patients;
DROP POLICY IF EXISTS "providers_update_linked_patient_setup" ON public.patients;

CREATE POLICY "patients_read_own"
  ON public.patients FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND id = (SELECT auth.uid())
  );

CREATE POLICY "providers_read_linked_patients"
  ON public.patients FOR SELECT TO authenticated
  USING (public.provider_has_patient(id));

CREATE POLICY "providers_update_linked_patients"
  ON public.patients FOR UPDATE TO authenticated
  USING (public.provider_has_patient(id))
  WITH CHECK (public.provider_has_patient(id));

REVOKE INSERT, UPDATE, DELETE ON TABLE public.patients
  FROM PUBLIC, anon, authenticated;
GRANT UPDATE (
  date_of_birth,
  risk_tier,
  risk_score,
  risk_scored_at,
  track_assignment,
  facility_tier,
  comorbidities,
  setup_completed_steps,
  ckm_stage,
  ckm_factors,
  hf_type
) ON public.patients TO authenticated;

DROP POLICY IF EXISTS "providers_select_own_links" ON public.provider_patient_links;
DROP POLICY IF EXISTS "patients_select_own_links" ON public.provider_patient_links;
DROP POLICY IF EXISTS "providers_insert_invites" ON public.provider_patient_links;
DROP POLICY IF EXISTS "patients_insert_linkage_requests" ON public.provider_patient_links;
DROP POLICY IF EXISTS "providers_review_pending_links" ON public.provider_patient_links;
DROP POLICY IF EXISTS "providers_revoke_active_links" ON public.provider_patient_links;
DROP POLICY IF EXISTS "patients_revoke_own_links" ON public.provider_patient_links;

CREATE POLICY "providers_select_own_links"
  ON public.provider_patient_links FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND public.has_registration_consent()
    AND provider_id = (SELECT auth.uid())
  );

CREATE POLICY "patients_select_own_links"
  ON public.provider_patient_links FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );

CREATE POLICY "providers_insert_invites"
  ON public.provider_patient_links FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'provider'
    AND public.has_registration_consent()
    AND provider_id = (SELECT auth.uid())
    AND patient_id IS NULL
    AND status = 'invited'
    AND invite_email IS NOT NULL
    AND linked_at IS NULL
  );

CREATE POLICY "patients_insert_linkage_requests"
  ON public.provider_patient_links FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
    AND status = 'pending'
    AND invite_email IS NULL
    AND linked_at IS NULL
  );

CREATE POLICY "providers_review_pending_links"
  ON public.provider_patient_links FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND public.has_registration_consent()
    AND provider_id = (SELECT auth.uid())
    AND patient_id IS NOT NULL
    AND status = 'pending'
  )
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND patient_id IS NOT NULL
    AND (
      (status = 'active' AND linked_at IS NOT NULL)
      OR (status = 'rejected' AND linked_at IS NULL)
    )
  );

CREATE POLICY "providers_revoke_active_links"
  ON public.provider_patient_links FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND public.has_registration_consent()
    AND provider_id = (SELECT auth.uid())
    AND status = 'active'
  )
  WITH CHECK (provider_id = (SELECT auth.uid()) AND status = 'revoked');

CREATE POLICY "patients_revoke_own_links"
  ON public.provider_patient_links FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
    AND status IN ('pending', 'active')
  )
  WITH CHECK (patient_id = (SELECT auth.uid()) AND status = 'revoked');

CREATE UNIQUE INDEX IF NOT EXISTS provider_invite_outstanding_unique
  ON public.provider_patient_links (provider_id, lower(invite_email))
  WHERE status = 'invited' AND invite_email IS NOT NULL;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.provider_patient_links
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  provider_id, patient_id, status, invite_email, invite_sent_at
) ON public.provider_patient_links TO authenticated;
GRANT UPDATE (status, linked_at)
  ON public.provider_patient_links TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Append-only observations and symptoms
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "vitals_access" ON public.vitals;
CREATE POLICY "patients_read_own_vitals"
  ON public.vitals FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );
CREATE POLICY "providers_read_linked_vitals"
  ON public.vitals FOR SELECT TO authenticated
  USING (public.provider_has_patient(patient_id));
CREATE POLICY "patients_insert_own_vitals"
  ON public.vitals FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
    AND source = 'patient_app'
  );
CREATE POLICY "providers_insert_linked_vitals"
  ON public.vitals FOR INSERT TO authenticated
  WITH CHECK (
    public.provider_has_patient(patient_id)
    AND source = 'provider_entry'
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.vitals
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  patient_id, recorded_at, weight_lbs, sbp, dbp, heart_rate, spo2,
  source, client_id, synced_from_offline
) ON public.vitals TO authenticated;

DROP POLICY IF EXISTS "symptoms_access" ON public.symptoms;
CREATE POLICY "patients_read_own_symptoms"
  ON public.symptoms FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );
CREATE POLICY "providers_read_linked_symptoms"
  ON public.symptoms FOR SELECT TO authenticated
  USING (public.provider_has_patient(patient_id));
CREATE POLICY "patients_insert_own_symptoms"
  ON public.symptoms FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );
CREATE POLICY "providers_insert_linked_symptoms"
  ON public.symptoms FOR INSERT TO authenticated
  WITH CHECK (public.provider_has_patient(patient_id));

REVOKE INSERT, UPDATE, DELETE ON TABLE public.symptoms
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  patient_id, recorded_at, dyspnea, edema, orthopnea, fatigue, red_flag,
  client_id
) ON public.symptoms TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Medication, adherence, reminders, and education
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "medications_access" ON public.medications;
DROP POLICY IF EXISTS "patients_manage_own_medications" ON public.medications;
DROP POLICY IF EXISTS "providers_read_linked_medications" ON public.medications;

CREATE POLICY "patients_read_own_medications"
  ON public.medications FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );
CREATE POLICY "providers_read_linked_medications"
  ON public.medications FOR SELECT TO authenticated
  USING (public.provider_has_patient(patient_id));
CREATE POLICY "patients_insert_own_medications"
  ON public.medications FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );
CREATE POLICY "providers_insert_linked_medications"
  ON public.medications FOR INSERT TO authenticated
  WITH CHECK (public.provider_has_patient(patient_id));
CREATE POLICY "patients_update_own_medications"
  ON public.medications FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  )
  WITH CHECK (patient_id = (SELECT auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON TABLE public.medications
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (patient_id, name, dosage, frequency, timing, active)
  ON public.medications TO authenticated;
GRANT UPDATE (name, dosage, frequency, timing, active)
  ON public.medications TO authenticated;

DROP POLICY IF EXISTS "medication_logs_access" ON public.medication_logs;
CREATE POLICY "patients_read_own_medication_logs"
  ON public.medication_logs FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );
CREATE POLICY "providers_read_linked_medication_logs"
  ON public.medication_logs FOR SELECT TO authenticated
  USING (public.provider_has_patient(patient_id));
CREATE POLICY "patients_insert_own_medication_logs"
  ON public.medication_logs FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.medications AS medication
      WHERE medication.id = medication_id
        AND medication.patient_id = (SELECT auth.uid())
    )
  );
CREATE POLICY "patients_update_own_medication_logs"
  ON public.medication_logs FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  )
  WITH CHECK (
    patient_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.medications AS medication
      WHERE medication.id = medication_id
        AND medication.patient_id = (SELECT auth.uid())
    )
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.medication_logs
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  medication_id, patient_id, scheduled_date, dose_number, taken, taken_at
) ON public.medication_logs TO authenticated;
GRANT UPDATE (
  medication_id, patient_id, scheduled_date, dose_number, taken, taken_at
) ON public.medication_logs TO authenticated;

DROP POLICY IF EXISTS "patients_manage_own_reminders" ON public.medication_reminders;
CREATE POLICY "patients_read_own_reminders"
  ON public.medication_reminders FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );
CREATE POLICY "patients_insert_own_reminders"
  ON public.medication_reminders FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );
CREATE POLICY "patients_update_own_reminders"
  ON public.medication_reminders FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  )
  WITH CHECK (patient_id = (SELECT auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON TABLE public.medication_reminders
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (medication_id, patient_id, reminder_time, timezone, enabled)
  ON public.medication_reminders TO authenticated;
GRANT UPDATE (reminder_time, timezone, enabled)
  ON public.medication_reminders TO authenticated;

DROP POLICY IF EXISTS "education_progress_access" ON public.education_progress;
CREATE POLICY "patients_read_own_education_progress"
  ON public.education_progress FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );
CREATE POLICY "providers_read_linked_education_progress"
  ON public.education_progress FOR SELECT TO authenticated
  USING (public.provider_has_patient(patient_id));
CREATE POLICY "patients_insert_own_education_progress"
  ON public.education_progress FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );
CREATE POLICY "patients_update_own_education_progress"
  ON public.education_progress FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  )
  WITH CHECK (patient_id = (SELECT auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON TABLE public.education_progress
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (patient_id, domain_id, completed, completed_at, attempts)
  ON public.education_progress TO authenticated;
GRANT UPDATE (patient_id, domain_id, completed, completed_at, attempts)
  ON public.education_progress TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Provider clinical records and alert state
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "providers_manage_alerts" ON public.alerts;
CREATE POLICY "providers_read_linked_alerts"
  ON public.alerts FOR SELECT TO authenticated
  USING (public.provider_has_patient(patient_id));
CREATE POLICY "providers_update_linked_alerts"
  ON public.alerts FOR UPDATE TO authenticated
  USING (public.provider_has_patient(patient_id))
  WITH CHECK (public.provider_has_patient(patient_id));

REVOKE INSERT, UPDATE, DELETE ON TABLE public.alerts
  FROM PUBLIC, anon, authenticated;
GRANT UPDATE (status) ON public.alerts TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_alert_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'an authenticated actor is required';
  END IF;

  IF OLD.status = 'open' AND NEW.status = 'acknowledged' THEN
    NEW.acknowledged_by := actor;
    NEW.acknowledged_at := now();
  ELSIF OLD.status IN ('open', 'acknowledged') AND NEW.status = 'resolved' THEN
    NEW.resolved_by := actor;
    NEW.resolved_at := now();
  ELSE
    RAISE EXCEPTION 'invalid alert status transition';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_alert_transition ON public.alerts;
CREATE TRIGGER enforce_alert_transition
  BEFORE UPDATE ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_alert_transition();
REVOKE ALL ON FUNCTION public.enforce_alert_transition()
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "providers_insert_notes" ON public.provider_notes;
DROP POLICY IF EXISTS "providers_read_notes" ON public.provider_notes;
CREATE POLICY "providers_insert_notes"
  ON public.provider_notes FOR INSERT TO authenticated
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "providers_read_notes"
  ON public.provider_notes FOR SELECT TO authenticated
  USING (public.provider_has_patient(patient_id));

REVOKE INSERT, UPDATE, DELETE ON TABLE public.provider_notes
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (patient_id, provider_id, content)
  ON public.provider_notes TO authenticated;

DROP POLICY IF EXISTS "patients_read_own_labs" ON public.lab_results;
DROP POLICY IF EXISTS "providers_read_linked_labs" ON public.lab_results;
DROP POLICY IF EXISTS "providers_insert_linked_labs" ON public.lab_results;
DROP POLICY IF EXISTS "providers_update_linked_labs" ON public.lab_results;
DROP POLICY IF EXISTS "providers_delete_linked_labs" ON public.lab_results;
CREATE POLICY "patients_read_own_labs"
  ON public.lab_results FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );
CREATE POLICY "providers_read_linked_labs"
  ON public.lab_results FOR SELECT TO authenticated
  USING (public.provider_has_patient(patient_id));
CREATE POLICY "providers_insert_linked_labs"
  ON public.lab_results FOR INSERT TO authenticated
  WITH CHECK (
    public.provider_has_patient(patient_id)
    AND (ordered_by IS NULL OR ordered_by = (SELECT auth.uid()))
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.lab_results
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  patient_id, collected_at, potassium, creatinine, egfr, bun, bnp,
  nt_probnp, hba1c, glucose, sodium, hemoglobin, ferritin, tsat, ldl,
  ordered_by, lab_facility, notes
) ON public.lab_results TO authenticated;

DROP POLICY IF EXISTS "provider_manage_own_preferences" ON public.alert_preferences;
CREATE POLICY "providers_read_linked_alert_preferences"
  ON public.alert_preferences FOR SELECT TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "providers_insert_linked_alert_preferences"
  ON public.alert_preferences FOR INSERT TO authenticated
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "providers_update_linked_alert_preferences"
  ON public.alert_preferences FOR UPDATE TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  )
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.alert_preferences
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (provider_id, patient_id, alert_type, muted)
  ON public.alert_preferences TO authenticated;
GRANT UPDATE (provider_id, patient_id, alert_type, muted)
  ON public.alert_preferences TO authenticated;

DROP POLICY IF EXISTS "provider_manage_own_followups" ON public.scheduled_followups;
DROP POLICY IF EXISTS "patient_read_own_followups" ON public.scheduled_followups;
CREATE POLICY "providers_read_linked_scheduled_followups"
  ON public.scheduled_followups FOR SELECT TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "providers_insert_linked_scheduled_followups"
  ON public.scheduled_followups FOR INSERT TO authenticated
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "providers_update_linked_scheduled_followups"
  ON public.scheduled_followups FOR UPDATE TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  )
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "patients_read_own_scheduled_followups"
  ON public.scheduled_followups FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.scheduled_followups
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (patient_id, provider_id, scheduled_at, type, notes, completed)
  ON public.scheduled_followups TO authenticated;
GRANT UPDATE (scheduled_at, type, notes, completed)
  ON public.scheduled_followups TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Discharge records and atomic discharge bundle creation
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "providers_select_linked_discharges" ON public.discharge_records;
DROP POLICY IF EXISTS "providers_insert_linked_discharges" ON public.discharge_records;
DROP POLICY IF EXISTS "providers_update_linked_discharges" ON public.discharge_records;
DROP POLICY IF EXISTS "providers_delete_own_discharges" ON public.discharge_records;
DROP POLICY IF EXISTS "patients_select_own_discharges" ON public.discharge_records;
CREATE POLICY "providers_select_linked_discharges"
  ON public.discharge_records FOR SELECT TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "providers_insert_linked_discharges"
  ON public.discharge_records FOR INSERT TO authenticated
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "providers_update_linked_discharges"
  ON public.discharge_records FOR UPDATE TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  )
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "patients_select_own_discharges"
  ON public.discharge_records FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.discharge_records
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  patient_id, provider_id, discharged_at, facility_tier, discharge_notes,
  bundle_completed
) ON public.discharge_records TO authenticated;
GRANT UPDATE (discharged_at, facility_tier, discharge_notes, bundle_completed)
  ON public.discharge_records TO authenticated;

DROP POLICY IF EXISTS "providers_select_linked_followups" ON public.discharge_followups;
DROP POLICY IF EXISTS "providers_insert_linked_followups" ON public.discharge_followups;
DROP POLICY IF EXISTS "providers_update_linked_followups" ON public.discharge_followups;
DROP POLICY IF EXISTS "providers_delete_own_followups" ON public.discharge_followups;
DROP POLICY IF EXISTS "patients_select_own_followups" ON public.discharge_followups;
CREATE POLICY "providers_select_linked_followups"
  ON public.discharge_followups FOR SELECT TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "providers_insert_linked_followups"
  ON public.discharge_followups FOR INSERT TO authenticated
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
    AND EXISTS (
      SELECT 1 FROM public.discharge_records AS record
      WHERE record.id = discharge_record_id
        AND record.patient_id = discharge_followups.patient_id
        AND record.provider_id = (SELECT auth.uid())
    )
  );
CREATE POLICY "providers_update_linked_followups"
  ON public.discharge_followups FOR UPDATE TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  )
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "patients_select_own_followups"
  ON public.discharge_followups FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.discharge_followups
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  discharge_record_id, patient_id, provider_id, type, label, due_at,
  purpose, status
) ON public.discharge_followups TO authenticated;
GRANT UPDATE (status, completed_at, contact_notes)
  ON public.discharge_followups TO authenticated;

CREATE OR REPLACE FUNCTION public.create_discharge_with_followups(
  p_patient_id uuid,
  p_discharged_at timestamptz,
  p_facility_tier int,
  p_discharge_notes text,
  p_bundle_completed jsonb,
  p_followups jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  record_id uuid;
BEGIN
  IF NOT public.provider_has_patient(p_patient_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_facility_tier NOT IN (1, 2, 3)
    OR length(COALESCE(p_discharge_notes, '')) > 5000 THEN
    RAISE EXCEPTION 'invalid discharge data';
  END IF;
  IF jsonb_typeof(p_followups) <> 'array'
    OR jsonb_array_length(p_followups) <> 5
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_followups) AS followup
      WHERE followup ->> 'type' NOT IN (
        'call_48h', 'visit_day7', 'call_week2', 'call_week3', 'call_week4'
      )
        OR length(COALESCE(followup ->> 'label', '')) > 200
        OR length(COALESCE(followup ->> 'purpose', '')) > 1000
    )
    OR (
      SELECT count(DISTINCT followup ->> 'type')
      FROM jsonb_array_elements(p_followups) AS followup
    ) <> 5 THEN
    RAISE EXCEPTION 'invalid follow-up schedule';
  END IF;

  INSERT INTO public.discharge_records (
    patient_id, provider_id, discharged_at, facility_tier,
    discharge_notes, bundle_completed
  ) VALUES (
    p_patient_id, (SELECT auth.uid()), p_discharged_at, p_facility_tier,
    NULLIF(p_discharge_notes, ''), COALESCE(p_bundle_completed, '{}'::jsonb)
  )
  RETURNING id INTO record_id;

  INSERT INTO public.discharge_followups (
    discharge_record_id, patient_id, provider_id, type, label, due_at,
    purpose, status
  )
  SELECT
    record_id,
    p_patient_id,
    (SELECT auth.uid()),
    followup ->> 'type',
    followup ->> 'label',
    (followup ->> 'due_at')::timestamptz,
    followup ->> 'purpose',
    'pending'
  FROM jsonb_array_elements(p_followups) AS followup;

  RETURN record_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_discharge_with_followups(
  uuid, timestamptz, int, text, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_discharge_with_followups(
  uuid, timestamptz, int, text, jsonb, jsonb
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Messaging, metrics, and user-owned delivery credentials
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "providers_insert_messages" ON public.provider_messages;
DROP POLICY IF EXISTS "providers_read_messages" ON public.provider_messages;
DROP POLICY IF EXISTS "patients_read_own_messages" ON public.provider_messages;
DROP POLICY IF EXISTS "patients_update_read_at" ON public.provider_messages;
CREATE POLICY "providers_insert_messages"
  ON public.provider_messages FOR INSERT TO authenticated
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "providers_read_messages"
  ON public.provider_messages FOR SELECT TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "patients_read_own_messages"
  ON public.provider_messages FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );
CREATE POLICY "patients_update_read_at"
  ON public.provider_messages FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  )
  WITH CHECK (patient_id = (SELECT auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON TABLE public.provider_messages
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (patient_id, provider_id, template_type, subject, body)
  ON public.provider_messages TO authenticated;
GRANT UPDATE (read_at) ON public.provider_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_message_read_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.read_at IS NOT NULL THEN
    NEW.read_at := OLD.read_at;
  ELSIF NEW.read_at IS NOT NULL THEN
    NEW.read_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_message_read_receipt ON public.provider_messages;
CREATE TRIGGER enforce_message_read_receipt
  BEFORE UPDATE ON public.provider_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_read_receipt();
REVOKE ALL ON FUNCTION public.enforce_message_read_receipt()
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "providers_select_own_metrics" ON public.quality_metric_records;
DROP POLICY IF EXISTS "providers_insert_own_metrics" ON public.quality_metric_records;
DROP POLICY IF EXISTS "providers_update_own_metrics" ON public.quality_metric_records;
DROP POLICY IF EXISTS "providers_delete_own_metrics" ON public.quality_metric_records;
CREATE POLICY "providers_select_own_metrics"
  ON public.quality_metric_records FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND public.has_registration_consent()
    AND provider_id = (SELECT auth.uid())
  );
CREATE POLICY "providers_insert_own_metrics"
  ON public.quality_metric_records FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'provider'
    AND public.has_registration_consent()
    AND provider_id = (SELECT auth.uid())
  );
CREATE POLICY "providers_update_own_metrics"
  ON public.quality_metric_records FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND public.has_registration_consent()
    AND provider_id = (SELECT auth.uid())
  )
  WITH CHECK (provider_id = (SELECT auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON TABLE public.quality_metric_records
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  provider_id, metric_key, period_month, numerator, denominator, rate_pct, notes
) ON public.quality_metric_records TO authenticated;
GRANT UPDATE (
  provider_id, metric_key, period_month, numerator, denominator, rate_pct, notes
) ON public.quality_metric_records TO authenticated;

DROP POLICY IF EXISTS "users_manage_own_subscriptions" ON public.push_subscriptions;
CREATE POLICY "users_read_own_subscriptions"
  ON public.push_subscriptions FOR SELECT TO authenticated
  USING (
    public.has_registration_consent()
    AND user_id = (SELECT auth.uid())
  );
CREATE POLICY "users_insert_own_subscriptions"
  ON public.push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (
    public.has_registration_consent()
    AND user_id = (SELECT auth.uid())
  );
CREATE POLICY "users_update_own_subscriptions"
  ON public.push_subscriptions FOR UPDATE TO authenticated
  USING (
    public.has_registration_consent()
    AND user_id = (SELECT auth.uid())
  )
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "users_delete_own_subscriptions"
  ON public.push_subscriptions FOR DELETE TO authenticated
  USING (
    public.has_registration_consent()
    AND user_id = (SELECT auth.uid())
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.push_subscriptions
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (user_id, endpoint, keys)
  ON public.push_subscriptions TO authenticated;
GRANT UPDATE (endpoint, keys)
  ON public.push_subscriptions TO authenticated;
GRANT DELETE ON TABLE public.push_subscriptions TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Public professional-access intake: write-only, fixed pending state
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone may submit an access request"
  ON public.access_requests;
CREATE POLICY "Anyone may submit a pending access request"
  ON public.access_requests FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'pending'
    AND reviewed_at IS NULL
    AND reviewed_by IS NULL
    AND length(full_name) BETWEEN 1 AND 200
    AND length(email) BETWEEN 3 AND 320
    AND length(COALESCE(message, '')) <= 2000
  );

REVOKE INSERT ON TABLE public.access_requests
  FROM PUBLIC, anon, authenticated;
GRANT INSERT (full_name, email, npi, state, facility, role_claim, message)
  ON public.access_requests TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Database constraints for clients that bypass application validation
-- ---------------------------------------------------------------------------
ALTER TABLE public.vitals
  ADD CONSTRAINT vitals_clinical_ranges CHECK (
    (weight_lbs IS NULL OR weight_lbs BETWEEN 50 AND 700)
    AND (sbp IS NULL OR sbp BETWEEN 60 AND 260)
    AND (dbp IS NULL OR dbp BETWEEN 30 AND 160)
    AND (heart_rate IS NULL OR heart_rate BETWEEN 30 AND 220)
    AND (spo2 IS NULL OR spo2 BETWEEN 50 AND 100)
  ) NOT VALID;

ALTER TABLE public.lab_results
  ADD CONSTRAINT lab_results_clinical_ranges CHECK (
    (potassium IS NULL OR potassium BETWEEN 1 AND 10)
    AND (creatinine IS NULL OR creatinine BETWEEN 0.1 AND 20)
    AND (egfr IS NULL OR egfr BETWEEN 0 AND 200)
    AND (bun IS NULL OR bun BETWEEN 0 AND 300)
    AND (bnp IS NULL OR bnp BETWEEN 0 AND 100000)
    AND (nt_probnp IS NULL OR nt_probnp BETWEEN 0 AND 100000)
    AND (hba1c IS NULL OR hba1c BETWEEN 2 AND 25)
    AND (glucose IS NULL OR glucose BETWEEN 20 AND 1000)
    AND (sodium IS NULL OR sodium BETWEEN 100 AND 180)
    AND (hemoglobin IS NULL OR hemoglobin BETWEEN 1 AND 30)
    AND (ferritin IS NULL OR ferritin BETWEEN 0 AND 100000)
    AND (tsat IS NULL OR tsat BETWEEN 0 AND 100)
    AND (ldl IS NULL OR ldl BETWEEN 0 AND 1000)
  ) NOT VALID;

ALTER TABLE public.patients
  ADD CONSTRAINT patients_setup_steps_range CHECK (
    setup_completed_steps BETWEEN 0 AND 31
  ) NOT VALID,
  ADD CONSTRAINT patients_comorbidities_limit CHECK (
    cardinality(comorbidities) <= 20
  ) NOT VALID;

ALTER TABLE public.provider_notes
  ADD CONSTRAINT provider_notes_content_length CHECK (
    char_length(content) BETWEEN 1 AND 5000
  ) NOT VALID;

ALTER TABLE public.provider_messages
  ADD CONSTRAINT provider_messages_content_length CHECK (
    char_length(subject) BETWEEN 1 AND 200
    AND char_length(body) BETWEEN 1 AND 2000
  ) NOT VALID;

ALTER TABLE public.discharge_records
  ADD CONSTRAINT discharge_notes_length CHECK (
    discharge_notes IS NULL OR char_length(discharge_notes) <= 5000
  ) NOT VALID;

ALTER TABLE public.discharge_followups
  ADD CONSTRAINT discharge_contact_notes_length CHECK (
    contact_notes IS NULL OR char_length(contact_notes) <= 5000
  ) NOT VALID;

ALTER TABLE public.quality_metric_records
  ADD CONSTRAINT quality_metric_values_valid CHECK (
    (numerator IS NULL OR numerator >= 0)
    AND (denominator IS NULL OR denominator > 0)
    AND (numerator IS NULL OR denominator IS NULL OR numerator <= denominator)
    AND (rate_pct IS NULL OR rate_pct BETWEEN 0 AND 100)
  ) NOT VALID;

-- Security notes:
-- * pgaudit remains a hosted-control decision. Enabling parameter logging can
--   itself copy PHI into database logs, so it must be configured and retained
--   under the deployment's formal logging policy.
-- * CAPTCHA/rate limiting for access_requests belongs at the edge/WAF layer;
--   this migration ensures a direct client still cannot forge review state.
