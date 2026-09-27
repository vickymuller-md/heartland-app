-- ED01, synthetic fixtures only; every write and deletion is rolled back.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
CREATE FUNCTION pg_temp.edu_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('58000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
CREATE FUNCTION pg_temp.edu_submit(domain_id text, option_index integer, base bigint, request_no integer)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.submit_education_response(auth.uid(),domain_id,pg_temp.edu_id(request_no),option_index,base,
    '0e09e605951318ccbfdd93a53cd2c87e67645c46d859ac022ed4bcb7b32ca03a')
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
  SELECT pg_temp.edu_id(n),'edu-'||n||'@example.invalid','{"consent_accepted":true}'::jsonb
  FROM generate_series(1,4) n;
UPDATE public.profiles SET role='provider' WHERE id=pg_temp.edu_id(3);
UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.edu_id(4);

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.education_response_state'::regclass),'receipt RLS enabled');
SELECT ok(NOT has_table_privilege(r,'public.education_response_state','SELECT,INSERT,UPDATE,DELETE'),'receipt is private to '||r)
  FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT ok(NOT has_any_column_privilege(r,'public.education_progress','INSERT,UPDATE'),'all column writes revoked from '||r)
  FROM unnest(ARRAY['anon','authenticated']) r;
SELECT ok(NOT has_table_privilege('authenticated','public.education_progress','DELETE'),'no API reset by deletion');
SELECT ok(has_table_privilege('authenticated','public.education_progress','SELECT'),'existing scoped reads retained');
SELECT ok(NOT has_function_privilege(r,'public.submit_education_response(uuid,text,uuid,integer,bigint,text)','EXECUTE'),'writer unavailable to '||r)
  FROM unnest(ARRAY['anon','service_role']) r;
SELECT ok(NOT has_function_privilege(r,'public.get_education_response_context(uuid,text)','EXECUTE'),'reader unavailable to '||r)
  FROM unnest(ARRAY['anon','service_role']) r;
SELECT ok(prosecdef AND proconfig @> ARRAY['search_path=""'],'definer has fixed path: '||proname)
  FROM pg_proc WHERE proname IN ('get_education_response_context','submit_education_response');
SELECT ok((SELECT proconfig @> ARRAY['lock_timeout=5s'] FROM pg_proc WHERE proname='submit_education_response'),'bounded write lock wait');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid='public.education_response_state'::regclass AND confrelid IN ('public.patients'::regclass,'public.profiles'::regclass)),0,'no new ambiguous PostgREST junction');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.edu_id(1),'role','authenticated')::text,true);
SELECT is(public.get_education_response_context(pg_temp.edu_id(1),'daily_weight')->>'revision','0','initial revision is zero');
SELECT is(public.get_education_response_context(pg_temp.edu_id(1),'daily_weight')->>'attempts','0','initial attempts zero');
SELECT throws_ok($q$SELECT public.get_education_response_context(pg_temp.edu_id(2),'daily_weight')$q$,'42501',NULL,'page identity mismatch read refused');
SELECT throws_ok($q$SELECT public.submit_education_response(pg_temp.edu_id(2),'daily_weight',pg_temp.edu_id(101),1,0,'old')$q$,'42501',NULL,'page identity mismatch write refused');
SELECT throws_ok($q$INSERT INTO public.education_progress(patient_id,domain_id) VALUES(auth.uid(),'daily_weight')$q$,'42501',NULL,'raw insert refused');
SELECT throws_ok($q$UPDATE public.education_progress SET completed=true$q$,'42501',NULL,'raw completion refused');
SELECT throws_ok($q$SELECT pg_temp.edu_submit('unknown',1,0,101)$q$,'22023',NULL,'unknown domain refused');
SELECT throws_ok($q$SELECT pg_temp.edu_submit('daily_weight',4,0,101)$q$,'22023',NULL,'option out of bounds refused');
SELECT throws_ok($q$SELECT pg_temp.edu_submit('daily_weight',NULL,0,101)$q$,'22023',NULL,'null option refused');
SELECT throws_ok($q$SELECT pg_temp.edu_submit('daily_weight',1,-1,101)$q$,'22023',NULL,'negative revision refused');
SELECT throws_ok($q$SELECT public.submit_education_response(auth.uid(),'daily_weight',pg_temp.edu_id(101),1,0,'old')$q$,'22023',NULL,'outdated content refused');
SELECT is(pg_temp.edu_submit('daily_weight',0,0,101)->>'status','saved','wrong answer saved atomically');
SELECT is(public.get_education_response_context(auth.uid(),'daily_weight')->>'completed','false','wrong answer does not complete');
SELECT is(public.get_education_response_context(auth.uid(),'daily_weight')->>'attempts','1','wrong answer counts once');
SELECT is(pg_temp.edu_submit('daily_weight',0,0,101)->>'status','saved','matching replay succeeds');
SELECT is(public.get_education_response_context(auth.uid(),'daily_weight')->>'attempts','1','replay does not count twice');
SELECT throws_ok($q$SELECT pg_temp.edu_submit('daily_weight',1,0,101)$q$,'22023',NULL,'same UUID changed option refused');
SELECT throws_ok($q$SELECT pg_temp.edu_submit('daily_weight',0,1,101)$q$,'22023',NULL,'same UUID changed base refused');
SELECT is(pg_temp.edu_submit('daily_weight',1,0,102)->>'status','conflict','competing stale request conflicts');
SELECT is(pg_temp.edu_submit('daily_weight',1,1,102)->>'status','saved','fresh correct response saved');
SELECT is(public.get_education_response_context(auth.uid(),'daily_weight')->>'attempts','2','second answer counted once');
SELECT is(public.get_education_response_context(auth.uid(),'daily_weight')->>'completed','true','correct response completes');
SELECT is(public.get_education_response_context(auth.uid(),'daily_weight')#>>'{lastResponse,correct}','true','receipt gives this answer correctness');
SELECT is(pg_temp.edu_submit('daily_weight',0,0,101)->>'status','conflict','superseded old receipt cannot reapply');
SELECT is(pg_temp.edu_submit('daily_weight',0,2,103)->>'status','saved','later wrong self-assessment can be saved');
SELECT is(public.get_education_response_context(auth.uid(),'daily_weight')->>'completed','true','existing completion stays monotonic');
SELECT is(public.get_education_response_context(auth.uid(),'daily_weight')#>>'{lastResponse,correct}','false','old completion is not correctness of latest answer');
SELECT is(pg_temp.edu_submit('medications',2,0,104)->>'status','saved','independent domain starts at revision zero');
SELECT is(pg_temp.edu_submit('activity_guidance',1,3,105)->>'status','conflict','invalid base for absent progress conflicts without creating row');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.education_progress WHERE patient_id=pg_temp.edu_id(1)),2,'failed/unknown domains did not create progress');
SELECT is((SELECT count(*)::int FROM public.education_response_state),2,'receipt storage bounded per progress');
SELECT is((SELECT count(*)::int FROM public.education_teachbacks),0,'professional verification untouched');

