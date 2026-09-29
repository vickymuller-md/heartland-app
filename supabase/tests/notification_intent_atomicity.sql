-- Forced AFTER-write failures in disposable, rolled-back synthetic sources.
-- Captures precede evaluator subtransactions; committed two-session evidence is
-- a separate harness. No test hook exists in the production migration.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
CREATE FUNCTION pg_temp.nf(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('55000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE fault_cases(patient_id uuid PRIMARY KEY,producer text,fail_table text,lab_id uuid,request_id uuid,captured jsonb,
 routing_kind text NOT NULL DEFAULT 'closed');
INSERT INTO fault_cases(patient_id,producer,fail_table)
 SELECT pg_temp.nf(100+row_number() OVER(ORDER BY p,t)::int),p,t FROM
 unnest(ARRAY['lab','vitals','batch','scan']) AS p CROSS JOIN unnest(ARRAY[
 'notification_source_state','notification_work_state','notification_intents','notification_routing_exceptions']) AS t;
INSERT INTO fault_cases(patient_id,producer,fail_table,routing_kind) VALUES
 (pg_temp.nf(117),'vitals','notification_routing_exceptions','new_flag'),
 (pg_temp.nf(118),'batch','notification_routing_exceptions','new_flag');
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT patient_id,patient_id||'@example.invalid','{"consent_accepted":true}'::jsonb FROM fault_cases
 UNION ALL SELECT pg_temp.nf(1),'intent-fault-provider@example.invalid','{"consent_accepted":true}'::jsonb;
UPDATE public.profiles SET role='provider' WHERE id=pg_temp.nf(1);
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT pg_temp.nf(1),patient_id,'active',now() FROM fault_cases;
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',user_id FROM public.organization_memberships WHERE user_id=pg_temp.nf(1) AND status='active';
-- Scan fixtures are source observations, not evaluated laboratory receipts.
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium)
 SELECT gen_random_uuid(),patient_id,now(),6.2 FROM fault_cases WHERE producer='scan';
UPDATE fault_cases AS c SET lab_id=l.id FROM public.lab_results l WHERE c.patient_id=l.patient_id;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT public.prepare_alert_scan('UTC');

CREATE FUNCTION pg_temp.fail_notification_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('test.notification_fail_table',true)=TG_TABLE_NAME THEN
   RAISE EXCEPTION 'Synthetic notification persistence interruption';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER test_notification_fault AFTER INSERT OR UPDATE ON public.notification_source_state
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_notification_write();
CREATE TRIGGER test_notification_fault AFTER INSERT OR UPDATE ON public.notification_work_state
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_notification_write();
CREATE TRIGGER test_notification_fault AFTER INSERT ON public.notification_intents
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_notification_write();
CREATE TRIGGER test_notification_fault AFTER INSERT ON public.notification_routing_exceptions
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_notification_write();

CREATE FUNCTION pg_temp.notification_evidence(p_patient uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'alerts',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM public.alerts a WHERE patient_id=p_patient),
  'works',(SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY id),'[]') FROM public.work_items w WHERE patient_id=p_patient),
  'source_state',(SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY alert_id),'[]') FROM public.notification_source_state s JOIN public.alerts a ON a.id=s.alert_id WHERE a.patient_id=p_patient),
  'work_state',(SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY work_item_id),'[]') FROM public.notification_work_state s JOIN public.work_items w ON w.id=s.work_item_id WHERE w.patient_id=p_patient),
  'intents',(SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM public.notification_intents i WHERE patient_id=p_patient),
  'exceptions',(SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.notification_routing_exceptions e WHERE patient_id=p_patient))
$$;
CREATE FUNCTION pg_temp.source_evidence(p_patient uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'labs',(SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY id),'[]') FROM public.lab_results l WHERE patient_id=p_patient),
  'vitals',(SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM public.vitals v WHERE patient_id=p_patient),
  'symptoms',(SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.symptoms s WHERE patient_id=p_patient),
  'lab_receipts',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY request_id),'[]') FROM public.lab_submission_receipts r WHERE patient_id=p_patient),
  'vitals_receipts',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.request_id),'[]') FROM public.vitals_submission_receipts r
    JOIN public.vitals_submission_attempts a USING(request_id) WHERE a.patient_id=p_patient),
  'scan_snapshot',(SELECT snapshot FROM public.alert_scan_patients WHERE patient_id=p_patient))
