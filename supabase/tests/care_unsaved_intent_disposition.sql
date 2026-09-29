BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
-- BEGIN UNSAVED FIXTURES
CREATE FUNCTION pg_temp.ui(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('75000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.ui(n),'unsaved-'||n||'@example.invalid','{"consent_accepted":true}' FROM unnest(ARRAY[1,2,3,11]) n;
UPDATE public.profiles SET role='provider' WHERE id IN(pg_temp.ui(1),pg_temp.ui(2),pg_temp.ui(3));
INSERT INTO public.organizations(id,name,created_by) VALUES(pg_temp.ui(90),'Synthetic orphan A',pg_temp.ui(1)),(pg_temp.ui(91),'Synthetic orphan B',pg_temp.ui(3));
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 SELECT pg_temp.ui(CASE WHEN n=3 THEN 91 ELSE 90 END),pg_temp.ui(n),CASE WHEN n=2 THEN 'clinician' ELSE 'owner' END,
  'active',now(),pg_temp.ui(CASE WHEN n=3 THEN 3 ELSE 1 END) FROM generate_series(1,3) n;
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,c,created_by FROM public.organization_memberships CROSS JOIN unnest(ARRAY['monitor','clinical_disposition']) c
 WHERE organization_id IN(pg_temp.ui(90),pg_temp.ui(91));
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by)
 VALUES(pg_temp.ui(90),pg_temp.ui(11),pg_temp.ui(1)),(pg_temp.ui(91),pg_temp.ui(11),pg_temp.ui(3));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT pg_temp.ui(n),pg_temp.ui(11),'active',now() FROM generate_series(1,3) n;
-- END UNSAVED FIXTURES
-- BEGIN UNSAVED HELPERS
CREATE FUNCTION pg_temp.ua(n integer) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ui(n),'aal','aal2')::text,true)
$$;
CREATE FUNCTION pg_temp.ut(t timestamptz) RETURNS text LANGUAGE sql AS $$
 SELECT to_char(t AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
CREATE TEMP TABLE unsaved_proofs(label text PRIMARY KEY,value jsonb);
CREATE TEMP TABLE unsaved_attempts(work integer PRIMARY KEY,submission uuid);
GRANT ALL ON unsaved_proofs,unsaved_attempts TO authenticated;
CREATE FUNCTION pg_temp.unew(w integer,already_cancelled boolean DEFAULT false,transfer boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f jsonb; submission uuid;
BEGIN
 PERFORM pg_temp.ua(1);
 PERFORM public.prepare_care_workflow_request(pg_temp.ui(w+1000),pg_temp.ui(w),pg_temp.ui(90),pg_temp.ui(11),
  jsonb_build_object('kind','laboratory_order','source','external_documented','purpose','Synthetic unsaved workflow','evidence','Original work evidence',
   'occurred_at',pg_temp.ut(now()-interval '1 hour'),'next_review_at',pg_temp.ut(now()+interval '1 day'),'analytes','["potassium"]'::jsonb));
 PERFORM public.apply_care_workflow_request(pg_temp.ui(w+1000)); PERFORM public.accept_work_item(pg_temp.ui(w));
 SELECT request_id INTO submission FROM public.prepare_lab_submission(pg_temp.ui(11));
 INSERT INTO unsaved_attempts VALUES(w,submission);
 f:=public.get_care_workflow(pg_temp.ui(w));
 PERFORM public.prepare_lab_followup_intent(pg_temp.ui(w+2000),pg_temp.ui(w),pg_temp.ui(90),pg_temp.ui(11),submission,
  (f->>'revision')::bigint,(f->>'ownership_revision')::bigint,
  jsonb_build_object('analytes','["potassium"]'::jsonb,'evidence','PRIVATE FORMER OWNER EVIDENCE','occurred_at',pg_temp.ut(now()-interval '1 hour')));
 IF already_cancelled THEN PERFORM public.cancel_lab_submission(pg_temp.ui(11),submission); END IF;
 IF transfer THEN PERFORM public.offer_work_item_transfer(pg_temp.ui(w),pg_temp.ui(2));
  PERFORM pg_temp.ua(2); PERFORM public.accept_work_item_transfer(pg_temp.ui(w)); END IF;
END $$;
CREATE FUNCTION pg_temp.upayload(c jsonb,override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('snapshot',c->'snapshot','occurred_at',pg_temp.ut(clock_timestamp()),'reason','Explicit abandonment after responsibility changed',
  'evidence','New administrative disposition evidence','unsaved_cancellation_acknowledged',true)||override
$$;
CREATE FUNCTION pg_temp.uprepare(n integer,w integer,override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c jsonb;
BEGIN
 c:=public.get_care_unsaved_intent_context(pg_temp.ui(w),pg_temp.ui(w+2000));
 RETURN public.prepare_care_unsaved_intent_request(pg_temp.ui(n),pg_temp.ui(w),pg_temp.ui(w+2000),pg_temp.ui(90),pg_temp.ui(11),
  (c->>'workflow_revision')::bigint,(c->>'ownership_revision')::bigint,pg_temp.upayload(c,override));
END $$;
CREATE FUNCTION pg_temp.ureplay(n integer,override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE q jsonb;
BEGIN
 q:=public.get_care_unsaved_intent_request(pg_temp.ui(n));
 RETURN public.prepare_care_unsaved_intent_request(pg_temp.ui(n),(q->>'work_item_id')::uuid,(q->>'intent_id')::uuid,
  (q->>'organization_id')::uuid,(q->>'patient_id')::uuid,(q->>'expected_revision')::bigint,(q->>'expected_ownership_revision')::bigint,q->'payload'||override);
END $$;
CREATE FUNCTION pg_temp.usave(w integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM public.submit_lab_result((SELECT submission FROM unsaved_attempts WHERE work=w),pg_temp.ui(11),
  '2026-01-01T12:00:00.123456-04:00',4.6,NULL,1.23);
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION pg_temp.ufingerprint(w integer,n integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_array((SELECT to_jsonb(q) FROM public.care_unsaved_intent_requests q WHERE id=pg_temp.ui(n)),
  (SELECT to_jsonb(i) FROM public.lab_followup_submission_intents i WHERE id=pg_temp.ui(w+2000)),
  (SELECT to_jsonb(a) FROM public.lab_submission_attempts a WHERE request_id=(SELECT submission FROM unsaved_attempts WHERE work=w)),
  (SELECT to_jsonb(f) FROM public.care_workflows f WHERE work_item_id=pg_temp.ui(w)),
  (SELECT to_jsonb(i) FROM public.work_items i WHERE id=pg_temp.ui(w)),
  (SELECT count(*) FROM public.care_unsaved_intent_events),(SELECT count(*) FROM public.care_unsaved_intent_context))
$$;
-- END UNSAVED HELPERS
SELECT ok(NOT has_table_privilege(r,t,p),'private administrative '||r||' '||t||' '||p)
 FROM unnest(ARRAY['anon','authenticated','service_role']) r
 CROSS JOIN unnest(ARRAY['public.care_unsaved_intent_requests','public.care_unsaved_intent_events','public.care_unsaved_intent_context']) t
 CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p;
SELECT ok(NOT has_function_privilege(r,'public.care_unsaved_transition_authorized(uuid,uuid,uuid,uuid)','EXECUTE'),'no direct guard capability '||r)
 FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SET LOCAL ROLE authenticated;
SELECT pg_temp.unew(100);
INSERT INTO unsaved_proofs VALUES('context',public.get_care_unsaved_intent_context(pg_temp.ui(100),pg_temp.ui(2100)));
SELECT ok(value::text NOT LIKE '%PRIVATE FORMER%' AND NOT(value->'snapshot' ? 'submission_request_id') AND NOT(value->'snapshot' ? 'actor_id'),
 'context does not expose former owner private payload or request') FROM unsaved_proofs WHERE label='context';
SELECT throws_ok($q$SELECT pg_temp.uprepare(3000,100,'{"unsaved_cancellation_acknowledged":false}')$q$,'22023',NULL,'explicit acknowledgement required');
SELECT throws_ok($q$SELECT pg_temp.uprepare(3000,100,'{"reason":" "}')$q$,'22023',NULL,'explicit reason required');
SELECT throws_ok($q$SELECT pg_temp.uprepare(3000,100,'{"next_review_at":"2026-10-01T12:00:00Z"}')$q$,'22023',NULL,'no invented deadline');
SELECT throws_ok($q$SELECT pg_temp.uprepare(3000,100,jsonb_build_object('occurred_at',pg_temp.ut(now()+interval '1 day')))$q$,'22023',NULL,'future disposition denied');
SELECT throws_ok(format('SELECT pg_temp.uprepare(3000,100,%L::jsonb)',override),'22023',NULL,'strict disposition payload '||override::text)
 FROM unnest(ARRAY['{"snapshot":null}'::jsonb,'{"snapshot":{}}','{"occurred_at":null}','{"evidence":null}',
 '{"reason":false}','{"unsaved_cancellation_acknowledged":"true"}','{"occurred_at":"infinity"}']) override;
SELECT throws_ok($q$SELECT pg_temp.uprepare(3000,100,jsonb_build_object('snapshot',
 (SELECT value->'snapshot'||jsonb_build_object('intent_id',pg_temp.ui(9999)) FROM unsaved_proofs WHERE label='context')))$q$,
 '40001',NULL,'changed target identity rejected by exact snapshot');
SELECT is(pg_temp.uprepare(3000,100)->>'state','prepared','administrative intent prepares without cancelling target');
SELECT is(pg_temp.ureplay(3000)->>'state','prepared','same request replay returns frozen preparation');
SELECT throws_ok($q$SELECT pg_temp.ureplay(3000,'{"reason":"Changed evidence"}')$q$,'23505',NULL,'changed frozen evidence denied');
SELECT throws_ok($q$SELECT public.acknowledge_care_unsaved_intent_request(pg_temp.ui(3000))$q$,'22023',NULL,'no ACK before apply');
SELECT is(jsonb_array_length(public.list_pending_care_unsaved_intent_requests(pg_temp.ui(90),pg_temp.ui(11))->'items'),1,'prepared request recoverable');
SELECT pg_temp.ua(1);
SELECT throws_ok($q$SELECT public.get_care_unsaved_intent_request(pg_temp.ui(3000))$q$,'42501',NULL,'old actor cannot read new actor private request');
SELECT pg_temp.ua(3);
SELECT throws_ok($q$SELECT public.get_care_unsaved_intent_context(pg_temp.ui(100),pg_temp.ui(2100))$q$,'42501',NULL,'other organization denied despite patient link');
SELECT pg_temp.ua(2);
RESET ROLE;
INSERT INTO unsaved_proofs VALUES('work100',jsonb_build_array((SELECT to_jsonb(w) FROM public.work_items w WHERE id=pg_temp.ui(100)),
 (SELECT to_jsonb(f) FROM public.care_workflows f WHERE work_item_id=pg_temp.ui(100))));
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='monitor'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.ui(1));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ua(1);
SELECT throws_ok($q$SELECT public.cancel_lab_followup_intent(pg_temp.ui(2100))$q$,'42501',NULL,'former owner without monitor cannot cancel');
SELECT pg_temp.ua(2);
INSERT INTO unsaved_proofs VALUES('applied100',public.apply_care_unsaved_intent_request(pg_temp.ui(3000)));
SELECT is(value->>'state','applied','new accepted owner disposes orphan without old monitor') FROM unsaved_proofs WHERE label='applied100';
SELECT is(value#>>'{receipt,care_completed}','false','administrative cancellation is not completed care') FROM unsaved_proofs WHERE label='applied100';
SELECT is(value#>>'{receipt,result_saved}','false','no invented saved result') FROM unsaved_proofs WHERE label='applied100';
SELECT is(public.apply_care_unsaved_intent_request(pg_temp.ui(3000)),(SELECT value FROM unsaved_proofs WHERE label='applied100'),'applied replay is immutable');
SELECT is(public.cancel_care_unsaved_intent_request(pg_temp.ui(3000)),(SELECT value FROM unsaved_proofs WHERE label='applied100'),'cancel cannot undo applied disposition');
SELECT is(public.list_care_unsaved_intent_history(pg_temp.ui(100))#>>'{items,0,payload,reason}','Explicit abandonment after responsibility changed','shared audit keeps new rationale');
SELECT ok(public.list_care_unsaved_intent_history(pg_temp.ui(100))::text NOT LIKE '%PRIVATE FORMER%','shared audit omits original private evidence');
RESET ROLE;
SELECT is((SELECT value FROM unsaved_proofs WHERE label='work100'),jsonb_build_array((SELECT to_jsonb(w) FROM public.work_items w WHERE id=pg_temp.ui(100)),
 (SELECT to_jsonb(f) FROM public.care_workflows f WHERE work_item_id=pg_temp.ui(100))),'work projection, revision, deadlines and factual stage unchanged');
SELECT is((SELECT count(*) FROM public.care_unsaved_intent_context),0::bigint,'transaction capability removed');
SELECT is((SELECT count(*) FROM public.care_unsaved_intent_events WHERE intent_id=pg_temp.ui(2100)),1::bigint,'one audit per target');
SELECT is((SELECT payload->>'evidence' FROM public.lab_followup_submission_intents WHERE id=pg_temp.ui(2100)),'PRIVATE FORMER OWNER EVIDENCE','original private payload preserved');
UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='monitor';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ua(1);
SELECT is(public.get_lab_followup_intent(pg_temp.ui(2100))->>'state','cancelled','original actor recovers truthful cancellation');
SELECT throws_ok($q$SELECT pg_temp.usave(100)$q$,'23505',NULL,'late old save cannot resurrect cancelled attempt');
SELECT pg_temp.ua(2);
SELECT ok(public.acknowledge_care_unsaved_intent_request(pg_temp.ui(3000))->>'acknowledged_at' IS NOT NULL,'explicit receipt ACK');
SELECT is(jsonb_array_length(public.list_pending_care_unsaved_intent_requests(pg_temp.ui(90),pg_temp.ui(11))->'items'),0,'ACK removes only recovery entry');
SELECT is(jsonb_array_length(public.list_care_unsaved_intent_history(pg_temp.ui(100))->'items'),1,'audit survives ACK');

-- A legitimate already-cancelled submission retains its exact earlier cancellation time.
SELECT pg_temp.unew(101,true);
INSERT INTO unsaved_proofs VALUES('cancelled101',public.get_care_unsaved_intent_context(pg_temp.ui(101),pg_temp.ui(2101)));
SELECT is(value#>>'{snapshot,submission_status}','submission_cancelled','already-cancelled attempt eligible') FROM unsaved_proofs WHERE label='cancelled101';
SELECT pg_temp.uprepare(3001,101);
SELECT is(public.apply_care_unsaved_intent_request(pg_temp.ui(3001))#>>'{receipt,submission_cancelled_at}',
 (SELECT value#>>'{snapshot,submission_cancelled_at}' FROM unsaved_proofs WHERE label='cancelled101'),'earlier tombstone time unchanged');

-- A state change after preparation cannot be adopted silently.
SELECT pg_temp.unew(102); SELECT pg_temp.uprepare(3002,102);
SELECT pg_temp.ua(1); SELECT public.cancel_lab_submission(pg_temp.ui(11),(SELECT submission FROM unsaved_attempts WHERE work=102));
SELECT pg_temp.ua(2);
SELECT throws_ok($q$SELECT public.apply_care_unsaved_intent_request(pg_temp.ui(3002))$q$,'40001',NULL,'changed cancellation snapshot conflicts');
SELECT is(public.cancel_care_unsaved_intent_request(pg_temp.ui(3002))->>'state','cancelled','cancel preparation only');
SELECT pg_temp.uprepare(3012,102);
SELECT is(public.apply_care_unsaved_intent_request(pg_temp.ui(3012))->>'state','applied','new explicit preparation adopts cancelled snapshot');

-- Save wins: cancellation must fail; the saved result stays intact for explicit reconciliation.
SELECT pg_temp.unew(103); SELECT pg_temp.uprepare(3003,103);
SELECT pg_temp.ua(1); INSERT INTO unsaved_proofs VALUES('saved103',pg_temp.usave(103));
SELECT pg_temp.ua(2);
SELECT throws_ok($q$SELECT public.apply_care_unsaved_intent_request(pg_temp.ui(3003))$q$,'40001',NULL,'saved result cannot be cancelled as orphan');
SELECT public.cancel_care_unsaved_intent_request(pg_temp.ui(3003));
SELECT pg_temp.ua(1);
SELECT public.acknowledge_lab_submission(pg_temp.ui(11),(SELECT submission FROM unsaved_attempts WHERE work=103),
 (SELECT (value->>'lab_result_id')::uuid FROM unsaved_proofs WHERE label='saved103'));
SELECT is(public.get_lab_followup_intent(pg_temp.ui(2103))#>>'{submission,status}','saved_not_linked','saved orphan remains explicit reconciliation need');

-- Same owner cannot use cross-owner disposition, and stale ownership cannot apply.
SELECT pg_temp.unew(104,false,false);
SELECT throws_ok($q$SELECT public.get_care_unsaved_intent_context(pg_temp.ui(104),pg_temp.ui(2104))$q$,'42501',NULL,'own intent uses existing own cancellation');
SELECT public.cancel_lab_followup_intent(pg_temp.ui(2104));
SELECT pg_temp.unew(105); SELECT pg_temp.uprepare(3005,105);
SELECT public.offer_work_item_transfer(pg_temp.ui(105),pg_temp.ui(1)); SELECT pg_temp.ua(1); SELECT public.accept_work_item_transfer(pg_temp.ui(105));
SELECT pg_temp.ua(2);
SELECT throws_ok($q$SELECT public.apply_care_unsaved_intent_request(pg_temp.ui(3005))$q$,'42501',NULL,'lost ownership cannot apply');
SELECT is(public.get_care_unsaved_intent_request(pg_temp.ui(3005))->>'state','prepared','lost ownership retains recovery');
SELECT is(public.cancel_care_unsaved_intent_request(pg_temp.ui(3005))->>'state','cancelled','lost owner can cancel own administrative preparation');
SELECT pg_temp.ua(1); SELECT public.cancel_lab_followup_intent(pg_temp.ui(2105));

-- Own-family exclusions do not erase the former owner's evidence.
SELECT pg_temp.unew(106); SELECT pg_temp.uprepare(3006,106);
SELECT throws_ok($q$SELECT pg_temp.uprepare(3016,106)$q$,'23505',NULL,'only one own administrative preparation');
SELECT throws_ok($q$SELECT public.prepare_care_step(pg_temp.ui(5006),pg_temp.ui(106),1,3,'record_exception',
 jsonb_build_object('occurred_at',pg_temp.ut(clock_timestamp()),'evidence','Synthetic barrier evidence','next_action','Explicit next step',
 'next_review_at',pg_temp.ut(now()+interval '1 day'),'details',jsonb_build_object('exception_id',pg_temp.ui(5106),'code','not_performed','reason','Synthetic barrier')))$q$,
 '23505',NULL,'prepared administrative request excludes a new own step');
RESET ROLE;
SELECT ok(NOT public.care_unsaved_transition_authorized(pg_temp.ui(1),pg_temp.ui(11),(SELECT submission FROM unsaved_attempts WHERE work=106),pg_temp.ui(2106)),
 'prepared request without audit and context is not a transition capability');
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='clinical_disposition'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.ui(2));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_unsaved_intent_request(pg_temp.ui(3006))$q$,'42501',NULL,'clinical revocation prevents apply');
SELECT is(public.get_care_unsaved_intent_request(pg_temp.ui(3006))->>'state','prepared','clinical revocation does not hide private recovery');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='clinical_disposition';
INSERT INTO unsaved_proofs VALUES('rollback106',pg_temp.ufingerprint(106,3006));
CREATE FUNCTION pg_temp.unsaved_fail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Synthetic administrative mutation failure'; END $$;
CREATE TRIGGER zz_unsaved_failure AFTER INSERT ON public.care_unsaved_intent_context FOR EACH ROW EXECUTE FUNCTION pg_temp.unsaved_fail();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_unsaved_intent_request(pg_temp.ui(3006))$q$,'22000',NULL,'context insertion failure rolls back');
RESET ROLE;
SELECT is(pg_temp.ufingerprint(106,3006),(SELECT value FROM unsaved_proofs WHERE label='rollback106'),'no mutation after context failure');
DROP TRIGGER zz_unsaved_failure ON public.care_unsaved_intent_context;
CREATE TRIGGER zz_unsaved_failure AFTER INSERT ON public.care_unsaved_intent_events FOR EACH ROW EXECUTE FUNCTION pg_temp.unsaved_fail();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_unsaved_intent_request(pg_temp.ui(3006))$q$,'22000',NULL,'audit insertion failure rolls back');
RESET ROLE;
SELECT is(pg_temp.ufingerprint(106,3006),(SELECT value FROM unsaved_proofs WHERE label='rollback106'),'no mutation after audit failure');
DROP TRIGGER zz_unsaved_failure ON public.care_unsaved_intent_events;
CREATE TRIGGER zz_unsaved_failure AFTER UPDATE ON public.lab_submission_attempts FOR EACH ROW EXECUTE FUNCTION pg_temp.unsaved_fail();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_unsaved_intent_request(pg_temp.ui(3006))$q$,'22000',NULL,'attempt cancellation failure rolls back');
RESET ROLE;
SELECT is(pg_temp.ufingerprint(106,3006),(SELECT value FROM unsaved_proofs WHERE label='rollback106'),'no mutation after attempt failure');
DROP TRIGGER zz_unsaved_failure ON public.lab_submission_attempts;
CREATE TRIGGER zz_unsaved_failure AFTER UPDATE ON public.lab_followup_submission_intents FOR EACH ROW EXECUTE FUNCTION pg_temp.unsaved_fail();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_unsaved_intent_request(pg_temp.ui(3006))$q$,'22000',NULL,'intention cancellation failure rolls back');
RESET ROLE;
SELECT is(pg_temp.ufingerprint(106,3006),(SELECT value FROM unsaved_proofs WHERE label='rollback106'),'no mutation after intention failure');
DROP TRIGGER zz_unsaved_failure ON public.lab_followup_submission_intents;
CREATE TRIGGER zz_unsaved_failure AFTER UPDATE ON public.care_unsaved_intent_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.unsaved_fail();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_unsaved_intent_request(pg_temp.ui(3006))$q$,'22000',NULL,'receipt update failure rolls back');
RESET ROLE;
SELECT is(pg_temp.ufingerprint(106,3006),(SELECT value FROM unsaved_proofs WHERE label='rollback106'),'no mutation after receipt failure');
DROP TRIGGER zz_unsaved_failure ON public.care_unsaved_intent_requests;
CREATE TRIGGER zz_unsaved_failure AFTER DELETE ON public.care_unsaved_intent_context FOR EACH ROW EXECUTE FUNCTION pg_temp.unsaved_fail();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_unsaved_intent_request(pg_temp.ui(3006))$q$,'22000',NULL,'capability removal failure rolls back');
RESET ROLE;
SELECT is(pg_temp.ufingerprint(106,3006),(SELECT value FROM unsaved_proofs WHERE label='rollback106'),'no mutation after capability removal failure');
DROP TRIGGER zz_unsaved_failure ON public.care_unsaved_intent_context;
SET LOCAL ROLE authenticated;
SELECT is(public.apply_care_unsaved_intent_request(pg_temp.ui(3006))->>'state','applied','same frozen request succeeds after all injected failures removed');
RESET ROLE;
SELECT ok(NOT public.care_unsaved_transition_authorized(pg_temp.ui(1),pg_temp.ui(11),(SELECT submission FROM unsaved_attempts WHERE work=106),pg_temp.ui(2106)),
 'old audit alone does not authorize another transition');
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='clinical_disposition'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.ui(2));
SET LOCAL ROLE authenticated;
SELECT is(public.apply_care_unsaved_intent_request(pg_temp.ui(3006))->>'state','applied','terminal replay requires monitor, not new clinical authority');
SELECT ok(public.acknowledge_care_unsaved_intent_request(pg_temp.ui(3006))->>'acknowledged_at' IS NOT NULL,'terminal ACK does not need clinical authority');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='clinical_disposition';
SET LOCAL ROLE authenticated;
SELECT pg_temp.unew(107); SELECT pg_temp.uprepare(3007,107);
SELECT is(public.cancel_care_unsaved_intent_request(pg_temp.ui(3007))->>'state','cancelled','preparation can be cancelled explicitly');
SELECT pg_temp.ua(1);
SELECT is(public.get_lab_followup_intent(pg_temp.ui(2107))->>'state','prepared','cancelling preparation leaves former intention untouched');
SELECT public.cancel_lab_followup_intent(pg_temp.ui(2107));

-- Preparing cancellation is not closure; after application, explicit non-completion can proceed.
SELECT pg_temp.unew(108); SELECT pg_temp.uprepare(3008,108);
SELECT is(jsonb_array_length(public.get_care_closure_context(pg_temp.ui(108),'close_without_completion')#>'{snapshot,prepared_intents}'),1,
 'administrative preparation alone cannot clear closure obligation');
SELECT public.apply_care_unsaved_intent_request(pg_temp.ui(3008));
INSERT INTO unsaved_proofs VALUES('close108',public.get_care_closure_context(pg_temp.ui(108),'close_without_completion'));
SELECT is(jsonb_array_length(value#>'{snapshot,prepared_intents}'),0,'applied exact disposition clears only prepared intention') FROM unsaved_proofs WHERE label='close108';
SELECT public.prepare_care_human_request(pg_temp.ui(8008),pg_temp.ui(108),pg_temp.ui(90),pg_temp.ui(11),
 (value->>'workflow_revision')::bigint,(value->>'ownership_revision')::bigint,'close_without_completion',value->'basis',value->>'basis_signature',
 jsonb_build_object('occurred_at',pg_temp.ut(clock_timestamp()),'evidence','Explicit separate closure evidence',
 'details',jsonb_build_object('snapshot',value->'snapshot','outcome','Documented non-delivery','disposition','not_performed',
 'reason','No completed laboratory care','declarations','[]'::jsonb))) FROM unsaved_proofs WHERE label='close108';
SELECT is(public.apply_care_human_request(pg_temp.ui(8008))#>>'{receipt,work_closed}','true','explicit separate closure succeeds after disposition');
SELECT is(public.get_care_unsaved_intent_request(pg_temp.ui(3008))->>'state','applied','administrative private recovery survives work closure');
SELECT is(public.list_care_unsaved_intent_history(pg_temp.ui(108))#>>'{items,0,receipt,care_completed}','false','administrative audit never upgraded by later closure');
SELECT pg_temp.ua(1);
SELECT throws_ok($q$SELECT pg_temp.usave(108)$q$,'23505',NULL,'late save remains denied after workflow closure');

-- Both directions of own-step exclusion use public mutations, not a client-only disable.
SELECT pg_temp.unew(109);
SELECT public.prepare_care_step(pg_temp.ui(9009),pg_temp.ui(109),1,3,'record_collection',
 jsonb_build_object('occurred_at',pg_temp.ut(clock_timestamp()),'evidence','Explicit synthetic collection record','next_action','Review evidence',
 'next_review_at',pg_temp.ut(now()+interval '1 day'),'details','{}'::jsonb));
SELECT throws_ok($q$SELECT pg_temp.uprepare(3009,109)$q$,'23505',NULL,'prepared own step excludes administrative preparation');
SELECT public.cancel_care_step(pg_temp.ui(9009));
SELECT pg_temp.uprepare(3009,109);
SELECT public.apply_care_unsaved_intent_request(pg_temp.ui(3009));
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
