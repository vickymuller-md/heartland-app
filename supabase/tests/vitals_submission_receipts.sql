-- N2p3a: real RPCs, RLS, transactions and synthetic fault injection; no clinical evaluation.
-- All fixture changes roll back. Committed concurrency is a separate local rehearsal.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

SELECT has_table('public', 'vitals_submission_attempts', 'durable attempts exist');
SELECT has_table('public', 'vitals_submission_receipts', 'atomic capture receipts exist');
SELECT has_function('public', 'prepare_vitals_submission', ARRAY['uuid'], 'preparation RPC exists');
SELECT has_function('public', 'get_vitals_submission', ARRAY['uuid','uuid'], 'recovery RPC exists');
SELECT has_function('public', 'submit_vitals_submission',
  ARRAY['uuid','uuid','numeric','text','integer','integer','integer','integer','integer','integer','boolean','integer','timestamp with time zone'],
  'typed capture RPC exists');
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class
  WHERE oid IN ('public.vitals_submission_attempts'::regclass,'public.vitals_submission_receipts'::regclass)), 'both tables enable RLS');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('can_access_vitals_submission','lock_vitals_submission_scope','vitals_submission_snapshot',
    'enforce_vitals_submission_transition','reject_vitals_receipt_mutation','prepare_vitals_submission',
    'get_vitals_submission','submit_vitals_submission','acknowledge_vitals_submission','cancel_vitals_submission')
  AND (NOT prosecdef OR NOT ('search_path=""' = ANY(proconfig)))), 0, 'all new functions pin definer search_path');
SELECT ok(NOT has_function_privilege('authenticated','public.lock_vitals_submission_scope(uuid)','EXECUTE'), 'internal lock helper denied');
SELECT ok(NOT has_function_privilege('authenticated','public.vitals_submission_snapshot(uuid,uuid,uuid)','EXECUTE'), 'unscoped snapshot helper denied');
SELECT ok(NOT has_function_privilege('anon','public.prepare_vitals_submission(uuid)','EXECUTE'), 'anon cannot prepare');
SELECT ok(NOT has_function_privilege('service_role','public.prepare_vitals_submission(uuid)','EXECUTE'), 'service cannot impersonate a submitting actor');
SELECT ok(NOT has_table_privilege('authenticated','public.vitals_submission_attempts','INSERT'), 'client cannot forge attempt');
SELECT ok(NOT has_table_privilege('service_role','public.vitals_submission_receipts','INSERT'), 'service direct receipt insert denied');
SELECT ok(NOT has_table_privilege('service_role','public.vitals_submission_attempts','DELETE'), 'service direct attempt deletion denied');
SELECT ok(NOT has_table_privilege('authenticated','public.vitals_submission_receipts','UPDATE'), 'client cannot rewrite receipt');
SELECT ok(NOT has_column_privilege('authenticated','public.vitals','weight_lbs','INSERT'), '00053 requires the receipted writer after local cutover');
SELECT is(public.work_item_outcome_grace_until(), '2026-09-24T00:00:00Z'::timestamptz, 'closing deadline is not extended');

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('44000000-0000-4000-8000-000000000001','vs-provider@example.invalid','{"consent_accepted":true}'),
 ('44000000-0000-4000-8000-000000000002','vs-other-provider@example.invalid','{"consent_accepted":true}'),
 ('44000000-0000-4000-8000-000000000003','vs-no-consent@example.invalid','{}'),
 ('44000000-0000-4000-8000-000000000004','vs-outsider@example.invalid','{"consent_accepted":true}'),
 ('44000000-0000-4000-8000-000000000011','vs-patient@example.invalid','{"consent_accepted":true}'),
 ('44000000-0000-4000-8000-000000000012','vs-patient-two@example.invalid','{"consent_accepted":true}'),
 ('44000000-0000-4000-8000-000000000013','vs-patient-no-consent@example.invalid','{}'),
 ('44000000-0000-4000-8000-000000000021','vs-tester@example.invalid','{"signup_intent":"sandbox","consent_accepted":true}');
