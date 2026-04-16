-- Lab Results table for tracking bloodwork history
-- K+, Creatinine, BNP/NT-proBNP, eGFR, HbA1c, etc.
-- Used by titration checklist (pre-populated) and patient detail view

CREATE TABLE public.lab_results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  collected_at  timestamptz NOT NULL,
  -- Renal panel
  potassium     numeric(3,1),     -- mEq/L (normal 3.5-5.0)
  creatinine    numeric(4,2),     -- mg/dL (normal 0.7-1.3)
  egfr          int,              -- mL/min/1.73m2
  bun           numeric(4,1),     -- mg/dL (normal 7-20)
  -- Cardiac biomarkers
  bnp           numeric(7,1),     -- pg/mL
  nt_probnp     numeric(8,1),     -- pg/mL
  -- Metabolic
  hba1c         numeric(3,1),     -- % (normal <5.7)
  glucose       numeric(5,1),     -- mg/dL
  sodium        numeric(4,1),     -- mEq/L (normal 136-145)
  -- Hematology
  hemoglobin    numeric(4,1),     -- g/dL
  ferritin      numeric(6,1),     -- ng/mL
  tsat          numeric(4,1),     -- % (transferrin saturation)
  -- Lipids
  ldl           numeric(5,1),     -- mg/dL
  -- Meta
  ordered_by    uuid REFERENCES public.profiles(id),
  lab_facility  text,
  notes         text,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.lab_results ENABLE ROW LEVEL SECURITY;

-- Patients read own labs
CREATE POLICY "patients_read_own_labs"
  ON public.lab_results FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND patient_id = (SELECT auth.uid())
  );

-- Providers read/write linked patient labs
CREATE POLICY "providers_read_linked_labs"
  ON public.lab_results FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND patient_id IN (
      SELECT patient_id FROM public.provider_patient_links
      WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
    )
  );

CREATE POLICY "providers_insert_linked_labs"
  ON public.lab_results FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'provider'
    AND patient_id IN (
      SELECT patient_id FROM public.provider_patient_links
      WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
    )
  );

-- Indexes
CREATE INDEX idx_lab_results_patient ON public.lab_results(patient_id, collected_at DESC);
