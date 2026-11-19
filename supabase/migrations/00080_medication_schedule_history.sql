BEGIN;

-- Dated regimen evidence. An unconfirmed historical interval deliberately carries
-- no name, dosage, or frequency. A recorded dose fixes that day's denominator.
-- Review: version history is written only by the source trigger. The API reads
-- under existing medication visibility. Editing and logging lock the same row.
-- Legacy weekly records require explicit weekday confirmation.
ALTER TABLE public.medications ADD COLUMN weekly_day smallint
  CHECK (weekly_day IS NULL OR (weekly_day BETWEEN 0 AND 6 AND COALESCE(lower(btrim(frequency)) = 'weekly', false)));
ALTER TABLE public.medications ADD COLUMN schedule_revision uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.medications ADD COLUMN client_request_id uuid;
CREATE UNIQUE INDEX medication_request_per_patient ON public.medications(patient_id,client_request_id) WHERE client_request_id IS NOT NULL;
GRANT INSERT (weekly_day,client_request_id), UPDATE (weekly_day) ON public.medications TO authenticated;

CREATE FUNCTION public.revise_medication() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF ROW(NEW.name, NEW.dosage, NEW.frequency, NEW.timing, NEW.weekly_day, NEW.active)
    IS DISTINCT FROM ROW(OLD.name, OLD.dosage, OLD.frequency, OLD.timing, OLD.weekly_day, OLD.active) THEN
    NEW.schedule_revision := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.revise_medication() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER revise_medication BEFORE UPDATE ON public.medications FOR EACH ROW EXECUTE FUNCTION public.revise_medication();

CREATE TABLE public.medication_schedule_versions (
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  medication_id uuid NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL,
  starts_on date NOT NULL,
  ends_before date CHECK (ends_before > starts_on),
  known boolean NOT NULL,
  active boolean,
  name text,
  dosage text,
  frequency text,
  timing text,
  weekly_day smallint CHECK (weekly_day BETWEEN 0 AND 6),
  PRIMARY KEY (medication_id, starts_on)
);
CREATE INDEX medication_schedule_history_patient_idx
  ON public.medication_schedule_versions (patient_id, starts_on, ends_before);
ALTER TABLE public.medication_schedule_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.medication_schedule_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.medication_schedule_versions TO authenticated;
CREATE POLICY medication_schedule_visible ON public.medication_schedule_versions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.medications m
    WHERE m.id = medication_schedule_versions.medication_id AND m.patient_id = medication_schedule_versions.patient_id
  ));

CREATE FUNCTION public.medication_calendar_zone_internal(p_patient uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = o.timezone)
      THEN o.timezone ELSE 'America/New_York' END
    FROM public.provider_patient_links l
    JOIN public.organization_memberships m ON m.user_id = l.provider_id AND m.status = 'active' AND m.is_default
    JOIN public.organizations o ON o.id = m.organization_id AND o.status = 'active'
    WHERE l.patient_id = p_patient AND l.status = 'active'
    ORDER BY l.linked_at DESC NULLS LAST, l.created_at DESC, l.id LIMIT 1
  ), 'America/New_York')