UPDATE public.profiles SET role='provider' WHERE id IN
 ('44000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000002',
  '44000000-0000-4000-8000-000000000003','44000000-0000-4000-8000-000000000004');
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 ('44000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000011','active',now()),
 ('44000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000012','active',now()),
 ('44000000-0000-4000-8000-000000000002','44000000-0000-4000-8000-000000000011','active',now()),
 ('44000000-0000-4000-8000-000000000003','44000000-0000-4000-8000-000000000011','active',now());
CREATE TEMP TABLE vs_results(label text PRIMARY KEY, result jsonb);
GRANT ALL ON vs_results TO authenticated, service_role;
-- Invoker helper only reduces repetition; it performs no identity/privilege changes.
CREATE FUNCTION pg_temp.vs_submit(p_request uuid, p_weight numeric DEFAULT 180,
  p_recorded_at timestamptz DEFAULT '2026-01-02T12:34:56.123456Z')
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.submit_vitals_submission('44000000-0000-4000-8000-000000000011', p_request,
   p_weight,'lbs',120,80,70,NULL,0,0,false,0,p_recorded_at)
$$;

-- Provider capture, lost responses and immutable replay.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT is(public.get_vitals_submission('44000000-0000-4000-8000-000000000011'),NULL::jsonb,'initial recovery has no active attempt');
INSERT INTO vs_results VALUES ('prepared',public.prepare_vitals_submission('44000000-0000-4000-8000-000000000011'));
SELECT is((SELECT result->>'submission_status' FROM vs_results WHERE label='prepared'),'prepared','attempt is durable before clinical rows');
SELECT is((SELECT result->>'observation' FROM vs_results WHERE label='prepared'),NULL::text,'prepared attempt does not invent observations');
SELECT is(public.prepare_vitals_submission('44000000-0000-4000-8000-000000000011'),
  (SELECT result FROM vs_results WHERE label='prepared'),'lost prepare response recovers same identity');
SELECT throws_ok($q$SELECT pg_temp.vs_submit('44000000-0000-4000-8000-000000009999')$q$,'22023','Vitals submission is not prepared','unknown ID cannot save');
INSERT INTO vs_results VALUES ('committed',pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='prepared')));
SELECT is((SELECT result->>'submission_status' FROM vs_results WHERE label='committed'),'committed','atomic capture committed');
SELECT is((SELECT result->>'evaluation_status' FROM vs_results WHERE label='committed'),'pending','capture does not claim evaluation complete');
SELECT is((SELECT (result#>>'{observation,vitals,recorded_at}')::timestamptz FROM vs_results WHERE label='committed'),
  '2026-01-02T12:34:56.123456Z'::timestamptz,'provider backdating and microseconds preserved');
SELECT is((SELECT result#>>'{observation,vitals,recorded_at}' FROM vs_results WHERE label='committed'),
  (SELECT result#>>'{observation,symptoms,recorded_at}' FROM vs_results WHERE label='committed'),'vitals and symptoms share exact recorded time');
SELECT is((SELECT result#>>'{observation,vitals,source}' FROM vs_results WHERE label='committed'),'provider_entry','source is role-derived');
SELECT is((SELECT result#>>'{observation,symptoms,red_flag}' FROM vs_results WHERE label='committed'),NULL::text,'unevaluated is NULL, never false normal');
SELECT is(public.get_vitals_submission('44000000-0000-4000-8000-000000000011'),
  (SELECT result FROM vs_results WHERE label='committed'),'lost save response recovered after reload');
SELECT is(pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='prepared'),180.00,'2026-01-02T07:34:56.123456-05:00'),
  (SELECT result FROM vs_results WHERE label='committed'),'equivalent numeric and timezone payload replays exact receipt');
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='prepared'),181)$q$,
  '23505','Vitals submission payload differs','changed weight cannot reuse request');
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='prepared'),180,'2026-01-03')$q$,
  '23505','Vitals submission payload differs','changed timestamp cannot reuse request');
SELECT throws_ok($q$SELECT public.submit_vitals_submission('44000000-0000-4000-8000-000000000011',
  (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='prepared'),180,'lbs',120,80,70,NULL,1,0,false,0,'2026-01-02T12:34:56.123456Z')$q$,
  '23505','Vitals submission payload differs','changed symptom cannot reuse request');
SELECT is((SELECT count(*)::int FROM public.vitals),1,'retries never add vitals');
SELECT is((SELECT count(*)::int FROM public.symptoms),1,'retries never add symptoms');
SELECT is(public.cancel_vitals_submission('44000000-0000-4000-8000-000000000011',(SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='prepared')),
  (SELECT result FROM vs_results WHERE label='committed'),'committed receipt wins over late cancellation');
SELECT throws_ok($q$SELECT public.acknowledge_vitals_submission('44000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='prepared'),
 (SELECT (result->>'vitals_id')::uuid FROM vs_results WHERE label='committed'),'44000000-0000-4000-8000-000000009999')$q$,
 '22023','Vitals receipt does not match','acknowledgement must match both saved rows');
INSERT INTO vs_results VALUES ('acknowledged',public.acknowledge_vitals_submission('44000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='prepared'),
 (SELECT (result->>'vitals_id')::uuid FROM vs_results WHERE label='committed'),
 (SELECT (result->>'symptoms_id')::uuid FROM vs_results WHERE label='committed')));
SELECT is((SELECT result->>'submission_status' FROM vs_results WHERE label='acknowledged'),'acknowledged','explicit receipt acknowledgement closes slot');
SELECT is((SELECT result->>'evaluation_status' FROM vs_results WHERE label='acknowledged'),'pending','acknowledgement is not clinical evaluation');
SELECT is(public.get_vitals_submission('44000000-0000-4000-8000-000000000011'),NULL::jsonb,'closed receipt is not active');
SELECT is(public.acknowledge_vitals_submission('44000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='prepared'),
 (SELECT (result->>'vitals_id')::uuid FROM vs_results WHERE label='committed'),
 (SELECT (result->>'symptoms_id')::uuid FROM vs_results WHERE label='committed')),
 (SELECT result FROM vs_results WHERE label='acknowledged'),'lost acknowledgement response safely replays');
INSERT INTO vs_results VALUES ('second',public.prepare_vitals_submission('44000000-0000-4000-8000-000000000011'));
SELECT isnt((SELECT result->>'request_id' FROM vs_results WHERE label='second'),
 (SELECT result->>'request_id' FROM vs_results WHERE label='prepared'),'closed slot allows a distinct next observation');
SELECT is(pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='prepared')),
 (SELECT result FROM vs_results WHERE label='acknowledged'),'old acknowledged receipt can replay without reopening');
