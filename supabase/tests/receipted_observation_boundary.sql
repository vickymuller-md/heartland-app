-- Real API-role denial and supported capture, with rolled-back synthetic fixtures.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
SELECT ok(NOT has_table_privilege(role_name,table_name,'INSERT'),role_name||' table INSERT denied on '||table_name)
 FROM unnest(ARRAY['anon','authenticated','service_role']) AS role_name
 CROSS JOIN unnest(ARRAY['public.vitals','public.symptoms']) AS table_name;
SELECT ok(NOT has_any_column_privilege(role_name,table_name,'INSERT'),role_name||' every column INSERT denied on '||table_name)
 FROM unnest(ARRAY['anon','authenticated','service_role']) AS role_name
 CROSS JOIN unnest(ARRAY['public.vitals','public.symptoms']) AS table_name;
SELECT ok((SELECT bool_and(prosecdef AND pg_get_userbyid(proowner)='postgres') FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname IN ('capture_vitals_submission_kernel','submit_vitals_submission','submit_vitals_batch')),
 'supported capture keeps definer authority');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.vitals'::regclass AND tgname='on_vitals_insert'),
 'SQL webhook remains absent; no inference about hosted dashboard webhooks');
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('53000000-0000-4000-8000-000000000001','boundary-provider@example.invalid','{"consent_accepted":true}'),
 ('53000000-0000-4000-8000-000000000011','boundary-patient@example.invalid','{"consent_accepted":true}'),
 ('53000000-0000-4000-8000-000000000012','boundary-individual@example.invalid','{"consent_accepted":true}'),
 ('53000000-0000-4000-8000-000000000013','boundary-batch@example.invalid','{"consent_accepted":true}');
UPDATE public.profiles SET role='provider' WHERE id='53000000-0000-4000-8000-000000000001';
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT '53000000-0000-4000-8000-000000000001',id,'active',now() FROM public.profiles WHERE role='patient';
CREATE TEMP TABLE boundary_receipts(label text PRIMARY KEY,result jsonb);
GRANT ALL ON boundary_receipts TO authenticated,service_role;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"53000000-0000-4000-8000-000000000011","role":"authenticated","aal":"aal1"}',true);
SELECT throws_ok($q$INSERT INTO public.vitals(patient_id,weight_lbs,source) VALUES('53000000-0000-4000-8000-000000000011',180,'patient_app')$q$,
 '42501',NULL,'consented patient cannot bypass receipt by raw vitals INSERT');
SELECT throws_ok($q$INSERT INTO public.symptoms(patient_id,dyspnea) VALUES('53000000-0000-4000-8000-000000000011',3)$q$,
 '42501',NULL,'consented patient cannot bypass receipt by raw symptoms INSERT');
INSERT INTO boundary_receipts VALUES('patient-prepare',public.prepare_vitals_submission('53000000-0000-4000-8000-000000000011'));
SELECT lives_ok($q$INSERT INTO boundary_receipts VALUES('patient-saved',public.submit_vitals_submission(
 '53000000-0000-4000-8000-000000000011',(SELECT (result->>'request_id')::uuid FROM boundary_receipts WHERE label='patient-prepare'),
 180,'lbs',120,80,70,98,0,0,false,0,NULL))$q$,'patient capture through definer remains available');
SELECT is((SELECT result->>'submission_status' FROM boundary_receipts WHERE label='patient-saved'),'committed','patient receives durable receipt');
SELECT is((SELECT count(*)::int FROM public.vitals),1,'denied raw patient insert added no source');
SELECT is((SELECT count(*)::int FROM public.symptoms),1,'patient source pair remains atomic');
SELECT is((SELECT result->>'evaluation_status' FROM boundary_receipts WHERE label='patient-saved'),'pending','capture does not claim completed evaluation');

SELECT set_config('request.jwt.claims','{"sub":"53000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT throws_ok($q$INSERT INTO public.vitals(patient_id,weight_lbs,source) VALUES('53000000-0000-4000-8000-000000000012',180,'provider_entry')$q$,
 '42501',NULL,'linked AAL2 provider cannot bypass receipt with raw vitals');
SELECT throws_ok($q$INSERT INTO public.symptoms(patient_id,dyspnea) VALUES('53000000-0000-4000-8000-000000000012',3)$q$,
 '42501',NULL,'linked AAL2 provider cannot bypass receipt with raw symptoms');
INSERT INTO boundary_receipts VALUES('provider-prepare',public.prepare_vitals_submission('53000000-0000-4000-8000-000000000012'));
SELECT lives_ok($q$INSERT INTO boundary_receipts VALUES('provider-saved',public.submit_vitals_submission(
 '53000000-0000-4000-8000-000000000012',(SELECT (result->>'request_id')::uuid FROM boundary_receipts WHERE label='provider-prepare'),
 180,'lbs',120,80,70,98,0,0,false,0,'2026-09-24T00:00:00Z'))$q$,'linked provider capture through definer remains available');
SELECT is((SELECT result->>'submission_status' FROM boundary_receipts WHERE label='provider-saved'),'committed','provider receives durable receipt');
INSERT INTO boundary_receipts VALUES('batch-prepare',public.prepare_vitals_batch('53000000-0000-4000-8000-000000000013'));
SELECT lives_ok($q$INSERT INTO boundary_receipts VALUES('batch-saved',public.submit_vitals_batch(
 '53000000-0000-4000-8000-000000000013',(SELECT (result->>'batch_id')::uuid FROM boundary_receipts WHERE label='batch-prepare'),
 '[{"weight":180,"weight_unit":"lbs","sbp":120,"dbp":80,"heart_rate":70,"spo2":98,"dyspnea":0,"recorded_at":"2026-09-24T00:00:00Z"},null,null,null,null,null,null]'::jsonb))$q$,
 'provider batch keeps definer authority without restoring blanket INSERT');
SELECT is((SELECT result->>'submission_status' FROM boundary_receipts WHERE label='batch-saved'),'committed','batch receives durable receipt');

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$INSERT INTO public.vitals(patient_id,weight_lbs) VALUES('53000000-0000-4000-8000-000000000011',180)$q$,
 '42501',NULL,'service raw vitals INSERT also denied');
SELECT throws_ok($q$INSERT INTO public.symptoms(patient_id,dyspnea) VALUES('53000000-0000-4000-8000-000000000011',3)$q$,
 '42501',NULL,'service raw symptoms INSERT also denied');
SELECT is((SELECT count(*)::int FROM public.vitals),3,'only three receipted observations exist');
SELECT is((SELECT count(*)::int FROM public.symptoms),3,'only three receipted symptom rows exist');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_receipts),3,'every captured source has a receipt');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_evaluations WHERE status='pending'),3,'every capture has recoverable pending evaluation');
SELECT lives_ok($q$SELECT public.finalize_vitals_submission_evaluation(
 (SELECT (result->>'request_id')::uuid FROM boundary_receipts WHERE label='patient-saved'),
 '53000000-0000-4000-8000-000000000011','vitals-frozen-individual-v1',ARRAY[]::text[])$q$,
 'existing evaluator still updates the receipted symptom classification');
SELECT is((SELECT status FROM public.vitals_submission_evaluations WHERE request_id=(SELECT (result->>'request_id')::uuid FROM boundary_receipts WHERE label='patient-saved')),
 'complete','evaluation completion remains distinct from capture');
SELECT is((SELECT red_flag FROM public.symptoms WHERE id=(SELECT (result->>'symptoms_id')::uuid FROM boundary_receipts WHERE label='patient-saved')),
 false,'evaluator retains authorized classification update');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
