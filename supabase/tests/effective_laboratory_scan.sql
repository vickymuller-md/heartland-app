-- Synthetic effective-source scanner verification; all fixtures roll back.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
-- BEGIN EFFECTIVE SCAN FIXTURES
CREATE FUNCTION pg_temp.es(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('64000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.es(n),'effective-scan-'||n||'@example.invalid','{"consent_accepted":true}' FROM unnest(ARRAY[1,2,3]||ARRAY(SELECT generate_series(11,35))) n;
UPDATE public.profiles SET role='provider' WHERE id IN(pg_temp.es(1),pg_temp.es(2),pg_temp.es(3));
INSERT INTO public.organizations(id,name,created_by) VALUES
 (pg_temp.es(90),'Synthetic scan source organization',pg_temp.es(1)),(pg_temp.es(91),'Synthetic scan second organization',pg_temp.es(2));
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES(pg_temp.es(90),pg_temp.es(1),'owner','active',now(),pg_temp.es(1)),
 (pg_temp.es(91),pg_temp.es(2),'owner','active',now(),pg_temp.es(2));
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,c,user_id FROM public.organization_memberships CROSS JOIN unnest(ARRAY['monitor','clinical_disposition']) c
 WHERE organization_id IN(pg_temp.es(90),pg_temp.es(91));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT pg_temp.es(provider),pg_temp.es(patient),'active',now() FROM unnest(ARRAY[1,2]) provider CROSS JOIN generate_series(11,35) patient;
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by)
 SELECT pg_temp.es(org),pg_temp.es(patient),pg_temp.es(CASE WHEN org=90 THEN 1 ELSE 2 END)
 FROM unnest(ARRAY[90,91]) org CROSS JOIN generate_series(11,35) patient ON CONFLICT DO NOTHING;
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium,egfr,notes,lab_facility)
 SELECT pg_temp.es(100+n),pg_temp.es(n),now()-interval '1 day',6.2,20,'Private synthetic note','Synthetic laboratory'
 FROM generate_series(11,35) n WHERE n NOT IN(15,16);
-- Only these two sources emulate pre-outbox legacy data, not hosted evidence.
ALTER TABLE public.lab_results DISABLE TRIGGER USER;
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium,egfr,notes,lab_facility)
 SELECT pg_temp.es(100+n),pg_temp.es(n),now()-interval '1 day',6.2,20,'Private synthetic note','Synthetic laboratory'
 FROM unnest(ARRAY[15,16]) n;
