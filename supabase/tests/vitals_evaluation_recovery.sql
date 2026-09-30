BEGIN;
SET LOCAL search_path = public, extensions;
SELECT no_plan();
SELECT has_table('public','vitals_submission_evaluations','durable evaluation state exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.vitals_submission_evaluations'::regclass),'evaluation RLS enabled');
SELECT ok(NOT has_function_privilege('authenticated','public.finalize_vitals_submission_evaluation(uuid,uuid,text,text[])','EXECUTE'),'browser cannot choose evaluated flags');
SELECT ok(NOT has_function_privilege('anon','public.finalize_vitals_submission_evaluation(uuid,uuid,text,text[])','EXECUTE'),'anonymous cannot finalize');
SELECT ok(NOT has_table_privilege('service_role','public.vitals_submission_evaluations','UPDATE'),'even service must use finalizer');
SELECT ok(NOT has_table_privilege('authenticated','public.vitals_submission_evaluations','INSERT'),'client cannot forge result');
SELECT ok(NOT has_function_privilege('authenticated','public.create_vitals_submission_evaluation()','EXECUTE'),'internal trigger inaccessible');

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('45000000-0000-4000-8000-000000000001','eval-provider@example.invalid','{"consent_accepted":true}'),
 ('45000000-0000-4000-8000-000000000011','eval-patient@example.invalid','{"consent_accepted":true}'),
 ('45000000-0000-4000-8000-000000000012','eval-other@example.invalid','{"consent_accepted":true}');
UPDATE public.profiles SET role='provider' WHERE id='45000000-0000-4000-8000-000000000001';
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 ('45000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000011','active',now());
CREATE TEMP TABLE ve_results(label text PRIMARY KEY,result jsonb);
GRANT ALL ON ve_results TO authenticated,service_role;
CREATE FUNCTION pg_temp.ve_request(p_label text) RETURNS uuid LANGUAGE sql AS $$
 SELECT (result->>'request_id')::uuid FROM ve_results WHERE label=p_label
$$;
CREATE FUNCTION pg_temp.ve_finish(p_label text,p_flags text[]) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.finalize_vitals_submission_evaluation(pg_temp.ve_request(p_label),
 '45000000-0000-4000-8000-000000000001','vitals-frozen-individual-v1',p_flags)
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"45000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
INSERT INTO ve_results VALUES ('critical',public.prepare_vitals_submission('45000000-0000-4000-8000-000000000011'));
INSERT INTO ve_results VALUES ('capture',public.submit_vitals_submission('45000000-0000-4000-8000-000000000011',
 pg_temp.ve_request('critical'),180,'lbs',120,80,70,90,0,0,false,0));
SELECT is((SELECT status FROM public.vitals_submission_evaluations WHERE request_id=pg_temp.ve_request('critical')),'pending','capture creates pending evaluation');
SELECT is((SELECT red_flag FROM public.symptoms),NULL::boolean,'not evaluated is not normal');
SELECT throws_ok($q$SELECT pg_temp.ve_finish('critical',ARRAY[]::text[])$q$,'42501',NULL,'authenticated cannot suppress flags');
SELECT throws_ok($q$UPDATE public.vitals SET weight_lbs=181$q$,'42501',NULL,'browser cannot change captured vitals');

RESET ROLE;
SELECT throws_ok($q$UPDATE public.vitals SET weight_lbs=181$q$,'P0001','Receipted observations are immutable','privileged source drift blocked');
SELECT throws_ok($q$UPDATE public.symptoms SET red_flag=false$q$,'P0001','Receipted observations are immutable','privileged false normal blocked before evaluation');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$SELECT pg_temp.ve_finish('critical',ARRAY['unknown'])$q$,'22023','Invalid vitals evaluation','unknown rule rejected');
SELECT throws_ok($q$SELECT pg_temp.ve_finish('critical',ARRAY[NULL]::text[])$q$,'22023','Invalid vitals evaluation','null flag rejected');
SELECT throws_ok($q$SELECT public.finalize_vitals_submission_evaluation(pg_temp.ve_request('critical'),
 '45000000-0000-4000-8000-000000000012','vitals-frozen-individual-v1',ARRAY['spo2_low'])$q$,
 '42501','Vitals evaluation not authorized','wrong actor denied');
