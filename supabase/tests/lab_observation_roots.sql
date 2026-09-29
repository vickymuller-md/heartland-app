-- Empty isolated PostgreSQL clone only; synthetic fixture/history changes roll back.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
-- BEGIN OBSERVATION FIXTURES
CREATE FUNCTION pg_temp.lo(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('61000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.lo(n),'observation-'||n||'@example.invalid','{"consent_accepted":true}' FROM unnest(ARRAY[1,2,3,11,12]) n;
UPDATE public.profiles SET role='provider' WHERE id=ANY(ARRAY[pg_temp.lo(1),pg_temp.lo(2),pg_temp.lo(3)]);
INSERT INTO public.organizations(id,name,created_by) VALUES(pg_temp.lo(90),'Synthetic source A',pg_temp.lo(1)),(pg_temp.lo(91),'Synthetic source B',pg_temp.lo(3));
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 SELECT pg_temp.lo(90),pg_temp.lo(n),CASE WHEN n=1 THEN 'owner' ELSE 'clinician' END,'active',now(),pg_temp.lo(1) FROM generate_series(1,2) n;
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES(pg_temp.lo(91),pg_temp.lo(3),'owner','active',now(),pg_temp.lo(3));
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',created_by FROM public.organization_memberships WHERE organization_id IN(pg_temp.lo(90),pg_temp.lo(91));
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'clinical_disposition',created_by FROM public.organization_memberships WHERE user_id IN(pg_temp.lo(1),pg_temp.lo(3)) AND organization_id IN(pg_temp.lo(90),pg_temp.lo(91));
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by) VALUES
 (pg_temp.lo(90),pg_temp.lo(11),pg_temp.lo(1)),(pg_temp.lo(91),pg_temp.lo(11),pg_temp.lo(3)),(pg_temp.lo(91),pg_temp.lo(12),pg_temp.lo(3));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 (pg_temp.lo(1),pg_temp.lo(11),'active',now()),(pg_temp.lo(2),pg_temp.lo(11),'active',now()),
 (pg_temp.lo(3),pg_temp.lo(11),'active',now()),(pg_temp.lo(3),pg_temp.lo(12),'active',now());
-- Emulate pre-outbox rows in this disposable fixture only, never alter hosted evidence.
ALTER TABLE public.lab_results DISABLE TRIGGER USER;
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium,creatinine,egfr,ordered_by,notes)
 SELECT pg_temp.lo(n),pg_temp.lo(11),now()-interval '1 day',4.6,1.23,82,pg_temp.lo(2),'Legacy synthetic source'
 FROM generate_series(100,450) n;
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium) VALUES
 (pg_temp.lo(500),pg_temp.lo(12),now()-interval '1 day',4.6),
 (pg_temp.lo(501),pg_temp.lo(11),now()+interval '1 day',4.6);
ALTER TABLE public.lab_results ENABLE TRIGGER USER;
-- END OBSERVATION FIXTURES
-- BEGIN OBSERVATION HELPERS
CREATE FUNCTION pg_temp.lo_payload() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('evidence','  Synthetic source_document  ','occurred_at',to_char(now() AT TIME ZONE 'UTC'-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;
CREATE FUNCTION pg_temp.lo_prepare(n integer,a text DEFAULT 'potassium',p jsonb DEFAULT pg_temp.lo_payload(),o integer DEFAULT 90) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_lab_observation(pg_temp.lo(n+1000),pg_temp.lo(n+2000),pg_temp.lo(o),pg_temp.lo(11),pg_temp.lo(n),a,p)
$$;
-- END OBSERVATION HELPERS
CREATE TEMP TABLE observation_receipts(label text PRIMARY KEY,value jsonb);
GRANT ALL ON observation_receipts TO authenticated;
SELECT ok(NOT has_table_privilege('authenticated','public.lab_observation_requests','SELECT'),'request payload private');
SELECT ok(NOT has_table_privilege('service_role','public.lab_observation_roots','INSERT'),'service cannot create authority');
SELECT ok(NOT has_table_privilege('authenticated','public.lab_observation_versions','UPDATE'),'API cannot overwrite source version');
SELECT ok(NOT has_function_privilege('anon','public.apply_lab_observation(uuid)','EXECUTE'),'anonymous apply denied');
SELECT ok(NOT has_function_privilege('service_role','public.apply_lab_observation(uuid)','EXECUTE'),'service apply denied');
SELECT ok(NOT has_function_privilege('authenticated','public.lab_observation_request_state(uuid)','EXECUTE'),'unscoped state helper private');
SELECT ok(NOT has_function_privilege('authenticated','public.lab_source_fingerprint(public.lab_results)','EXECUTE'),'fingerprint helper private');
SELECT throws_ok($q$SELECT public.observation_source_snapshot(jsonb_populate_record(NULL::public.lab_results,
 jsonb_build_object('collected_at',now()-interval '1 day','potassium','NaN')),'potassium')$q$,
 '22023','Verify the recorded source value and collection','snapshot decoder rejects nonfinite value without bypassing storage constraints');
SELECT throws_ok($q$SELECT public.observation_source_snapshot(jsonb_populate_record(NULL::public.lab_results,
 jsonb_build_object('collected_at',now()-interval '1 day','potassium',-1)),'potassium')$q$,
 '22023','Verify the recorded source value and collection','snapshot decoder rejects negative value');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(1),'aal','aal1')::text,true);