SELECT is(public.get_vitals_submission('44000000-0000-4000-8000-000000000011'),
 (SELECT result FROM vs_results WHERE label='second'),'old replay never displaces newer active attempt');
INSERT INTO vs_results VALUES ('cancelled',public.cancel_vitals_submission('44000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='second')));
SELECT is((SELECT result->>'submission_status' FROM vs_results WHERE label='cancelled'),'cancelled','unsaved attempt can be fenced');
SELECT is(public.cancel_vitals_submission('44000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='second')),
 (SELECT result FROM vs_results WHERE label='cancelled'),'lost cancel response replays');
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='second'))$q$,
 '23505','Vitals submission is closed','late cancelled packet cannot create source rows');
SELECT throws_ok($q$SELECT public.cancel_vitals_submission('44000000-0000-4000-8000-000000000011',NULL)$q$,
 '22023','Invalid vitals submission','null cancellation is not proof of absence');
INSERT INTO vs_results VALUES ('fault-attempt',public.prepare_vitals_submission('44000000-0000-4000-8000-000000000011'));

-- Validation occurs inside the database, not only a browser/action schema.
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'),'NaN'::numeric)$q$,
 '22023','Invalid vitals submission','NaN weight rejected');
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'),'Infinity'::numeric)$q$,
 '22023','Invalid vitals submission','infinite weight rejected');
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'),NULL)$q$,
 '22023','Invalid vitals submission','required weight cannot be null');
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'),49)$q$,
 '22023','Invalid vitals submission','existing lower input bound enforced');
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'),701)$q$,
 '22023','Invalid vitals submission','existing upper input bound enforced');
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'),180,'infinity')$q$,
 '22023','Invalid vitals submission','nonfinite recorded time rejected');
SELECT throws_ok($q$SELECT public.submit_vitals_submission('44000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'),180,'oz',120,80,70,NULL,0,0,false,0)$q$,
 '22023','Invalid vitals submission','unknown unit rejected');
