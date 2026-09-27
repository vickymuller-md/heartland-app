-- Frozen-source evaluation receipt. No clinical threshold or notification delivery claim.
-- Deploy only with the integrated consumers; 00044 remains the atomic capture primitive.
CREATE TABLE public.vitals_submission_evaluations (
  request_id uuid PRIMARY KEY REFERENCES public.vitals_submission_receipts(request_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'failed', 'complete')),
  rule_version text,
  flags text[],
  alert_id uuid REFERENCES public.alerts(id) ON DELETE RESTRICT,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code text,
  evaluated_at timestamptz,
  CHECK ((status = 'complete') = (flags IS NOT NULL AND rule_version IS NOT NULL AND evaluated_at IS NOT NULL)),
  CHECK (status <> 'complete' OR ((cardinality(flags) = 0) = (alert_id IS NULL)))
);
ALTER TABLE public.vitals_submission_evaluations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vitals_submission_evaluations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.vitals_submission_evaluations TO authenticated, service_role;
CREATE POLICY vitals_evaluation_actor_read ON public.vitals_submission_evaluations
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.vitals_submission_attempts AS attempt
    WHERE attempt.request_id = vitals_submission_evaluations.request_id
      AND attempt.actor_id = (SELECT auth.uid()) AND public.can_access_vitals_submission(attempt.patient_id)));