SELECT throws_ok($q$SELECT pg_temp.lo_prepare(100)$q$,'42501','Work ownership operation not authorized','AAL1 cannot register');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(2),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT pg_temp.lo_prepare(100)$q$,'42501','Current clinical disposition authority required','monitor without clinical authority cannot register');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(1),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT pg_temp.lo_prepare(500)$q$,'42501','Observation source not authorized','other patient refused');
SELECT throws_ok($q$SELECT pg_temp.lo_prepare(999)$q$,'42501','Observation source not authorized','absent source not empty success');
SELECT throws_ok($q$SELECT pg_temp.lo_prepare(100,'unknown')$q$,'22023','Invalid observation analyte','unsupported analyte refused');
SELECT throws_ok($q$SELECT pg_temp.lo_prepare(100,'bnp')$q$,'22023','Verify the recorded source value and collection','absent analyte refused');
SELECT throws_ok($q$SELECT pg_temp.lo_prepare(501)$q$,'22023','Verify the recorded source value and collection','future collection refused');
SELECT throws_ok($q$SELECT pg_temp.lo_prepare(100,'potassium',pg_temp.lo_payload()||'{"actor_id":"forged"}')$q$,'22023','Invalid observation source evidence','forged payload identity refused');
SELECT throws_ok($q$SELECT pg_temp.lo_prepare(100,'potassium',pg_temp.lo_payload()||'{"evidence":"  "}')$q$,'22023','Invalid observation source evidence','meaningful source evidence required');
SELECT throws_ok($q$SELECT pg_temp.lo_prepare(100,'potassium',pg_temp.lo_payload()||'{"occurred_at":"9999-01-01T00:00:00Z"}')$q$,'22023','Source registration occurrence cannot be future','future occurrence refused');
SELECT throws_ok($q$SELECT pg_temp.lo_prepare(100,'potassium',pg_temp.lo_payload()||'{"occurred_at":"2026-01-01T00:00:00"}')$q$,'22023','Invalid care step timestamp','explicit offset required');
INSERT INTO observation_receipts VALUES('prepared',pg_temp.lo_prepare(100));
SELECT is((SELECT value->>'state' FROM observation_receipts WHERE label='prepared'),'prepared','source preparation recoverable before registration');
SELECT is((SELECT value#>>'{source_snapshot,value}' FROM observation_receipts WHERE label='prepared'),'4.6','decimal value string preserved');
SELECT ok(NOT((SELECT value FROM observation_receipts WHERE label='prepared')?'source_fingerprint'),'private full-panel fingerprint not exposed');
SELECT is(pg_temp.lo_prepare(100),(SELECT value FROM observation_receipts WHERE label='prepared'),'identical prepare returns original frozen snapshot');
SELECT is(public.get_lab_observation_request(pg_temp.lo(1100)),(SELECT value FROM observation_receipts WHERE label='prepared'),'reload recovers prepared source');
SELECT throws_ok($q$SELECT pg_temp.lo_prepare(100,'potassium',pg_temp.lo_payload()||'{"evidence":"Changed evidence"}')$q$,'23505','Observation request identity conflict','changed evidence conflicts');
SELECT throws_ok($q$SELECT public.prepare_lab_observation(pg_temp.lo(9100),pg_temp.lo(9200),pg_temp.lo(90),pg_temp.lo(11),pg_temp.lo(100),'potassium',pg_temp.lo_payload())$q$,
 '23505','Recover or cancel the pending source registration first','cannot hide an unresolved preparation');
SELECT throws_ok($q$SELECT public.acknowledge_lab_observation(pg_temp.lo(1100))$q$,'22023','Only an applied source receipt can be acknowledged','prepared is not a receipt');
INSERT INTO observation_receipts VALUES('applied',public.apply_lab_observation(pg_temp.lo(1100)));
SELECT is((SELECT value->>'state' FROM observation_receipts WHERE label='applied'),'applied','registration committed');
SELECT is((SELECT value#>>'{receipt,revision}' FROM observation_receipts WHERE label='applied'),'1','initial version only');
SELECT is((SELECT value#>>'{receipt,order_authorship_confirmed}' FROM observation_receipts WHERE label='applied'),'false','registration never claims order authorship');
SELECT is((SELECT value#>>'{receipt,clinical_review_recorded}' FROM observation_receipts WHERE label='applied'),'false','registration not clinical review');
SELECT is((SELECT value#>>'{receipt,care_completed}' FROM observation_receipts WHERE label='applied'),'false','registration not care completion');
SELECT is(public.apply_lab_observation(pg_temp.lo(1100)),(SELECT value FROM observation_receipts WHERE label='applied'),'apply replay original receipt');
SELECT is(public.cancel_lab_observation(pg_temp.lo(1100)),(SELECT value FROM observation_receipts WHERE label='applied'),'late cancellation cannot undo authority');
SELECT lives_ok($q$SELECT public.acknowledge_lab_observation(pg_temp.lo(1100))$q$,'receipt explicitly acknowledged');
SELECT is(public.get_lab_observation_request(pg_temp.lo(1100))->'receipt',(SELECT value->'receipt' FROM observation_receipts WHERE label='applied'),'receipt persists after ACK');
SELECT lives_ok($q$SELECT public.acknowledge_lab_observation(pg_temp.lo(1100))$q$,'ACK replay idempotent');
SELECT is((SELECT ordered_by FROM public.lab_results WHERE id=pg_temp.lo(100)),pg_temp.lo(2),'original ordering identity unchanged');
SELECT is((SELECT count(*) FROM public.lab_alert_evaluations WHERE lab_result_id=pg_temp.lo(100)),0::bigint,'registration does not invent an evaluation');
SELECT throws_ok($q$SELECT public.prepare_lab_observation(pg_temp.lo(9100),pg_temp.lo(9200),pg_temp.lo(90),pg_temp.lo(11),pg_temp.lo(100),'potassium',pg_temp.lo_payload())$q$,
 '23505','Observation source already registered','same organization cannot fork source authority');
SELECT lives_ok($q$SELECT public.prepare_lab_observation(pg_temp.lo(9101),pg_temp.lo(9201),pg_temp.lo(90),pg_temp.lo(11),pg_temp.lo(100),'creatinine',pg_temp.lo_payload()); SELECT public.apply_lab_observation(pg_temp.lo(9101))$q$,'second original analyte independent');

SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(3),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT pg_temp.lo_prepare(100,'potassium',pg_temp.lo_payload(),91)$q$,'23505','Observation request identity conflict','another actor cannot reuse existing request');
SELECT throws_ok($q$SELECT public.prepare_lab_observation(pg_temp.lo(9500),pg_temp.lo(9501),pg_temp.lo(91),pg_temp.lo(11),pg_temp.lo(100),'potassium',pg_temp.lo_payload())$q$,
 '23505','Observation source already registered','another authorized organization cannot claim original/analyte');
SELECT throws_ok($q$SELECT public.get_lab_observation_request(pg_temp.lo(1100))$q$,'42501','Observation request not authorized','other actor cannot recover private request');
SELECT throws_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(1100))$q$,'42501','Observation request not authorized','account switch cannot apply request');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.lab_observation_roots WHERE original_lab_result_id=pg_temp.lo(100)),2::bigint,'two analytes retain two roots');
SELECT throws_ok($q$UPDATE public.lab_results SET notes='Changed' WHERE id=pg_temp.lo(100)$q$,'42501','Registered source panels are immutable','registered legacy panel sealed');
SELECT throws_ok($q$DELETE FROM public.lab_results WHERE id=pg_temp.lo(100)$q$,'42501','Registered source panels are immutable','registered legacy panel cannot be deleted');
SELECT throws_ok($q$UPDATE public.lab_observation_roots SET organization_id=pg_temp.lo(91) WHERE id=pg_temp.lo(2100)$q$,'42501','Observation history is immutable','root authority immutable');
SELECT throws_ok($q$UPDATE public.lab_observation_versions SET status='original' WHERE root_id=pg_temp.lo(2100)$q$,'42501','Observation history is immutable','version cannot be rewritten');
SELECT throws_ok($q$DELETE FROM public.lab_observation_requests WHERE id=pg_temp.lo(1100)$q$,'42501','Observation history is immutable','request evidence retained');
SELECT is((SELECT count(*) FROM public.alerts WHERE patient_id=pg_temp.lo(11)),0::bigint,'no alert invented by registration');
SELECT is((SELECT count(*) FROM public.work_items WHERE patient_id=pg_temp.lo(11)),0::bigint,'no care/work completion invented');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(1),'aal','aal2')::text,true);
SELECT pg_temp.lo_prepare(101); SELECT pg_temp.lo_prepare(102); SELECT pg_temp.lo_prepare(103); SELECT pg_temp.lo_prepare(104);
RESET ROLE;
UPDATE public.lab_results SET potassium=4.8 WHERE id=pg_temp.lo(101);
UPDATE public.lab_results SET notes='Changed synthetic note' WHERE id=pg_temp.lo(102);
UPDATE public.lab_results SET creatinine=1.24 WHERE id=pg_temp.lo(103);
UPDATE public.lab_results SET patient_id=pg_temp.lo(12) WHERE id=pg_temp.lo(104);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(1101))$q$,'40001','Source panel changed after preparation','changed analyte conflicts');
SELECT throws_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(1102))$q$,'40001','Source panel changed after preparation','changed notes conflict');
SELECT throws_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(1103))$q$,'40001','Source panel changed after preparation','changed other analyte conflicts');
SELECT throws_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(1104))$q$,'42501','Observation source not authorized','patient rechecked after row lock');
SELECT is(public.get_lab_observation_request(pg_temp.lo(1101))#>>'{source_snapshot,value}','4.6','changed source does not rewrite frozen preparation');
SELECT lives_ok($q$SELECT public.cancel_lab_observation(pg_temp.lo(1104))$q$,'own preparation can be cancelled without reading changed patient source');
SELECT throws_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(1104))$q$,'42501','Observation source not authorized','cancelled source with changed patient cannot bypass scope');
SELECT pg_temp.lo_prepare(105);
SET LOCAL timezone='America/New_York';
SELECT lives_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(1105))$q$,'fingerprint invariant to session timezone');
SET LOCAL timezone='UTC';
SELECT pg_temp.lo_prepare(106);
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='clinical_disposition'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE organization_id=pg_temp.lo(90) AND user_id=pg_temp.lo(1));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(1106))$q$,'42501','Current clinical disposition authority required','revoked clinical grant cannot register');
SELECT lives_ok($q$SELECT public.get_lab_observation_request(pg_temp.lo(1106)); SELECT public.cancel_lab_observation(pg_temp.lo(1106))$q$,'monitor can recover/cancel after clinical grant revoked');
SELECT lives_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(1100)); SELECT public.acknowledge_lab_observation(pg_temp.lo(1100))$q$,'terminal replay creates no new clinical authority');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='clinical_disposition';