SELECT throws_ok($q$SELECT public.submit_vitals_submission('44000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'),180,'lbs',120,80,70,NULL,4,0,false,0)$q$,
 '22023','Invalid vitals submission','invalid symptom severity rejected');
SELECT throws_ok($q$SELECT public.submit_vitals_submission('44000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'),180,'lbs',120,80,70,101,0,0,false,0)$q$,
 '22023','Invalid vitals submission','invalid saturation rejected');

-- Forced failure after the vitals INSERT: no partial source survives.
RESET ROLE;
CREATE FUNCTION pg_temp.vs_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic capture failure'; END $$;
CREATE TRIGGER vs_fail_symptoms BEFORE INSERT ON public.symptoms FOR EACH ROW EXECUTE FUNCTION pg_temp.vs_fail();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'))$q$,
 'P0001','synthetic capture failure','symptoms failure aborts entire capture');
SELECT is((SELECT count(*)::int FROM public.vitals),1,'symptoms fault leaves no orphan vitals');
SELECT is((SELECT count(*)::int FROM public.symptoms),1,'symptoms fault leaves no symptoms');
SELECT is(public.get_vitals_submission('44000000-0000-4000-8000-000000000011')->>'submission_status','prepared','preexisting attempt survives symptoms failure');
RESET ROLE;
DROP TRIGGER vs_fail_symptoms ON public.symptoms;
CREATE TRIGGER vs_fail_receipt AFTER INSERT ON public.vitals_submission_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.vs_fail();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'))$q$,
 'P0001','synthetic capture failure','failure after receipt INSERT aborts receipt and both source inserts');
SELECT is((SELECT count(*)::int FROM public.vitals),1,'receipt fault leaves no vitals');
SELECT is((SELECT count(*)::int FROM public.symptoms),1,'receipt fault leaves no symptoms');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_receipts),1,'receipt fault leaves no extra receipt');
RESET ROLE;
DROP TRIGGER vs_fail_receipt ON public.vitals_submission_receipts;

-- Bounded snapshot must reject, never truncate; savepoint preserves earlier fixtures.
SAVEPOINT history_overflow;
INSERT INTO public.vitals(patient_id,recorded_at,weight_lbs,source)
 SELECT '44000000-0000-4000-8000-000000000011',clock_timestamp(),180,'provider_entry' FROM generate_series(1,1001);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'))$q$,
 '54000','Vitals capture history limit exceeded','history overflow aborts capture explicitly');
SELECT is((SELECT count(*)::int FROM public.vitals),1002,'overflow does not retain the newly inserted observation');
SELECT is((SELECT count(*)::int FROM public.symptoms),1,'overflow rolls back symptoms too');
SELECT is(public.get_vitals_submission('44000000-0000-4000-8000-000000000011')->>'submission_status','prepared','overflow leaves recoverable preparation');
ROLLBACK TO SAVEPOINT history_overflow;

INSERT INTO public.vitals(id,patient_id,recorded_at,weight_lbs,source) VALUES
 ('44000000-0000-4000-8000-000000008001','44000000-0000-4000-8000-000000000011',now()-interval '1 hour',170,'provider_entry'),
 ('44000000-0000-4000-8000-000000008002','44000000-0000-4000-8000-000000000011',now()-interval '1 hour',NULL,'provider_entry'),
 ('44000000-0000-4000-8000-000000008003','44000000-0000-4000-8000-000000000011',now()-interval '30 days',150,'provider_entry');