INSERT INTO ve_results VALUES ('evaluated',pg_temp.ve_finish('critical',ARRAY['spo2_low','spo2_low']));
SELECT is((SELECT result->>'status' FROM ve_results WHERE label='evaluated'),'complete','critical evaluation committed');
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT red_flag FROM public.symptoms),true,'symptom classification committed with alert');
SELECT is((SELECT count(*)::int FROM public.alerts),1,'one alert');
SELECT is((SELECT flags FROM public.alerts),ARRAY['spo2_low'],'correct mapping');
SET LOCAL ROLE service_role;
SELECT is(pg_temp.ve_finish('critical',ARRAY['spo2_low']),
 (SELECT result FROM ve_results WHERE label='evaluated'),'lost finalizer response replays exact result');
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT occurrence_count FROM public.alerts),1,'retry does not coalesce twice');
SET LOCAL ROLE service_role;
SELECT is((SELECT attempts FROM public.vitals_submission_evaluations),1,'completed retry does not count another evaluation');
SELECT throws_ok($q$SELECT pg_temp.ve_finish('critical',ARRAY[]::text[])$q$,'23505','Vitals evaluation differs','changed flags cannot replace result');
SELECT throws_ok($q$DELETE FROM public.vitals_submission_evaluations$q$,'42501',NULL,'service cannot erase provenance directly');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"45000000-0000-4000-8000-000000000012","role":"authenticated","aal":"aal1"}',true);
SELECT is((SELECT count(*)::int FROM public.vitals_submission_evaluations),0,'other actor cannot read result');
SELECT set_config('request.jwt.claims','{"sub":"45000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT is(public.get_vitals_submission('45000000-0000-4000-8000-000000000011')->>'evaluation_status','complete','recovery reports current status');
SELECT is(public.get_vitals_submission('45000000-0000-4000-8000-000000000011')#>>'{observation,symptoms,red_flag}',NULL::text,'raw capture remains unchanged');
SELECT public.acknowledge_vitals_submission('45000000-0000-4000-8000-000000000011',pg_temp.ve_request('critical'),
 (SELECT (result->>'vitals_id')::uuid FROM ve_results WHERE label='capture'),
 (SELECT (result->>'symptoms_id')::uuid FROM ve_results WHERE label='capture'));
INSERT INTO ve_results VALUES ('failure',public.prepare_vitals_submission('45000000-0000-4000-8000-000000000011'));
INSERT INTO ve_results VALUES ('failure-capture',public.submit_vitals_submission('45000000-0000-4000-8000-000000000011',
 pg_temp.ve_request('failure'),180,'lbs',120,80,70,NULL,3,0,false,0));

RESET ROLE;
CREATE FUNCTION pg_temp.ve_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic alert failure'; END $$;
CREATE TRIGGER ve_fail AFTER INSERT OR UPDATE ON public.alerts FOR EACH ROW EXECUTE FUNCTION pg_temp.ve_fail();
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(pg_temp.ve_finish('failure',ARRAY['dyspnea_rest'])->>'status','failed','coalescer failure persists retry state');
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.alerts),1,'failed coalescer effects rolled back');
SELECT is((SELECT red_flag FROM public.symptoms WHERE id=(SELECT (result->>'symptoms_id')::uuid FROM ve_results WHERE label='failure-capture')),
 NULL::boolean,'failed evaluation never marks symptoms normal');
SET LOCAL ROLE service_role;
SELECT is((SELECT flags FROM public.vitals_submission_evaluations WHERE request_id=pg_temp.ve_request('failure')),NULL::text[],'failed result not published as complete');
SELECT is((SELECT last_error_code FROM public.vitals_submission_evaluations WHERE request_id=pg_temp.ve_request('failure')),'P0001','sanitized error code only');
RESET ROLE;
DROP TRIGGER ve_fail ON public.alerts;
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id='45000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT pg_temp.ve_finish('failure',ARRAY['dyspnea_rest'])$q$,'42501','Vitals evaluation not authorized','revoked link blocks privileged finalization');
RESET ROLE;
UPDATE public.provider_patient_links SET status='active' WHERE provider_id='45000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT is(pg_temp.ve_finish('failure',ARRAY['dyspnea_rest'])->>'status','complete','retry completes original capture');
SELECT is((SELECT attempts FROM public.vitals_submission_evaluations WHERE request_id=pg_temp.ve_request('failure')),2,'failure and retry counted');
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.vitals),2,'retry never creates new observations');
SELECT is((SELECT count(*)::int FROM public.alerts),2,'retry records one new signal');
SELECT is((SELECT flags FROM public.alerts WHERE id=(SELECT alert_id FROM public.vitals_submission_evaluations WHERE request_id=pg_temp.ve_request('failure'))),
 ARRAY['dyspnea_severe'],'dyspnea maps to operational flag');
SET LOCAL ROLE service_role;

