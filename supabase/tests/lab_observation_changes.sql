-- Isolated synthetic source-amendment verification. Every fixture rolls back.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
-- BEGIN CHANGE FIXTURES
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

-- END CHANGE FIXTURES
CREATE FUNCTION pg_temp.lo_payload() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('evidence','  Synthetic source_document  ','occurred_at',to_char(now() AT TIME ZONE 'UTC'-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;
CREATE FUNCTION pg_temp.lo_prepare(n integer,a text DEFAULT 'potassium',p jsonb DEFAULT pg_temp.lo_payload(),o integer DEFAULT 90) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_lab_observation(pg_temp.lo(n+1000),pg_temp.lo(n+2000),pg_temp.lo(o),pg_temp.lo(11),pg_temp.lo(n),a,p)
$$;

-- BEGIN CHANGE HELPERS
CREATE FUNCTION pg_temp.change_payload(v text DEFAULT '4.20') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('reason','Private synthetic correction reason','evidence','Synthetic corrected source',
 'occurred_at',to_char(now() AT TIME ZONE 'UTC'-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'value',v,'collected_at',to_char(now() AT TIME ZONE 'UTC'-interval '2 days','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;
CREATE FUNCTION pg_temp.change_prepare(n integer,r integer DEFAULT 2100,rev bigint DEFAULT 1,c text DEFAULT 'correct_source',p jsonb DEFAULT pg_temp.change_payload())
 RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_lab_observation_change(pg_temp.lo(n),pg_temp.lo(r),pg_temp.lo(90),pg_temp.lo(11),rev,c,p)
$$;
-- END CHANGE HELPERS
CREATE TEMP TABLE changes(label text PRIMARY KEY,value jsonb);
GRANT ALL ON changes TO authenticated;
SELECT ok(NOT has_table_privilege('authenticated','public.lab_observation_change_events','SELECT'),'change evidence private');
SELECT ok(NOT has_table_privilege('service_role','public.lab_observation_change_events','INSERT'),'service cannot forge change event');
SELECT ok(NOT has_function_privilege('anon','public.prepare_lab_observation_change(uuid,uuid,uuid,uuid,bigint,text,jsonb)','EXECUTE'),'anonymous change denied');
SELECT ok(NOT has_function_privilege('service_role','public.prepare_lab_observation_change(uuid,uuid,uuid,uuid,bigint,text,jsonb)','EXECUTE'),'service change denied');
SELECT ok(NOT has_function_privilege('authenticated','public.validate_observation_change(text,jsonb,text)','EXECUTE'),'unscoped typed decoder private');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.lab_observation_change_events'::regclass
 AND confrelid IN('public.work_items'::regclass,'public.care_workflows'::regclass)),'change evidence has no hidden work FK');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(1),'aal','aal2')::text,true);
SELECT pg_temp.lo_prepare(100); SELECT public.apply_lab_observation(pg_temp.lo(1100));
INSERT INTO changes VALUES('before',public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)]));
INSERT INTO changes VALUES('prepared',pg_temp.change_prepare(8000));
SELECT is((SELECT value#>>'{source_snapshot,revision}' FROM changes WHERE label='prepared'),'1','preparation freezes revision');
SELECT is((SELECT value#>>'{source_snapshot,value}' FROM changes WHERE label='prepared'),'4.6','preparation freezes old value');
SELECT is((SELECT value#>>'{payload,value}' FROM changes WHERE label='prepared'),'4.20','request keeps exact submitted spelling');
SELECT is(pg_temp.change_prepare(8000),(SELECT value FROM changes WHERE label='prepared'),'same prepare exact replay');
SELECT throws_ok($q$SELECT pg_temp.change_prepare(8000,2100,1,'correct_source',pg_temp.change_payload('4.3'))$q$,'23505','Observation request identity conflict','payload cannot change on replay');
SELECT throws_ok($q$SELECT public.prepare_lab_observation(pg_temp.lo(8000),pg_temp.lo(2100),pg_temp.lo(90),pg_temp.lo(11),pg_temp.lo(100),'potassium',pg_temp.change_payload())$q$,
 '23505','Observation request identity conflict','old registration cannot replay a change request');
SELECT throws_ok($q$SELECT pg_temp.change_prepare(8001)$q$,'23505','Recover or cancel the pending observation change first','unresolved request not hidden by replacement');
INSERT INTO changes VALUES('corrected',public.apply_lab_observation(pg_temp.lo(8000)));
SELECT is((SELECT value#>>'{receipt,revision}' FROM changes WHERE label='corrected'),'2','correction appends revision2');
SELECT is((SELECT value#>>'{receipt,stored_source,value}' FROM changes WHERE label='corrected'),'4.2','receipt distinguishes stored scale');
SELECT is((SELECT value#>>'{receipt,evaluation_status}' FROM changes WHERE label='corrected'),'pending','new source evaluation only pending');
SELECT is((SELECT value#>>'{receipt,work_invalidation_recorded}' FROM changes WHERE label='corrected'),'false','global change is not per-work invalidation');
SELECT is((SELECT value#>>'{receipt,clinical_review_recorded}' FROM changes WHERE label='corrected'),'false','change is not review');
SELECT is((SELECT value#>>'{receipt,care_completed}' FROM changes WHERE label='corrected'),'false','change is not completed care');
SELECT is(public.apply_lab_observation(pg_temp.lo(8000)),(SELECT value FROM changes WHERE label='corrected'),'applied replay exact');
SELECT is(public.cancel_lab_observation(pg_temp.lo(8000)),(SELECT value FROM changes WHERE label='corrected'),'late request cancel never cancels source');
SELECT lives_ok($q$SELECT public.acknowledge_lab_observation(pg_temp.lo(8000))$q$,'change receipt acknowledgement supported');
SELECT is(public.get_lab_observation_request(pg_temp.lo(8000))->'receipt',(SELECT value->'receipt' FROM changes WHERE label='corrected'),'receipt retained after ACK');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)],(SELECT value->>'next_cursor' FROM changes WHERE label='before'),(SELECT value->>'snapshot' FROM changes WHERE label='before'))$q$,
 '40001','Laboratory projection changed; restart the complete read','amendment invalidates prior pagination');
INSERT INTO changes VALUES('projection',public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)]));
SELECT is((SELECT x->>'value' FROM changes CROSS JOIN LATERAL jsonb_array_elements(value->'items') x WHERE label='projection' AND x->>'id'=pg_temp.lo(100)||':potassium'),'4.2','projection returns corrected K');
SELECT is((SELECT x->>'value' FROM changes CROSS JOIN LATERAL jsonb_array_elements(value->'items') x WHERE label='projection' AND x->>'id'=pg_temp.lo(100)||':creatinine'),'1.23','other original analyte preserved');
SELECT is((SELECT x->>'value' FROM changes CROSS JOIN LATERAL jsonb_array_elements(value->'items') x WHERE label='projection' AND x->>'id'=pg_temp.lo(100)||':egfr'),'82','original renal value not dropped by K amendment');
SELECT ok(NOT EXISTS(SELECT 1 FROM changes CROSS JOIN LATERAL jsonb_array_elements(value->'items') x WHERE label='projection'
 AND x->>'original_lab_result_id'=(SELECT value#>>'{receipt,effective_lab_result_id}' FROM changes WHERE label='corrected')),'amendment excluded as independent panel');
SELECT throws_ok($q$SELECT public.prepare_lab_observation(pg_temp.lo(8010),pg_temp.lo(8011),pg_temp.lo(90),pg_temp.lo(11),
 (SELECT (value#>>'{receipt,effective_lab_result_id}')::uuid FROM changes WHERE label='corrected'),'potassium',pg_temp.lo_payload())$q$,
 '22023','Amendment rows cannot become original sources','amendment cannot be registered');
SELECT throws_ok($q$SELECT pg_temp.change_prepare(8001)$q$,'40001','Observation revision changed','old revision never auto-upgraded');
SELECT pg_temp.change_prepare(8001,2100,2,'cancel_source',pg_temp.change_payload()-ARRAY['value','collected_at']);
INSERT INTO changes VALUES('cancelled',public.apply_lab_observation(pg_temp.lo(8001)));
SELECT is((SELECT value#>>'{receipt,status}' FROM changes WHERE label='cancelled'),'cancelled','cancel source explicit');
SELECT ok((SELECT value#>'{receipt,effective_lab_result_id}'='null'::jsonb AND value#>'{receipt,evaluation_status}'='null'::jsonb
 AND value#>'{receipt,stored_source,value}'='null'::jsonb FROM changes WHERE label='cancelled'),'cancel creates no source/value/evaluation');
INSERT INTO changes VALUES('cancel-projection',public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)]));
SELECT is((SELECT x->>'status' FROM changes CROSS JOIN LATERAL jsonb_array_elements(value->'items') x WHERE label='cancel-projection' AND x->>'id'=pg_temp.lo(100)||':potassium'),'cancelled','projection does not fall back to original');
SELECT is((SELECT x->>'collected_at' FROM changes CROSS JOIN LATERAL jsonb_array_elements(value->'items') x WHERE label='cancel-projection' AND x->>'id'=pg_temp.lo(100)||':potassium'),
 (SELECT value#>>'{receipt,stored_source,collected_at}' FROM changes WHERE label='corrected'),'cancel keeps previous collection anchor');
SELECT throws_ok($q$SELECT pg_temp.change_prepare(8002,2100,3,'cancel_source',pg_temp.change_payload()-ARRAY['value','collected_at'])$q$,
 '22023','Observation is already cancelled','fresh duplicate source cancel denied');
SELECT pg_temp.change_prepare(8002,2100,3,'correct_source',pg_temp.change_payload('4.30'));
INSERT INTO changes VALUES('restored',public.apply_lab_observation(pg_temp.lo(8002)));
SELECT is((SELECT value#>>'{receipt,revision}' FROM changes WHERE label='restored'),'4','restoration is new revision');
SELECT isnt((SELECT value#>>'{receipt,effective_lab_result_id}' FROM changes WHERE label='restored'),
 (SELECT value#>>'{receipt,effective_lab_result_id}' FROM changes WHERE label='corrected'),'restoration allocates new single-analyte row');
SELECT is(pg_temp.change_prepare(8000)->'receipt',(SELECT value->'receipt' FROM changes WHERE label='corrected'),'old prepare replay retains original receipt after later heads');
SELECT is(public.apply_lab_observation(pg_temp.lo(8000))->'receipt',(SELECT value->'receipt' FROM changes WHERE label='corrected'),'old apply replay does not restore its superseded value');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.lab_observation_change_events),3::bigint,'each change has one durable global event');
SELECT is((SELECT count(*) FROM public.lab_alert_evaluations),2::bigint,'only two corrected rows create pending evaluations');
SELECT is((SELECT count(*) FROM public.alerts),0::bigint,'no evaluation or alert in change transaction');
SELECT is((SELECT count(*) FROM public.work_items),0::bigint,'no work side effect');
SELECT ok((SELECT ordered_by IS NULL AND notes IS NULL AND lab_facility IS NULL AND creatinine IS NULL AND egfr IS NULL FROM public.lab_results
 WHERE id=(SELECT (value#>>'{receipt,effective_lab_result_id}')::uuid FROM changes WHERE label='corrected')),'one analyte, no copied authorship or private evidence');
SELECT is((SELECT ordered_by FROM public.lab_results WHERE id=pg_temp.lo(100)),pg_temp.lo(2),'original ordering identity retained');
SELECT throws_ok($q$UPDATE public.lab_results SET notes='Changed' WHERE id=(SELECT (value#>>'{receipt,effective_lab_result_id}')::uuid FROM changes WHERE label='corrected')$q$,
 '42501','Registered source panels are immutable','amendment immutable');
SELECT throws_ok($q$DELETE FROM public.lab_results WHERE id=(SELECT (value#>>'{receipt,effective_lab_result_id}')::uuid FROM changes WHERE label='restored')$q$,
 '42501','Registered source panels are immutable','restored amendment cannot be deleted');
SELECT throws_ok($q$DELETE FROM public.lab_observation_change_events$q$,'42501','Observation history is immutable','change events retained');
-- Value validation covers every existing column with no new clinical thresholds.
SELECT lives_ok(format('SELECT public.validate_observation_change(%L,%L::jsonb,%L)','correct_source',pg_temp.change_payload('1.0'),a),
 'exact typed value accepted: '||a) FROM unnest(ARRAY['potassium','creatinine','bun','bnp','nt_probnp','hba1c','glucose','sodium','hemoglobin','ferritin','tsat','ldl']) a;
SELECT lives_ok($q$SELECT public.validate_observation_change('correct_source',pg_temp.change_payload('65'),'egfr')$q$,'integer eGFR exact');
SELECT lives_ok($q$SELECT public.validate_observation_change('correct_source',pg_temp.change_payload('00065.00'),'egfr')$q$,'integral decimal spelling accepted without rounding');
SELECT throws_ok($q$SELECT public.validate_observation_change('correct_source',pg_temp.change_payload('4.21'),'potassium')$q$,'22023','Observation value would lose storage precision','K rounding rejected');
SELECT throws_ok($q$SELECT public.validate_observation_change('correct_source',pg_temp.change_payload('65.1'),'egfr')$q$,'22023','Observation value cannot be stored exactly','fractional eGFR rejected');
SELECT throws_ok($q$SELECT public.validate_observation_change('correct_source',pg_temp.change_payload('1000'),'potassium')$q$,'22023','Observation value cannot be stored exactly','overflow rejected');
SELECT throws_ok(format('SELECT public.validate_observation_change(%L,%L::jsonb,%L)','correct_source',pg_temp.change_payload(v),'potassium'),
 '22023','Invalid exact observation value','invalid decimal rejected: '||v) FROM unnest(ARRAY['NaN','Infinity','-1','1e3','.5','4.',' 4.2','']) v;
SELECT throws_ok($q$SELECT public.validate_observation_change('correct_source',pg_temp.change_payload()||jsonb_build_object('collected_at',to_char(now()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),'potassium')$q$,
 '22023','Observation collection cannot be future','future collection rejected');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(3),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.prepare_lab_observation_change(pg_temp.lo(8020),pg_temp.lo(2100),pg_temp.lo(91),pg_temp.lo(11),4,'correct_source',pg_temp.change_payload())$q$,
 '42501','Observation source authority not authorized','another organization cannot borrow authority');
SELECT throws_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(8002))$q$,'42501','Observation request not authorized','another actor cannot replay');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(2),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT pg_temp.change_prepare(8020,2100,4)$q$,'42501','Current clinical disposition authority required','monitor-only cannot prepare change');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(1),'aal','aal1')::text,true);
SELECT throws_ok($q$SELECT pg_temp.change_prepare(8020,2100,4)$q$,'42501','Work ownership operation not authorized','AAL1 refused');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(1),'aal','aal2')::text,true);
SELECT pg_temp.change_prepare(8020,2100,4);
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='clinical_disposition'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.lo(1) AND organization_id=pg_temp.lo(90));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_lab_observation(pg_temp.lo(8020))$q$,'42501','Current clinical disposition authority required','revoked clinical grant blocks fresh apply');
SELECT lives_ok($q$SELECT public.get_lab_observation_request(pg_temp.lo(8020)); SELECT public.cancel_lab_observation(pg_temp.lo(8020));
 SELECT public.apply_lab_observation(pg_temp.lo(8002)); SELECT public.acknowledge_lab_observation(pg_temp.lo(8002))$q$,'monitor can recover/cancel/ACK/replay after clinical revocation');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='clinical_disposition';
-- Roll back each new write; a still-prepared request is recoverable without another source row.
CREATE FUNCTION pg_temp.fail_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic change rollback'; END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.change_prepare(8030,2100,4);
RESET ROLE;
CREATE FUNCTION pg_temp.rollback_change(t text,operation text) RETURNS boolean LANGUAGE plpgsql AS $test$
DECLARE before_labs bigint; before_versions bigint; before_events bigint; caught boolean:=false;
BEGIN
 SELECT count(*) INTO before_labs FROM public.lab_results;
 SELECT count(*) INTO before_versions FROM public.lab_observation_versions;
 SELECT count(*) INTO before_events FROM public.lab_observation_change_events;
 EXECUTE format('CREATE TRIGGER synthetic_change_failure AFTER %s ON public.%I FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_change()',operation,t);
 BEGIN
  PERFORM public.apply_lab_observation(pg_temp.lo(8030));
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Synthetic change rollback' THEN RAISE; END IF;
  caught:=true;
 END;
 EXECUTE format('DROP TRIGGER synthetic_change_failure ON public.%I',t);
 RETURN caught AND (SELECT count(*) FROM public.lab_results)=before_labs AND (SELECT count(*) FROM public.lab_observation_versions)=before_versions
  AND (SELECT count(*) FROM public.lab_observation_change_events)=before_events
  AND (SELECT state FROM public.lab_observation_requests WHERE id=pg_temp.lo(8030))='prepared';
END $test$;
SELECT ok(pg_temp.rollback_change(t,'INSERT'),'atomic rollback after '||t) FROM unnest(ARRAY['lab_results','lab_alert_evaluations','lab_observation_versions','lab_observation_change_events']) t;
SELECT ok(pg_temp.rollback_change('lab_observation_requests','UPDATE'),'atomic rollback after receipt');
SELECT is((SELECT count(*) FROM public.lab_observation_versions WHERE root_id=pg_temp.lo(2100)),4::bigint,'all earlier immutable versions retained');
SELECT * FROM finish();
ROLLBACK;