CREATE FUNCTION public.create_vitals_submission_evaluation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.vitals_submission_evaluations(request_id) VALUES (NEW.request_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.create_vitals_submission_evaluation() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER create_vitals_submission_evaluation AFTER INSERT ON public.vitals_submission_receipts
  FOR EACH ROW EXECUTE FUNCTION public.create_vitals_submission_evaluation();
-- Only existing capture receipts receive pending processing records. No observations are classified.
INSERT INTO public.vitals_submission_evaluations(request_id) SELECT request_id FROM public.vitals_submission_receipts;

CREATE OR REPLACE FUNCTION public.vitals_submission_snapshot(p_actor uuid, p_patient_id uuid, p_request_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $$
  SELECT jsonb_build_object(
    'request_id', attempt.request_id,
    'submission_status', COALESCE(attempt.closed_status, CASE WHEN receipt.request_id IS NULL THEN 'prepared' ELSE 'committed' END),
    'vitals_id', receipt.vitals_id, 'symptoms_id', receipt.symptoms_id,
    'evaluation_status', evaluation.status,
    'red_flag_ids', evaluation.flags,
    'alert_id', evaluation.alert_id,
    'rule_version', evaluation.rule_version,
    'observation', receipt.observation, 'captured_at', receipt.captured_at)
  FROM public.vitals_submission_attempts AS attempt
  LEFT JOIN public.vitals_submission_receipts AS receipt USING (request_id)
  LEFT JOIN public.vitals_submission_evaluations AS evaluation USING (request_id)
  WHERE attempt.actor_id = p_actor AND attempt.patient_id = p_patient_id AND attempt.request_id = p_request_id
$$;

-- Raw capture values cannot drift while a retry evaluates the frozen snapshot.
CREATE FUNCTION public.protect_receipted_vitals_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request uuid; v_flags text[];
BEGIN
  IF TG_TABLE_NAME = 'vitals' THEN
    SELECT request_id INTO v_request FROM public.vitals_submission_receipts WHERE vitals_id = OLD.id;
  ELSE
    SELECT request_id INTO v_request FROM public.vitals_submission_receipts WHERE symptoms_id = OLD.id;
  END IF;
  IF v_request IS NULL OR NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'symptoms' AND (SELECT auth.role()) = 'service_role' AND (SELECT auth.uid()) IS NULL
    AND (to_jsonb(NEW) - 'red_flag') = (to_jsonb(OLD) - 'red_flag') THEN
    SELECT flags INTO v_flags FROM public.vitals_submission_evaluations
      WHERE request_id = v_request AND status = 'complete';
    IF FOUND AND NEW.red_flag IS NOT DISTINCT FROM (cardinality(v_flags) > 0) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Receipted observations are immutable';
END;
$$;
REVOKE ALL ON FUNCTION public.protect_receipted_vitals_source() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER protect_receipted_vitals_source BEFORE UPDATE ON public.vitals
  FOR EACH ROW EXECUTE FUNCTION public.protect_receipted_vitals_source();
CREATE TRIGGER protect_receipted_symptoms_source BEFORE UPDATE ON public.symptoms
  FOR EACH ROW EXECUTE FUNCTION public.protect_receipted_vitals_source();

-- Called only by the authenticated server workflow after reading the actor-owned
-- receipt and running the versioned engine. Never expose flags as a browser RPC.
CREATE FUNCTION public.vitals_evaluation_rule_version(p_request_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT 'vitals-frozen-individual-v1'::text
$$;
REVOKE ALL ON FUNCTION public.vitals_evaluation_rule_version(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.finalize_vitals_submission_evaluation(p_request_id uuid, p_actor_id uuid,
  p_rule_version text, p_flags text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' SET lock_timeout = '5s' AS $$
DECLARE
  v_attempt public.vitals_submission_attempts%ROWTYPE;
  v_receipt public.vitals_submission_receipts%ROWTYPE;
  v_evaluation public.vitals_submission_evaluations%ROWTYPE;
  v_role text; v_target_role text; v_flags text[]; v_alert_flags text[]; v_alert uuid;
  v_source jsonb; v_symptoms jsonb; v_error_code text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' OR (SELECT auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Vitals evaluation not authorized';
  END IF;
  SELECT * INTO v_attempt FROM public.vitals_submission_attempts
    WHERE request_id = p_request_id AND actor_id = p_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Vitals evaluation not authorized'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'heartland:vitals-submission:' || p_actor_id::text || ':' || v_attempt.patient_id::text, 0));
  PERFORM profile.id FROM public.profiles AS profile WHERE profile.id IN (p_actor_id, v_attempt.patient_id)
    ORDER BY profile.id FOR SHARE;
  SELECT role INTO v_role FROM public.profiles WHERE id = p_actor_id;
  SELECT role INTO v_target_role FROM public.profiles WHERE id = v_attempt.patient_id;
  IF v_target_role IS DISTINCT FROM 'patient'
    OR NOT COALESCE(v_role = 'provider' OR (v_role = 'patient' AND p_actor_id = v_attempt.patient_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Vitals evaluation not authorized';
  END IF;
  PERFORM 1 FROM public.consents WHERE user_id = p_actor_id AND consent_type = 'registration'
    AND consent_version = 'v1.0' AND accepted = true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Vitals evaluation not authorized'; END IF;
  IF v_role = 'provider' THEN
    PERFORM 1 FROM public.provider_patient_links WHERE provider_id = p_actor_id
      AND patient_id = v_attempt.patient_id AND status = 'active' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Vitals evaluation not authorized'; END IF;
  END IF;
  IF p_rule_version IS DISTINCT FROM public.vitals_evaluation_rule_version(p_request_id) OR p_flags IS NULL
    OR array_position(p_flags, NULL) IS NOT NULL
    OR NOT p_flags <@ ARRAY['weight_gain_3lb_2d','weight_gain_5lb_7d','sbp_low_symptomatic','spo2_low','dyspnea_rest']::text[] THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid vitals evaluation';
  END IF;
  SELECT COALESCE(array_agg(flag ORDER BY flag), ARRAY[]::text[]) INTO v_flags
    FROM (SELECT DISTINCT unnest(p_flags) AS flag) AS unique_flags;
  SELECT * INTO v_receipt FROM public.vitals_submission_receipts WHERE request_id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Vitals receipt not found'; END IF;
  SELECT * INTO v_evaluation FROM public.vitals_submission_evaluations WHERE request_id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Vitals evaluation not found'; END IF;
  IF v_evaluation.status = 'complete' THEN
    IF v_evaluation.flags IS DISTINCT FROM v_flags OR v_evaluation.rule_version IS DISTINCT FROM p_rule_version THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Vitals evaluation differs';
    END IF;
    RETURN to_jsonb(v_evaluation);
  END IF;
  BEGIN
    SELECT to_jsonb(vital) INTO v_source FROM public.vitals AS vital WHERE id = v_receipt.vitals_id FOR SHARE;
    SELECT to_jsonb(symptom) INTO v_symptoms FROM public.symptoms AS symptom WHERE id = v_receipt.symptoms_id FOR UPDATE;
    IF v_source IS DISTINCT FROM v_receipt.observation->'vitals'
      OR v_symptoms IS DISTINCT FROM v_receipt.observation->'symptoms' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Vitals source differs from capture';
    END IF;
    IF cardinality(v_flags) > 0 THEN
      SELECT array_agg(CASE flag WHEN 'sbp_low_symptomatic' THEN 'sbp_low'
        WHEN 'dyspnea_rest' THEN 'dyspnea_severe' ELSE flag END ORDER BY flag)
        INTO v_alert_flags FROM unnest(v_flags) AS flag;
      SELECT alert_id INTO v_alert FROM public.coalesce_patient_alert(v_attempt.patient_id, v_receipt.vitals_id,
        CASE WHEN v_flags = ARRAY['weight_gain_3lb_2d']::text[] THEN 'warning' ELSE 'critical' END, v_alert_flags);
      IF v_alert IS NULL THEN RAISE EXCEPTION 'Alert persistence not confirmed'; END IF;
    END IF;
    UPDATE public.vitals_submission_evaluations SET status = 'complete', rule_version = p_rule_version,
      flags = v_flags, alert_id = v_alert, attempts = attempts + 1, last_error_code = NULL,
      evaluated_at = clock_timestamp() WHERE request_id = p_request_id RETURNING * INTO v_evaluation;
    UPDATE public.symptoms SET red_flag = cardinality(v_flags) > 0 WHERE id = v_receipt.symptoms_id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_code = RETURNED_SQLSTATE;
    UPDATE public.vitals_submission_evaluations SET status = 'failed', attempts = attempts + 1,
      last_error_code = v_error_code WHERE request_id = p_request_id RETURNING * INTO v_evaluation;
  END;
  RETURN to_jsonb(v_evaluation);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_vitals_submission_evaluation(uuid,uuid,text,text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_vitals_submission_evaluation(uuid,uuid,text,text[]) TO service_role;
COMMENT ON TABLE public.vitals_submission_evaluations IS
  'Recoverable frozen-source rule evaluation. Alert persistence is not notification delivery, acknowledgement or clinical review.';

-- Client acknowledgement frees capture, not unresolved evaluation. Keep those
-- receipts discoverable after reload, with bounded pagination and a true total.
CREATE FUNCTION public.list_pending_vitals_submissions(p_patient_id uuid, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' SET lock_timeout = '5s' AS $$
DECLARE v_actor uuid; v_total integer; v_rows jsonb;
BEGIN
  v_actor := public.lock_vitals_submission_scope(p_patient_id);
  IF p_offset IS NULL OR p_offset < 0 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid pending page'; END IF;
  SELECT count(*) INTO v_total FROM public.vitals_submission_attempts AS attempt
    JOIN public.vitals_submission_evaluations AS evaluation USING(request_id)
    WHERE attempt.actor_id=v_actor AND attempt.patient_id=p_patient_id
      AND attempt.closed_status='acknowledged' AND evaluation.status <> 'complete';
  SELECT COALESCE(jsonb_agg(public.vitals_submission_snapshot(v_actor,p_patient_id,pending.request_id)
    ORDER BY pending.created_at,pending.request_id),'[]'::jsonb) INTO v_rows FROM (
      SELECT attempt.request_id,attempt.created_at FROM public.vitals_submission_attempts AS attempt
      JOIN public.vitals_submission_evaluations AS evaluation USING(request_id)
      WHERE attempt.actor_id=v_actor AND attempt.patient_id=p_patient_id
        AND attempt.closed_status='acknowledged' AND evaluation.status <> 'complete'
      ORDER BY attempt.created_at,attempt.request_id LIMIT 20 OFFSET p_offset
    ) AS pending;
  RETURN jsonb_build_object('total',v_total,'receipts',v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.list_pending_vitals_submissions(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_pending_vitals_submissions(uuid,integer) TO authenticated;
