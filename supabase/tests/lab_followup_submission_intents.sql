-- Local synthetic pre-save binding proof. No hosted fixtures.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
-- BEGIN STEP FIXTURES
CREATE FUNCTION pg_temp.cs(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.cs(n),'care-step-'||n||'@example.invalid','{"consent_accepted":true}' FROM unnest(ARRAY[1,2,3,11,12]) n;
UPDATE public.profiles SET role='provider' WHERE id=ANY(ARRAY[pg_temp.cs(1),pg_temp.cs(2),pg_temp.cs(3)]);
INSERT INTO public.organizations(id,name,created_by) VALUES
 (pg_temp.cs(90),'Synthetic step A',pg_temp.cs(1)),(pg_temp.cs(91),'Synthetic step B',pg_temp.cs(3));
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 SELECT pg_temp.cs(90),pg_temp.cs(n),CASE WHEN n=1 THEN 'owner' ELSE 'clinician' END,'active',now(),pg_temp.cs(1)
 FROM generate_series(1,2) n;
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES(pg_temp.cs(91),pg_temp.cs(3),'owner','active',now(),pg_temp.cs(3));
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',created_by FROM public.organization_memberships WHERE organization_id=ANY(ARRAY[pg_temp.cs(90),pg_temp.cs(91)]);
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by) VALUES
 (pg_temp.cs(90),pg_temp.cs(11),pg_temp.cs(1)),(pg_temp.cs(91),pg_temp.cs(12),pg_temp.cs(3));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 (pg_temp.cs(1),pg_temp.cs(11),'active',now()),(pg_temp.cs(2),pg_temp.cs(11),'active',now()),(pg_temp.cs(3),pg_temp.cs(12),'active',now());