ALTER TABLE public.lab_results ENABLE TRIGGER USER;
-- END EFFECTIVE SCAN FIXTURES
-- BEGIN EFFECTIVE SCAN HELPERS
CREATE FUNCTION pg_temp.es_service() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims','{"role":"service_role"}',true)::text;
$$;
CREATE FUNCTION pg_temp.es_register(n integer,a text DEFAULT 'potassium') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.es(1),'aal','aal2')::text,true);
 PERFORM public.prepare_lab_observation(pg_temp.es(1000+n),pg_temp.es(2000+n),pg_temp.es(90),pg_temp.es(n),pg_temp.es(100+n),a,
  jsonb_build_object('evidence','Synthetic source register','occurred_at',to_char(now()-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 result:=public.apply_lab_observation(pg_temp.es(1000+n)); PERFORM pg_temp.es_service(); RETURN result;
END $$;
CREATE FUNCTION pg_temp.es_change(n integer,c text DEFAULT 'correct_source',value text DEFAULT '4.2') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; payload jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.es(1),'aal','aal2')::text,true);
 payload:=jsonb_build_object('reason','Synthetic amended value','evidence','Synthetic revised report',
  'occurred_at',to_char(now()-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 IF c='correct_source' THEN payload:=payload||jsonb_build_object('value',value,
  'collected_at',to_char(now()-interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')); END IF;
 PERFORM public.prepare_lab_observation_change(pg_temp.es(3000+n),pg_temp.es(2000+n),pg_temp.es(90),pg_temp.es(n),1,c,payload);
 result:=public.apply_lab_observation(pg_temp.es(3000+n)); PERFORM pg_temp.es_service(); RETURN result;
END $$;
CREATE FUNCTION pg_temp.es_receipt(n integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM public.alert_scan_patients WHERE patient_id=pg_temp.es(n)
 AND run_id=(SELECT id FROM public.alert_scan_runs WHERE slot=(clock_timestamp() AT TIME ZONE 'UTC')::date)
$$;
CREATE FUNCTION pg_temp.es_capture(n integer) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.es_service(); RETURN public.capture_alert_scan_patient(pg_temp.es_receipt(n)); END $$;
CREATE FUNCTION pg_temp.es_result(n integer,r text DEFAULT 'hyperkalemia',d text DEFAULT 'triggered',reason text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('receipt_id',id,'rule',r,'decision',d,'severity',CASE WHEN d='triggered' THEN 'critical' END,'reason',reason,
  'source_ids',CASE WHEN d='blocked' THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(COALESCE(v->>'version_id',v->>'original_lab_result_id'))
  FROM jsonb_array_elements(snapshot#>ARRAY['sources','effective_labs',CASE WHEN r='hyperkalemia' THEN 'potassium' ELSE 'egfr' END]) v),'[]'::jsonb) END)
 FROM public.alert_scan_patients WHERE id=pg_temp.es_receipt(n)
$$;
CREATE FUNCTION pg_temp.es_finish(n integer,r text DEFAULT 'hyperkalemia',d text DEFAULT 'triggered',reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.es_service(); RETURN public.finalize_alert_scan_rule(pg_temp.es_receipt(n),'proactive-frozen-v2',pg_temp.es_result(n,r,d,reason)); END $$;
-- END EFFECTIVE SCAN HELPERS
CREATE TEMP TABLE scan_evidence(label text PRIMARY KEY,data jsonb);
SELECT ok(NOT has_function_privilege('service_role','public.effective_lab_observation_rows(uuid[],boolean)','EXECUTE'),'service cannot read unscoped projection helper');
SELECT ok(NOT has_function_privilege('authenticated','public.capture_effective_scan_labs(uuid)','EXECUTE'),'browser cannot read unscoped scanner source');
SELECT ok(NOT has_function_privilege('service_role','public.begin_alert_effect_scope(uuid)','EXECUTE'),'service cannot forge scope context directly');
SELECT ok(NOT has_table_privilege('service_role','public.alert_effect_scope_context','INSERT'),'private scope context cannot be forged');
SELECT ok(NOT has_table_privilege('authenticated','public.alert_effect_scope_context','SELECT'),'private context cannot leak recipient IDs');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.alert_effect_scope_context'::regclass AND contype='f'),'context has no hidden account or work FK');
SELECT pg_temp.es_service();
SELECT throws_ok($q$SELECT public.coalesce_fenced_patient_alert(pg_temp.es(11),'critical',ARRAY['hyperkalemia'])$q$,
 '42501','Alert effect context required','coalescence without fence fails closed');
SELECT public.prepare_alert_scan('UTC');
SELECT pg_temp.es_register(11); SELECT pg_temp.es_change(11);
INSERT INTO scan_evidence VALUES('independent',pg_temp.es_capture(11));
SELECT is((SELECT data#>>'{snapshot,recipe}' FROM scan_evidence WHERE label='independent'),'proactive-frozen-v2','capture freezes explicit new recipe');
SELECT is((SELECT jsonb_array_length(data#>'{snapshot,sources,effective_labs,potassium}') FROM scan_evidence WHERE label='independent'),1,'amendment not duplicated as raw panel');
SELECT is((SELECT data#>>'{snapshot,sources,effective_labs,potassium,0,value}' FROM scan_evidence WHERE label='independent'),'4.2','corrected potassium frozen');
SELECT is((SELECT data#>>'{snapshot,sources,effective_labs,egfr,0,value}' FROM scan_evidence WHERE label='independent'),'20','other original analyte preserved');
SELECT is((SELECT data#>>'{snapshot,sources,effective_labs,potassium,0,revision}' FROM scan_evidence WHERE label='independent'),'2','source revision frozen');
SELECT ok((SELECT NOT data->'snapshot'->'sources' ? 'latest_labs' FROM scan_evidence WHERE label='independent'),'capture has no legacy raw fallback');
SELECT ok((SELECT data#>'{snapshot,sources,effective_labs,potassium,0,notes}'='null'::jsonb
 AND data#>'{snapshot,sources,effective_labs,egfr,0,lab_facility}'='null'::jsonb
 AND data#>'{snapshot,sources,effective_labs,potassium,0,evaluation_status}'='null'::jsonb FROM scan_evidence WHERE label='independent'),'no notes/facility/processing state in clinical snapshot');
SELECT is((SELECT count(*) FROM public.alert_effect_scope_context),0::bigint,'capture clears context');
SELECT is(pg_temp.es_capture(11),(SELECT data FROM scan_evidence WHERE label='independent'),'capture replay exact');
SELECT is((SELECT count(*) FROM public.alert_effect_scope_context),0::bigint,'capture replay clears context');
SELECT is(pg_temp.es_finish(11,'hyperkalemia','not_triggered')->>'status','complete','non-trigger correction evaluated');
SELECT is(pg_temp.es_finish(11,'low_egfr')->>'status','complete','independent renal source evaluated');
SELECT is((SELECT count(*) FROM public.alerts WHERE patient_id=pg_temp.es(11)),1::bigint,'only actual renal signal emitted');
SELECT is((SELECT count(*) FROM public.work_items WHERE patient_id=pg_temp.es(11)),4::bigint,'explicit and default organizations retain governed work');
SELECT is((SELECT count(*) FROM public.notification_intents WHERE patient_id=pg_temp.es(11)),4::bigint,'work and intents atomic for two owners across four organizations');
SELECT is((SELECT count(*) FROM public.alert_effect_scope_context),0::bigint,'finalization clears context');
SELECT pg_temp.es_capture(12); SELECT pg_temp.es_register(12);
SELECT is(pg_temp.es_finish(12)->>'error_code','source_changed','first registration invalidates frozen no-root identity');
SELECT is((SELECT count(*) FROM public.alerts WHERE patient_id=pg_temp.es(12)),0::bigint,'no alert for changed no-root source');
SELECT is(pg_temp.es_finish(12)->>'error_code','source_changed','source-changed terminal replay preserved');
SELECT pg_temp.es_register(13); SELECT pg_temp.es_capture(13); SELECT pg_temp.es_change(13);
SELECT is(pg_temp.es_finish(13)->>'error_code','source_changed','correction after capture blocks fresh signal');
SELECT is((SELECT result->>'decision' FROM public.alert_scan_evaluations WHERE receipt_id=pg_temp.es_receipt(13) AND rule='hyperkalemia'),'triggered','proposed result retained alongside source-changed block');
SELECT is(pg_temp.es_finish(13,'low_egfr')->>'status','complete','K correction does not invalidate frozen GFR');
SELECT pg_temp.es_register(14); SELECT pg_temp.es_capture(14); SELECT pg_temp.es_change(14,'cancel_source');
SELECT is(pg_temp.es_finish(14)->>'error_code','source_changed','cancellation after capture blocks signal');
SELECT pg_temp.es_capture(15);
UPDATE public.lab_results SET potassium=4.5 WHERE id=pg_temp.es(115);
SELECT is(pg_temp.es_finish(15)->>'error_code','source_changed','mutable unregistered source revalidated by value');
SELECT pg_temp.es_capture(16);
UPDATE public.lab_results SET notes='Updated synthetic note' WHERE id=pg_temp.es(116);
SELECT is(pg_temp.es_finish(16)->>'status','complete','free-text update is not measured-value invalidation');
SELECT pg_temp.es_capture(17);
INSERT INTO public.lab_results(patient_id,collected_at,potassium) VALUES(pg_temp.es(17),now(),4.2);
SELECT is(pg_temp.es_finish(17)->>'status','complete','independent newer collection does not rewrite frozen historic detection');
SELECT pg_temp.es_capture(18);
SELECT public.process_lab_alert_event(pg_temp.es(118));
SELECT is(pg_temp.es_finish(18)->>'status','complete','processing completion does not invalidate measured source');
SELECT pg_temp.es_register(19); SELECT pg_temp.es_change(19,'cancel_source');
INSERT INTO scan_evidence VALUES('cancelled',pg_temp.es_capture(19));
SELECT is((SELECT data#>>'{snapshot,sources,effective_labs,potassium,0,status}' FROM scan_evidence WHERE label='cancelled'),'cancelled','latest cancellation remains visible to evaluator');
SELECT is((SELECT data#>>'{snapshot,sources,effective_labs,potassium,0,value}' FROM scan_evidence WHERE label='cancelled'),NULL::text,'no fallback old K');
SELECT is(pg_temp.es_finish(19,'hyperkalemia','blocked','cancelled_source')->>'error_code','cancelled_source','cancellation block distinguishable from no trigger');
SELECT is(pg_temp.es_finish(19,'low_egfr')->>'status','complete','other analyte survives cancellation');
-- All tied sources must be verified, not only the subset supplied by the worker.
ALTER TABLE public.lab_results DISABLE TRIGGER USER;
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium)
 SELECT pg_temp.es(500),pg_temp.es(20),collected_at,6.2 FROM public.lab_results WHERE id=pg_temp.es(120);
ALTER TABLE public.lab_results ENABLE TRIGGER USER;
SELECT pg_temp.es_capture(20);
UPDATE public.lab_results SET potassium=4.2 WHERE id=pg_temp.es(500);
SELECT is(public.finalize_alert_scan_rule(pg_temp.es_receipt(20),'proactive-frozen-v2',
 jsonb_set(pg_temp.es_result(20),'{source_ids}',jsonb_build_array(pg_temp.es(120))))->>'error_code','source_changed','unreturned tied candidate still revalidated');
-- Legacy synthetic historical rows: immutable prior results must not be replaced.
INSERT INTO public.alert_scan_runs(id,slot,calendar_timezone) VALUES(pg_temp.es(900),current_date-1,'UTC');
INSERT INTO public.alert_scan_patients(id,run_id,patient_id,capture_status,snapshot)
 SELECT pg_temp.es(900+n),pg_temp.es(900),pg_temp.es(n),'captured',jsonb_build_object('receipt_id',pg_temp.es(900+n),
 'recipe','proactive-frozen-v1','sources',jsonb_build_object('latest_labs',jsonb_build_array(jsonb_build_object('id',pg_temp.es(100+n),'potassium',6.2))))
 FROM generate_series(21,24) n;
INSERT INTO public.alert_scan_evaluations(receipt_id,rule,status,result,error_code,processed_at)
 SELECT pg_temp.es(900+n),'hyperkalemia',CASE n WHEN 21 THEN 'failed' WHEN 22 THEN 'blocked' WHEN 23 THEN 'complete' ELSE 'pending' END,
 CASE WHEN n<>24 THEN jsonb_build_object('receipt_id',pg_temp.es(900+n),'rule','hyperkalemia','decision','triggered','severity','critical','reason',NULL,'source_ids',jsonb_build_array(pg_temp.es(100+n))) END,
 CASE n WHEN 21 THEN 'P0001' WHEN 22 THEN 'blocked_scope' END,CASE WHEN n IN(22,23) THEN now() END FROM generate_series(21,24) n;
INSERT INTO scan_evidence SELECT 'legacy-before-'||n,to_jsonb(e) FROM generate_series(21,24) n JOIN public.alert_scan_evaluations e ON e.receipt_id=pg_temp.es(900+n);
INSERT INTO scan_evidence SELECT 'legacy-after-'||n,public.finalize_alert_scan_rule(pg_temp.es(900+n),'proactive-frozen-v1',jsonb_build_object(
 'receipt_id',pg_temp.es(900+n),'rule','hyperkalemia','decision','blocked','severity',NULL,'reason','legacy_recipe','source_ids','[]'::jsonb)) FROM generate_series(21,24) n;
SELECT is((SELECT data->>'error_code' FROM scan_evidence WHERE label='legacy-after-'||n),'legacy_recipe','legacy uncompleted rule retired: '||n) FROM unnest(ARRAY[21,22,24]) n;
SELECT is((SELECT data->'result' FROM scan_evidence WHERE label='legacy-after-'||n),(SELECT data->'result' FROM scan_evidence WHERE label='legacy-before-'||n),'legacy prior triggered proposal retained: '||n) FROM unnest(ARRAY[21,22]) n;
SELECT is((SELECT data FROM scan_evidence WHERE label='legacy-after-23'),(SELECT data FROM scan_evidence WHERE label='legacy-before-23'),'completed legacy receipt byte-identical');
SELECT is((SELECT count(*) FROM public.alerts WHERE patient_id IN(pg_temp.es(21),pg_temp.es(22),pg_temp.es(23),pg_temp.es(24))),0::bigint,'legacy retirement creates no new effects');
SELECT throws_ok($q$SELECT public.finalize_alert_scan_rule(pg_temp.es_receipt(11),'proactive-frozen-v1',pg_temp.es_result(11))$q$,
 '22023','Scan recipe does not match capture','caller cannot downgrade captured v2');
-- Context cannot acquire an unknown recipient/org FK late. Actual new routing is retried.
SELECT public.begin_alert_effect_scope(pg_temp.es(25));
SELECT ok((SELECT profile_ids @> ARRAY[pg_temp.es(1),pg_temp.es(2),pg_temp.es(25)] FROM public.alert_effect_scope_context),'fence holds both potential owners and patient');
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES(pg_temp.es(3),pg_temp.es(25),'active',now());
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by)
 VALUES(public.primary_organization_for_provider(pg_temp.es(3)),pg_temp.es(25),pg_temp.es(3)) ON CONFLICT DO NOTHING;
SELECT throws_ok($q$SELECT public.coalesce_fenced_patient_alert(pg_temp.es(25),'critical',ARRAY['hyperkalemia'])$q$,
 '40001','Alert recipient scope changed','new owner/org refused before late FK');
SELECT is((SELECT count(*) FROM public.alerts WHERE patient_id=pg_temp.es(25)),0::bigint,'failed fence rolls back alert');
SELECT is((SELECT count(*) FROM public.work_items WHERE patient_id=pg_temp.es(25)),0::bigint,'failed fence rolls back earlier organization work');
SELECT is((SELECT count(*) FROM public.notification_intents WHERE patient_id=pg_temp.es(25)),0::bigint,'failed fence rolls back intents');
SELECT public.end_alert_effect_scope();
SELECT public.begin_alert_effect_scope(pg_temp.es(25));
SELECT lives_ok($q$SELECT public.coalesce_fenced_patient_alert(pg_temp.es(25),'critical',ARRAY['hyperkalemia'])$q$,'new attempt captures changed routing set');
SELECT public.end_alert_effect_scope();
SELECT is((SELECT count(*) FROM public.alert_effect_scope_context),0::bigint,'no private context residue after all outcomes');
SELECT * FROM finish();
ROLLBACK;