-- Legacy completion without a receipt is preserved; no fabricated answer history.
INSERT INTO public.education_progress(patient_id,domain_id,attempts,completed,completed_at)
  VALUES(pg_temp.edu_id(1),'what_is_hf',3,true,'2026-01-01T00:00:00Z'),
    (pg_temp.edu_id(1),'warning_signs',32766,false,NULL);
SET LOCAL ROLE authenticated;
SELECT is(public.get_education_response_context(auth.uid(),'what_is_hf')->>'revision','0','legacy progress starts at revision zero');
SELECT is(public.get_education_response_context(auth.uid(),'what_is_hf')->>'lastResponse',NULL,'legacy progress has no invented receipt');
SELECT is(pg_temp.edu_submit('what_is_hf',0,0,106)->>'status','saved','legacy progress accepts atomic wrong response');
SELECT is(pg_temp.edu_submit('warning_signs',2,0,107)->>'status','saved','last representable attempt saves');
SELECT is(pg_temp.edu_submit('warning_signs',2,0,107)->>'status','saved','receipt replay precedes overflow guard');
SELECT throws_ok($q$SELECT pg_temp.edu_submit('warning_signs',1,1,108)$q$,'22003',NULL,'overflow fails atomically');
SELECT is(public.get_education_response_context(auth.uid(),'warning_signs')->>'attempts','32767','overflow neither clips nor resets count');
SELECT is(public.get_education_response_context(auth.uid(),'warning_signs')->>'revision','1','overflow does not create receipt');
RESET ROLE;
SELECT is((SELECT completed_at FROM public.education_progress WHERE patient_id=pg_temp.edu_id(1) AND domain_id='what_is_hf'),'2026-01-01T00:00:00Z'::timestamptz,'legacy completion date preserved');