SET LOCAL ROLE authenticated;
INSERT INTO vs_results VALUES ('after-fault',pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt')));
SELECT is((SELECT result->>'request_id' FROM vs_results WHERE label='after-fault'),
 (SELECT result->>'request_id' FROM vs_results WHERE label='fault-attempt'),'successful retry uses original prepared identity');
SELECT is((SELECT jsonb_array_length(history) FROM public.vitals_submission_receipts
 WHERE request_id=(SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt')),2,'snapshot includes bounded prior inputs, not current/backdated old observations');
SELECT is((SELECT history#>>'{0,id}' FROM public.vitals_submission_receipts
 WHERE request_id=(SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt')),
 '44000000-0000-4000-8000-000000008002','tied historical times have stable ID order');
SELECT is((SELECT history#>>'{0,weight_lbs}' FROM public.vitals_submission_receipts
 WHERE request_id=(SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt')),NULL::text,'raw missing historical value preserved');
RESET ROLE;
INSERT INTO public.vitals(patient_id,recorded_at,weight_lbs,source) VALUES
 ('44000000-0000-4000-8000-000000000011',clock_timestamp(),199,'provider_entry');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt')),
 (SELECT result FROM vs_results WHERE label='after-fault'),'replay preserves source time and observation after history changes');
SELECT is((SELECT jsonb_array_length(history) FROM public.vitals_submission_receipts
 WHERE request_id=(SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt')),2,'replay never silently resnapshots new history');

-- Every RPC is scoped; metadata guessing does not grant historical access.
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
SELECT is(public.get_vitals_submission('44000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='prepared')),NULL::jsonb,'another linked provider cannot recover actor receipt');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_receipts),0,'receipt RLS hides another actor history');
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'))$q$,
 '22023','Vitals submission is not prepared','another linked actor cannot replay known ID');
INSERT INTO vs_results VALUES ('other-actor',public.prepare_vitals_submission('44000000-0000-4000-8000-000000000011'));
SELECT isnt((SELECT result->>'request_id' FROM vs_results WHERE label='other-actor'),
 (SELECT result->>'request_id' FROM vs_results WHERE label='fault-attempt'),'another authorized actor has independent slot');
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT is(public.get_vitals_submission('44000000-0000-4000-8000-000000000012',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='prepared')),NULL::jsonb,'known request cannot cross patient scope');
SELECT throws_ok($q$UPDATE public.vitals_submission_attempts SET closed_status='cancelled'$q$,'42501',NULL,'client DML denied');
SELECT throws_ok($q$SELECT public.vitals_submission_snapshot('44000000-0000-4000-8000-000000000001',
 '44000000-0000-4000-8000-000000000011',(SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='prepared'))$q$,
 '42501',NULL,'client cannot invoke private snapshot');

-- Database-enforced auth matrix covers all public mutation/read entry points after revocation.
RESET ROLE;
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id='44000000-0000-4000-8000-000000000001'
 AND patient_id='44000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.prepare_vitals_submission('44000000-0000-4000-8000-000000000011')$q$,'42501','Vitals operation not authorized','revoked link cannot prepare');
SELECT throws_ok($q$SELECT public.get_vitals_submission('44000000-0000-4000-8000-000000000011')$q$,'42501','Vitals operation not authorized','revoked link cannot recover');
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'))$q$,'42501','Vitals operation not authorized','revoked link cannot replay');
SELECT throws_ok($q$SELECT public.cancel_vitals_submission('44000000-0000-4000-8000-000000000011',(SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'))$q$,'42501','Vitals operation not authorized','revoked link cannot cancel');
SELECT throws_ok($q$SELECT public.acknowledge_vitals_submission('44000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='fault-attempt'),
 (SELECT (result->>'vitals_id')::uuid FROM vs_results WHERE label='after-fault'),
 (SELECT (result->>'symptoms_id')::uuid FROM vs_results WHERE label='after-fault'))$q$,'42501','Vitals operation not authorized','revoked link cannot acknowledge');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_attempts),0,'revoked access also hides attempts via RLS');
RESET ROLE;
UPDATE public.provider_patient_links SET status='active' WHERE provider_id='44000000-0000-4000-8000-000000000001'
 AND patient_id='44000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
SELECT throws_ok($q$SELECT public.get_vitals_submission('44000000-0000-4000-8000-000000000011')$q$,'42501','Vitals operation not authorized','provider AAL1 cannot recover');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_receipts),0,'provider AAL1 direct SELECT denied by RLS');
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT public.prepare_vitals_submission('44000000-0000-4000-8000-000000000011')$q$,'42501','Vitals operation not authorized','provider without consent denied');
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT public.prepare_vitals_submission('44000000-0000-4000-8000-000000000011')$q$,'42501','Vitals operation not authorized','unlinked provider denied');
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000021","role":"authenticated","aal":"aal2","user_role":"provider"}',true);
SELECT throws_ok($q$SELECT public.prepare_vitals_submission('44000000-0000-4000-8000-000000000011')$q$,'42501','Vitals operation not authorized','tester with forged metadata denied');
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000001","role":"service_role","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT public.prepare_vitals_submission('44000000-0000-4000-8000-000000000011')$q$,'42501','Vitals operation not authorized','service claim plus uid cannot impersonate human');
SELECT set_config('request.jwt.claims','{"role":"authenticated","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT public.prepare_vitals_submission('44000000-0000-4000-8000-000000000011')$q$,'42501','Vitals operation not authorized','missing subject denied');

-- Patient self-entry is AAL1-compatible, but cannot target another patient or backdate.
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000013","role":"authenticated","aal":"aal1"}',true);
SELECT throws_ok($q$SELECT public.prepare_vitals_submission('44000000-0000-4000-8000-000000000013')$q$,'42501','Vitals operation not authorized','patient without consent denied');
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000011","role":"authenticated","aal":"aal1"}',true);
SELECT throws_ok($q$SELECT public.prepare_vitals_submission('44000000-0000-4000-8000-000000000012')$q$,'42501','Vitals operation not authorized','patient cannot target another patient');
INSERT INTO vs_results VALUES ('patient-prepared',public.prepare_vitals_submission('44000000-0000-4000-8000-000000000011'));
SELECT throws_ok($q$SELECT pg_temp.vs_submit((SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='patient-prepared'))$q$,
 '22023','Invalid vitals submission','patient cannot supply provider backdating');
INSERT INTO vs_results VALUES ('patient-committed',public.submit_vitals_submission('44000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='patient-prepared'),100,'kg',120,80,70,NULL,0,0,false,0));
SELECT is((SELECT result#>>'{observation,vitals,weight_lbs}' FROM vs_results WHERE label='patient-committed'),'220.5','existing kg conversion and storage precision preserved');
SELECT is((SELECT result#>>'{observation,vitals,source}' FROM vs_results WHERE label='patient-committed'),'patient_app','patient source derived from identity');
SELECT ok((SELECT (result#>>'{observation,vitals,recorded_at}')::timestamptz = (result->>'captured_at')::timestamptz
 FROM vs_results WHERE label='patient-committed'),'patient timestamp chosen by server at first capture');
SELECT is(public.submit_vitals_submission('44000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='patient-prepared'),100.0,'kg',120,80,70,NULL,0,0,false,0),
 (SELECT result FROM vs_results WHERE label='patient-committed'),'server timestamp does not drift on patient replay');
RESET ROLE;
UPDATE public.consents SET accepted=false WHERE user_id='44000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_vitals_submission('44000000-0000-4000-8000-000000000011')$q$,'42501','Vitals operation not authorized','patient consent revocation hides recovery');
RESET ROLE;
UPDATE public.consents SET accepted=true WHERE user_id='44000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000012","role":"authenticated","aal":"aal1"}',true);
INSERT INTO vs_results VALUES ('critical-source',public.prepare_vitals_submission('44000000-0000-4000-8000-000000000012'));
INSERT INTO vs_results VALUES ('critical-capture',public.submit_vitals_submission('44000000-0000-4000-8000-000000000012',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='critical-source'),180,'lbs',80,60,70,88,3,0,false,2));
SELECT is((SELECT result->>'evaluation_status' FROM vs_results WHERE label='critical-capture'),'pending','critical-signal fixture is still explicitly unevaluated');
SELECT is((SELECT result#>>'{observation,symptoms,red_flag}' FROM vs_results WHERE label='critical-capture'),NULL::text,'critical-signal capture never asserts false normal');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.alerts),0,'capture-only never coalesces alert');
SELECT is((SELECT count(*)::int FROM public.work_items),0,'capture-only never creates care task');
SELECT throws_ok($q$UPDATE public.vitals_submission_receipts SET history='[]'$q$,'P0001','Vitals receipts are append-only','even owner fixture writes cannot rewrite source context');
SELECT throws_ok($q$DELETE FROM public.vitals_submission_attempts WHERE request_id=(SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='second')$q$,
 'P0001','Vitals submission history is immutable','ordinary owner delete cannot erase cancellation fence');

-- Expired-tester lifecycle, including provenance where tester is the target patient.
-- Role transitions here are privileged synthetic fixtures, not application authorization.
UPDATE public.profiles SET role='tester',sandbox_expires_at=now()-interval '1 day'
 WHERE id='44000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT public.get_vitals_submission('44000000-0000-4000-8000-000000000011')$q$,
 '42501','Vitals operation not authorized','changed author role cannot recover old receipt');
RESET ROLE;
SELECT throws_ok($q$DELETE FROM auth.users WHERE id='44000000-0000-4000-8000-000000000001'$q$,'23503',NULL,'restrictive provenance prevents unaudited actor deletion');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT throws_ok($q$DELETE FROM public.vitals_submission_receipts$q$,'42501',NULL,'service cannot bypass erasure RPC');
SELECT throws_ok($q$SELECT * FROM public.purge_expired_tester_provenance('44000000-0000-4000-8000-000000000002')$q$,
 '42501',NULL,'protected provider cannot be purged');
SELECT throws_ok($q$SELECT * FROM public.purge_expired_tester_provenance('44000000-0000-4000-8000-000000000021')$q$,
 '42501',NULL,'unexpired tester cannot be purged');
SAVEPOINT erasure_rollback;
SELECT is((SELECT receipts_deleted+attempts_deleted+evaluations_detached FROM public.purge_expired_tester_provenance('44000000-0000-4000-8000-000000000001')),0,
 'lab response remains three original counters, not mixed vitals counts');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_attempts WHERE actor_id='44000000-0000-4000-8000-000000000001'),0,'actor attempts erased in tested transaction');
ROLLBACK TO SAVEPOINT erasure_rollback;
SELECT is((SELECT count(*)::int FROM public.vitals_submission_attempts WHERE actor_id='44000000-0000-4000-8000-000000000001'),3,'erasure rollback restores all actor attempts');
SELECT is((SELECT count(*)::int FROM public.lab_provenance_erasures WHERE actor_id='44000000-0000-4000-8000-000000000001'),0,'erasure rollback restores audit atomically');
SELECT * FROM public.purge_expired_tester_provenance('44000000-0000-4000-8000-000000000001');
SELECT is((SELECT vitals_receipts_deleted FROM public.lab_provenance_erasures WHERE actor_id='44000000-0000-4000-8000-000000000001'),2,'audit separately counts vitals receipts erased');
SELECT is((SELECT vitals_attempts_deleted FROM public.lab_provenance_erasures WHERE actor_id='44000000-0000-4000-8000-000000000001'),3,'audit counts prepared/committed/closed actor identities');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_attempts WHERE actor_id='44000000-0000-4000-8000-000000000002'),1,'other actor attempt preserved');
SELECT is((SELECT count(*)::int FROM public.vitals WHERE id=(SELECT (result->>'vitals_id')::uuid FROM vs_results WHERE label='committed')),1,'actor erasure preserves patient observation');
SELECT * FROM public.purge_expired_tester_provenance('44000000-0000-4000-8000-000000000001');
SELECT is((SELECT sum(vitals_receipts_deleted)::int FROM public.lab_provenance_erasures WHERE actor_id='44000000-0000-4000-8000-000000000001'),2,
 'same-transaction repeat purge preserves earlier audit counts');
RESET ROLE;
SELECT throws_ok($q$DELETE FROM public.vitals_submission_receipts WHERE request_id=(SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='patient-prepared')$q$,
 'P0001','Vitals receipts are append-only','erasure permission cannot spill into another actor/patient');
SELECT throws_ok($q$DELETE FROM auth.users WHERE id='44000000-0000-4000-8000-000000000001'$q$,'23503',
 'update or delete on table "profiles" violates foreign key constraint "organizations_created_by_fkey" on table "organizations"',
 'converted provider retains independent preexisting organization deletion gate');
UPDATE public.profiles SET role='tester',sandbox_expires_at=now()-interval '1 day'
 WHERE id='44000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT public.prepare_vitals_submission('44000000-0000-4000-8000-000000000011')$q$,
 '42501','Vitals operation not authorized','new captures into expired tester target are fenced');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT * FROM public.purge_expired_tester_provenance('44000000-0000-4000-8000-000000000011');
SELECT is((SELECT count(*)::int FROM public.vitals_submission_attempts WHERE patient_id='44000000-0000-4000-8000-000000000011'),0,
 'target erasure includes other actors attempts referring to synthetic patient');
SELECT is((SELECT vitals_attempts_deleted FROM public.lab_provenance_erasures WHERE actor_id='44000000-0000-4000-8000-000000000011'),2,'target audit accounts for self and other actor identities');
RESET ROLE;
SELECT throws_ok($q$DELETE FROM auth.users WHERE id='44000000-0000-4000-8000-000000000011'$q$,'23503',
 'update or delete on table "patients" violates foreign key constraint "organization_patient_assignments_patient_id_fkey" on table "organization_patient_assignments"',
 'governed target retains independent preexisting assignment deletion gate');
SELECT is((SELECT count(*)::int FROM public.profiles WHERE id='44000000-0000-4000-8000-000000000002'),1,'target erasure does not delete linked provider');

-- A normal tester has no organization. Insert actor-bound provenance as privileged
-- fixtures (testers cannot submit) to isolate the new FK cleanup from older team FKs.
UPDATE public.profiles SET sandbox_expires_at=now()-interval '1 day' WHERE id='44000000-0000-4000-8000-000000000021';
INSERT INTO public.vitals(id,patient_id,recorded_at,weight_lbs) VALUES
 ('44000000-0000-4000-8000-000000008021','44000000-0000-4000-8000-000000000012',now(),180);
INSERT INTO public.symptoms(id,patient_id,recorded_at,red_flag) VALUES
 ('44000000-0000-4000-8000-000000008022','44000000-0000-4000-8000-000000000012',now(),NULL);
INSERT INTO public.vitals_submission_attempts(request_id,actor_id,patient_id) VALUES
 ('44000000-0000-4000-8000-000000008023','44000000-0000-4000-8000-000000000021','44000000-0000-4000-8000-000000000012');
INSERT INTO public.vitals_submission_receipts(request_id,vitals_id,symptoms_id,input,observation,captured_at,history) VALUES
 ('44000000-0000-4000-8000-000000008023','44000000-0000-4000-8000-000000008021','44000000-0000-4000-8000-000000008022','{}','{}',now(),'[]');
SELECT throws_ok($q$DELETE FROM auth.users WHERE id='44000000-0000-4000-8000-000000000021'$q$,'23503',NULL,'ordinary tester actor blocked by new provenance before purge');
SET LOCAL ROLE service_role;
SELECT * FROM public.purge_expired_tester_provenance('44000000-0000-4000-8000-000000000021');
RESET ROLE;
SELECT lives_ok($q$DELETE FROM auth.users WHERE id='44000000-0000-4000-8000-000000000021'$q$,'ordinary expired tester Auth deletion succeeds after new provenance purge');
SELECT is((SELECT count(*)::int FROM public.vitals WHERE id='44000000-0000-4000-8000-000000008021'),1,'ordinary tester actor deletion preserves third-party vitals');

-- Self-entry target with no care-team assignment: full Auth cascade is feasible.
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('44000000-0000-4000-8000-000000000014','vs-unassigned-patient@example.invalid','{"consent_accepted":true}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000014","role":"authenticated","aal":"aal1"}',true);
INSERT INTO vs_results VALUES ('unassigned-target',public.prepare_vitals_submission('44000000-0000-4000-8000-000000000014'));
SELECT lives_ok($q$SELECT public.submit_vitals_submission('44000000-0000-4000-8000-000000000014',
 (SELECT (result->>'request_id')::uuid FROM vs_results WHERE label='unassigned-target'),180,'lbs',120,80,70,NULL,0,0,false,0)$q$,
 'unassigned patient can capture own observation');
RESET ROLE;
UPDATE public.profiles SET role='tester',sandbox_expires_at=now()-interval '1 day' WHERE id='44000000-0000-4000-8000-000000000014';
SELECT throws_ok($q$DELETE FROM auth.users WHERE id='44000000-0000-4000-8000-000000000014'$q$,'23503',NULL,'target provenance blocks unaudited deletion');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT * FROM public.purge_expired_tester_provenance('44000000-0000-4000-8000-000000000014');
RESET ROLE;
SELECT lives_ok($q$DELETE FROM auth.users WHERE id='44000000-0000-4000-8000-000000000014'$q$,'unassigned expired target Auth cascade succeeds after audited purge');
SELECT is((SELECT count(*)::int FROM public.vitals WHERE patient_id='44000000-0000-4000-8000-000000000014'),0,'target deletion cascades only its own observations');

SELECT * FROM finish();
ROLLBACK;
