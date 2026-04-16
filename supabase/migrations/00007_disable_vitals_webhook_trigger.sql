-- Disable the vitals INSERT webhook trigger that requires pg_net extension.
-- pg_net is not enabled on Supabase free tier by default.
-- The alert pipeline (Phase 10) will need pg_net enabled or an alternative
-- approach (e.g., Supabase Database Webhooks via Dashboard) when ready.

DROP TRIGGER IF EXISTS on_vitals_insert ON public.vitals;

-- Also fix provider_notes RLS to use get_user_role() fallback
DROP POLICY IF EXISTS "providers_insert_notes" ON public.provider_notes;
CREATE POLICY "providers_insert_notes"
  ON public.provider_notes FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'provider'
    AND provider_id = (SELECT auth.uid())
    AND patient_id IN (
      SELECT patient_id FROM public.provider_patient_links
      WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
    )
  );

DROP POLICY IF EXISTS "providers_read_notes" ON public.provider_notes;
CREATE POLICY "providers_read_notes"
  ON public.provider_notes FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND patient_id IN (
      SELECT patient_id FROM public.provider_patient_links
      WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
    )
  );