-- END STEP FIXTURES
-- BEGIN STEP HELPERS
CREATE FUNCTION pg_temp.cs_instant(p_time timestamptz) RETURNS text LANGUAGE sql AS $$
 SELECT to_char(p_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
CREATE FUNCTION pg_temp.cs_new(n integer,p_kind text DEFAULT 'laboratory_order',p_accept boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM public.prepare_care_workflow_request(pg_temp.cs(n+1000),pg_temp.cs(n),pg_temp.cs(90),pg_temp.cs(11),
  jsonb_build_object('kind',p_kind,'source','external_documented','purpose','Synthetic documented follow-up',
   'evidence','Synthetic source only','occurred_at',pg_temp.cs_instant(now()-interval '1 hour'),
   'next_review_at',pg_temp.cs_instant(now()+interval '1 day'),'analytes',
   CASE WHEN p_kind='laboratory_order' THEN '["potassium","creatinine","egfr","sodium","bnp"]'::jsonb ELSE '[]'::jsonb END));
 PERFORM public.apply_care_workflow_request(pg_temp.cs(n+1000));
 IF p_accept THEN PERFORM public.accept_work_item(pg_temp.cs(n)); END IF;
END $$;
CREATE FUNCTION pg_temp.cs_payload(p_details jsonb DEFAULT '{}',p_override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurred_at',pg_temp.cs_instant(now()-interval '30 minutes'),'evidence','Synthetic event evidence',
  'next_action','Review the pending synthetic need','next_review_at',pg_temp.cs_instant(now()+interval '2 days'),'details',p_details)||p_override
$$;
CREATE FUNCTION pg_temp.cs_prepare(n integer,w integer,c text,d jsonb DEFAULT '{}',o jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f jsonb;
BEGIN
 f:=public.get_care_workflow(pg_temp.cs(w));
 RETURN public.prepare_care_step(pg_temp.cs(n),pg_temp.cs(w),(f->>'revision')::bigint,(f->>'ownership_revision')::bigint,c,pg_temp.cs_payload(d,o));
END $$;
CREATE FUNCTION pg_temp.cs_step(n integer,w integer,c text,d jsonb DEFAULT '{}',o jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.cs_prepare(n,w,c,d,o); RETURN public.apply_care_step(pg_temp.cs(n));
END $$;
-- END STEP HELPERS

CREATE TEMP TABLE intent_submissions(work integer PRIMARY KEY,submission uuid);
CREATE TEMP TABLE intent_proofs(label text PRIMARY KEY,value jsonb);
GRANT ALL ON intent_submissions,intent_proofs TO authenticated,service_role;
-- BEGIN INTENT HELPERS
CREATE FUNCTION pg_temp.fi_payload(override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('analytes','["potassium","egfr"]'::jsonb,'evidence','  Synthetic follow-up intention  ',
  'occurred_at',pg_temp.cs_instant(now()-interval '1 hour'))||override
$$;
CREATE FUNCTION pg_temp.fi_attempt(w integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE submission uuid;
BEGIN
 SELECT request_id INTO submission FROM public.prepare_lab_submission(pg_temp.cs(11));
 INSERT INTO intent_submissions VALUES(w,submission); RETURN submission;
END $$;
CREATE FUNCTION pg_temp.fi_bind(n integer,w integer,override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE flow jsonb; submission uuid;
BEGIN
 flow:=public.get_care_workflow(pg_temp.cs(w)); SELECT s.submission INTO submission FROM intent_submissions s WHERE work=w;
 RETURN public.prepare_lab_followup_intent(pg_temp.cs(n),pg_temp.cs(w),pg_temp.cs(90),pg_temp.cs(11),submission,
  (flow->>'revision')::bigint,(flow->>'ownership_revision')::bigint,pg_temp.fi_payload(override));
END $$;
CREATE FUNCTION pg_temp.fi_save(w integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE submission uuid; receipt record;
BEGIN
 SELECT s.submission INTO submission FROM intent_submissions s WHERE work=w;
 SELECT * INTO receipt FROM public.submit_lab_result(submission,pg_temp.cs(11),'2026-01-01T12:00:00.123456-04:00',4.6,NULL,1.23);
 RETURN to_jsonb(receipt);
END $$;
CREATE FUNCTION pg_temp.fi_ack(w integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE submission uuid; lab uuid;
BEGIN
 SELECT s.submission INTO submission FROM intent_submissions s WHERE work=w;
 SELECT r.lab_result_id INTO lab FROM public.lab_submission_receipts r WHERE actor_id=pg_temp.cs(1) AND patient_id=pg_temp.cs(11) AND request_id=submission;
 PERFORM public.acknowledge_lab_submission(pg_temp.cs(11),submission,lab);
END $$;
-- END INTENT HELPERS
SELECT ok(NOT has_table_privilege('authenticated','public.lab_followup_submission_intents','SELECT'),'intent payload table private');
SELECT ok(NOT has_table_privilege('service_role','public.lab_followup_submission_intents','INSERT'),'service cannot forge intentions');
SELECT ok(NOT has_function_privilege('authenticated','public.lab_followup_intent_state(uuid)','EXECUTE'),'unscoped helper private');
SELECT ok(NOT has_function_privilege('anon','public.get_lab_followup_intent(uuid)','EXECUTE'),'anonymous reads denied');
SELECT ok(NOT has_function_privilege('service_role','public.cancel_lab_followup_intent(uuid)','EXECUTE'),'service cannot cancel human intent');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
SELECT pg_temp.cs_new(100); SELECT pg_temp.cs_new(101,'referral'); SELECT pg_temp.cs_new(102,'laboratory_order',false);
SELECT pg_temp.fi_attempt(100);
INSERT INTO intent_submissions SELECT 101,submission FROM intent_submissions WHERE work=100;
INSERT INTO intent_submissions SELECT 102,submission FROM intent_submissions WHERE work=100;
SELECT throws_ok($q$SELECT pg_temp.fi_bind(200,101)$q$,'22023','Laboratory workflow required','referral cannot claim lab intention');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(200,102)$q$,'42501',NULL,'unaccepted work cannot bind');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(200,100,'{"analytes":[]}')$q$,'22023',NULL,'empty analytes refused');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(200,100,'{"analytes":["potassium","potassium"]}')$q$,'22023',NULL,'duplicate analytes refused');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(200,100,'{"analytes":["bnp"]}')$q$,'22023',NULL,'requested but unsupported submission analyte refused');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(200,100,'{"analytes":["ldl"]}')$q$,'22023',NULL,'unrequested analyte refused');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(200,100,'{"analytes":[4]}')$q$,'22023',NULL,'non-string analyte refused');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(200,100,'{"evidence":"  "}')$q$,'22023',NULL,'meaningful evidence required');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(200,100,'{"actor_id":"forged"}')$q$,'22023',NULL,'payload extra identity refused');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(200,100,'{"occurred_at":"9999-01-01T00:00:00Z"}')$q$,'22023',NULL,'future intent refused');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(200,100,'{"occurred_at":"2026-01-01T00:00:00"}')$q$,'22023',NULL,'explicit timezone required');
SELECT throws_ok($q$SELECT public.prepare_lab_followup_intent(pg_temp.cs(200),pg_temp.cs(100),pg_temp.cs(90),pg_temp.cs(11),(SELECT submission FROM intent_submissions WHERE work=100),99,1,pg_temp.fi_payload())$q$,'40001',NULL,'workflow revision checked');
SELECT throws_ok($q$SELECT public.prepare_lab_followup_intent(pg_temp.cs(200),pg_temp.cs(100),pg_temp.cs(90),pg_temp.cs(11),(SELECT submission FROM intent_submissions WHERE work=100),1,99,pg_temp.fi_payload())$q$,'40001',NULL,'ownership revision checked');
SELECT throws_ok($q$SELECT public.prepare_lab_followup_intent(pg_temp.cs(200),pg_temp.cs(100),pg_temp.cs(91),pg_temp.cs(11),(SELECT submission FROM intent_submissions WHERE work=100),1,1,pg_temp.fi_payload())$q$,'42501',NULL,'explicit organization checked');
SELECT throws_ok($q$SELECT public.prepare_lab_followup_intent(pg_temp.cs(200),pg_temp.cs(100),pg_temp.cs(90),pg_temp.cs(12),(SELECT submission FROM intent_submissions WHERE work=100),1,1,pg_temp.fi_payload())$q$,'42501',NULL,'patient scope checked');
SELECT throws_ok($q$SELECT public.prepare_lab_followup_intent(pg_temp.cs(200),pg_temp.cs(100),pg_temp.cs(90),pg_temp.cs(11),pg_temp.cs(999),1,1,pg_temp.fi_payload())$q$,'42501',NULL,'absent submission not guessed');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal1')::text,true);
SELECT throws_ok($q$SELECT public.list_pending_lab_followup_intents(pg_temp.cs(90),pg_temp.cs(11))$q$,'42501',NULL,'AAL1 refused');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
INSERT INTO intent_proofs VALUES('prepared',pg_temp.fi_bind(200,100));
SELECT is((SELECT value->>'state' FROM intent_proofs WHERE label='prepared'),'prepared','pre-save intention durable');
SELECT is((SELECT value#>>'{submission,status}' FROM intent_proofs WHERE label='prepared'),'awaiting_save','intention is not result');
SELECT is((SELECT value#>>'{payload,evidence}' FROM intent_proofs WHERE label='prepared'),'  Synthetic follow-up intention  ','exact evidence preserved');
SELECT is(pg_temp.fi_bind(200,100),(SELECT value FROM intent_proofs WHERE label='prepared'),'exact replay preserves whole identity');
SELECT is(public.get_lab_followup_intent(pg_temp.cs(200)),(SELECT value FROM intent_proofs WHERE label='prepared'),'explicit recovery');
SELECT is(public.get_care_workflow(pg_temp.cs(100))->>'revision','1','intent does not advance workflow');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(200,100,'{"evidence":"Changed source"}')$q$,'23505',NULL,'payload mismatch refused');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(201,100)$q$,'23505',NULL,'cannot replace open intention');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(300,100,'record_collection')$q$,'23505',NULL,'open intent blocks fresh step');
SELECT is(public.cancel_lab_followup_intent(pg_temp.cs(200))->>'state','cancelled','intent cancellation explicit');
SELECT is((SELECT submission_status FROM public.get_lab_submission(pg_temp.cs(11),(SELECT submission FROM intent_submissions WHERE work=100))),'cancelled','same transaction cancels unsaved lab attempt');
SELECT is(public.cancel_lab_followup_intent(pg_temp.cs(200))->>'state','cancelled','cancellation replay idempotent');
SELECT throws_ok($q$SELECT pg_temp.fi_save(100)$q$,'23505',NULL,'cancelled intention fences a late submit');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(201,100)$q$,'22023',NULL,'cancelled attempt cannot receive new binding');
SELECT is(jsonb_array_length(public.list_pending_lab_followup_intents(pg_temp.cs(90),pg_temp.cs(11))->'items'),0,'cancelled unsaved intent leaves pending list');

