-- Phase 16: Discharge Checklist & Post-Discharge Protocol
-- Creates discharge_records + discharge_followups tables with RLS
-- Source: HEARTLAND Protocol v3.3 Module 4

-- 1. Discharge Records -- stores each discharge event per patient
CREATE TABLE public.discharge_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  provider_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  discharged_at    timestamptz NOT NULL,
  facility_tier    int NOT NULL CHECK (facility_tier IN (1, 2, 3)),
  discharge_notes  text,
  bundle_completed jsonb DEFAULT '{}',
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE public.discharge_records ENABLE ROW LEVEL SECURITY;

-- Providers can view their own discharge records
CREATE POLICY "providers_select_own_discharges"
  ON public.discharge_records FOR SELECT TO authenticated
  USING (provider_id = (SELECT auth.uid()));

-- Providers can insert discharge records
CREATE POLICY "providers_insert_own_discharges"
  ON public.discharge_records FOR INSERT TO authenticated
  WITH CHECK (provider_id = (SELECT auth.uid()));

-- Providers can update their own discharge records
CREATE POLICY "providers_update_own_discharges"
  ON public.discharge_records FOR UPDATE TO authenticated
  USING (provider_id = (SELECT auth.uid()))
  WITH CHECK (provider_id = (SELECT auth.uid()));

CREATE INDEX idx_discharge_records_patient ON public.discharge_records (patient_id);
CREATE INDEX idx_discharge_records_provider ON public.discharge_records (provider_id);

-- 2. Discharge Follow-ups -- structured follow-up schedule (5 rows per discharge)
CREATE TABLE public.discharge_followups (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discharge_record_id  uuid NOT NULL REFERENCES public.discharge_records(id) ON DELETE CASCADE,
  patient_id           uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  provider_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type                 text NOT NULL CHECK (type IN ('call_48h','visit_day7','call_week2','call_week3','call_week4')),
  label                text NOT NULL,
  due_at               timestamptz NOT NULL,
  purpose              text,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','skipped')),
  completed_at         timestamptz,
  contact_notes        text,
  created_at           timestamptz DEFAULT now()
);

ALTER TABLE public.discharge_followups ENABLE ROW LEVEL SECURITY;

-- Providers can view their own follow-ups
CREATE POLICY "providers_select_own_followups"
  ON public.discharge_followups FOR SELECT TO authenticated
  USING (provider_id = (SELECT auth.uid()));

-- Providers can insert follow-ups
CREATE POLICY "providers_insert_own_followups"
  ON public.discharge_followups FOR INSERT TO authenticated
  WITH CHECK (provider_id = (SELECT auth.uid()));

-- Providers can update their own follow-ups (mark complete)
CREATE POLICY "providers_update_own_followups"
  ON public.discharge_followups FOR UPDATE TO authenticated
  USING (provider_id = (SELECT auth.uid()))
  WITH CHECK (provider_id = (SELECT auth.uid()));

CREATE INDEX idx_discharge_followups_patient ON public.discharge_followups (patient_id);
CREATE INDEX idx_discharge_followups_provider ON public.discharge_followups (provider_id);
CREATE INDEX idx_discharge_followups_due ON public.discharge_followups (due_at) WHERE status = 'pending';
