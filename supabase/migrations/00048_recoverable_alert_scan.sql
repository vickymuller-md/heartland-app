-- Local staged producer. Do not activate before scoped exceptions, notification
-- intent coupling, cutover and release gates in the N2 contract are complete.
CREATE TABLE public.alert_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot date NOT NULL UNIQUE,
  calendar_timezone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.alert_scan_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.alert_scan_runs(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  capture_status text NOT NULL DEFAULT 'pending' CHECK(capture_status IN ('pending','failed','captured','blocked_scope','missed_capture_window')),
  snapshot jsonb,
  rule_cursor smallint NOT NULL DEFAULT 0 CHECK(rule_cursor BETWEEN 0 AND 6),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  error_code text,
  UNIQUE(run_id,patient_id),
  CHECK((capture_status='captured')=(snapshot IS NOT NULL))
);
CREATE TABLE public.alert_scan_evaluations (
  receipt_id uuid NOT NULL REFERENCES public.alert_scan_patients(id) ON DELETE CASCADE,
  rule text NOT NULL CHECK(rule IN ('no_checkin','low_adherence','weight_trend_7d','hyperkalemia','low_egfr','followup_due','followup_overdue')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','failed','complete','blocked')),
  result jsonb,
  alert_id uuid REFERENCES public.alerts(id) ON DELETE RESTRICT,
  alert_created boolean,
  error_code text,
  prior_item_ids uuid[],
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  processed_at timestamptz,
  PRIMARY KEY(receipt_id,rule),
  CHECK(status NOT IN ('complete','blocked') OR processed_at IS NOT NULL)
);
CREATE TABLE public.alert_scan_drain_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  after_id uuid
);
INSERT INTO public.alert_scan_drain_state(singleton) VALUES(true);
ALTER TABLE public.alert_scan_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_scan_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_scan_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_scan_drain_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alert_scan_runs,public.alert_scan_patients,public.alert_scan_evaluations,public.alert_scan_drain_state
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.alert_scan_runs,public.alert_scan_patients,public.alert_scan_evaluations TO service_role;

CREATE FUNCTION public.require_alert_scan_service()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' OR (SELECT auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Scan service context required';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.require_alert_scan_service() FROM PUBLIC,anon,authenticated,service_role;