SELECT pg_temp.cs_new(103); SELECT pg_temp.fi_attempt(103); SELECT pg_temp.cs_prepare(303,103,'record_collection');
SELECT throws_ok($q$SELECT pg_temp.fi_bind(203,103)$q$,'23505',NULL,'prepared step blocks new intention');
SELECT public.cancel_care_step(pg_temp.cs(303)); SELECT pg_temp.fi_bind(203,103);
SELECT lives_ok($q$SELECT pg_temp.cs_prepare(303,103,'record_collection')$q$,'terminal step replay is not blocked by fresh-intent guard');
SELECT pg_temp.fi_save(103);
INSERT INTO intent_proofs VALUES('saved',public.get_lab_followup_intent(pg_temp.cs(203)));
SELECT is((SELECT value#>>'{submission,status}' FROM intent_proofs WHERE label='saved'),'saved_not_linked','saved remains unlinked');
SELECT is((SELECT value#>'{submission,recorded_analytes}' FROM intent_proofs WHERE label='saved'),'["creatinine","potassium"]'::jsonb,'actual supported fields come from exact receipt');
SELECT is((SELECT value#>'{submission,missing_analytes}' FROM intent_proofs WHERE label='saved'),'["egfr"]'::jsonb,'partial intended panel visible');
SELECT is((SELECT value#>>'{submission,evaluation_status}' FROM intent_proofs WHERE label='saved'),'pending','processing remains separate');
SELECT is(public.cancel_lab_followup_intent(pg_temp.cs(203))->>'state','prepared','committed save prevents false cancellation');
SELECT ok((SELECT NOT(value->>'result_linked')::boolean AND NOT(value->>'clinical_review_recorded')::boolean AND NOT(value->>'care_completed')::boolean FROM intent_proofs WHERE label='saved'),'no association/review/closure claim');
SELECT pg_temp.fi_ack(103);
SELECT is(pg_temp.fi_bind(203,103)#>>'{submission,status}','saved_not_linked','replay after save ACK does not require unsaved attempt');
SELECT ok(public.get_lab_followup_intent(pg_temp.cs(203))#>>'{submission,acknowledged_at}' IS NOT NULL,'save ACK remains explicit separate fact');
SELECT is(jsonb_array_length(public.list_pending_lab_followup_intents(pg_temp.cs(90),pg_temp.cs(11))->'items'),1,'save ACK does not remove pending linkage');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(2),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.get_lab_followup_intent(pg_temp.cs(203))$q$,'42501',NULL,'peer cannot recover private intent');
SELECT throws_ok($q$SELECT public.prepare_lab_followup_intent(pg_temp.cs(250),pg_temp.cs(103),pg_temp.cs(90),pg_temp.cs(11),(SELECT submission FROM intent_submissions WHERE work=103),1,1,pg_temp.fi_payload())$q$,'42501',NULL,'peer cannot bind another actor submission');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);

SELECT pg_temp.cs_new(104); SELECT pg_temp.fi_attempt(104); SELECT pg_temp.fi_save(104);
SELECT throws_ok($q$SELECT pg_temp.fi_bind(204,104)$q$,'22023',NULL,'already saved result cannot fabricate pre-save intention');
SELECT pg_temp.fi_ack(104);
SELECT pg_temp.cs_new(105); SELECT pg_temp.fi_attempt(105); SELECT pg_temp.fi_bind(205,105);
SELECT public.cancel_lab_submission(pg_temp.cs(11),(SELECT submission FROM intent_submissions WHERE work=105));
SELECT is(public.get_lab_followup_intent(pg_temp.cs(205))->>'state','prepared','independent cancellation read does not write intent');
SELECT is(public.get_lab_followup_intent(pg_temp.cs(205))#>>'{submission,status}','submission_cancelled','independent cancellation shown explicitly');
SELECT is(public.cancel_lab_followup_intent(pg_temp.cs(205))->>'state','cancelled','explicit terminalization after independent cancellation');

RESET ROLE;
CREATE FUNCTION pg_temp.fail_intent_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic intent rollback'; END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.cs_new(106); SELECT pg_temp.fi_attempt(106);
RESET ROLE;
CREATE TRIGGER fail_intent_write AFTER INSERT ON public.lab_followup_submission_intents FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_intent_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.fi_bind(206,106)$q$,'P0001','Synthetic intent rollback','failed intention insert rolls back');
RESET ROLE;
DROP TRIGGER fail_intent_write ON public.lab_followup_submission_intents;
SELECT is((SELECT count(*) FROM public.lab_followup_submission_intents WHERE id=pg_temp.cs(206)),0::bigint,'no partial intent inserted');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fi_bind(206,106);
RESET ROLE;
CREATE TRIGGER fail_intent_write AFTER UPDATE ON public.lab_submission_attempts FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_intent_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.cancel_lab_followup_intent(pg_temp.cs(206))$q$,'P0001','Synthetic intent rollback','failure after attempt cancellation rolls back');
RESET ROLE;
DROP TRIGGER fail_intent_write ON public.lab_submission_attempts;
CREATE TRIGGER fail_intent_write AFTER UPDATE ON public.lab_followup_submission_intents FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_intent_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.cancel_lab_followup_intent(pg_temp.cs(206))$q$,'P0001','Synthetic intent rollback','failure after intent cancellation rolls both writes back');
SELECT is(public.get_lab_followup_intent(pg_temp.cs(206))#>>'{submission,status}','awaiting_save','attempt remains open after rollback');
SELECT is(public.get_lab_followup_intent(pg_temp.cs(206))->>'state','prepared','intent remains prepared after rollback');
RESET ROLE;
DROP TRIGGER fail_intent_write ON public.lab_followup_submission_intents;
SET LOCAL ROLE authenticated;
SELECT public.cancel_lab_followup_intent(pg_temp.cs(206));

--26 more acknowledged saves leave their separate bindings open and recoverable.
DO $loop$ BEGIN
 FOR n IN 110..135 LOOP
  PERFORM pg_temp.cs_new(n); PERFORM pg_temp.fi_attempt(n); PERFORM pg_temp.fi_bind(n+100,n);
  PERFORM pg_temp.fi_save(n); PERFORM pg_temp.fi_ack(n);
 END LOOP;
END $loop$;
INSERT INTO intent_proofs VALUES('page1',public.list_pending_lab_followup_intents(pg_temp.cs(90),pg_temp.cs(11)));
INSERT INTO intent_proofs VALUES('page2',public.list_pending_lab_followup_intents(pg_temp.cs(90),pg_temp.cs(11),(SELECT (value->>'next_cursor')::uuid FROM intent_proofs WHERE label='page1')));
SELECT is((SELECT jsonb_array_length(value->'items') FROM intent_proofs WHERE label='page1'),25,'pending page25 bounded');
SELECT is((SELECT jsonb_array_length(value->'items') FROM intent_proofs WHERE label='page2'),2,'tail includes all27 open bindings');
SELECT ok((SELECT value->>'next_cursor' IS NULL FROM intent_proofs WHERE label='page2'),'explicit terminal tail');
SELECT is((SELECT count(DISTINCT x->>'intent_id') FROM intent_proofs CROSS JOIN LATERAL jsonb_array_elements(value->'items') x WHERE label IN('page1','page2')),27::bigint,'no lost or duplicate pending identity');

RESET ROLE;
UPDATE public.profiles SET role='tester',sandbox_expires_at=clock_timestamp()-interval '1 day' WHERE id=pg_temp.cs(1);
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$SELECT public.purge_expired_tester_provenance(pg_temp.cs(1))$q$,'23503',NULL,'composite attempt FK preserves workflow binding identity against erasure');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.lab_provenance_erasures),0::bigint,'failed purge rolls erasure ledger back');
SELECT is((SELECT count(*) FROM public.lab_followup_submission_intents WHERE state='prepared'),27::bigint,'protected bindings retained');
SELECT is((SELECT count(*) FROM public.lab_submission_receipts),28::bigint,'all actor receipts retained after refused erasure');
UPDATE public.profiles SET role='provider',sandbox_expires_at=NULL WHERE id=pg_temp.cs(1);
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.cs(1);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.get_lab_followup_intent(pg_temp.cs(203))$q$,'42501',NULL,'current monitor scope required even for historical recovery');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.care_step_events),0::bigint,'binding never applies a clinical or workflow step');
SELECT is((SELECT count(*) FROM public.alerts),0::bigint,'saved outbox is not automatically evaluated');
SELECT is((SELECT count(*) FROM public.lab_observation_roots),0::bigint,'binding never silently registers source authority');
SELECT ok((SELECT bool_and(stage='requested' AND revision=1) FROM public.care_workflows),'binding does not advance workflow revision or stage');
SELECT * FROM finish();
ROLLBACK;