$$;
REVOKE ALL ON FUNCTION public.medication_calendar_zone_internal(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_medication_calendar_zone(p_patient uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT COALESCE((auth.uid() = p_patient AND public.get_user_role() = 'patient' AND public.has_registration_consent())
    OR public.provider_has_patient(p_patient), false) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Medication calendar unavailable';
  END IF;
  RETURN public.medication_calendar_zone_internal(p_patient);
END;
$$;
REVOKE ALL ON FUNCTION public.get_medication_calendar_zone(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_medication_calendar_zone(uuid) TO authenticated;

-- Lock source writes during the one-time boundary and preserve old medication logs.
LOCK TABLE public.medications IN SHARE ROW EXCLUSIVE MODE;
WITH initial AS MATERIALIZED (
  SELECT m.*, (statement_timestamp() AT TIME ZONE zone.name)::date boundary,
    COALESCE((m.created_at AT TIME ZONE zone.name)::date, '-infinity'::date) first_day
  FROM public.medications m
  CROSS JOIN LATERAL (SELECT public.medication_calendar_zone_internal(m.patient_id) AS name) zone
)
INSERT INTO public.medication_schedule_versions
  (medication_id,patient_id,starts_on,ends_before,known,active,name,dosage,frequency,timing,weekly_day)
SELECT id,patient_id,first_day,boundary,false,NULL,NULL,NULL,NULL,NULL,NULL
FROM initial WHERE first_day < boundary
UNION ALL
SELECT id,patient_id,greatest(first_day,boundary),NULL,true,active,name,dosage,frequency,timing,weekly_day FROM initial;

CREATE FUNCTION public.capture_medication_schedule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  effective_day date;
  zone text := public.medication_calendar_zone_internal(NEW.patient_id);
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD.name,OLD.dosage,OLD.frequency,OLD.timing,OLD.weekly_day,OLD.active)
    IS NOT DISTINCT FROM ROW(NEW.name,NEW.dosage,NEW.frequency,NEW.timing,NEW.weekly_day,NEW.active) THEN RETURN NEW; END IF;
  effective_day := (statement_timestamp() AT TIME ZONE zone)::date;
  IF TG_OP = 'INSERT' THEN
    effective_day := greatest(effective_day, (NEW.created_at AT TIME ZONE zone)::date);
  ELSIF EXISTS (SELECT 1 FROM public.medication_logs WHERE medication_id = NEW.id AND scheduled_date = effective_day) THEN
    effective_day := effective_day + 1;
  END IF;
  -- Local date can move backwards after a timezone change. Never rewrite an
  -- earlier interval, including a change already scheduled for tomorrow.
  SELECT greatest(effective_day,max(starts_on)) INTO effective_day
  FROM public.medication_schedule_versions WHERE medication_id = NEW.id;
  UPDATE public.medication_schedule_versions SET ends_before = effective_day
    WHERE medication_id = NEW.id AND ends_before IS NULL AND starts_on < effective_day;
  INSERT INTO public.medication_schedule_versions
    (medication_id,patient_id,starts_on,known,active,name,dosage,frequency,timing,weekly_day)
  VALUES (NEW.id,NEW.patient_id,effective_day,true,NEW.active,NEW.name,NEW.dosage,NEW.frequency,NEW.timing,NEW.weekly_day)
  ON CONFLICT (medication_id,starts_on) DO UPDATE SET id=gen_random_uuid(),known=true,
    active=EXCLUDED.active,name=EXCLUDED.name,dosage=EXCLUDED.dosage,frequency=EXCLUDED.frequency,
    timing=EXCLUDED.timing,weekly_day=EXCLUDED.weekly_day;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_medication_schedule() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER capture_medication_schedule AFTER INSERT OR UPDATE ON public.medications
  FOR EACH ROW EXECUTE FUNCTION public.capture_medication_schedule();

CREATE FUNCTION public.medication_dose_slots(p_frequency text,p_weekday smallint,p_day date) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE lower(btrim(p_frequency))
    WHEN 'once_daily' THEN 1 WHEN 'daily' THEN 1 WHEN 'twice_daily' THEN 2
    WHEN 'three_times_daily' THEN 3 WHEN 'four_times_daily' THEN 4 WHEN 'as_needed' THEN 0
    WHEN 'weekly' THEN CASE WHEN p_weekday IS NOT NULL THEN (extract(dow FROM p_day)=p_weekday)::integer END
  END
$$;
REVOKE ALL ON FUNCTION public.medication_dose_slots(text,smallint,date) FROM PUBLIC, anon, authenticated, service_role;

-- Guard the existing raw log writer too. Every writer must acquire the source
-- lock before a concurrent regimen edit may establish its effective date.
CREATE FUNCTION public.validate_medication_dose_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  slots integer;
BEGIN
  IF TG_OP='UPDATE' AND ROW(OLD.medication_id,OLD.patient_id,OLD.scheduled_date,OLD.dose_number)
    IS DISTINCT FROM ROW(NEW.medication_id,NEW.patient_id,NEW.scheduled_date,NEW.dose_number) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Dose identity cannot change';
  END IF;
  PERFORM 1 FROM public.medications WHERE id=NEW.medication_id AND patient_id=NEW.patient_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Medication unavailable'; END IF;
  IF NEW.scheduled_date <> (statement_timestamp() AT TIME ZONE public.medication_calendar_zone_internal(NEW.patient_id))::date THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Reload the current medication day';
  END IF;
  SELECT public.medication_dose_slots(v.frequency,v.weekly_day,NEW.scheduled_date) INTO slots
    FROM public.medication_schedule_versions v WHERE v.medication_id=NEW.medication_id
      AND v.active AND v.known AND v.starts_on<=NEW.scheduled_date
      AND (v.ends_before IS NULL OR v.ends_before>NEW.scheduled_date);
  IF slots IS NULL OR NEW.dose_number NOT BETWEEN 1 AND slots THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Dose is not confirmed for this day';
  END IF;
  IF NOT NEW.taken THEN NEW.taken_at:=NULL;
  ELSIF TG_OP='UPDATE' AND OLD.taken THEN NEW.taken_at:=OLD.taken_at;
  ELSE NEW.taken_at:=statement_timestamp(); END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_medication_dose_write() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER validate_medication_dose_write BEFORE INSERT OR UPDATE ON public.medication_logs
  FOR EACH ROW EXECUTE FUNCTION public.validate_medication_dose_write();

CREATE FUNCTION public.record_medication_dose(p_actor uuid,p_medication uuid,p_version uuid,p_day date,p_slot integer,p_taken boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_actor IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR public.get_user_role() IS DISTINCT FROM 'patient' OR NOT COALESCE(public.has_registration_consent(),false) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Medication session changed';
  END IF;
  PERFORM 1 FROM public.medications WHERE id=p_medication AND patient_id=p_actor FOR UPDATE;
  IF NOT FOUND OR p_taken IS NULL OR p_slot IS NULL OR p_day IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.medication_schedule_versions WHERE id=p_version AND medication_id=p_medication
      AND known AND active AND starts_on<=p_day AND (ends_before IS NULL OR ends_before>p_day)
  ) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Reload the medication schedule'; END IF;
  INSERT INTO public.medication_logs(medication_id,patient_id,scheduled_date,dose_number,taken)
    VALUES (p_medication,p_actor,p_day,p_slot,p_taken)
    ON CONFLICT(medication_id,scheduled_date,dose_number) DO UPDATE SET taken=EXCLUDED.taken
    WHERE medication_logs.taken IS DISTINCT FROM EXCLUDED.taken;
END;
$$;
REVOKE ALL ON FUNCTION public.record_medication_dose(uuid,uuid,uuid,date,integer,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_medication_dose(uuid,uuid,uuid,date,integer,boolean) TO authenticated;

-- Only the patient-day revisions and slot identities are needed for the
-- seven-day signal. Names, dosages and free-text instructions stay out of it.
CREATE FUNCTION public.capture_medication_scan(p_patient uuid,p_clock timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH zone AS (SELECT public.medication_calendar_zone_internal(p_patient) AS tz),
 bounds AS (SELECT tz, (p_clock AT TIME ZONE tz)::date AS last_day FROM zone)
 SELECT jsonb_build_object('mode','dated-v1','calendar_timezone',tz,'calendar_dates',
   (SELECT jsonb_agg(to_char(last_day - i,'YYYY-MM-DD') ORDER BY i DESC) FROM generate_series(0,6) i),
   'medications', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM (
     SELECT id,medication_id,starts_on,ends_before,known,active,weekly_day,
       CASE WHEN lower(btrim(frequency)) IN ('daily','once_daily','twice_daily','three_times_daily','four_times_daily','as_needed','weekly')
         THEN lower(btrim(frequency)) END AS schedule_frequency
     FROM public.medication_schedule_versions WHERE patient_id=p_patient AND starts_on<=last_day
       AND (ends_before IS NULL OR ends_before>last_day-6) ORDER BY id LIMIT 1001
   ) v),'[]'::jsonb),
   'logs', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM (
     SELECT id,medication_id,scheduled_date,dose_number,taken FROM public.medication_logs WHERE patient_id=p_patient
       AND scheduled_date BETWEEN last_day-6 AND last_day ORDER BY id LIMIT 10001
   ) l),'[]'::jsonb)) FROM bounds
