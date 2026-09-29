-- Effective-source scanner cutover. No activation or immediate outbox cutover implied.
CREATE FUNCTION public.effective_lab_observation_rows(p_patients uuid[],p_include_evaluation boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE patients uuid[]:=p_patients; provider boolean:=p_include_evaluation; rows jsonb; invalid boolean;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Laboratory projection requires READ COMMITTED';
 END IF;
 -- Do not hide an inconsistent root merely because its source would be excluded.
 IF EXISTS(SELECT 1 FROM public.lab_observation_roots r JOIN public.lab_results l ON l.id=r.original_lab_result_id
  WHERE (l.patient_id=ANY(patients) OR r.patient_id=ANY(patients)) AND
   (r.patient_id<>l.patient_id OR EXISTS(SELECT 1 FROM public.lab_observation_versions v
     WHERE v.lab_result_id=l.id AND v.status<>'original'))) THEN
  RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory source history is inconsistent';
 END IF;
 WITH originals AS (
  SELECT l.* FROM public.lab_results l WHERE l.patient_id=ANY(patients)
   AND NOT EXISTS(SELECT 1 FROM public.lab_observation_versions v WHERE v.lab_result_id=l.id AND v.status<>'original')
 ), observations AS (
  SELECT o.id AS original_id,o.patient_id,a.key AS analyte,o.id::text||':'||a.key AS key,
   r.id AS root_id,r.patient_id AS root_patient,h.id AS version_id,h.revision,h.status AS head_status,
   h.lab_result_id AS head_lab,h.predecessor_id,e.id AS value_lab,e.patient_id AS value_patient,
   e.collected_at,e.notes,e.lab_facility,to_jsonb(e)->>a.key AS source_value,a.value='null'::jsonb AS original_missing,
   CASE WHEN provider THEN ev.status ELSE NULL END AS evaluation_status
  FROM originals o CROSS JOIN LATERAL jsonb_each(to_jsonb(o)) a
  LEFT JOIN public.lab_observation_roots r ON r.original_lab_result_id=o.id AND r.analyte=a.key
  LEFT JOIN LATERAL (SELECT v.* FROM public.lab_observation_versions v WHERE v.root_id=r.id ORDER BY v.revision DESC LIMIT 1) h ON true
  LEFT JOIN LATERAL (SELECT v.lab_result_id FROM public.lab_observation_versions v WHERE v.root_id=r.id AND v.lab_result_id IS NOT NULL
   ORDER BY v.revision DESC LIMIT 1) prior_value ON true
  LEFT JOIN public.lab_results e ON e.id=CASE WHEN r.id IS NULL THEN o.id
   WHEN h.status='cancelled' THEN prior_value.lab_result_id ELSE h.lab_result_id END
  LEFT JOIN public.lab_alert_evaluations ev ON ev.lab_result_id=e.id
  WHERE a.key IN('potassium','creatinine','egfr','bun','bnp','nt_probnp','hba1c','glucose','sodium','hemoglobin','ferritin','tsat','ldl')
   AND (a.value<>'null'::jsonb OR r.id IS NOT NULL)
 ), rendered AS (
  SELECT key,
   (original_missing OR value_lab IS NULL OR value_patient IS DISTINCT FROM patient_id OR source_value IS NULL OR
    (root_id IS NOT NULL AND (version_id IS NULL OR root_patient IS DISTINCT FROM patient_id OR
     NOT COALESCE((head_status='original' AND revision=1 AND head_lab=original_id AND predecessor_id IS NULL)
       OR(head_status='corrected' AND revision>1 AND head_lab IS NOT NULL AND predecessor_id IS NOT NULL)
       OR(head_status='cancelled' AND revision>1 AND head_lab IS NULL AND predecessor_id IS NOT NULL),false)))) AS broken,
   jsonb_build_object('id',key,'patient_id',patient_id,'original_lab_result_id',original_id,'analyte',analyte,
    'root_id',root_id,'version_id',version_id,'revision',revision::text,'status',COALESCE(head_status,'original'),
    'effective_lab_result_id',CASE WHEN head_status='cancelled' THEN NULL ELSE value_lab END,
    'value',CASE WHEN head_status='cancelled' THEN NULL ELSE source_value END,'collected_at',collected_at,
    'notes',notes,'lab_facility',lab_facility,'evaluation_status',CASE WHEN head_status='cancelled' THEN NULL ELSE evaluation_status END) AS item
  FROM observations
 ) SELECT COALESCE(jsonb_agg(item ORDER BY key COLLATE "C"),'[]'::jsonb),COALESCE(bool_or(broken),false) INTO rows,invalid FROM rendered;
 IF invalid THEN RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory source history is inconsistent'; END IF;
 RETURN rows;
END $$;
REVOKE ALL ON FUNCTION public.effective_lab_observation_rows(uuid[],boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_effective_lab_observations(p_patient_ids uuid[],p_after text DEFAULT NULL,p_snapshot text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE actor uuid:=(SELECT auth.uid()); patients uuid[]; rows jsonb; signature text; page jsonb; invalid boolean;
 provider boolean:=public.provider_aal2(); patient uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Laboratory projection requires READ COMMITTED';
 END IF;
 IF actor IS NULL OR COALESCE((SELECT auth.jwt()->>'role'),'')<>'authenticated' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory projection not authorized';
 END IF;
 IF p_patient_ids IS NULL OR cardinality(p_patient_ids) NOT BETWEEN 1 AND 500 OR array_ndims(p_patient_ids)<>1
  OR array_position(p_patient_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid laboratory projection scope';
 END IF;
 SELECT array_agg(DISTINCT id ORDER BY id) INTO patients FROM unnest(p_patient_ids) id;
 IF cardinality(patients)<>cardinality(p_patient_ids) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid laboratory projection scope';
 END IF;
 FOREACH patient IN ARRAY patients LOOP
  IF NOT EXISTS(SELECT 1 FROM public.patients WHERE id=patient) OR NOT(
   (provider AND public.provider_has_patient(patient)) OR
   (public.get_user_role()='patient' AND public.has_registration_consent() AND patient=actor)) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory projection not authorized';
  END IF;
 END LOOP;
 IF num_nulls(p_after,p_snapshot)=1 OR (p_snapshot IS NOT NULL AND p_snapshot !~ '^[0-9a-f]{64}$')
  OR (p_after IS NOT NULL AND p_after !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(potassium|creatinine|egfr|bun|bnp|nt_probnp|hba1c|glucose|sodium|hemoglobin|ferritin|tsat|ldl)$') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid laboratory projection cursor';
 END IF;
 rows:=public.effective_lab_observation_rows(patients,provider);
 signature:=encode(sha256(convert_to(jsonb_build_object('actor_id',actor,'patient_ids',patients,'items',rows)::text,'UTF8')),'hex');
 IF p_snapshot IS NOT NULL AND signature<>p_snapshot THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Laboratory projection changed; restart the complete read';
 END IF;
 WITH candidates AS(SELECT item FROM jsonb_array_elements(rows) item WHERE p_after IS NULL OR (item->>'id') COLLATE "C">p_after COLLATE "C"
  ORDER BY (item->>'id') COLLATE "C" LIMIT 251), visible AS(SELECT item FROM candidates ORDER BY (item->>'id') COLLATE "C" LIMIT 250)
 SELECT jsonb_build_object('actor_id',actor,'patient_ids',patients,'snapshot',signature,
  'items',COALESCE((SELECT jsonb_agg(item ORDER BY (item->>'id') COLLATE "C") FROM visible),'[]'::jsonb),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>250 THEN(SELECT item->>'id' FROM visible ORDER BY (item->>'id') COLLATE "C" DESC LIMIT 1) ELSE NULL END)
 INTO page;
 RETURN page;
END $$;
REVOKE ALL ON FUNCTION public.get_effective_lab_observations(uuid[],text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_effective_lab_observations(uuid[],text,text) TO authenticated;

-- No account FKs: transaction-local capability, deleted on every normal exit.
CREATE TABLE public.alert_effect_scope_context (
 xact_id xid8 PRIMARY KEY, patient_id uuid NOT NULL, profile_ids uuid[] NOT NULL, organization_ids uuid[] NOT NULL
);
ALTER TABLE public.alert_effect_scope_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alert_effect_scope_context FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.begin_alert_effect_scope(p_patient uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE provider uuid; current_provider uuid; profiles uuid[]; organizations uuid[];
BEGIN
 PERFORM public.require_alert_scan_service();
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Alert effects require READ COMMITTED';
 END IF;
 IF EXISTS(SELECT 1 FROM public.alert_effect_scope_context WHERE xact_id=pg_catalog.pg_current_xact_id()) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Alert effect context already active';
 END IF;
 provider:=public.alert_scan_scope_provider(p_patient);
 IF provider IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Scan scope unavailable'; END IF;
 -- Every possible INSERT recipient is linked. Match the legacy resolver rather
 -- than imposing a stronger role filter. Aggregate ACTUALLY locked rows.
 SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO profiles FROM (
  SELECT p.id FROM public.profiles p WHERE p.id=p_patient OR p.id IN(
   SELECT l.provider_id FROM public.provider_patient_links l WHERE l.patient_id=p_patient AND l.status='active')
  ORDER BY p.id LIMIT 10001 FOR SHARE OF p) locked;
 IF cardinality(profiles)>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Alert recipient limit exceeded'; END IF;
 IF NOT p_patient=ANY(profiles) OR NOT provider=ANY(profiles) THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Alert recipient scope changed';
 END IF;
 PERFORM id FROM public.consents WHERE user_id IN(p_patient,provider)
  AND consent_type='registration' AND consent_version='v1.0' ORDER BY id FOR SHARE;
 SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO organizations FROM (
  SELECT o.id FROM public.organizations o WHERE o.status='active' AND EXISTS(
   SELECT 1 FROM public.organization_patient_assignments a WHERE a.organization_id=o.id AND a.patient_id=p_patient AND a.status='active')
  ORDER BY o.id LIMIT 10001 FOR SHARE OF o) locked;
 IF cardinality(organizations)>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Alert organization limit exceeded'; END IF;
 PERFORM id FROM public.provider_patient_links WHERE provider_id=provider AND patient_id=p_patient AND status='active' FOR SHARE;
 IF NOT FOUND THEN
  IF public.alert_scan_scope_provider(p_patient) IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Scan scope unavailable';
  END IF;
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Alert recipient scope changed';
 END IF;
 PERFORM id FROM public.patients WHERE id=p_patient FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Scan scope unavailable'; END IF;
 current_provider:=public.alert_scan_scope_provider(p_patient);
 IF current_provider IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Scan scope unavailable';
 END IF;
 IF current_provider<>provider THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Alert recipient scope changed'; END IF;
 INSERT INTO public.alert_effect_scope_context VALUES(pg_catalog.pg_current_xact_id(),p_patient,profiles,organizations);
END $$;

CREATE FUNCTION public.end_alert_effect_scope() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 DELETE FROM public.alert_effect_scope_context WHERE xact_id=pg_catalog.pg_current_xact_id()
$$;

CREATE FUNCTION public.guard_alert_effect_identities() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fence public.alert_effect_scope_context; identities uuid[];
BEGIN
 SELECT * INTO fence FROM public.alert_effect_scope_context WHERE xact_id=pg_catalog.pg_current_xact_id();
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.patient_id,NEW.provider_id,NEW.assigned_to,NEW.organization_id,NEW.accepted_by,
  NEW.transfer_pending_to,NEW.transfer_offered_by) IS NOT DISTINCT FROM ROW(OLD.patient_id,OLD.provider_id,OLD.assigned_to,
  OLD.organization_id,OLD.accepted_by,OLD.transfer_pending_to,OLD.transfer_offered_by) THEN RETURN NEW; END IF;
 identities:=array_remove(ARRAY[NEW.provider_id,NEW.assigned_to,NEW.accepted_by,NEW.transfer_pending_to,NEW.transfer_offered_by],NULL);
 IF NEW.patient_id IS DISTINCT FROM fence.patient_id OR NEW.organization_id IS NULL OR NOT NEW.organization_id=ANY(fence.organization_ids)
  OR NOT identities<@fence.profile_ids THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Alert recipient scope changed';
 END IF;
 RETURN NEW;
END $$;
-- After BEFORE normalization, before AFTER FK/delivery checks.
CREATE TRIGGER z_guard_alert_effect_identities BEFORE INSERT OR UPDATE ON public.work_items
 FOR EACH ROW EXECUTE FUNCTION public.guard_alert_effect_identities();

CREATE FUNCTION public.coalesce_fenced_patient_alert(p_patient uuid,p_severity text,p_flags text[])
RETURNS TABLE(alert_id uuid,created boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.require_alert_scan_service();
 IF NOT EXISTS(SELECT 1 FROM public.alert_effect_scope_context
  WHERE xact_id=pg_catalog.pg_current_xact_id() AND patient_id=p_patient) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Alert effect context required';
 END IF;
 RETURN QUERY SELECT * FROM public.coalesce_patient_alert(p_patient,NULL,p_severity,p_flags);
END $$;
REVOKE ALL ON FUNCTION public.begin_alert_effect_scope(uuid),public.end_alert_effect_scope(),
 public.guard_alert_effect_identities(),public.coalesce_fenced_patient_alert(uuid,text,text[]) FROM PUBLIC,anon,authenticated,service_role;

-- Same shape for capture/revalidation, without free-text notes or processing state.
CREATE FUNCTION public.scan_lab_source(p_row jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_row || jsonb_build_object('notes',NULL,'lab_facility',NULL,'evaluation_status',NULL)
$$;
CREATE FUNCTION public.capture_effective_scan_labs(p_patient uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
 WITH rows AS (SELECT value AS item FROM jsonb_array_elements(public.effective_lab_observation_rows(ARRAY[p_patient],false))),
 latest AS (SELECT item->>'analyte' AS analyte,max((item->>'collected_at')::timestamptz) AS collected FROM rows
  WHERE item->>'analyte' IN('potassium','egfr') GROUP BY item->>'analyte')
 SELECT jsonb_object_agg(analyte,items) FROM (
  SELECT a AS analyte,COALESCE((SELECT jsonb_agg(public.scan_lab_source(item) ORDER BY item->>'id') FROM (
   SELECT rows.item FROM rows JOIN latest ON latest.analyte=rows.item->>'analyte'
    AND latest.collected=(rows.item->>'collected_at')::timestamptz WHERE latest.analyte=a
   ORDER BY rows.item->>'id' LIMIT 1001) bounded),'[]'::jsonb) AS items
  FROM unnest(ARRAY['potassium','egfr']) a) grouped
$$;
CREATE FUNCTION public.lock_and_verify_scan_labs(p_patient uuid,p_analyte text,p_frozen jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE originals uuid[]; current_rows jsonb; item jsonb; current_item jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.alert_effect_scope_context
  WHERE xact_id=pg_catalog.pg_current_xact_id() AND patient_id=p_patient) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Alert effect context required';
 END IF;
 IF p_analyte NOT IN('potassium','egfr') OR p_frozen IS NULL OR jsonb_typeof(p_frozen)<>'array'
  OR jsonb_array_length(p_frozen)>1000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid frozen laboratory context'; END IF;
 SELECT array_agg(DISTINCT (value->>'original_lab_result_id')::uuid ORDER BY (value->>'original_lab_result_id')::uuid)
  INTO originals FROM jsonb_array_elements(p_frozen);
 -- Registration also locks the original, even if no root was visible at capture.
 PERFORM id FROM public.lab_results WHERE id=ANY(originals) ORDER BY id FOR SHARE;
 PERFORM id FROM public.lab_observation_roots WHERE original_lab_result_id=ANY(originals)
  AND analyte=p_analyte ORDER BY id FOR SHARE;
 current_rows:=public.effective_lab_observation_rows(ARRAY[p_patient],false);
 FOR item IN SELECT value FROM jsonb_array_elements(p_frozen) LOOP
  IF item->>'analyte' IS DISTINCT FROM p_analyte OR item->>'patient_id' IS DISTINCT FROM p_patient::text THEN RETURN false; END IF;
  SELECT public.scan_lab_source(value) INTO current_item FROM jsonb_array_elements(current_rows) WHERE value->>'id'=item->>'id';
  IF NOT FOUND OR current_item IS DISTINCT FROM item THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.scan_lab_source(jsonb),public.capture_effective_scan_labs(uuid),
 public.lock_and_verify_scan_labs(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

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
      'adherence',jsonb_build_object('medications',COALESCE((SELECT jsonb_agg(to_jsonb(medication) ORDER BY medication.id) FROM (
        SELECT id,frequency FROM public.medications WHERE patient_id=v_patient AND active ORDER BY id LIMIT 1001) AS medication),'[]'::jsonb),
        'logs',COALESCE((SELECT jsonb_agg(to_jsonb(log) ORDER BY log.id) FROM (
        SELECT id,medication_id,scheduled_date,taken FROM public.medication_logs WHERE patient_id=v_patient
          AND scheduled_date>=v_start AND scheduled_date<=v_end ORDER BY id LIMIT 10001) AS log),'[]'::jsonb))))
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
 v_sources jsonb; v_allowed uuid[]; v_supplied uuid[]; v_legacy_lab boolean; v_valid boolean:=true; v_analyte text;
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
 v_legacy_lab:=p_recipe='proactive-frozen-v1' AND v_analyte IS NOT NULL;
 IF p_recipe='proactive-frozen-v2' AND v_row.snapshot->>'patient_id' IS DISTINCT FROM v_patient::text THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan patient does not match capture';
 END IF;
 SELECT * INTO STRICT v_eval FROM public.alert_scan_evaluations WHERE receipt_id=p_receipt_id AND rule=v_rule;
 -- No effects/scope widening on terminal readback or legacy retirement.
 IF v_legacy_lab OR v_eval.status='complete' OR (v_eval.status='blocked' AND v_eval.error_code<>'blocked_scope') THEN
  PERFORM id FROM public.profiles WHERE id=v_patient FOR SHARE;
  PERFORM id FROM public.alert_scan_patients WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scan receipt unavailable'; END IF;
  SELECT * INTO STRICT v_eval FROM public.alert_scan_evaluations WHERE receipt_id=p_receipt_id AND rule=v_rule FOR UPDATE;
  IF v_legacy_lab THEN
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
