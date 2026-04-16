-- Migration: fill RLS coverage gaps identified during v1.0.0 hardening review.
-- Scope is additive -- existing policies are preserved; this adds the missing
-- SELECT/UPDATE/DELETE pathways and tightens one over-broad FOR ALL policy.

-- ---------------------------------------------------------------------------
-- 1. Patients can read their own discharge records + followups
--    (Needed so the patient Track B can view discharge instructions.)
-- ---------------------------------------------------------------------------
CREATE POLICY "patients_select_own_discharges"
  ON public.discharge_records FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND patient_id = (SELECT auth.uid())
  );

CREATE POLICY "patients_select_own_followups"
  ON public.discharge_followups FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND patient_id = (SELECT auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 2. Providers can delete their own discharge records and followups.
--    Needed for test/demo cleanup and for correcting accidental discharges.
--    Cascades to followups are already declared on the foreign key.
-- ---------------------------------------------------------------------------
CREATE POLICY "providers_delete_own_discharges"
  ON public.discharge_records FOR DELETE TO authenticated
  USING (provider_id = (SELECT auth.uid()));

CREATE POLICY "providers_delete_own_followups"
  ON public.discharge_followups FOR DELETE TO authenticated
  USING (provider_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. Lab results: providers can correct values for linked patients.
--    Patients cannot update or delete (read-only for them).
--    Providers can delete to retract erroneous entries (rare but needed).
-- ---------------------------------------------------------------------------
CREATE POLICY "providers_update_linked_labs"
  ON public.lab_results FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND patient_id IN (
      SELECT patient_id FROM public.provider_patient_links
      WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
    )
  )
  WITH CHECK (
    public.get_user_role() = 'provider'
    AND patient_id IN (
      SELECT patient_id FROM public.provider_patient_links
      WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
    )
  );

CREATE POLICY "providers_delete_linked_labs"
  ON public.lab_results FOR DELETE TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND patient_id IN (
      SELECT patient_id FROM public.provider_patient_links
      WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Tighten quality_metric_records: the FOR ALL policy lacks a WITH CHECK,
--    so a provider could UPDATE a row to belong to another provider_id.
--    Split into the four per-operation policies with matched WITH CHECK.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "providers_manage_own_metrics" ON public.quality_metric_records;

CREATE POLICY "providers_select_own_metrics"
  ON public.quality_metric_records FOR SELECT TO authenticated
  USING (provider_id = (SELECT auth.uid()));

CREATE POLICY "providers_insert_own_metrics"
  ON public.quality_metric_records FOR INSERT TO authenticated
  WITH CHECK (provider_id = (SELECT auth.uid()));

CREATE POLICY "providers_update_own_metrics"
  ON public.quality_metric_records FOR UPDATE TO authenticated
  USING (provider_id = (SELECT auth.uid()))
  WITH CHECK (provider_id = (SELECT auth.uid()));

CREATE POLICY "providers_delete_own_metrics"
  ON public.quality_metric_records FOR DELETE TO authenticated
  USING (provider_id = (SELECT auth.uid()));
