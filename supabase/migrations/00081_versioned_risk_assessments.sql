BEGIN;
-- Keep each completed assessment and its patient summary in the same transaction.
CREATE TABLE public.risk_assessments (
  request_id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL,
  framework_version text NOT NULL,
  factors jsonb NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 18),
  tier text NOT NULL CHECK (tier IN ('low', 'moderate', 'high'))
);
CREATE INDEX risk_assessments_patient_date ON public.risk_assessments (patient_id, recorded_at DESC);
ALTER TABLE public.risk_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.risk_assessments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.risk_assessments TO authenticated;
CREATE POLICY read_linked_risk_assessments ON public.risk_assessments FOR SELECT TO authenticated
  USING (public.provider_has_patient(patient_id));

CREATE FUNCTION public.record_risk_assessment(
  p_expected_actor uuid, p_patient_id uuid, p_request_id uuid, p_version text, p_factors jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_weights constant jsonb := '{"ageOver75":2,"priorHfHospitalization":3,"egfrBelow45":2,"elevatedNatriuretic":2,"sbpBelow100":2,"diabetes":1,"lvefBelow30":2,"ckmStage3or4":2,"distanceOver50Miles":1,"livesAloneOrLimitedSupport":1}';
  v_saved public.risk_assessments%ROWTYPE;
  v_score integer;
  v_tier text;
  v_at timestamptz;
BEGIN
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_expected_actor OR public.provider_aal2() IS NOT TRUE THEN
    RAISE EXCEPTION 'Provider session unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.provider_patient_links
    WHERE provider_id = v_actor AND patient_id = p_patient_id AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient link unavailable' USING ERRCODE = '42501'; END IF;
  IF p_version IS DISTINCT FROM 'HEARTLAND-3.4.1-table-1' OR p_request_id IS NULL
     OR jsonb_typeof(p_factors) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Incomplete assessment' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_weights) k WHERE jsonb_typeof(p_factors -> k) IS DISTINCT FROM 'boolean')
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_factors) k WHERE NOT v_weights ? k) THEN
    RAISE EXCEPTION 'Each of the ten factors requires a boolean answer' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.patients WHERE id = p_patient_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_saved FROM public.risk_assessments WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_saved.recorded_by IS DISTINCT FROM v_actor OR v_saved.patient_id <> p_patient_id
       OR v_saved.framework_version <> p_version OR v_saved.factors <> p_factors THEN
      RAISE EXCEPTION 'Assessment does not match the previous operation' USING ERRCODE = '22023';
    END IF;
    RETURN p_request_id;
  END IF;
  SELECT coalesce(sum(value::integer), 0) INTO v_score FROM jsonb_each_text(v_weights)
    WHERE p_factors -> key = 'true'::jsonb;
  v_tier := CASE WHEN v_score <= 4 THEN 'low' WHEN v_score <= 8 THEN 'moderate' ELSE 'high' END;
  v_at := clock_timestamp();
  INSERT INTO public.risk_assessments (request_id, patient_id, recorded_by, recorded_at, framework_version, factors, score, tier)
    VALUES (p_request_id, p_patient_id, v_actor, v_at, p_version, p_factors, v_score, v_tier);
  UPDATE public.patients SET risk_score = v_score, risk_tier = v_tier, risk_scored_at = v_at WHERE id = p_patient_id;
  RETURN p_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_risk_assessment(uuid,uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_risk_assessment(uuid,uuid,uuid,text,jsonb) TO authenticated;
REVOKE UPDATE (risk_score, risk_tier, risk_scored_at) ON public.patients FROM PUBLIC, anon, authenticated;
COMMIT;