$$;
REVOKE ALL ON FUNCTION public.capture_medication_scan(uuid,timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Keep the original capture transaction, terminal records, and authorization checks.
CREATE OR REPLACE FUNCTION public.capture_alert_scan_patient(p_receipt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='5s' AS $$
DECLARE v_patient uuid; v_row public.alert_scan_patients%ROWTYPE; v_run public.alert_scan_runs%ROWTYPE;
  v_clock timestamptz; v_dates jsonb; v_start date; v_end date; v_snapshot jsonb; v_code text;
BEGIN
  PERFORM public.require_alert_scan_service();
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Alert effects require READ COMMITTED';
  END IF;
  SELECT patient_id INTO v_patient FROM public.alert_scan_patients WHERE id=p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan receipt unavailable'; END IF;
  BEGIN
    PERFORM public.begin_alert_effect_scope(v_patient);
    SELECT * INTO v_row FROM public.alert_scan_patients WHERE id=p_receipt_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan receipt unavailable'; END IF;
    IF v_row.snapshot IS NOT NULL THEN
      PERFORM public.end_alert_effect_scope();
      RETURN jsonb_build_object('receipt_id',v_row.id,'state','captured','snapshot',v_row.snapshot);
    END IF;
    SELECT * INTO STRICT v_run FROM public.alert_scan_runs WHERE id=v_row.run_id;
    v_clock:=clock_timestamp();
    IF v_row.capture_status='missed_capture_window' OR v_clock::date<>v_run.slot THEN
      IF v_row.capture_status<>'missed_capture_window' THEN
        UPDATE public.alert_scan_patients SET capture_status='missed_capture_window',error_code='missed_capture_window',attempts=attempts+1 WHERE id=v_row.id;
      END IF;
      PERFORM public.end_alert_effect_scope();
      RETURN jsonb_build_object('receipt_id',v_row.id,'state','missed_capture_window');
    END IF;
    v_end:=(v_clock AT TIME ZONE v_run.calendar_timezone)::date; v_start:=v_end-6;
    SELECT jsonb_agg(to_char(v_start+day,'YYYY-MM-DD') ORDER BY day) INTO v_dates FROM generate_series(0,6) AS day;
    -- One SELECT snapshot for every source group. Each bounded subquery reads one extra
    -- row; overflow aborts rather than freezing a silently truncated clinical context.
    SELECT jsonb_build_object('receipt_id',v_row.id,'recipe','proactive-frozen-v2','patient_id',v_patient,'captured_at',v_clock,
      'calendar_timezone',v_run.calendar_timezone,'calendar_dates',v_dates,'sources',jsonb_build_object(
      'checkin',jsonb_build_object('patient_created_at',patient.created_at,'latest_vital',
        (SELECT jsonb_build_object('id',vital.id,'recorded_at',vital.recorded_at) FROM public.vitals AS vital
          WHERE vital.patient_id=v_patient ORDER BY vital.recorded_at DESC,vital.id LIMIT 1)),
      'weights',COALESCE((SELECT jsonb_agg(to_jsonb(weight) ORDER BY weight.recorded_at,weight.id) FROM (
        SELECT id,weight_lbs,recorded_at FROM public.vitals WHERE patient_id=v_patient
          AND recorded_at>=v_clock-interval '7 days' AND weight_lbs IS NOT NULL ORDER BY recorded_at,id LIMIT 1001) AS weight),'[]'::jsonb),
      'effective_labs',public.capture_effective_scan_labs(v_patient),
      'followups',COALESCE((SELECT jsonb_agg(to_jsonb(followup) ORDER BY followup.scheduled_at,followup.id) FROM (
        SELECT id,scheduled_at,completed FROM public.scheduled_followups WHERE patient_id=v_patient
          AND NOT completed AND scheduled_at>=v_clock-interval '7 days' AND scheduled_at<=v_clock+interval '24 hours'
          ORDER BY scheduled_at,id LIMIT 1001) AS followup),'[]'::jsonb),
      'acute_alerts',COALESCE((SELECT jsonb_agg(to_jsonb(alert) ORDER BY alert.id) FROM (
        SELECT id,flags,status FROM public.alerts WHERE patient_id=v_patient AND status IN ('open','acknowledged') ORDER BY id LIMIT 1001) AS alert),'[]'::jsonb),
      'adherence',public.capture_medication_scan(v_patient,v_clock)))
    INTO v_snapshot FROM public.patients AS patient WHERE patient.id=v_patient;
    IF v_snapshot IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan source unavailable'; END IF;
    IF jsonb_array_length(v_snapshot#>'{sources,weights}')>1000 OR jsonb_array_length(v_snapshot#>'{sources,effective_labs,potassium}')>1000 OR jsonb_array_length(v_snapshot#>'{sources,effective_labs,egfr}')>1000
      OR jsonb_array_length(v_snapshot#>'{sources,followups}')>1000 OR jsonb_array_length(v_snapshot#>'{sources,acute_alerts}')>1000
      OR jsonb_array_length(v_snapshot#>'{sources,adherence,medications}')>1000 OR jsonb_array_length(v_snapshot#>'{sources,adherence,logs}')>10000 THEN
      RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Scan source limit exceeded';
    END IF;
    UPDATE public.alert_scan_patients SET capture_status='captured',snapshot=v_snapshot,error_code=NULL,attempts=attempts+1 WHERE id=v_row.id;
    PERFORM public.end_alert_effect_scope();
    RETURN jsonb_build_object('receipt_id',v_row.id,'state','captured','snapshot',v_snapshot);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code=RETURNED_SQLSTATE;
    -- Scope locks/context rolled back; re-read before recording the failed attempt.
    PERFORM id FROM public.profiles WHERE id=v_patient FOR SHARE;
    SELECT * INTO v_row FROM public.alert_scan_patients WHERE id=p_receipt_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan receipt unavailable'; END IF;
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


CREATE OR REPLACE FUNCTION public.finalize_alert_scan_rule(p_receipt_id uuid,p_recipe text,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='5s' AS $$
DECLARE v_patient uuid; v_row public.alert_scan_patients%ROWTYPE; v_eval public.alert_scan_evaluations%ROWTYPE;
 v_rule text; v_decision text; v_severity text; v_alert uuid; v_created boolean; v_items uuid[]; v_code text;
 v_sources jsonb; v_allowed uuid[]; v_supplied uuid[]; v_retired_source boolean; v_valid boolean:=true; v_analyte text;
BEGIN
 PERFORM public.require_alert_scan_service();
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Alert effects require READ COMMITTED';
 END IF;
  IF (p_recipe IS NULL OR p_recipe NOT IN ('proactive-frozen-v1','proactive-frozen-v2')) OR p_result IS NULL OR jsonb_typeof(p_result)<>'object'
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
    OR (v_decision='blocked' AND COALESCE(p_result->>'reason','') NOT IN ('invalid_context','invalid_source','ambiguous_source','cancelled_source','legacy_recipe'))
    OR (v_decision='suppressed' AND (v_rule<>'weight_trend_7d' OR p_result->>'reason' IS DISTINCT FROM 'acute_weight_active'))
    OR (v_decision NOT IN ('blocked','suppressed') AND p_result->>'reason' IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid scan result';
  END IF;

 SELECT * INTO v_row FROM public.alert_scan_patients WHERE id=p_receipt_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan receipt unavailable'; END IF;
 IF v_row.snapshot IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan capture unavailable'; END IF;
 IF v_row.snapshot->>'recipe' IS DISTINCT FROM p_recipe THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan recipe does not match capture';
 END IF;
 v_patient:=v_row.patient_id; v_sources:=v_row.snapshot->'sources';
 v_analyte:=CASE v_rule WHEN 'hyperkalemia' THEN 'potassium' WHEN 'low_egfr' THEN 'egfr' END;
 v_retired_source:=(p_recipe='proactive-frozen-v1' AND v_analyte IS NOT NULL)
   OR (v_rule='low_adherence' AND (v_sources#>>'{adherence,mode}') IS DISTINCT FROM 'dated-v1');
 IF p_recipe='proactive-frozen-v2' AND v_row.snapshot->>'patient_id' IS DISTINCT FROM v_patient::text THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan patient does not match capture';
 END IF;
 SELECT * INTO STRICT v_eval FROM public.alert_scan_evaluations WHERE receipt_id=p_receipt_id AND rule=v_rule;
 -- No effects/scope widening on terminal readback or legacy retirement.
 IF v_retired_source OR v_eval.status='complete' OR (v_eval.status='blocked' AND v_eval.error_code<>'blocked_scope') THEN
  PERFORM id FROM public.profiles WHERE id=v_patient FOR SHARE;
  PERFORM id FROM public.alert_scan_patients WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan receipt unavailable'; END IF;
  SELECT * INTO STRICT v_eval FROM public.alert_scan_evaluations WHERE receipt_id=p_receipt_id AND rule=v_rule FOR UPDATE;
  IF v_retired_source THEN
   IF v_eval.status='complete' OR (v_eval.status='blocked' AND v_eval.error_code<>'blocked_scope') THEN RETURN to_jsonb(v_eval); END IF;
   UPDATE public.alert_scan_evaluations SET status='blocked',result=COALESCE(result,p_result),error_code='legacy_recipe',
    attempts=attempts+1,processed_at=clock_timestamp() WHERE receipt_id=p_receipt_id AND rule=v_rule RETURNING * INTO v_eval;
   RETURN to_jsonb(v_eval);
  END IF;
  IF v_eval.result IS NOT NULL AND v_eval.result IS DISTINCT FROM p_result THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Scan result differs from frozen evaluation';
  END IF;
  RETURN to_jsonb(v_eval);
 END IF;
 SELECT COALESCE(array_agg(value::uuid),ARRAY[]::uuid[]) INTO v_supplied FROM jsonb_array_elements_text(p_result->'source_ids');
 IF v_rule='no_checkin' THEN
  v_allowed:=CASE WHEN v_sources#>>'{checkin,latest_vital,id}' IS NULL THEN ARRAY[]::uuid[]
   ELSE ARRAY[(v_sources#>>'{checkin,latest_vital,id}')::uuid] END;
 ELSIF v_analyte IS NOT NULL THEN
  SELECT COALESCE(array_agg(COALESCE(entry->>'version_id',entry->>'original_lab_result_id')::uuid),ARRAY[]::uuid[])
   INTO v_allowed FROM jsonb_array_elements(v_sources->'effective_labs'->v_analyte) entry;
 ELSE
  SELECT COALESCE(array_agg((entry->>'id')::uuid),ARRAY[]::uuid[]) INTO v_allowed FROM jsonb_array_elements(
   CASE v_rule WHEN 'followup_due' THEN v_sources->'followups' WHEN 'followup_overdue' THEN v_sources->'followups'
   WHEN 'weight_trend_7d' THEN CASE WHEN v_decision='suppressed' THEN v_sources->'acute_alerts' ELSE v_sources->'weights' END
   WHEN 'low_adherence' THEN (v_sources#>'{adherence,medications}')||(v_sources#>'{adherence,logs}') END) entry;
 END IF;
 IF NOT v_supplied<@v_allowed OR (v_decision='triggered' AND v_rule<>'no_checkin' AND cardinality(v_supplied)=0)
  OR (v_decision='triggered' AND v_rule='weight_trend_7d' AND cardinality(v_supplied)<2) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan source identities do not match capture';
 END IF;
 BEGIN
  PERFORM public.begin_alert_effect_scope(v_patient);
  IF v_analyte IS NOT NULL THEN
   v_valid:=public.lock_and_verify_scan_labs(v_patient,v_analyte,v_sources->'effective_labs'->v_analyte);
  END IF;
  PERFORM id FROM public.alert_scan_patients WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan receipt unavailable'; END IF;
  SELECT * INTO STRICT v_eval FROM public.alert_scan_evaluations WHERE receipt_id=p_receipt_id AND rule=v_rule FOR UPDATE;
  IF v_eval.result IS NOT NULL AND v_eval.result IS DISTINCT FROM p_result THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Scan result differs from frozen evaluation';
  END IF;
  IF v_eval.status='complete' OR (v_eval.status='blocked' AND v_eval.error_code<>'blocked_scope') THEN
   PERFORM public.end_alert_effect_scope(); RETURN to_jsonb(v_eval);
  END IF;
  IF NOT v_valid OR v_decision='blocked' THEN
   UPDATE public.alert_scan_evaluations SET status='blocked',result=COALESCE(result,p_result),
    error_code=CASE WHEN NOT v_valid THEN 'source_changed' ELSE p_result->>'reason' END,
    attempts=attempts+1,processed_at=clock_timestamp() WHERE receipt_id=p_receipt_id AND rule=v_rule RETURNING * INTO v_eval;
   PERFORM public.end_alert_effect_scope(); RETURN to_jsonb(v_eval);
  END IF;
  IF v_decision='triggered' THEN
   PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_patient::text,0));
   SELECT alert.id INTO v_alert FROM public.alerts alert WHERE alert.patient_id=v_patient
    AND alert.status IN ('open','acknowledged') AND alert.flags && ARRAY[v_rule]
    ORDER BY alert.last_seen_at DESC,alert.id FOR UPDATE LIMIT 1;
   IF v_alert IS NOT NULL THEN
    PERFORM id FROM public.work_items WHERE source_type='alert' AND source_id=v_alert ORDER BY id FOR UPDATE;
    SELECT array_agg(id ORDER BY id) INTO v_items FROM public.work_items WHERE source_type='alert' AND source_id=v_alert AND status='closed';
   END IF;
   SELECT alert_id,created INTO v_alert,v_created FROM public.coalesce_fenced_patient_alert(v_patient,v_severity,ARRAY[v_rule]);
   IF v_alert IS NULL THEN RAISE EXCEPTION 'Scan alert persistence not confirmed'; END IF;
  END IF;
  UPDATE public.alert_scan_evaluations SET status='complete',result=p_result,alert_id=v_alert,alert_created=v_created,
   error_code=CASE WHEN v_items IS NOT NULL THEN 'needs_episode_adjudication' END,
   prior_item_ids=v_items,attempts=attempts+1,processed_at=clock_timestamp()
   WHERE receipt_id=p_receipt_id AND rule=v_rule RETURNING * INTO v_eval;
  PERFORM public.end_alert_effect_scope();
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_code=RETURNED_SQLSTATE;
  -- All processing locks/context rolled back. A concurrent success must win over
  -- our failed attempt; never replace its result or reapply its effects.
  PERFORM id FROM public.profiles WHERE id=v_patient FOR SHARE;
  PERFORM id FROM public.alert_scan_patients WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan receipt unavailable'; END IF;
  SELECT * INTO STRICT v_eval FROM public.alert_scan_evaluations WHERE receipt_id=p_receipt_id AND rule=v_rule FOR UPDATE;
  IF v_eval.result IS NOT NULL AND v_eval.result IS DISTINCT FROM p_result THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Scan result differs from frozen evaluation';
  END IF;
  IF v_eval.status='complete' OR (v_eval.status='blocked' AND v_eval.error_code<>'blocked_scope') THEN RETURN to_jsonb(v_eval); END IF;
  UPDATE public.alert_scan_evaluations SET status=CASE WHEN v_code='42501' THEN 'blocked' ELSE 'failed' END,
   result=COALESCE(result,p_result),error_code=CASE WHEN v_code='42501' THEN 'blocked_scope' ELSE v_code END,
   attempts=attempts+1,processed_at=clock_timestamp()
   WHERE receipt_id=p_receipt_id AND rule=v_rule RETURNING * INTO v_eval;
 END;
 RETURN to_jsonb(v_eval);
END $$;
REVOKE ALL ON FUNCTION public.finalize_alert_scan_rule(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_alert_scan_rule(uuid,text,jsonb) TO service_role;

-- Share the same dated slot definition across the portfolio. Every contributing
-- patient already has a visible direct link to the requesting provider.
CREATE FUNCTION public.get_provider_scheduled_adherence() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH calendar AS MATERIALIZED (
    SELECT DISTINCT l.patient_id,
      (statement_timestamp() AT TIME ZONE public.medication_calendar_zone_internal(l.patient_id))::date AS last_day
    FROM public.provider_patient_links l
    WHERE l.provider_id=auth.uid() AND l.status='active' AND public.provider_has_patient(l.patient_id)
  ), slots AS MATERIALIZED (
    SELECT s.medication_id, c.last_day - i AS day,
      CASE WHEN NOT s.known OR s.active IS NULL THEN NULL WHEN NOT s.active THEN 0
        ELSE public.medication_dose_slots(s.frequency,s.weekly_day,c.last_day-i) END AS expected
    FROM calendar c CROSS JOIN generate_series(0,6) i
    JOIN public.medication_schedule_versions s ON s.patient_id=c.patient_id AND s.starts_on<=c.last_day-i
      AND (s.ends_before IS NULL OR s.ends_before>c.last_day-i)
  ), logged AS (
    SELECT l.id, s.expected IS NOT NULL AND l.dose_number BETWEEN 1 AND s.expected AS confirmed
    FROM calendar c JOIN public.medication_logs l ON l.patient_id=c.patient_id
      AND l.scheduled_date BETWEEN c.last_day-6 AND c.last_day AND l.taken
    LEFT JOIN slots s ON s.medication_id=l.medication_id AND s.day=l.scheduled_date
  )
  SELECT CASE WHEN EXISTS(SELECT 1 FROM slots WHERE expected IS NULL)
    OR EXISTS(SELECT 1 FROM logged WHERE NOT confirmed) THEN NULL
    ELSE round(100.0 * (SELECT count(*) FROM logged) / nullif((SELECT sum(expected) FROM slots),0))::integer END
$$;
REVOKE ALL ON FUNCTION public.get_provider_scheduled_adherence() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_provider_scheduled_adherence() TO authenticated;

-- Reconcile a confirmed provider selection with the active list in one transaction.
-- Existing entries are never edited by the provider writer. Each selection carries
-- a patient- and provider-bound request identity to survive a lost acknowledgement.
CREATE TABLE public.gdmt_medication_receipts (
  id uuid PRIMARY KEY,
  medication_id uuid NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  schedule_revision uuid NOT NULL,
  instruction_hash bytea NOT NULL CHECK (octet_length(instruction_hash)=32),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.gdmt_medication_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gdmt_medication_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_gdmt_medications(p_actor uuid,p_patient uuid,p_selections jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE item jsonb; receipt uuid; saved public.medications%ROWTYPE;
  prior public.gdmt_medication_receipts%ROWTYPE; instruction_hash bytea;
  med_name text; med_dose text; med_frequency text; added integer:=0; already_listed integer:=0;
BEGIN
  IF p_actor IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR public.provider_aal2() IS NOT TRUE THEN
    RAISE EXCEPTION 'Provider session unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.provider_patient_links WHERE provider_id=p_actor AND patient_id=p_patient AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient link unavailable' USING ERRCODE='42501'; END IF;
  IF p_selections IS NULL OR jsonb_typeof(p_selections)<>'array' THEN RAISE EXCEPTION 'Invalid selection' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_selections) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Invalid selection' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gdmt medications/'||p_patient::text,0));
  FOR item IN SELECT value FROM jsonb_array_elements(p_selections) LOOP
    IF jsonb_typeof(item)<>'object' OR NOT item ?& ARRAY['request_id','name','dosage','frequency']
       OR item-ARRAY['request_id','name','dosage','frequency']<>'{}'::jsonb
       OR jsonb_typeof(item->'name')<>'string' OR jsonb_typeof(item->'dosage')<>'string'
       OR jsonb_typeof(item->'frequency')<>'string' OR jsonb_typeof(item->'request_id')<>'string' THEN
      RAISE EXCEPTION 'Invalid medication instruction' USING ERRCODE='22023';
    END IF;
    med_name:=btrim(item->>'name'); med_dose:=btrim(item->>'dosage'); med_frequency:=lower(btrim(item->>'frequency'));
    IF length(med_name) NOT BETWEEN 1 AND 200 OR med_name ~* '[[:space:]]or[[:space:]]'
       OR length(med_dose) NOT BETWEEN 1 AND 100 OR med_frequency NOT IN ('daily','once_daily','twice_daily','three_times_daily','four_times_daily','as_needed','as directed') THEN
      RAISE EXCEPTION 'Confirm one medication and its recorded instructions' USING ERRCODE='22023';
    END IF;
    IF med_frequency='daily' THEN med_frequency:='once_daily'; END IF;
    receipt:=md5(p_actor::text||'/'||p_patient::text||'/'||(item->>'request_id')::uuid::text)::uuid;
    instruction_hash:=sha256(convert_to(jsonb_build_array(med_name,med_dose,med_frequency)::text,'UTF8'));
    SELECT * INTO prior FROM public.gdmt_medication_receipts WHERE id=receipt;
    IF FOUND THEN
      SELECT * INTO saved FROM public.medications WHERE patient_id=p_patient AND id=prior.medication_id FOR SHARE;
      IF NOT FOUND OR NOT saved.active OR saved.schedule_revision IS DISTINCT FROM prior.schedule_revision
         OR prior.instruction_hash IS DISTINCT FROM instruction_hash THEN
        RAISE EXCEPTION 'Medication changed after the earlier save' USING ERRCODE='22023';
      END IF;
      already_listed:=already_listed+1;
      CONTINUE;
    END IF;
    SELECT * INTO saved FROM public.medications WHERE patient_id=p_patient AND active IS TRUE AND lower(btrim(name))=lower(med_name)
      ORDER BY created_at,id LIMIT 1 FOR SHARE;
    IF FOUND THEN
      already_listed:=already_listed+1;
    ELSE
      INSERT INTO public.medications(patient_id,name,dosage,frequency,timing,active,client_request_id)
        VALUES(p_patient,med_name,med_dose,med_frequency,NULL,true,receipt) RETURNING * INTO saved;
      added:=added+1;
    END IF;
    INSERT INTO public.gdmt_medication_receipts(id,medication_id,schedule_revision,instruction_hash)
      VALUES(receipt,saved.id,saved.schedule_revision,instruction_hash);
  END LOOP;
  RETURN jsonb_build_object('added',added,'existing',already_listed);
END;
$$;
REVOKE ALL ON FUNCTION public.record_gdmt_medications(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_gdmt_medications(uuid,uuid,jsonb) TO authenticated;

COMMIT;
