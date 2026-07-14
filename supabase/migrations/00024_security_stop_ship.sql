-- Security stop-ship: fail closed on identity and remove the broadest
-- authorization paths before any environment is allowed to process PHI.

-- ---------------------------------------------------------------------------
-- 1. New public registrations are always patients.
--    Provider provisioning must happen through an audited admin workflow.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, email)
  VALUES (
    NEW.id,
    'patient',
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.patients (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;

  -- Self-service signup records the explicit checkbox acceptance atomically.
  -- Administrative invites intentionally create an unconsented account; the
  -- invited user must accept the same version on the first authenticated use.
  IF COALESCE(NEW.raw_user_meta_data ->> 'consent_accepted', '') = 'true' THEN
    INSERT INTO public.consents (
      user_id,
      consent_version,
      consent_type,
      accepted,
      accepted_at
    )
    VALUES (NEW.id, 'v1.0', 'registration', true, now());
  END IF;

  RETURN NEW;
END;
$$;

-- Authorization may use only the server-issued custom claim. Never fall back
-- to user_metadata, which the account owner can edit.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN auth.jwt() ->> 'user_role' IN ('provider', 'patient')
      THEN auth.jwt() ->> 'user_role'
    ELSE 'patient'
  END
$$;

-- Keep self-service profile edits limited to non-authorization fields.
DROP POLICY IF EXISTS "users_update_own_profile" ON public.profiles;
CREATE POLICY "users_update_own_profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

REVOKE UPDATE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT UPDATE (
  full_name,
  phone,
  address,
  state,
  onboarding_seen_at,
  updated_at
) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Provider-patient links use explicit operations and immutable principals.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "providers_manage_own_links"
  ON public.provider_patient_links;
DROP POLICY IF EXISTS "patients_read_own_links"
  ON public.provider_patient_links;
DROP POLICY IF EXISTS "providers_insert_invites"
  ON public.provider_patient_links;
DROP POLICY IF EXISTS "patients_insert_linkage_requests"
  ON public.provider_patient_links;
DROP POLICY IF EXISTS "providers_update_link_status"
  ON public.provider_patient_links;
DROP POLICY IF EXISTS "providers_select_own_links"
  ON public.provider_patient_links;
DROP POLICY IF EXISTS "patients_select_own_links"
  ON public.provider_patient_links;
DROP POLICY IF EXISTS "providers_review_pending_links"
  ON public.provider_patient_links;
DROP POLICY IF EXISTS "providers_revoke_active_links"
  ON public.provider_patient_links;
DROP POLICY IF EXISTS "patients_revoke_own_links"
  ON public.provider_patient_links;

CREATE POLICY "providers_select_own_links"
  ON public.provider_patient_links FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
  );

CREATE POLICY "patients_select_own_links"
  ON public.provider_patient_links FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND patient_id = (SELECT auth.uid())
  );

CREATE POLICY "providers_insert_invites"
  ON public.provider_patient_links FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'provider'
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
    AND patient_id = (SELECT auth.uid())
    AND status = 'pending'
    AND invite_email IS NULL
    AND linked_at IS NULL
  );

CREATE POLICY "providers_review_pending_links"
  ON public.provider_patient_links FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
    AND patient_id IS NOT NULL
    AND status = 'pending'
  )
  WITH CHECK (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
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
    AND provider_id = (SELECT auth.uid())
    AND status = 'active'
  )
  WITH CHECK (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
    AND status = 'revoked'
  );

CREATE POLICY "patients_revoke_own_links"
  ON public.provider_patient_links FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND patient_id = (SELECT auth.uid())
    AND status IN ('pending', 'active')
  )
  WITH CHECK (
    public.get_user_role() = 'patient'
    AND patient_id = (SELECT auth.uid())
    AND status = 'revoked'
  );

REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.provider_patient_links FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  provider_id,
  patient_id,
  status,
  invite_email,
  invite_sent_at
) ON public.provider_patient_links TO authenticated;
GRANT UPDATE (status, linked_at)
  ON public.provider_patient_links TO authenticated;

-- An invited email can attach only as a pending request. A provider must
-- explicitly review it before any clinical access becomes active.
CREATE OR REPLACE FUNCTION public.auto_link_invited_patient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'patient' THEN
    UPDATE public.provider_patient_links
    SET patient_id = NEW.id,
        status = 'pending',
        linked_at = NULL
    WHERE lower(invite_email) = lower(NEW.email)
      AND status = 'invited';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Discharge data requires a verified provider and active patient link.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "providers_select_own_discharges"
  ON public.discharge_records;
DROP POLICY IF EXISTS "providers_insert_own_discharges"
  ON public.discharge_records;