-- This is internal detection authority, not an assignee choice or delivery grant.
CREATE FUNCTION public.alert_scan_scope_provider(p_patient uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT link.provider_id FROM public.provider_patient_links AS link
  JOIN public.profiles AS provider ON provider.id=link.provider_id AND provider.role='provider'
  JOIN public.profiles AS target ON target.id=link.patient_id AND target.role='patient'
  JOIN public.patients AS patient ON patient.id=target.id
  WHERE link.patient_id=p_patient AND link.status='active'
    AND EXISTS(SELECT 1 FROM public.consents AS consent WHERE consent.user_id=provider.id
      AND consent.consent_type='registration' AND consent.consent_version='v1.0' AND consent.accepted)
    AND EXISTS(SELECT 1 FROM public.consents AS consent WHERE consent.user_id=target.id
      AND consent.consent_type='registration' AND consent.consent_version='v1.0' AND consent.accepted)
  ORDER BY link.provider_id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.alert_scan_scope_provider(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.lock_alert_scan_scope(p_patient uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_provider uuid;
BEGIN
  PERFORM public.require_alert_scan_service();
  v_provider:=public.alert_scan_scope_provider(p_patient);
  IF v_provider IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Scan scope unavailable'; END IF;
  PERFORM id FROM public.profiles WHERE id IN(p_patient,v_provider) ORDER BY id FOR SHARE;
  PERFORM id FROM public.consents WHERE user_id IN(p_patient,v_provider)
    AND consent_type='registration' AND consent_version='v1.0' AND accepted ORDER BY id FOR SHARE;
  PERFORM id FROM public.patients WHERE id=p_patient FOR KEY SHARE;
  PERFORM id FROM public.provider_patient_links WHERE provider_id=v_provider AND patient_id=p_patient AND status='active' FOR SHARE;
  IF NOT FOUND OR public.alert_scan_scope_provider(p_patient) IS DISTINCT FROM v_provider THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Scan scope unavailable';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_alert_scan_scope(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.protect_alert_scan_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_patient uuid;
BEGIN
  IF TG_OP='DELETE' AND TG_TABLE_NAME<>'alert_scan_runs' THEN
    IF TG_TABLE_NAME='alert_scan_patients' THEN v_patient:=OLD.patient_id;
    ELSE SELECT patient_id INTO v_patient FROM public.alert_scan_patients WHERE id=OLD.receipt_id; END IF;
    IF public.lab_provenance_erasure_active(v_patient) THEN RETURN OLD; END IF;
  END IF;
  IF TG_OP='DELETE' OR TG_TABLE_NAME='alert_scan_runs' THEN RAISE EXCEPTION 'Scan provenance is immutable'; END IF;
  PERFORM public.require_alert_scan_service();
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='alert_scan_patients' THEN
    -- Scheduling metadata can advance without changing immutable captured sources.
    IF (to_jsonb(NEW)-'rule_cursor') IS NOT DISTINCT FROM (to_jsonb(OLD)-'rule_cursor') THEN RETURN NEW; END IF;
    IF (to_jsonb(NEW)-ARRAY['capture_status','snapshot','attempts','error_code']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['capture_status','snapshot','attempts','error_code'])
      OR OLD.snapshot IS NOT NULL OR OLD.capture_status='missed_capture_window' THEN
      RAISE EXCEPTION 'Scan provenance is immutable';
    END IF;
  ELSE
    IF NEW.receipt_id IS DISTINCT FROM OLD.receipt_id OR NEW.rule IS DISTINCT FROM OLD.rule
      OR OLD.status='complete' OR (OLD.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result) THEN
      RAISE EXCEPTION 'Scan provenance is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_alert_scan_provenance() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_alert_scan_run BEFORE UPDATE OR DELETE ON public.alert_scan_runs
  FOR EACH ROW EXECUTE FUNCTION public.protect_alert_scan_provenance();
CREATE TRIGGER protect_alert_scan_patient BEFORE UPDATE OR DELETE ON public.alert_scan_patients
  FOR EACH ROW EXECUTE FUNCTION public.protect_alert_scan_provenance();
CREATE TRIGGER protect_alert_scan_evaluation BEFORE UPDATE OR DELETE ON public.alert_scan_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.protect_alert_scan_provenance();

CREATE FUNCTION public.prepare_alert_scan(p_calendar_timezone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='5s' AS $$
DECLARE v_slot date; v_run public.alert_scan_runs%ROWTYPE; v_participants uuid[];
BEGIN
  PERFORM public.require_alert_scan_service();
  IF p_calendar_timezone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_calendar_timezone) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Unsupported scan calendar';
  END IF;
  -- Recompute after the serialization wait, so a midnight contender cannot open yesterday.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('heartland:alert-scan:prepare',0));
  v_slot:=clock_timestamp()::date;
  SELECT * INTO v_run FROM public.alert_scan_runs WHERE slot=v_slot;
  IF NOT FOUND THEN
    -- Fence target-role changes/erasure before persisting the fixed participant set.
    SELECT array_agg(id ORDER BY id) INTO v_participants FROM (
      SELECT profile.id FROM public.profiles AS profile JOIN public.patients AS patient ON patient.id=profile.id
      WHERE public.alert_scan_scope_provider(patient.id) IS NOT NULL
      ORDER BY profile.id LIMIT 10001 FOR SHARE OF profile) AS eligible;
    IF COALESCE(cardinality(v_participants),0)>10000 THEN
      RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Scan participant limit exceeded';
    END IF;
    v_slot:=clock_timestamp()::date;
    SELECT * INTO v_run FROM public.alert_scan_runs WHERE slot=v_slot;
    IF FOUND THEN
      RETURN jsonb_build_object('run_id',v_run.id,'slot',v_run.slot,'calendar_timezone',v_run.calendar_timezone,
        'patients',(SELECT count(*) FROM public.alert_scan_patients WHERE run_id=v_run.id));
    END IF;
    INSERT INTO public.alert_scan_runs(slot,calendar_timezone) VALUES(v_slot,p_calendar_timezone) RETURNING * INTO v_run;
    INSERT INTO public.alert_scan_patients(run_id,patient_id)
      SELECT v_run.id,patient FROM unnest(v_participants) AS patient
      WHERE public.alert_scan_scope_provider(patient) IS NOT NULL;
    INSERT INTO public.alert_scan_evaluations(receipt_id,rule)
      SELECT participant.id,rule FROM public.alert_scan_patients AS participant
      CROSS JOIN unnest(ARRAY['no_checkin','low_adherence','weight_trend_7d','hyperkalemia','low_egfr','followup_due','followup_overdue']) AS rule
      WHERE participant.run_id=v_run.id;
  END IF;
  RETURN jsonb_build_object('run_id',v_run.id,'slot',v_run.slot,'calendar_timezone',v_run.calendar_timezone,
    'patients',(SELECT count(*) FROM public.alert_scan_patients WHERE run_id=v_run.id));
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_alert_scan(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_alert_scan(text) TO service_role;

CREATE FUNCTION public.capture_alert_scan_patient(p_receipt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='5s' AS $$
DECLARE v_patient uuid; v_row public.alert_scan_patients%ROWTYPE; v_run public.alert_scan_runs%ROWTYPE;
  v_clock timestamptz; v_dates jsonb; v_start date; v_end date; v_snapshot jsonb; v_code text;
BEGIN
  PERFORM public.require_alert_scan_service();
  SELECT patient_id INTO v_patient FROM public.alert_scan_patients WHERE id=p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan receipt unavailable'; END IF;
  -- Profile lock precedes provenance row locks, matching audited tester erasure.
  PERFORM id FROM public.profiles WHERE id=v_patient FOR SHARE;
  SELECT * INTO v_row FROM public.alert_scan_patients WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan receipt unavailable'; END IF;
  BEGIN
    PERFORM public.lock_alert_scan_scope(v_patient);
    IF v_row.snapshot IS NOT NULL THEN
      RETURN jsonb_build_object('receipt_id',v_row.id,'state','captured','snapshot',v_row.snapshot);
    END IF;
    SELECT * INTO STRICT v_run FROM public.alert_scan_runs WHERE id=v_row.run_id;
    v_clock:=clock_timestamp();
    IF v_row.capture_status='missed_capture_window' OR v_clock::date<>v_run.slot THEN
      IF v_row.capture_status<>'missed_capture_window' THEN
        UPDATE public.alert_scan_patients SET capture_status='missed_capture_window',error_code='missed_capture_window',attempts=attempts+1 WHERE id=v_row.id;
      END IF;
      RETURN jsonb_build_object('receipt_id',v_row.id,'state','missed_capture_window');
    END IF;
    v_end:=(v_clock AT TIME ZONE v_run.calendar_timezone)::date; v_start:=v_end-6;
    SELECT jsonb_agg(to_char(v_start+day,'YYYY-MM-DD') ORDER BY day) INTO v_dates FROM generate_series(0,6) AS day;
    -- One SELECT snapshot for every source group. Each bounded subquery reads one extra
    -- row; overflow aborts rather than freezing a silently truncated clinical context.
    SELECT jsonb_build_object('receipt_id',v_row.id,'recipe','proactive-frozen-v1','captured_at',v_clock,
      'calendar_timezone',v_run.calendar_timezone,'calendar_dates',v_dates,'sources',jsonb_build_object(
      'checkin',jsonb_build_object('patient_created_at',patient.created_at,'latest_vital',
        (SELECT jsonb_build_object('id',vital.id,'recorded_at',vital.recorded_at) FROM public.vitals AS vital
          WHERE vital.patient_id=v_patient ORDER BY vital.recorded_at DESC,vital.id LIMIT 1)),
      'weights',COALESCE((SELECT jsonb_agg(to_jsonb(weight) ORDER BY weight.recorded_at,weight.id) FROM (
        SELECT id,weight_lbs,recorded_at FROM public.vitals WHERE patient_id=v_patient
          AND recorded_at>=v_clock-interval '7 days' AND weight_lbs IS NOT NULL ORDER BY recorded_at,id LIMIT 1001) AS weight),'[]'::jsonb),
      'latest_labs',COALESCE((SELECT jsonb_agg(to_jsonb(lab) ORDER BY lab.id) FROM (
        SELECT id,potassium,egfr,collected_at FROM public.lab_results WHERE patient_id=v_patient
          AND collected_at=(SELECT max(collected_at) FROM public.lab_results WHERE patient_id=v_patient) ORDER BY id LIMIT 1001) AS lab),'[]'::jsonb),
      'followups',COALESCE((SELECT jsonb_agg(to_jsonb(followup) ORDER BY followup.scheduled_at,followup.id) FROM (
        SELECT id,scheduled_at,completed FROM public.scheduled_followups WHERE patient_id=v_patient
          AND NOT completed AND scheduled_at>=v_clock-interval '7 days' AND scheduled_at<=v_clock+interval '24 hours'
          ORDER BY scheduled_at,id LIMIT 1001) AS followup),'[]'::jsonb),
      'acute_alerts',COALESCE((SELECT jsonb_agg(to_jsonb(alert) ORDER BY alert.id) FROM (
        SELECT id,flags,status FROM public.alerts WHERE patient_id=v_patient AND status IN ('open','acknowledged') ORDER BY id LIMIT 1001) AS alert),'[]'::jsonb),
      'adherence',jsonb_build_object('medications',COALESCE((SELECT jsonb_agg(to_jsonb(medication) ORDER BY medication.id) FROM (
        SELECT id,frequency FROM public.medications WHERE patient_id=v_patient AND active ORDER BY id LIMIT 1001) AS medication),'[]'::jsonb),
        'logs',COALESCE((SELECT jsonb_agg(to_jsonb(log) ORDER BY log.id) FROM (
        SELECT id,medication_id,scheduled_date,taken FROM public.medication_logs WHERE patient_id=v_patient
          AND scheduled_date>=v_start AND scheduled_date<=v_end ORDER BY id LIMIT 10001) AS log),'[]'::jsonb))))
    INTO v_snapshot FROM public.patients AS patient WHERE patient.id=v_patient;
    IF v_snapshot IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan source unavailable'; END IF;
    IF jsonb_array_length(v_snapshot#>'{sources,weights}')>1000 OR jsonb_array_length(v_snapshot#>'{sources,latest_labs}')>1000
      OR jsonb_array_length(v_snapshot#>'{sources,followups}')>1000 OR jsonb_array_length(v_snapshot#>'{sources,acute_alerts}')>1000
      OR jsonb_array_length(v_snapshot#>'{sources,adherence,medications}')>1000 OR jsonb_array_length(v_snapshot#>'{sources,adherence,logs}')>10000 THEN
      RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Scan source limit exceeded';
    END IF;
    UPDATE public.alert_scan_patients SET capture_status='captured',snapshot=v_snapshot,error_code=NULL,attempts=attempts+1 WHERE id=v_row.id;
    RETURN jsonb_build_object('receipt_id',v_row.id,'state','captured','snapshot',v_snapshot);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code=RETURNED_SQLSTATE;
    IF v_row.snapshot IS NULL AND v_row.capture_status<>'missed_capture_window' THEN
      UPDATE public.alert_scan_patients SET capture_status=CASE WHEN v_code='42501' THEN 'blocked_scope' ELSE 'failed' END,
        error_code=v_code,attempts=attempts+1 WHERE id=v_row.id;
    ELSE
      UPDATE public.alert_scan_evaluations SET status='blocked',error_code='blocked_scope',processed_at=clock_timestamp()
        WHERE receipt_id=v_row.id AND status IN ('pending','failed') AND v_code='42501';
    END IF;
    RETURN jsonb_build_object('receipt_id',v_row.id,'state',CASE WHEN v_code='42501' THEN 'blocked_scope' ELSE 'failed' END,'error_code',v_code);
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_alert_scan_patient(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.capture_alert_scan_patient(uuid) TO service_role;

CREATE FUNCTION public.finalize_alert_scan_rule(p_receipt_id uuid,p_recipe text,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='5s' AS $$
DECLARE v_patient uuid; v_row public.alert_scan_patients%ROWTYPE; v_eval public.alert_scan_evaluations%ROWTYPE;
  v_rule text; v_decision text; v_severity text; v_alert uuid; v_created boolean; v_items uuid[]; v_code text;
  v_sources jsonb; v_allowed uuid[]; v_supplied uuid[];
BEGIN
  PERFORM public.require_alert_scan_service();
  IF p_recipe IS DISTINCT FROM 'proactive-frozen-v1' OR p_result IS NULL OR jsonb_typeof(p_result)<>'object'
    OR NOT p_result ?& ARRAY['receipt_id','rule','decision','severity','reason','source_ids']
    OR p_result-ARRAY['receipt_id','rule','decision','severity','reason','source_ids']<>'{}'::jsonb
    OR p_result->>'receipt_id' IS DISTINCT FROM p_receipt_id::text THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid scan result';
  END IF;
  v_rule:=p_result->>'rule'; v_decision:=p_result->>'decision'; v_severity:=p_result->>'severity';
  IF v_rule IS NULL OR v_rule NOT IN ('no_checkin','low_adherence','weight_trend_7d','hyperkalemia','low_egfr','followup_due','followup_overdue')
    OR v_decision IS NULL OR v_decision NOT IN ('triggered','not_triggered','not_applicable','suppressed','blocked')
    OR jsonb_typeof(p_result->'source_ids')<>'array' OR jsonb_array_length(p_result->'source_ids')>11000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid scan result';
  END IF;
  -- Validate source identities without retaining arbitrary free text in operational records.
  PERFORM value::uuid FROM jsonb_array_elements_text(p_result->'source_ids');
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_result->'source_ids') AS value WHERE jsonb_typeof(value)<>'string')
    OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements_text(p_result->'source_ids') AS value)
    OR (v_decision='triggered' AND (v_severity IS NULL OR NOT CASE v_rule
      WHEN 'no_checkin' THEN v_severity='informational' WHEN 'followup_due' THEN v_severity='informational'
      WHEN 'hyperkalemia' THEN v_severity='critical' WHEN 'low_egfr' THEN v_severity='critical'
      WHEN 'followup_overdue' THEN v_severity IN ('warning','critical') ELSE v_severity='warning' END))
    OR (v_decision<>'triggered' AND v_severity IS NOT NULL)
    OR (v_decision='blocked' AND COALESCE(p_result->>'reason','') NOT IN ('invalid_context','invalid_source','ambiguous_source'))
    OR (v_decision='suppressed' AND (v_rule<>'weight_trend_7d' OR p_result->>'reason' IS DISTINCT FROM 'acute_weight_active'))
    OR (v_decision NOT IN ('blocked','suppressed') AND p_result->>'reason' IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid scan result';
  END IF;
  SELECT patient_id INTO v_patient FROM public.alert_scan_patients WHERE id=p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan receipt unavailable'; END IF;
  PERFORM id FROM public.profiles WHERE id=v_patient FOR SHARE;
  SELECT * INTO v_row FROM public.alert_scan_patients WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND OR v_row.snapshot IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan capture unavailable'; END IF;
  v_sources:=v_row.snapshot->'sources';
  SELECT COALESCE(array_agg(value::uuid),ARRAY[]::uuid[]) INTO v_supplied FROM jsonb_array_elements_text(p_result->'source_ids');
  IF v_rule='no_checkin' THEN
    v_allowed:=CASE WHEN v_sources#>>'{checkin,latest_vital,id}' IS NULL THEN ARRAY[]::uuid[]
      ELSE ARRAY[(v_sources#>>'{checkin,latest_vital,id}')::uuid] END;
  ELSE
    SELECT COALESCE(array_agg((entry->>'id')::uuid),ARRAY[]::uuid[]) INTO v_allowed FROM jsonb_array_elements(
      CASE v_rule WHEN 'hyperkalemia' THEN v_sources->'latest_labs' WHEN 'low_egfr' THEN v_sources->'latest_labs'
      WHEN 'followup_due' THEN v_sources->'followups' WHEN 'followup_overdue' THEN v_sources->'followups'
      WHEN 'weight_trend_7d' THEN CASE WHEN v_decision='suppressed' THEN v_sources->'acute_alerts' ELSE v_sources->'weights' END
      WHEN 'low_adherence' THEN (v_sources#>'{adherence,medications}')||(v_sources#>'{adherence,logs}') END) AS entry;
  END IF;
  IF NOT v_supplied<@v_allowed OR (v_decision='triggered' AND v_rule<>'no_checkin' AND cardinality(v_supplied)=0)
    OR (v_decision='triggered' AND v_rule='weight_trend_7d' AND cardinality(v_supplied)<2) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan source identities do not match capture';
  END IF;
  SELECT * INTO STRICT v_eval FROM public.alert_scan_evaluations WHERE receipt_id=p_receipt_id AND rule=v_rule FOR UPDATE;
  IF v_eval.result IS NOT NULL AND v_eval.result IS DISTINCT FROM p_result THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Scan result differs from frozen evaluation';
  END IF;
  IF v_eval.status='complete' OR (v_eval.status='blocked' AND v_eval.error_code<>'blocked_scope') THEN RETURN to_jsonb(v_eval); END IF;
  BEGIN
    PERFORM public.lock_alert_scan_scope(v_patient);
    IF v_decision='blocked' THEN
      UPDATE public.alert_scan_evaluations SET status='blocked',result=p_result,error_code=p_result->>'reason',
        attempts=attempts+1,processed_at=clock_timestamp() WHERE receipt_id=p_receipt_id AND rule=v_rule RETURNING * INTO v_eval;
      RETURN to_jsonb(v_eval);
    END IF;
    IF v_decision='triggered' THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_patient::text,0));
      SELECT alert.id INTO v_alert FROM public.alerts AS alert WHERE alert.patient_id=v_patient
        AND alert.status IN ('open','acknowledged') AND alert.flags && ARRAY[v_rule]
        ORDER BY alert.last_seen_at DESC,alert.id FOR UPDATE LIMIT 1;
      IF v_alert IS NOT NULL THEN
        PERFORM id FROM public.work_items WHERE source_type='alert' AND source_id=v_alert ORDER BY id FOR UPDATE;
        SELECT array_agg(id ORDER BY id) INTO v_items FROM public.work_items
          WHERE source_type='alert' AND source_id=v_alert AND status='closed';
        -- Persist the signal once even when one organization's work is closed.
        -- 00042 preserves closed items; other organizations' open items still refresh.
        -- Keep per-item routing exceptions separately from completed detection.
      END IF;
      SELECT alert_id,created INTO v_alert,v_created FROM public.coalesce_patient_alert(v_patient,NULL,v_severity,ARRAY[v_rule]);
      IF v_alert IS NULL THEN RAISE EXCEPTION 'Scan alert persistence not confirmed'; END IF;
    END IF;
    UPDATE public.alert_scan_evaluations SET status='complete',result=p_result,alert_id=v_alert,alert_created=v_created,
      error_code=CASE WHEN v_items IS NOT NULL THEN 'needs_episode_adjudication' END,
      prior_item_ids=v_items,attempts=attempts+1,processed_at=clock_timestamp()
      WHERE receipt_id=p_receipt_id AND rule=v_rule RETURNING * INTO v_eval;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code=RETURNED_SQLSTATE;
    UPDATE public.alert_scan_evaluations SET status=CASE WHEN v_code='42501' THEN 'blocked' ELSE 'failed' END,
      result=p_result,error_code=CASE WHEN v_code='42501' THEN 'blocked_scope' ELSE v_code END,
      attempts=attempts+1,processed_at=clock_timestamp()
      WHERE receipt_id=p_receipt_id AND rule=v_rule RETURNING * INTO v_eval;
  END;
  RETURN to_jsonb(v_eval);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_alert_scan_rule(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_alert_scan_rule(uuid,text,jsonb) TO service_role;

-- A persisted circular sweep advances before processing. Response loss may defer
-- a page until the next sweep, but cannot lose its receipts or duplicate effects.
CREATE FUNCTION public.next_alert_scan_page(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='5s' AS $$
DECLARE v_after uuid; v_ids uuid[]; v_last uuid; v_rows jsonb:='[]'::jsonb; v_id uuid; v_row public.alert_scan_patients%ROWTYPE;
  v_rule text; v_index integer; v_rules text[]:=ARRAY['no_checkin','low_adherence','weight_trend_7d','hyperkalemia','low_egfr','followup_due','followup_overdue'];
BEGIN
  PERFORM public.require_alert_scan_service();
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid scan page size'; END IF;
  SELECT after_id INTO v_after FROM public.alert_scan_drain_state WHERE singleton FOR UPDATE;
  FOR round IN 1..2 LOOP
    SELECT array_agg(id ORDER BY id) INTO v_ids FROM (
      SELECT patient.id FROM public.alert_scan_patients AS patient
      WHERE (v_after IS NULL OR patient.id>v_after)
        AND (patient.capture_status IN ('pending','failed') OR (patient.capture_status='captured' AND EXISTS(
          SELECT 1 FROM public.alert_scan_evaluations AS evaluation WHERE evaluation.receipt_id=patient.id AND evaluation.status IN ('pending','failed'))))
      ORDER BY patient.id LIMIT p_limit FOR UPDATE OF patient SKIP LOCKED) AS page;
    EXIT WHEN v_ids IS NOT NULL OR v_after IS NULL;
    v_after:=NULL;
  END LOOP;
  v_last:=v_ids[array_length(v_ids,1)];
  UPDATE public.alert_scan_drain_state SET after_id=v_last WHERE singleton;
  FOREACH v_id IN ARRAY COALESCE(v_ids,ARRAY[]::uuid[]) LOOP
    SELECT * INTO v_row FROM public.alert_scan_patients WHERE id=v_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    SELECT evaluation.rule,position.index INTO v_rule,v_index
      FROM public.alert_scan_evaluations AS evaluation
      JOIN unnest(v_rules) WITH ORDINALITY AS position(rule,index) ON position.rule=evaluation.rule
      WHERE evaluation.receipt_id=v_id AND evaluation.status IN ('pending','failed')
      ORDER BY mod(position.index::integer-1-v_row.rule_cursor+7,7) LIMIT 1;
    CONTINUE WHEN NOT FOUND;
    UPDATE public.alert_scan_patients SET rule_cursor=mod(v_index,7) WHERE id=v_id;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('receipt_id',v_id,'run_id',v_row.run_id,'rule',v_rule));
  END LOOP;
  RETURN jsonb_build_object('receipts',v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.next_alert_scan_page(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.next_alert_scan_page(integer) TO service_role;

CREATE FUNCTION public.alert_scan_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.require_alert_scan_service();
  RETURN jsonb_build_object(
    'patients',(SELECT count(*) FROM public.alert_scan_patients),
    'capture_pending',(SELECT count(*) FROM public.alert_scan_patients WHERE capture_status IN ('pending','failed')),
    'capture_blocked',(SELECT count(*) FROM public.alert_scan_patients WHERE capture_status IN ('blocked_scope','missed_capture_window')),
    'rules_pending',(SELECT count(*) FROM public.alert_scan_evaluations AS evaluation JOIN public.alert_scan_patients AS patient ON patient.id=evaluation.receipt_id
      WHERE patient.capture_status='captured' AND evaluation.status IN ('pending','failed')),
    'rules_blocked',(SELECT count(*) FROM public.alert_scan_evaluations WHERE status='blocked'),
    'routing_exceptions',(SELECT count(*) FROM public.alert_scan_evaluations WHERE prior_item_ids IS NOT NULL),
    'rules_complete',(SELECT count(*) FROM public.alert_scan_evaluations WHERE status='complete'));
END;
$$;
REVOKE ALL ON FUNCTION public.alert_scan_status() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.alert_scan_status() TO service_role;

ALTER TABLE public.lab_provenance_erasures
  ADD COLUMN scan_patients_deleted integer CHECK(scan_patients_deleted IS NULL OR scan_patients_deleted>=0),
  ADD COLUMN scan_evaluations_deleted integer CHECK(scan_evaluations_deleted IS NULL OR scan_evaluations_deleted>=0);
-- An audit-row trigger extends the existing purge without duplicating its body,
-- return signature or counters. It runs after the same tester profile lock/audit.
CREATE FUNCTION public.erase_audited_tester_scan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_patients integer; v_evaluations integer;
BEGIN
  PERFORM public.require_alert_scan_service();
  IF NOT public.lab_provenance_erasure_active(NEW.actor_id) THEN RAISE EXCEPTION 'Scan erasure audit required'; END IF;
  DELETE FROM public.alert_scan_evaluations AS evaluation USING public.alert_scan_patients AS patient
    WHERE evaluation.receipt_id=patient.id AND patient.patient_id=NEW.actor_id;
  GET DIAGNOSTICS v_evaluations=ROW_COUNT;
  DELETE FROM public.alert_scan_patients WHERE patient_id=NEW.actor_id;
  GET DIAGNOSTICS v_patients=ROW_COUNT;
  UPDATE public.lab_provenance_erasures SET scan_patients_deleted=v_patients,scan_evaluations_deleted=v_evaluations WHERE id=NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.erase_audited_tester_scan() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER erase_audited_tester_scan AFTER INSERT ON public.lab_provenance_erasures
  FOR EACH ROW EXECUTE FUNCTION public.erase_audited_tester_scan();
