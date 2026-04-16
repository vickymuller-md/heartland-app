-- The medications_access policy uses get_user_role() which works,
-- but the RLS check requires the JWT user_role claim for 'provider'.
-- Let's verify the policy allows provider access and add explicit read policy.

-- Drop the combined policy and create separate read policies
DROP POLICY IF EXISTS "medications_access" ON public.medications;

-- Patients: full access to own medications
CREATE POLICY "patients_manage_own_medications"
  ON public.medications FOR ALL TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND patient_id = (SELECT auth.uid())
  );

-- Providers: read-only access to linked patients' medications
CREATE POLICY "providers_read_linked_medications"
  ON public.medications FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND patient_id IN (
      SELECT patient_id FROM public.provider_patient_links
      WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
    )
  );
