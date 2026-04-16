-- Allow providers to read profiles of their linked patients
CREATE POLICY "providers_read_linked_profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND id IN (
      SELECT patient_id FROM public.provider_patient_links
      WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
    )
  );
