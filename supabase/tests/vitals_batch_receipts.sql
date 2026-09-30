BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
SELECT has_table('public','vitals_submission_batches','durable batch identity');
SELECT has_table('public','vitals_submission_batch_rows','durable row identity');
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN('public.vitals_submission_batches'::regclass,'public.vitals_submission_batch_rows'::regclass)),'RLS on both tables');
SELECT ok(NOT has_table_privilege('authenticated','public.vitals_submission_batches','INSERT'),'browser cannot forge batch');
SELECT ok(NOT has_table_privilege('service_role','public.vitals_submission_batch_rows','UPDATE'),'service cannot change recipe history');
SELECT ok(NOT has_function_privilege('authenticated','public.capture_vitals_submission_kernel(uuid,uuid,numeric,text,integer,integer,integer,integer,integer,integer,boolean,integer,timestamptz,timestamptz,jsonb)','EXECUTE'),'kernel is not a browser capability');
SELECT ok(NOT has_function_privilege('service_role','public.capture_vitals_submission_kernel(uuid,uuid,numeric,text,integer,integer,integer,integer,integer,integer,boolean,integer,timestamptz,timestamptz,jsonb)','EXECUTE'),'kernel has no service grant');
SELECT ok(NOT has_function_privilege('anon','public.prepare_vitals_batch(uuid)','EXECUTE'),'anonymous cannot prepare');
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('46000000-0000-4000-8000-000000000001','batch-provider@example.invalid','{"consent_accepted":true}'),
 ('46000000-0000-4000-8000-000000000002','batch-other-provider@example.invalid','{"consent_accepted":true}'),
 ('46000000-0000-4000-8000-000000000011','batch-patient@example.invalid','{"consent_accepted":true}'),
 ('46000000-0000-4000-8000-000000000012','batch-overflow@example.invalid','{"consent_accepted":true}');
UPDATE public.profiles SET role='provider' WHERE id IN('46000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000002');
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 ('46000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000011','active',now()),
 ('46000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000012','active',now());
CREATE TEMP TABLE vb_results(label text PRIMARY KEY,result jsonb);
GRANT ALL ON vb_results TO authenticated,service_role;
CREATE FUNCTION pg_temp.vb_id(p_label text) RETURNS uuid LANGUAGE sql AS $$ SELECT (result->>'batch_id')::uuid FROM vb_results WHERE label=p_label $$;
CREATE FUNCTION pg_temp.vb_rows() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_array(jsonb_build_object('weight',180,'weight_unit','lbs','sbp',120,'dbp',80,'heart_rate',70,'spo2',90,'dyspnea',0,'recorded_at','2026-09-23T12:00:00Z'),
 jsonb_build_object('weight',82,'weight_unit','kg','sbp',120,'dbp',80,'heart_rate',70,'spo2',NULL,'dyspnea',0,'recorded_at','2026-09-22T12:00:00Z'),NULL,NULL,NULL,NULL,NULL)
