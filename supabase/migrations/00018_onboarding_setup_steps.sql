-- Patient onboarding setup steps tracking
-- Bitmask column: bit 1=Risk Calculator, 2=Track Assignment, 4=Medications, 8=Device Setup, 16=Education
-- ALL_STEPS_COMPLETE = 31 (binary 11111)

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS setup_completed_steps int NOT NULL DEFAULT 0;

-- Auto-init existing patients: bit 1 if risk_tier set, bit 2 if track_assignment set
UPDATE public.patients
  SET setup_completed_steps =
    (CASE WHEN risk_tier IS NOT NULL THEN 1 ELSE 0 END) |
    (CASE WHEN track_assignment IS NOT NULL THEN 2 ELSE 0 END);

-- RLS: providers can update setup_completed_steps for their linked patients
CREATE POLICY "providers_update_linked_patient_setup"
  ON public.patients FOR UPDATE TO authenticated
  USING (
    id IN (
      SELECT patient_id FROM public.provider_patient_links
      WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
    )
  )
  WITH CHECK (
    id IN (
      SELECT patient_id FROM public.provider_patient_links
      WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
    )
  );
