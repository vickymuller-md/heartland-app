-- Exercise the client roles and real receipt functions after migrations 00081–83.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
CREATE FUNCTION pg_temp.rid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('81000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
  SELECT pg_temp.rid(n), 'receipt-'||n||'@example.invalid', '{"consent_accepted":true}'::jsonb FROM generate_series(1,3) n;
UPDATE public.profiles SET role='provider' WHERE id=pg_temp.rid(1);
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
  VALUES(pg_temp.rid(1),pg_temp.rid(2),'active',now());
CREATE TEMP TABLE weights(factor text, points integer);
INSERT INTO weights VALUES ('ageOver75',2),('priorHfHospitalization',3),('egfrBelow45',2),('elevatedNatriuretic',2),
  ('sbpBelow100',2),('diabetes',1),('lvefBelow30',2),('ckmStage3or4',2),('distanceOver50Miles',1),('livesAloneOrLimitedSupport',1);
GRANT SELECT ON weights TO authenticated;
CREATE FUNCTION pg_temp.answers(value boolean) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_object_agg(factor,value) FROM weights
$$;
CREATE FUNCTION pg_temp.record(n integer,answers jsonb) RETURNS uuid LANGUAGE sql AS $$
  SELECT public.record_risk_assessment(pg_temp.rid(1),pg_temp.rid(2),pg_temp.rid(n),'HEARTLAND-3.4.1-table-1',answers)
$$;
SELECT ok(EXISTS(SELECT FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='alerts'),
  'authorized alert changes have a publication');
SELECT ok(NOT has_column_privilege('authenticated','public.patients','risk_score','UPDATE'),'derived score has no raw update grant');
SELECT ok(NOT has_column_privilege('authenticated','public.provider_messages','read_at','UPDATE'),'read time has no raw update grant');
SELECT ok(NOT has_any_column_privilege('authenticated','public.provider_messages','INSERT'),'all portal sends require a reusable operation receipt');
SELECT ok(NOT has_function_privilege('anon','public.confirm_portal_message_read(uuid,uuid)','execute'),'anonymous users cannot issue a portal read receipt');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(1),'role','authenticated','aal','aal1')::text,true);
SELECT throws_ok($q$SELECT pg_temp.record(10,pg_temp.answers(false))$q$,'42501','Provider session unavailable','linked clinician needs MFA');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(1),'role','authenticated','aal','aal2')::text,true);
SELECT throws_ok($q$SELECT pg_temp.record(10,pg_temp.answers(false)-'diabetes')$q$,'22023','Each of the ten factors requires a boolean answer','missing is distinct from absent');
SELECT throws_ok($q$SELECT pg_temp.record(10,pg_temp.answers(false)||'{"extra":false}')$q$,'22023','Each of the ten factors requires a boolean answer','unknown factor rejected');
SELECT throws_ok($q$SELECT pg_temp.record(10,pg_temp.answers(false)||'{"diabetes":null}')$q$,'22023','Each of the ten factors requires a boolean answer','null answer rejected');
SELECT throws_ok($q$SELECT public.record_risk_assessment(pg_temp.rid(1),pg_temp.rid(2),pg_temp.rid(10),'unexpected',pg_temp.answers(false))$q$,'22023','Incomplete assessment','version checked');
SELECT throws_ok($q$SELECT public.record_risk_assessment(pg_temp.rid(1),pg_temp.rid(3),pg_temp.rid(10),'HEARTLAND-3.4.1-table-1',pg_temp.answers(false))$q$,'42501','Patient link unavailable','another patient requires an active link');
SELECT is(pg_temp.record(10,pg_temp.answers(false)),pg_temp.rid(10),'completed zero assessment returns receipt');
SELECT is((SELECT score FROM public.risk_assessments WHERE request_id=pg_temp.rid(10)),0,'ten explicit absences produce zero');
SELECT pg_temp.record(100+n,pg_temp.answers(false)||jsonb_build_object(factor,true)) FROM (
  SELECT row_number() OVER(ORDER BY factor)::int n, factor FROM weights) numbered;
SELECT is((SELECT a.score FROM public.risk_assessments a WHERE a.request_id=pg_temp.rid(100+n)),points,'approved points for '||factor)
  FROM (SELECT row_number() OVER(ORDER BY factor)::int n, factor, points FROM weights) numbered;
SELECT is(pg_temp.record(11,pg_temp.answers(true)),pg_temp.rid(11),'second assessment has its own receipt');
SELECT is(pg_temp.record(10,pg_temp.answers(false)),pg_temp.rid(10),'old request can be retried');
SELECT is((SELECT risk_score FROM public.patients WHERE id=pg_temp.rid(2)),18,'old retry preserves latest summary');
SELECT is((SELECT tier FROM public.risk_assessments WHERE request_id=pg_temp.rid(11)),'high','all ten confirmed conditions give high');
SELECT is((SELECT count(*)::int FROM public.risk_assessments WHERE patient_id=pg_temp.rid(2)),12,'replay produces no additional assessment');
SELECT throws_ok($q$SELECT pg_temp.record(10,pg_temp.answers(true))$q$,'22023','Assessment does not match the previous operation','same receipt cannot change answers');
SELECT is(public.record_portal_message(pg_temp.rid(1),pg_temp.rid(2),pg_temp.rid(20),'general','Synthetic follow-up','Receipt rehearsal'),pg_temp.rid(20),'provider records message');
SELECT is(public.record_portal_message(pg_temp.rid(1),pg_temp.rid(2),pg_temp.rid(20),'general','Synthetic follow-up','Receipt rehearsal'),pg_temp.rid(20),'duplicate submission returns its original message');
SELECT is((SELECT count(*)::int FROM public.notification_deliveries WHERE message_id=pg_temp.rid(20)),1,'one in-app delivery after retry');
SELECT throws_ok($q$SELECT public.record_portal_message(pg_temp.rid(1),pg_temp.rid(2),pg_temp.rid(20),'general','Changed','Receipt rehearsal')$q$,'22023','Message does not match previous operation','changed message requires a new request');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(3),'role','authenticated','aal','aal1')::text,true);
SELECT throws_ok($q$SELECT public.confirm_portal_message_read(pg_temp.rid(3),pg_temp.rid(20))$q$,'42501','Message unavailable','another patient cannot confirm the message');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(2),'role','authenticated','aal','aal1')::text,true);
SELECT is((SELECT read_at FROM public.provider_messages WHERE id=pg_temp.rid(20)),NULL::timestamptz,'viewing a message leaves it unread');
CREATE TEMP TABLE first_read AS SELECT public.confirm_portal_message_read(pg_temp.rid(2),pg_temp.rid(20)) receipt;
SELECT ok((SELECT receipt IS NOT NULL FROM first_read),'explicit patient action confirmed');
SELECT is(public.confirm_portal_message_read(pg_temp.rid(2),pg_temp.rid(20)),(SELECT receipt FROM first_read),'retry preserves first read time');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(1),'role','authenticated','aal','aal2')::text,true);
SELECT is((SELECT read_at FROM public.notification_deliveries WHERE message_id=pg_temp.rid(20)),(SELECT receipt FROM first_read),'patient confirmation reaches team delivery history');
SELECT * FROM finish();
ROLLBACK;