$$;
CREATE FUNCTION pg_temp.vb_save(p_label text,p_rows jsonb DEFAULT pg_temp.vb_rows()) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.submit_vitals_batch('46000000-0000-4000-8000-000000000011',pg_temp.vb_id(p_label),p_rows)
$$;
CREATE FUNCTION pg_temp.vb_requests(p_label text) RETURNS uuid[] LANGUAGE sql AS $$
 SELECT array_agg(request_id ORDER BY row_index) FROM public.vitals_submission_batch_rows WHERE batch_id=pg_temp.vb_id(p_label)
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"46000000-0000-4000-8000-000000000011","role":"authenticated","aal":"aal1"}',true);
SELECT throws_ok($q$SELECT public.prepare_vitals_batch('46000000-0000-4000-8000-000000000011')$q$,'42501','Batch operation not authorized','patient cannot use provider batch');
SELECT set_config('request.jwt.claims','{"sub":"46000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
SELECT throws_ok($q$SELECT public.prepare_vitals_batch('46000000-0000-4000-8000-000000000011')$q$,'42501','Vitals operation not authorized','provider requires AAL2');
SELECT set_config('request.jwt.claims','{"sub":"46000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT public.prepare_vitals_batch('46000000-0000-4000-8000-000000000011')$q$,'42501','Vitals operation not authorized','unlinked provider denied');
SELECT set_config('request.jwt.claims','{"sub":"46000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
INSERT INTO vb_results VALUES('batch',public.prepare_vitals_batch('46000000-0000-4000-8000-000000000011'));
SELECT is(public.prepare_vitals_batch('46000000-0000-4000-8000-000000000011'),(SELECT result FROM vb_results WHERE label='batch'),'prepare replay same identity');
SELECT is(public.get_active_vitals_capture('46000000-0000-4000-8000-000000000011')->>'mode','batch','cross-mode recovery explicit');
SELECT throws_ok($q$SELECT public.prepare_vitals_submission('46000000-0000-4000-8000-000000000011')$q$,'23505','Recover the batch before continuing individual entry','individual prepare fenced by batch');
SELECT throws_ok($q$SELECT pg_temp.vb_save('batch','[null,null,null,null,null,null,null]')$q$,'22023','Batch needs at least one row','all blank denied');
SELECT throws_ok($q$SELECT pg_temp.vb_save('batch','[]')$q$,'22023','Invalid batch rows','exactly seven positions');
SELECT throws_ok($q$SELECT pg_temp.vb_save('batch',jsonb_set(pg_temp.vb_rows(),'{6}','{"spo2":85}'))$q$,'22023','Invalid batch row','invalid last row rejected');
SELECT is((SELECT count(*)::int FROM public.vitals),0,'validation failure writes no earlier vitals');
SELECT is((SELECT count(*)::int FROM public.symptoms),0,'validation failure writes no earlier symptoms');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_batch_rows),0,'validation failure leaves no row mappings');
SELECT is(public.get_vitals_batch('46000000-0000-4000-8000-000000000011',pg_temp.vb_id('batch'))->>'submission_status','prepared','invalid batch can be corrected under same ID');

RESET ROLE;
CREATE FUNCTION pg_temp.vb_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.weight_lbs<>180 THEN RAISE EXCEPTION 'synthetic later row failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER vb_fault AFTER INSERT ON public.vitals FOR EACH ROW EXECUTE FUNCTION pg_temp.vb_fault();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.vb_save('batch')$q$,'P0001','synthetic later row failure','later database error rolls back whole batch');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_receipts),0,'no earlier receipt after later-row fault');
SELECT is((SELECT count(*)::int FROM public.vitals),0,'no partial observations after later-row fault');
RESET ROLE;
DROP TRIGGER vb_fault ON public.vitals;
SET LOCAL ROLE authenticated;
INSERT INTO vb_results VALUES('saved',pg_temp.vb_save('batch'));
SELECT is((SELECT result->>'submission_status' FROM vb_results WHERE label='saved'),'committed','batch capture committed');
SELECT is((SELECT count(*)::int FROM public.vitals),2,'exactly two observations');
SELECT is((SELECT count(*)::int FROM public.symptoms WHERE red_flag IS NULL),2,'capture is not classification');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_attempts WHERE closed_status='batched'),2,'row closed as batched, not acknowledged');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_attempts WHERE closed_at IS NULL),0,'no leaked individual slot');
SELECT is((SELECT count(DISTINCT captured_at)::int FROM public.vitals_submission_receipts),1,'common batch clock');
SELECT is((SELECT weight_lbs FROM public.vitals WHERE weight_lbs<>180),180.8::numeric,'original kg conversion preserved');
SELECT is((SELECT jsonb_array_length(history) FROM public.vitals_submission_batch_rows WHERE row_index=0),0,'first row has only prior base');
SELECT is((SELECT jsonb_array_length(history) FROM public.vitals_submission_batch_rows WHERE row_index=1),1,'second row has earlier submitted row');
SELECT is((SELECT history->0->>'id' FROM public.vitals_submission_batch_rows WHERE row_index=1),
 (SELECT result#>>'{rows,0,receipt,vitals_id}' FROM vb_results WHERE label='saved'),'prepend order preserved even with reversed dates');
SELECT is(pg_temp.vb_save('batch'),(SELECT result FROM vb_results WHERE label='saved'),'lost response replay is byte-identical');
SELECT is(public.get_vitals_batch('46000000-0000-4000-8000-000000000011',pg_temp.vb_id('batch')),(SELECT result FROM vb_results WHERE label='saved'),'reload recovers saved rows');
SELECT throws_ok($q$SELECT pg_temp.vb_save('batch',jsonb_set(pg_temp.vb_rows(),'{0,weight}','181'))$q$,'23505','Batch payload differs','changed values cannot replace batch');
SELECT throws_ok($q$SELECT pg_temp.vb_save('batch',jsonb_set(pg_temp.vb_rows(),'{0,recorded_at}','"2026-09-24T12:00:00Z"'))$q$,'23505','Batch payload differs','changed dates cannot replace batch');
SELECT is(public.cancel_vitals_batch('46000000-0000-4000-8000-000000000011',pg_temp.vb_id('batch'))->>'submission_status','committed','cancel after save recovers rather than erases');
SELECT is(public.list_pending_vitals_submissions('46000000-0000-4000-8000-000000000011')->>'total','0','active batch is not duplicated in acknowledged pending list');
SELECT throws_ok($q$SELECT public.acknowledge_vitals_batch('46000000-0000-4000-8000-000000000011',pg_temp.vb_id('batch'),ARRAY[]::uuid[])$q$,'22023','Batch receipt does not match','empty ACK rejected');
SELECT throws_ok($q$SELECT public.acknowledge_vitals_batch('46000000-0000-4000-8000-000000000011',pg_temp.vb_id('batch'),(pg_temp.vb_requests('batch'))[1:1])$q$,'22023','Batch receipt does not match','partial ACK rejected');
SELECT throws_ok($q$SELECT public.acknowledge_vitals_batch('46000000-0000-4000-8000-000000000011',pg_temp.vb_id('batch'),pg_temp.vb_requests('batch')||pg_temp.vb_requests('batch'))$q$,'22023','Batch receipt does not match','duplicate ACK rejected');
SELECT throws_ok($q$SELECT public.acknowledge_vitals_batch('46000000-0000-4000-8000-000000000011',pg_temp.vb_id('batch'),pg_temp.vb_requests('batch')||gen_random_uuid())$q$,'22023','Batch receipt does not match','extra or foreign ID rejected');
SELECT throws_ok($q$SELECT public.acknowledge_vitals_submission('46000000-0000-4000-8000-000000000011',(pg_temp.vb_requests('batch'))[1],
 (SELECT (result#>>'{rows,0,receipt,vitals_id}')::uuid FROM vb_results WHERE label='saved'),
 (SELECT (result#>>'{rows,0,receipt,symptoms_id}')::uuid FROM vb_results WHERE label='saved'))$q$,'23505','Recover the batch before continuing individual entry','individual ACK cannot release batch');
SELECT is(public.acknowledge_vitals_batch('46000000-0000-4000-8000-000000000011',pg_temp.vb_id('batch'),pg_temp.vb_requests('batch'))->>'submission_status','acknowledged','exact set ACK releases batch');
SELECT is(public.acknowledge_vitals_batch('46000000-0000-4000-8000-000000000011',pg_temp.vb_id('batch'),pg_temp.vb_requests('batch'))->>'submission_status','acknowledged','ACK replay harmless');
SELECT is(public.list_pending_vitals_submissions('46000000-0000-4000-8000-000000000011')->>'total','2','both unresolved batch rows remain discoverable');
SELECT is(public.get_active_vitals_capture('46000000-0000-4000-8000-000000000011'),NULL::jsonb,'ACK frees active mode');
INSERT INTO vb_results VALUES('individual',public.prepare_vitals_submission('46000000-0000-4000-8000-000000000011'));
SELECT is(pg_temp.vb_save('batch')->>'submission_status','acknowledged','old batch replay allowed while new individual is active');
SELECT throws_ok($q$SELECT public.prepare_vitals_batch('46000000-0000-4000-8000-000000000011')$q$,'23505','Recover the individual entry before continuing the batch','batch prepare fenced by individual');
SELECT is(public.get_active_vitals_capture('46000000-0000-4000-8000-000000000011')->>'mode','individual','batch screen can recover conflicting individual');
SELECT public.cancel_vitals_submission('46000000-0000-4000-8000-000000000011',(SELECT (result->>'request_id')::uuid FROM vb_results WHERE label='individual'));
INSERT INTO vb_results VALUES('individual-saved',public.submit_vitals_submission('46000000-0000-4000-8000-000000000011',
 (public.prepare_vitals_submission('46000000-0000-4000-8000-000000000011')->>'request_id')::uuid,180,'lbs',120,80,70,NULL,0,0,false,0));
SELECT public.acknowledge_vitals_submission('46000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vb_results WHERE label='individual-saved'),
 (SELECT (result->>'vitals_id')::uuid FROM vb_results WHERE label='individual-saved'),
 (SELECT (result->>'symptoms_id')::uuid FROM vb_results WHERE label='individual-saved'));
INSERT INTO vb_results VALUES('cancel',public.prepare_vitals_batch('46000000-0000-4000-8000-000000000011'));
SELECT is(public.get_vitals_submission('46000000-0000-4000-8000-000000000011')->>'mode','batch','individual initial recovery reports active batch');
SELECT is(public.submit_vitals_submission('46000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vb_results WHERE label='individual-saved'),180,'lbs',120,80,70,NULL,0,0,false,0)->>'submission_status',
 'acknowledged','old individual replay allowed while batch active');
SELECT is(public.acknowledge_vitals_submission('46000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vb_results WHERE label='individual-saved'),
 (SELECT (result->>'vitals_id')::uuid FROM vb_results WHERE label='individual-saved'),
 (SELECT (result->>'symptoms_id')::uuid FROM vb_results WHERE label='individual-saved'))->>'submission_status','acknowledged','old individual ACK allowed during new batch');
SELECT is(public.cancel_vitals_submission('46000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vb_results WHERE label='individual'))->>'submission_status','cancelled','old cancelled individual replay allowed during batch');
SELECT is(pg_temp.vb_save('batch',jsonb_set(jsonb_set(pg_temp.vb_rows(),'{0,sbp}','"120"'),'{0,recorded_at}','"2026-09-23T08:00:00-04:00"'))->>'submission_status',
 'acknowledged','scalar and timezone equivalents replay without new capture');
SELECT is(pg_temp.vb_save('batch',jsonb_set(pg_temp.vb_rows(),'{1}',(pg_temp.vb_rows()->1)-'spo2'))->>'submission_status',
 'acknowledged','omitted optional SpO2 and explicit null are canonical equivalents');
SELECT is(public.cancel_vitals_batch('46000000-0000-4000-8000-000000000011',pg_temp.vb_id('cancel'))->>'submission_status','cancelled','unsaved cancel terminal');
SELECT throws_ok($q$SELECT pg_temp.vb_save('cancel')$q$,'23505','Batch is closed','delayed save fenced after cancellation');

RESET ROLE;
SELECT throws_ok($q$UPDATE public.vitals_submission_batch_rows SET history='[]'$q$,'P0001','Batch provenance is immutable','privileged recipe drift denied');
SELECT throws_ok($q$UPDATE public.vitals_submission_batches SET input='[null,null,null,null,null,null,null]' WHERE captured_at IS NOT NULL$q$,'P0001','Batch provenance is immutable','privileged payload drift denied');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$SELECT public.finalize_vitals_submission_evaluation((pg_temp.vb_requests('batch'))[1],'46000000-0000-4000-8000-000000000001','vitals-frozen-individual-v1',ARRAY['spo2_low'])$q$,
 '22023','Invalid vitals evaluation','batch cannot use individual recipe');
SELECT is(public.finalize_vitals_submission_evaluation((pg_temp.vb_requests('batch'))[1],'46000000-0000-4000-8000-000000000001','vitals-frozen-batch-v1',ARRAY['spo2_low'])->>'status','complete','batch recipe finalized');
SELECT is(public.finalize_vitals_submission_evaluation((pg_temp.vb_requests('batch'))[1],'46000000-0000-4000-8000-000000000001','vitals-frozen-batch-v1',ARRAY['spo2_low'])->>'attempts','1','batch evaluation replay idempotent');
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT occurrence_count FROM public.alerts),1,'replay does not increment alert');
SET LOCAL ROLE service_role;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"46000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT is(public.list_pending_vitals_submissions('46000000-0000-4000-8000-000000000011')->>'total','2','unfinished batch row and acknowledged individual remain pending');
SELECT set_config('request.jwt.claims','{"sub":"46000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
SELECT is((SELECT count(*)::int FROM public.vitals_submission_batches),0,'other provider cannot see batch');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_batch_rows),0,'other provider cannot see context');
RESET ROLE;
UPDATE public.provider_patient_links SET status='revoked' WHERE patient_id='46000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"46000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT public.get_vitals_batch('46000000-0000-4000-8000-000000000011',pg_temp.vb_id('batch'))$q$,'42501','Vitals operation not authorized','revoked access blocks recovery');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_batch_rows),0,'revoked actor cannot select frozen history');

-- Exactly1,000 prior observations plus seven rows must fit without re-query overflow.
RESET ROLE;
INSERT INTO public.vitals(patient_id,recorded_at,weight_lbs,sbp,dbp,heart_rate,source)
 SELECT '46000000-0000-4000-8000-000000000012',clock_timestamp()-interval '1 hour',180,120,80,70,'provider_entry' FROM generate_series(1,1000);
SET LOCAL ROLE authenticated;
INSERT INTO vb_results VALUES('limit',public.prepare_vitals_batch('46000000-0000-4000-8000-000000000012'));
SELECT lives_ok($q$SELECT public.submit_vitals_batch('46000000-0000-4000-8000-000000000012',pg_temp.vb_id('limit'),
 (SELECT jsonb_agg(pg_temp.vb_rows()->0) FROM generate_series(1,7)))$q$,'1000 base plus seven captured rows accepted');
SELECT is((SELECT jsonb_array_length(history) FROM public.vitals_submission_batch_rows WHERE batch_id=pg_temp.vb_id('limit') AND row_index=6),1006,'last recipe history contains1006 prior-only entries');
SELECT is((SELECT count(DISTINCT receipt.captured_at)::int FROM public.vitals_submission_receipts AS receipt
 JOIN public.vitals_submission_batch_rows AS mapping USING(request_id) WHERE mapping.batch_id=pg_temp.vb_id('limit')),1,'all seven use same captured instant');
SELECT is((SELECT count(DISTINCT receipt.history)::int FROM public.vitals_submission_receipts AS receipt
 JOIN public.vitals_submission_batch_rows AS mapping USING(request_id) WHERE mapping.batch_id=pg_temp.vb_id('limit')),1,'all seven preserve identical raw base');
SELECT public.acknowledge_vitals_batch('46000000-0000-4000-8000-000000000012',pg_temp.vb_id('limit'),pg_temp.vb_requests('limit'));
INSERT INTO vb_results VALUES('overflow',public.prepare_vitals_batch('46000000-0000-4000-8000-000000000012'));
SELECT throws_ok($q$SELECT public.submit_vitals_batch('46000000-0000-4000-8000-000000000012',pg_temp.vb_id('overflow'),pg_temp.vb_rows())$q$,
 '54000','Vitals capture history limit exceeded','overflow rejects without silently truncating history');
SELECT is((SELECT count(*)::int FROM public.vitals WHERE patient_id='46000000-0000-4000-8000-000000000012'),1007,'overflow writes no extra observations');
SELECT is(public.get_vitals_batch('46000000-0000-4000-8000-000000000012',pg_temp.vb_id('overflow'))->>'submission_status','prepared','overflow preserves recoverable prepared identity');

RESET ROLE;
UPDATE public.profiles SET role='tester',sandbox_expires_at=now()-interval '1 hour' WHERE id='46000000-0000-4000-8000-000000000012';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT lives_ok($q$SELECT public.purge_expired_tester_provenance('46000000-0000-4000-8000-000000000012')$q$,'target tester purge removes batch provenance');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_batches WHERE patient_id='46000000-0000-4000-8000-000000000012'),0,'no batch orphan');
SELECT is((SELECT vitals_batch_rows_deleted FROM public.lab_provenance_erasures WHERE actor_id='46000000-0000-4000-8000-000000000012'),7,'new row audit count separate');
SELECT is((SELECT vitals_batches_deleted FROM public.lab_provenance_erasures WHERE actor_id='46000000-0000-4000-8000-000000000012'),2,'new batch audit count includes unsaved attempt separately');
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.vitals WHERE patient_id='46000000-0000-4000-8000-000000000012'),1007,'provenance purge does not invent observation deletion');
SET LOCAL ROLE service_role;
RESET ROLE;
UPDATE public.profiles SET role='tester',sandbox_expires_at=now()-interval '1 hour' WHERE id='46000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
-- This former provider is ALSO the historical recipient of an unresolved N2
-- intent. Role conversion must not disguise subject erasure as actor cleanup.
SELECT throws_ok($q$SELECT public.purge_expired_tester_provenance('46000000-0000-4000-8000-000000000001')$q$,
 '23503','Notification subject evidence requires explicit disposition','historical recipient requires disposition before actor purge');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_batches),2,'blocked purge preserves both actor batches');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_batch_rows),2,'blocked purge preserves recipe mappings');
SELECT is((SELECT count(*)::int FROM public.lab_provenance_erasures WHERE actor_id='46000000-0000-4000-8000-000000000001'),0,'blocked purge creates no partial erasure receipt');
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.vitals WHERE patient_id='46000000-0000-4000-8000-000000000011'),3,'blocked purge preserves third-party patient observations');
SET LOCAL ROLE service_role;
SELECT * FROM finish();
ROLLBACK;