-- Forced failure between progress and receipt rolls the whole RPC back.
CREATE FUNCTION pg_temp.reject_education_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Synthetic receipt fault' USING ERRCODE='P0001'; END $$;
CREATE TRIGGER synthetic_receipt_fault BEFORE INSERT OR UPDATE ON public.education_response_state
  FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_education_receipt();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.edu_submit('daily_weight',1,3,109)$q$,'P0001','Synthetic receipt fault','failure after progress update is atomic');
SELECT is(public.get_education_response_context(auth.uid(),'daily_weight')->>'attempts','3','failed receipt rolls counter back');
SELECT is(public.get_education_response_context(auth.uid(),'daily_weight')->>'revision','3','failed receipt leaves revision unchanged');
SELECT throws_ok($q$SELECT pg_temp.edu_submit('fluid_management',1,0,110)$q$,'P0001','Synthetic receipt fault','first-row failure rolls back too');
RESET ROLE;
DROP TRIGGER synthetic_receipt_fault ON public.education_response_state;
SELECT is((SELECT count(*)::int FROM public.education_progress WHERE domain_id='fluid_management'),0,'failed first receipt leaves no progress');

-- Current roles and consent apply even to replay. JWT metadata is not authority.
UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.edu_id(1);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.edu_submit('daily_weight',0,2,103)$q$,'42501',NULL,'revoked consent denies replay');
SELECT throws_ok($q$SELECT public.get_education_response_context(auth.uid(),'daily_weight')$q$,'42501',NULL,'revoked consent denies read');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.edu_id(3),'role','authenticated','user_role','patient')::text,true);
SELECT throws_ok($q$SELECT pg_temp.edu_submit('daily_weight',1,0,111)$q$,'42501',NULL,'provider cannot spoof patient role');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.edu_id(999),'role','authenticated')::text,true);
SELECT throws_ok($q$SELECT pg_temp.edu_submit('daily_weight',1,0,111)$q$,'42501',NULL,'absent profile cannot exploit role fallback');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.edu_id(2),'role','authenticated')::text,true);
SELECT is(public.get_education_response_context(auth.uid(),'daily_weight')->>'attempts','0','other patient cannot see first patient response');
RESET ROLE;
-- Authorized local fixture deletion verifies only the progress-linked cascade.
DELETE FROM public.education_progress WHERE patient_id=pg_temp.edu_id(1) AND domain_id='medications';
SELECT is((SELECT count(*)::int FROM public.education_response_state),3,'bounded state follows legitimate progress deletion');
SELECT throws_ok($q$DELETE FROM public.profiles WHERE id=pg_temp.edu_id(1)$q$,'23503',NULL,'pre-existing patient deletion restrictions remain');
SELECT * FROM finish();
ROLLBACK;