-- Roll back each partial registration write independently; keep preparation recoverable.
CREATE FUNCTION pg_temp.fail_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic rollback injection'; END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.lo_prepare(107);
RESET ROLE;
CREATE TRIGGER synthetic_failure AFTER INSERT ON public.lab_observation_roots FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_observation();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(1107))$q$,'P0001','Synthetic rollback injection','rollback after root write');
RESET ROLE;
DROP TRIGGER synthetic_failure ON public.lab_observation_roots;
SELECT is((SELECT count(*) FROM public.lab_observation_roots WHERE id=pg_temp.lo(2107)),0::bigint,'root insert rolled back');
SELECT is((SELECT state FROM public.lab_observation_requests WHERE id=pg_temp.lo(1107)),'prepared','request stays prepared after root failure');
CREATE TRIGGER synthetic_failure AFTER INSERT ON public.lab_observation_versions FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_observation();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(1107))$q$,'P0001','Synthetic rollback injection','rollback after version write');
RESET ROLE;
DROP TRIGGER synthetic_failure ON public.lab_observation_versions;
SELECT is((SELECT count(*) FROM public.lab_observation_roots WHERE id=pg_temp.lo(2107)),0::bigint,'root rolled back with version failure');
SELECT is((SELECT count(*) FROM public.lab_observation_versions WHERE root_id=pg_temp.lo(2107)),0::bigint,'version rolled back');
SELECT is((SELECT state FROM public.lab_observation_requests WHERE id=pg_temp.lo(1107)),'prepared','request prepared after version failure');
CREATE TRIGGER synthetic_failure AFTER UPDATE ON public.lab_observation_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_observation();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(1107))$q$,'P0001','Synthetic rollback injection','rollback after receipt write');
RESET ROLE;
DROP TRIGGER synthetic_failure ON public.lab_observation_requests;
SELECT is((SELECT count(*) FROM public.lab_observation_roots WHERE id=pg_temp.lo(2107)),0::bigint,'root rolled back with receipt failure');
SELECT is((SELECT count(*) FROM public.lab_observation_versions WHERE root_id=pg_temp.lo(2107)),0::bigint,'version rolled back with receipt failure');
SELECT is((SELECT state FROM public.lab_observation_requests WHERE id=pg_temp.lo(1107)),'prepared','receipt transition rolled back');

