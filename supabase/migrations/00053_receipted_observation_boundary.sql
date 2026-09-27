-- Local capture cutover. Deploy only with receipted clients and verified legacy guards.
-- Existing sources are untouched; no backfill, evaluation, sender or clinical policy.
-- Table REVOKE alone does not remove the column grants installed by 00025.
REVOKE INSERT ON TABLE public.vitals, public.symptoms FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT (id, patient_id, recorded_at, weight_lbs, sbp, dbp, heart_rate, spo2,
  created_at, client_id, source, synced_from_offline)
  ON public.vitals FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT (id, patient_id, recorded_at, dyspnea, edema, orthopnea, fatigue, red_flag,
  created_at, client_id)
  ON public.symptoms FROM PUBLIC, anon, authenticated, service_role;

-- The postgres-owned SECURITY DEFINER capture kernel keeps its authority. API callers
-- must use authenticated prepare/submit RPCs, with their existing scope/consent/AAL gates.
-- Evaluator UPDATE, reads and the separately controlled erasure path are unchanged.
-- Administrative SQL remains administrative; this is not a superuser write prohibition.