$$;
CREATE FUNCTION pg_temp.finish_case(p_patient uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c fault_cases%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO STRICT c FROM fault_cases WHERE patient_id=p_patient;
 IF c.producer='lab' THEN
  SELECT to_jsonb(r) INTO result FROM public.process_lab_alert_event(c.lab_id) r;
 ELSIF c.producer='scan' THEN
  result:=public.finalize_alert_scan_rule(c.request_id,'proactive-frozen-v2',jsonb_build_object(
   'receipt_id',c.request_id,'rule','hyperkalemia','decision','triggered','severity','critical','reason',NULL,'source_ids',jsonb_build_array(c.lab_id)));
 ELSE
  result:=public.finalize_vitals_submission_evaluation(c.request_id,pg_temp.nf(1),
   CASE WHEN c.producer='batch' THEN 'vitals-frozen-batch-v1' ELSE 'vitals-frozen-individual-v1' END,
   CASE WHEN c.routing_kind='new_flag' THEN ARRAY['dyspnea_rest','spo2_low'] ELSE ARRAY['spo2_low'] END);
 END IF;
 RETURN result;
END;
$$;
CREATE FUNCTION pg_temp.run_fault_case(p_patient uuid) RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
 c fault_cases%ROWTYPE; prepared jsonb; saved jsonb; lab_result record; before_notifications jsonb; before_sources jsonb;
 failed jsonb; recovered jsonb; final_notifications jsonb; label text; baseline_alert uuid; previous_count integer:=0;
BEGIN
 SELECT * INTO STRICT c FROM fault_cases WHERE patient_id=p_patient;
 label:=c.producer||' / '||c.fail_table||' / '||c.routing_kind||': ';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.nf(1),'role','authenticated','aal','aal2')::text,true);
 IF c.producer='lab' THEN
  SELECT to_jsonb(r) INTO prepared FROM public.prepare_lab_submission(p_patient) r;
  c.request_id:=(prepared->>'request_id')::uuid;
  SELECT * INTO lab_result FROM public.submit_lab_result(c.request_id,p_patient,now(),6.2);
  c.lab_id:=lab_result.lab_result_id;
 ELSIF c.producer='vitals' THEN
  prepared:=public.prepare_vitals_submission(p_patient);
  c.request_id:=(prepared->>'request_id')::uuid;
  saved:=public.submit_vitals_submission(p_patient,c.request_id,180,'lbs',120,80,70,90,CASE WHEN c.routing_kind='new_flag' THEN 3 ELSE 0 END,0,false,0);
 ELSIF c.producer='batch' THEN
  prepared:=public.prepare_vitals_batch(p_patient);
  saved:=public.submit_vitals_batch(p_patient,(prepared->>'batch_id')::uuid,
   jsonb_build_array(jsonb_build_object('weight',180,'weight_unit','lbs','sbp',120,'dbp',80,'heart_rate',70,'spo2',90,
    'dyspnea',CASE WHEN c.routing_kind='new_flag' THEN 3 ELSE 0 END,'recorded_at',now()),NULL,NULL,NULL,NULL,NULL,NULL));
  SELECT request_id INTO c.request_id FROM public.vitals_submission_batch_rows WHERE batch_id=(prepared->>'batch_id')::uuid;
 ELSE
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  SELECT id INTO c.request_id FROM public.alert_scan_patients WHERE patient_id=p_patient;
  saved:=public.capture_alert_scan_patient(c.request_id);
 END IF;
 UPDATE fault_cases SET request_id=c.request_id,lab_id=c.lab_id,captured=saved WHERE patient_id=p_patient;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 IF c.fail_table='notification_routing_exceptions' THEN
  SELECT alert_id INTO baseline_alert FROM public.coalesce_patient_alert(p_patient,NULL,'critical',
   ARRAY[CASE WHEN c.producer IN ('vitals','batch') THEN 'spo2_low' ELSE 'hyperkalemia' END]);
  IF c.routing_kind='closed' THEN
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.nf(1),'role','authenticated','aal','aal2')::text,true);
   UPDATE public.work_items SET status='closed',outcome='Synthetic closure before later observation',outcome_code='clinical_action_taken' WHERE source_id=baseline_alert;
   PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  END IF;
  previous_count:=1;
 END IF;
 before_notifications:=pg_temp.notification_evidence(p_patient);
 before_sources:=pg_temp.source_evidence(p_patient);
 PERFORM set_config('test.notification_fail_table',c.fail_table,true);
 failed:=pg_temp.finish_case(p_patient);
 RETURN NEXT is(failed->>'status',CASE WHEN c.producer='lab' THEN 'pending' ELSE 'failed' END,label||'failure is recoverable, not completion');
 RETURN NEXT is(pg_temp.notification_evidence(p_patient),before_notifications,label||'source, work, counters, intent and exception atomically rolled back');
 RETURN NEXT is(pg_temp.source_evidence(p_patient),before_sources,label||'previously captured observations and receipts survive unchanged');
 IF c.producer IN ('vitals','batch') THEN
  RETURN NEXT is((SELECT red_flag FROM public.symptoms WHERE patient_id=p_patient),NULL::boolean,label||'failed persistence never classifies normal');
 END IF;
 PERFORM set_config('test.notification_fail_table','',true);
 recovered:=pg_temp.finish_case(p_patient);
 RETURN NEXT is(recovered->>'status',CASE WHEN c.producer='lab' THEN 'recorded' ELSE 'complete' END,label||'same captured evaluation recovers');
 RETURN NEXT is((SELECT count(*)::int FROM public.alerts WHERE patient_id=p_patient),1,label||'exactly one alert identity');
 RETURN NEXT is((SELECT occurrence_count FROM public.alerts WHERE patient_id=p_patient),previous_count+1,label||'one new occurrence, not failed-attempt duplicate');
 RETURN NEXT is((SELECT count(*)::int FROM public.work_items WHERE patient_id=p_patient),1,label||'one work identity');
 RETURN NEXT is((SELECT count(*)::int FROM public.notification_intents WHERE patient_id=p_patient),1,label||'one transport generation, no retry duplicate');
 RETURN NEXT is((SELECT generation FROM public.notification_work_state s JOIN public.work_items w ON w.id=s.work_item_id WHERE w.patient_id=p_patient),1::bigint,label||'counter failure did not consume generation');
 RETURN NEXT is((SELECT count(*)::int FROM public.notification_routing_exceptions WHERE patient_id=p_patient),previous_count,label||'closed routing evidence exists once, or absent for open source');
 IF previous_count=1 THEN
  RETURN NEXT is((SELECT state FROM public.notification_intents WHERE patient_id=p_patient),
   CASE WHEN c.routing_kind='new_flag' THEN 'pending' ELSE 'cancelled' END,label||'later observation preserves original transport disposition');
  RETURN NEXT is((SELECT reason FROM public.notification_routing_exceptions WHERE patient_id=p_patient),
   CASE WHEN c.routing_kind='new_flag' THEN 'critical_new_flag' ELSE 'closed_work_later_signal' END,label||'exact routing reason survives retry');
 END IF;
 final_notifications:=pg_temp.notification_evidence(p_patient);
 RETURN NEXT is(pg_temp.finish_case(p_patient),recovered,label||'response-loss replay returns original evaluation');
 RETURN NEXT is(pg_temp.notification_evidence(p_patient),final_notifications,label||'replay has no source/work/intent/exception effects');
END;
$$;
SELECT pg_temp.run_fault_case(patient_id) FROM fault_cases ORDER BY patient_id;
SELECT * FROM finish();
ROLLBACK;
