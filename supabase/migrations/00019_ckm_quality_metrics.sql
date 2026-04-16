-- Phase 22: CKM Staging & Quality Metrics
-- Adds ckm_stage/ckm_factors to patients table
-- Creates quality_metric_records table

ALTER TABLE public.patients
  ADD COLUMN ckm_stage int CHECK (ckm_stage BETWEEN 0 AND 4),
  ADD COLUMN ckm_factors jsonb;

CREATE TABLE public.quality_metric_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  metric_key    text NOT NULL,
  period_month  date NOT NULL,
  numerator     int,
  denominator   int,
  rate_pct      numeric(5,2),
  notes         text,
  created_at    timestamptz DEFAULT now(),
  UNIQUE(provider_id, metric_key, period_month)
);

ALTER TABLE public.quality_metric_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "providers_manage_own_metrics"
  ON public.quality_metric_records FOR ALL TO authenticated
  USING (provider_id = (SELECT auth.uid()));