-- Patient self-entry with a no-alert evaluation and explicit no-delivery semantics.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"45000000-0000-4000-8000-000000000012","role":"authenticated","aal":"aal1"}',true);
INSERT INTO ve_results VALUES ('no-alert',public.prepare_vitals_submission('45000000-0000-4000-8000-000000000012'));
SELECT public.submit_vitals_submission('45000000-0000-4000-8000-000000000012',pg_temp.ve_request('no-alert'),
 180,'lbs',120,80,70,NULL,0,0,false,0);
SELECT is(public.list_pending_vitals_submissions('45000000-0000-4000-8000-000000000012')->>'total','0','active receipt not duplicated in acknowledged pending list');
SELECT public.acknowledge_vitals_submission('45000000-0000-4000-8000-000000000012',pg_temp.ve_request('no-alert'),
 (public.get_vitals_submission('45000000-0000-4000-8000-000000000012')->>'vitals_id')::uuid,
 (public.get_vitals_submission('45000000-0000-4000-8000-000000000012')->>'symptoms_id')::uuid);
SELECT is(public.list_pending_vitals_submissions('45000000-0000-4000-8000-000000000012')->>'total','1','ack releases capture but preserves visible pending evaluation');
SELECT is(public.list_pending_vitals_submissions('45000000-0000-4000-8000-000000000012')#>>'{receipts,0,request_id}',
 pg_temp.ve_request('no-alert')::text,'pending record retains exact identity across reload');
SELECT throws_ok($q$SELECT public.list_pending_vitals_submissions('45000000-0000-4000-8000-000000000011')$q$,
 '42501','Vitals operation not authorized','pending list does not cross patient scope');
SELECT throws_ok($q$SELECT public.list_pending_vitals_submissions('45000000-0000-4000-8000-000000000012',-1)$q$,
 '22023','Invalid pending page','invalid pagination rejected');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(public.finalize_vitals_submission_evaluation(pg_temp.ve_request('no-alert'),
 '45000000-0000-4000-8000-000000000012','vitals-frozen-individual-v1',ARRAY[]::text[])->>'status','complete','zero flags is an actual completed evaluation');
SELECT is((SELECT alert_id FROM public.vitals_submission_evaluations WHERE request_id=pg_temp.ve_request('no-alert')),NULL::uuid,'no invented alert for zero flags');
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT red_flag FROM public.symptoms WHERE patient_id='45000000-0000-4000-8000-000000000012'),false,'normal only after evaluation');
SET LOCAL ROLE service_role;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"45000000-0000-4000-8000-000000000012","role":"authenticated","aal":"aal1"}',true);
SELECT is(public.list_pending_vitals_submissions('45000000-0000-4000-8000-000000000012')->>'total','0','completed evaluation leaves pending list');
DO $$ DECLARE v_request uuid; v_receipt jsonb; BEGIN
 FOR i IN 1..21 LOOP
  v_request := (public.prepare_vitals_submission('45000000-0000-4000-8000-000000000012')->>'request_id')::uuid;
  v_receipt := public.submit_vitals_submission('45000000-0000-4000-8000-000000000012',v_request,180,'lbs',120,80,70,NULL,0,0,false,0);
  PERFORM public.acknowledge_vitals_submission('45000000-0000-4000-8000-000000000012',v_request,
   (v_receipt->>'vitals_id')::uuid,(v_receipt->>'symptoms_id')::uuid);
 END LOOP;
END $$;
SELECT is(public.list_pending_vitals_submissions('45000000-0000-4000-8000-000000000012')->>'total','21','bounded list reports true total');
SELECT is(jsonb_array_length(public.list_pending_vitals_submissions('45000000-0000-4000-8000-000000000012')->'receipts'),20,'first pending page bounded');
SELECT is(jsonb_array_length(public.list_pending_vitals_submissions('45000000-0000-4000-8000-000000000012',20)->'receipts'),1,'last pending page remains accessible');
SELECT is(public.get_vitals_submission('45000000-0000-4000-8000-000000000012'),NULL::jsonb,'acknowledged pending records do not block next capture');
RESET ROLE;
UPDATE public.profiles SET role='tester',sandbox_expires_at=now()-interval '1 hour' WHERE id='45000000-0000-4000-8000-000000000012';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT public.purge_expired_tester_provenance('45000000-0000-4000-8000-000000000012');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_evaluations WHERE request_id=pg_temp.ve_request('no-alert')),0,'audited erasure cascades evaluation provenance');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_evaluations),2,'other actors evaluations preserved');
SELECT * FROM finish();
ROLLBACK;