SET LOCAL ROLE authenticated;
SELECT public.cancel_lab_observation(id) FROM (SELECT (value->>'request_id')::uuid id FROM jsonb_array_elements(public.list_pending_lab_observations(pg_temp.lo(90),pg_temp.lo(11))->'items') value
 WHERE value->>'state'='prepared') pending;
SELECT public.acknowledge_lab_observation(id) FROM (SELECT (value->>'request_id')::uuid id FROM jsonb_array_elements(public.list_pending_lab_observations(pg_temp.lo(90),pg_temp.lo(11))->'items') value
 WHERE value->>'state'='applied') pending;
SELECT pg_temp.lo_prepare(n) FROM generate_series(200,229) n;
SELECT is(jsonb_array_length(public.list_pending_lab_observations(pg_temp.lo(90),pg_temp.lo(11))->'items'),25,'pending first page25');
SELECT is(public.list_pending_lab_observations(pg_temp.lo(90),pg_temp.lo(11))->>'next_cursor',pg_temp.lo(1224)::text,'cursor last visible ID');
SELECT is(jsonb_array_length(public.list_pending_lab_observations(pg_temp.lo(90),pg_temp.lo(11),pg_temp.lo(1224))->'items'),5,'pending tail5');
SELECT ok(public.list_pending_lab_observations(pg_temp.lo(90),pg_temp.lo(11),pg_temp.lo(1224))->>'next_cursor' IS NULL,'tail terminal explicitly');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='monitor'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE organization_id=pg_temp.lo(90) AND user_id=pg_temp.lo(1));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_lab_observation_request(pg_temp.lo(1200))$q$,'42501','Work ownership operation not authorized','current monitor mandatory for recovery');
SELECT throws_ok($q$SELECT public.list_pending_lab_observations(pg_temp.lo(90),pg_temp.lo(11))$q$,'42501','Work ownership operation not authorized','scope failure never empty list');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
