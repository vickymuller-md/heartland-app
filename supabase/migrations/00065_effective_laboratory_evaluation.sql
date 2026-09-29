-- Immediate outbox source cutover. Historical terminal evidence is not recomputed.
ALTER TABLE public.lab_alert_evaluations DROP CONSTRAINT lab_alert_evaluations_status_check;
ALTER TABLE public.lab_alert_evaluations ADD CONSTRAINT lab_alert_evaluations_status_check
 CHECK(status IN('pending','recorded','not_required','invalidated'));
ALTER TABLE public.lab_alert_evaluations ADD COLUMN source_assessment jsonb;
ALTER TABLE public.lab_alert_evaluations ADD CONSTRAINT lab_assessment_terminal_check
 CHECK(source_assessment IS NULL OR(status<>'pending' AND jsonb_typeof(source_assessment)='object'));
COMMENT ON COLUMN public.lab_alert_evaluations.source_assessment IS
 'Historical per-analyte source eligibility at immediate processing; NULL means no version-aware assessment recorded. Not clinical review or currentness.';

CREATE OR REPLACE FUNCTION public.process_lab_alert_event(p_lab_result_id uuid)
RETURNS TABLE(lab_result_id uuid,event_id uuid,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='5s' AS $$
DECLARE
 ev public.lab_alert_evaluations%ROWTYPE; lab public.lab_results%ROWTYPE;
 original_id uuid; check_original uuid; original_patient uuid; candidate jsonb; head jsonb;
 event_version public.lab_observation_versions%ROWTYPE;
 rows jsonb; entries jsonb:='{}'; assessment jsonb; v_analyte text; value text; reason text;
 flags text[]:=ARRAY[]::text[]; flag text; alert_id uuid; detected timestamptz;
 eligible integer:=0; excluded integer:=0;
BEGIN
 IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' OR (SELECT auth.uid()) IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory operation not authorized';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Laboratory evaluation requires READ COMMITTED';
 END IF;
 SELECT e.* INTO ev FROM public.lab_alert_evaluations e WHERE e.lab_result_id=p_lab_result_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid laboratory event'; END IF;
 IF ev.status<>'pending' THEN
  -- Replay remains readable after detection scope changes, including legacy NULL proof.
  PERFORM 1 FROM public.profiles p WHERE p.id=ev.patient_id FOR SHARE;
  SELECT e.* INTO STRICT ev FROM public.lab_alert_evaluations e WHERE e.id=ev.id FOR UPDATE;
  RETURN QUERY SELECT ev.lab_result_id,ev.id,ev.status; RETURN;
 END IF;
 BEGIN
  PERFORM public.begin_alert_effect_scope(ev.patient_id);
  SELECT COALESCE((SELECT r.original_lab_result_id FROM public.lab_observation_versions v
   JOIN public.lab_observation_roots r ON r.id=v.root_id
   WHERE v.lab_result_id=p_lab_result_id AND v.status='corrected'),p_lab_result_id) INTO original_id;
  SELECT l.patient_id INTO STRICT original_patient FROM public.lab_results l WHERE l.id=original_id FOR SHARE;
  IF original_patient<>ev.patient_id THEN RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory event scope mismatch'; END IF;
  PERFORM 1 FROM public.lab_observation_roots r WHERE r.original_lab_result_id=original_id
   AND r.analyte IN('potassium','egfr') ORDER BY r.id FOR SHARE;
  SELECT l.* INTO STRICT lab FROM public.lab_results l WHERE l.id=p_lab_result_id FOR SHARE;
  SELECT COALESCE((SELECT r.original_lab_result_id FROM public.lab_observation_versions v
   JOIN public.lab_observation_roots r ON r.id=v.root_id
   WHERE v.lab_result_id=p_lab_result_id AND v.status='corrected'),p_lab_result_id) INTO check_original;
  IF lab.patient_id<>ev.patient_id OR check_original<>original_id THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Laboratory event source changed';
  END IF;
  SELECT e.* INTO STRICT ev FROM public.lab_alert_evaluations e WHERE e.id=ev.id FOR UPDATE;
  IF ev.lab_result_id<>lab.id OR ev.patient_id<>lab.patient_id THEN
   RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory event identity mismatch';
  END IF;
  IF ev.status<>'pending' THEN
   PERFORM public.end_alert_effect_scope(); RETURN QUERY SELECT ev.lab_result_id,ev.id,ev.status; RETURN;
  END IF;
  rows:=public.effective_lab_observation_rows(ARRAY[ev.patient_id],false);
  detected:=clock_timestamp();
  FOREACH v_analyte IN ARRAY ARRAY['potassium','egfr'] LOOP
   value:=to_jsonb(lab)->>v_analyte;
   candidate:=NULL; head:=NULL; reason:='not_recorded';
   IF value IS NOT NULL THEN
    SELECT v.* INTO event_version FROM public.lab_observation_versions v
     JOIN public.lab_observation_roots r ON r.id=v.root_id
     WHERE v.lab_result_id=lab.id AND r.analyte=v_analyte AND r.original_lab_result_id=original_id;
    candidate:=jsonb_build_object('lab_result_id',lab.id,'value',value,'collected_at',lab.collected_at,
     'root_id',event_version.root_id,'version_id',event_version.id,'revision',event_version.revision::text);
    SELECT item INTO STRICT head FROM jsonb_array_elements(rows) item
     WHERE item->>'original_lab_result_id'=original_id::text AND item->>'analyte'=v_analyte;
    reason:=CASE WHEN head->>'status'='cancelled' THEN 'cancelled'
     WHEN head->>'effective_lab_result_id'<>lab.id::text THEN 'replaced' ELSE 'effective' END;
    IF reason='effective' THEN
     IF value !~ '^\d+(\.\d+)?$' OR NOT isfinite(lab.collected_at) OR lab.collected_at>detected
      OR head->>'value' IS DISTINCT FROM value OR (head->>'collected_at')::timestamptz<>lab.collected_at THEN
      RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Invalid eligible laboratory source';
     END IF;
     eligible:=eligible+1;
     IF v_analyte='potassium' AND value::numeric>5.5 THEN flags:=array_append(flags,'hyperkalemia'); END IF;
     IF v_analyte='egfr' AND value::numeric<15 THEN flags:=array_append(flags,'low_egfr'); END IF;
    ELSE excluded:=excluded+1; END IF;
    head:=jsonb_build_object('root_id',head->'root_id','version_id',head->'version_id','revision',head->'revision',
     'status',head->'status','effective_lab_result_id',head->'effective_lab_result_id',
     'value',head->'value','collected_at',head->'collected_at');
   END IF;
   entries:=entries||jsonb_build_object(v_analyte,jsonb_build_object('reason',reason,'event_source',candidate,'observed_head',head));
  END LOOP;
  assessment:=jsonb_build_object('recipe','immediate-effective-v1','evaluated_at',detected,'patient_id',ev.patient_id,
   'lab_result_id',lab.id,'original_lab_result_id',original_id,'analytes',entries);
  FOREACH flag IN ARRAY flags LOOP
   SELECT result.alert_id INTO STRICT alert_id
    FROM public.coalesce_fenced_patient_alert(ev.patient_id,'critical',ARRAY[flag]) result;
   INSERT INTO public.lab_alert_sources(event_id,lab_result_id,patient_id,alert_id,flag,collected_at,detected_at)
    VALUES(ev.id,lab.id,ev.patient_id,alert_id,flag,lab.collected_at,detected);
  END LOOP;
  UPDATE public.lab_alert_evaluations e SET status=CASE WHEN cardinality(flags)>0 THEN 'recorded'
   WHEN eligible=0 AND excluded>0 THEN 'invalidated' ELSE 'not_required' END,
   source_assessment=assessment,completed_at=clock_timestamp(),last_error_code=NULL,attempt_count=e.attempt_count+1
   WHERE e.id=ev.id;
  PERFORM public.end_alert_effect_scope();
 EXCEPTION WHEN OTHERS THEN
  -- All effect/source/context locks and writes above have rolled back first.
  PERFORM 1 FROM public.profiles p WHERE p.id=ev.patient_id FOR SHARE;
  SELECT e.* INTO STRICT ev FROM public.lab_alert_evaluations e WHERE e.lab_result_id=p_lab_result_id FOR UPDATE;
  IF ev.status='pending' THEN
   UPDATE public.lab_alert_evaluations e SET attempt_count=e.attempt_count+1,last_error_code='evaluation_failed' WHERE e.id=ev.id;
  END IF;
 END;
 RETURN QUERY SELECT e.lab_result_id,e.id,e.status FROM public.lab_alert_evaluations e WHERE e.id=ev.id;
END $$;
REVOKE ALL ON FUNCTION public.process_lab_alert_event(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.process_lab_alert_event(uuid) TO service_role;