DROP POLICY IF EXISTS "providers_update_own_discharges"
  ON public.discharge_records;
DROP POLICY IF EXISTS "providers_delete_own_discharges"
  ON public.discharge_records;

CREATE POLICY "providers_select_linked_discharges"
  ON public.discharge_records FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.provider_patient_links link
      WHERE link.provider_id = (SELECT auth.uid())
        AND link.patient_id = discharge_records.patient_id
        AND link.status = 'active'
    )
  );

CREATE POLICY "providers_insert_linked_discharges"
  ON public.discharge_records FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.provider_patient_links link
      WHERE link.provider_id = (SELECT auth.uid())
        AND link.patient_id = discharge_records.patient_id
        AND link.status = 'active'
    )
  );

CREATE POLICY "providers_update_linked_discharges"
  ON public.discharge_records FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.provider_patient_links link
      WHERE link.provider_id = (SELECT auth.uid())
        AND link.patient_id = discharge_records.patient_id
        AND link.status = 'active'
    )
  )
  WITH CHECK (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.provider_patient_links link
      WHERE link.provider_id = (SELECT auth.uid())
        AND link.patient_id = discharge_records.patient_id
        AND link.status = 'active'
    )
  );

REVOKE UPDATE, DELETE
  ON TABLE public.discharge_records FROM PUBLIC, anon, authenticated;
GRANT UPDATE (
  discharged_at,
  facility_tier,
  discharge_notes,
  bundle_completed
) ON public.discharge_records TO authenticated;

DROP POLICY IF EXISTS "providers_select_own_followups"
  ON public.discharge_followups;
DROP POLICY IF EXISTS "providers_insert_own_followups"
  ON public.discharge_followups;
DROP POLICY IF EXISTS "providers_update_own_followups"
  ON public.discharge_followups;
DROP POLICY IF EXISTS "providers_delete_own_followups"
  ON public.discharge_followups;

CREATE POLICY "providers_select_linked_followups"
  ON public.discharge_followups FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.provider_patient_links link
      WHERE link.provider_id = (SELECT auth.uid())
        AND link.patient_id = discharge_followups.patient_id
        AND link.status = 'active'
    )
  );

CREATE POLICY "providers_insert_linked_followups"
  ON public.discharge_followups FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.provider_patient_links link
      WHERE link.provider_id = (SELECT auth.uid())
        AND link.patient_id = discharge_followups.patient_id
        AND link.status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.discharge_records record
      WHERE record.id = discharge_followups.discharge_record_id
        AND record.patient_id = discharge_followups.patient_id
        AND record.provider_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "providers_update_linked_followups"
  ON public.discharge_followups FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.provider_patient_links link
      WHERE link.provider_id = (SELECT auth.uid())
        AND link.patient_id = discharge_followups.patient_id
        AND link.status = 'active'
    )
  )
  WITH CHECK (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.provider_patient_links link
      WHERE link.provider_id = (SELECT auth.uid())
        AND link.patient_id = discharge_followups.patient_id
        AND link.status = 'active'
    )
  );

REVOKE UPDATE, DELETE
  ON TABLE public.discharge_followups FROM PUBLIC, anon, authenticated;
GRANT UPDATE (status, completed_at, contact_notes)
  ON public.discharge_followups TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Quality metrics and privileged helper functions fail closed.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "providers_manage_own_metrics"
  ON public.quality_metric_records;
DROP POLICY IF EXISTS "providers_select_own_metrics"
  ON public.quality_metric_records;
DROP POLICY IF EXISTS "providers_insert_own_metrics"
  ON public.quality_metric_records;
DROP POLICY IF EXISTS "providers_update_own_metrics"
  ON public.quality_metric_records;
DROP POLICY IF EXISTS "providers_delete_own_metrics"
  ON public.quality_metric_records;

CREATE POLICY "providers_select_own_metrics"
  ON public.quality_metric_records FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
  );

CREATE POLICY "providers_insert_own_metrics"
  ON public.quality_metric_records FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
  );

CREATE POLICY "providers_update_own_metrics"
  ON public.quality_metric_records FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
  );

CREATE POLICY "providers_delete_own_metrics"
  ON public.quality_metric_records FOR DELETE TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
  );

REVOKE UPDATE
  ON TABLE public.quality_metric_records FROM PUBLIC, anon, authenticated;
GRANT UPDATE (
  metric_key,
  period_month,
  numerator,
  denominator,
  rate_pct,
  notes
) ON public.quality_metric_records TO authenticated;

REVOKE ALL ON FUNCTION public.check_duplicate_alert(uuid, text, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_duplicate_alert(uuid, text, int)
  TO service_role;
