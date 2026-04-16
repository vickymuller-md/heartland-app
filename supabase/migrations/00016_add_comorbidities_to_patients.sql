-- Add comorbidities text[] to patients table for Phase 17 Comorbidity Manager
-- Stores selected comorbidity keys (e.g., ['afib', 'ckd', 'diabetes'])

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS comorbidities text[] NOT NULL DEFAULT '{}';

-- providers_read_linked_patients covers SELECT; no existing UPDATE policy for providers
-- This is the first phase requiring provider UPDATE on the patients table

CREATE POLICY "providers_update_linked_patient_comorbidities"
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
