-- Disposable local fixtures only. No external transport; all changes roll back.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
CREATE FUNCTION pg_temp.nr(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('58000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
SELECT ok(relrowsecurity,'RLS enabled: '||relname) FROM pg_class WHERE relname IN
 ('notification_retention_policy','notification_retention_scopes','notification_erasure_context','notification_erasure_receipts');
SELECT ok(NOT has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),r||' cannot manipulate '||t)
 FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY[
 'notification_retention_policy','notification_retention_scopes','notification_erasure_context','notification_erasure_receipts']) t;
SELECT is((SELECT count(*)::int FROM notification_retention_scopes),0,'no historic enrollment');
-- FIXTURE BEGIN: also used by the committed local concurrency rehearsal.
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (pg_temp.nr(1),'retention-owner@example.invalid','{"consent_accepted":true}'),
 (pg_temp.nr(2),'retention-target@example.invalid','{"consent_accepted":true}'),
 (pg_temp.nr(11),'retention-patient@example.invalid','{"consent_accepted":true}');
UPDATE public.profiles SET role='provider' WHERE id IN(pg_temp.nr(1),pg_temp.nr(2));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT pg_temp.nr(n),pg_temp.nr(11),'active',now() FROM unnest(ARRAY[1,2]) n;
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES(public.primary_organization_for_provider(pg_temp.nr(1)),pg_temp.nr(2),'clinician','active',now(),pg_temp.nr(1));
UPDATE public.organization_patient_assignments SET status='revoked',revoked_at=now()
 WHERE organization_id=public.primary_organization_for_provider(pg_temp.nr(2));
INSERT INTO public.patient_accountability(organization_id,patient_id,accountable_id,designated_by)
 VALUES(public.primary_organization_for_provider(pg_temp.nr(1)),pg_temp.nr(11),pg_temp.nr(1),pg_temp.nr(1));
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',user_id FROM public.organization_memberships WHERE user_id IN(pg_temp.nr(1),pg_temp.nr(2)) AND status='active';
INSERT INTO public.push_subscriptions(id,user_id,endpoint,keys) VALUES
 (pg_temp.nr(21),pg_temp.nr(1),'https://fcm.googleapis.com/retention-synthetic','{"p256dh":"synthetic","auth":"synthetic"}');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.alerts(id,patient_id,severity,flags,first_seen_at,last_seen_at)
 SELECT pg_temp.nr(n),pg_temp.nr(11),'critical',ARRAY['weight_gain_3lb_2d'],now(),now() FROM generate_series(101,130) n;
-- FIXTURE END
-- HELPERS BEGIN: owner-only local fixture time travel, never deployed functions.
CREATE FUNCTION pg_temp.work(n integer) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT id FROM public.work_items WHERE source_id=pg_temp.nr(n) AND assigned_to=pg_temp.nr(1)
$$;
CREATE FUNCTION pg_temp.intent(n integer) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT id FROM public.notification_intents WHERE work_item_id=pg_temp.work(n) ORDER BY generation DESC LIMIT 1
$$;
CREATE FUNCTION pg_temp.close_work(n integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.nr(1),'role','authenticated','aal','aal2')::text,true);
 UPDATE public.work_items SET status='closed',outcome='Synthetic test closure',outcome_code='clinical_action_taken' WHERE id=pg_temp.work(n);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
END $$;
CREATE FUNCTION pg_temp.age(n integer,age interval,inject_failure boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_intent uuid:=pg_temp.intent(n); at_time timestamptz:=clock_timestamp()-age;
 saved jsonb; item jsonb;
BEGIN
 -- Owner-only fixture construction: never disable FKs or grant system privileges.
 SELECT jsonb_agg(jsonb_build_object('table',c.relname,'trigger',t.tgname,'state',t.tgenabled) ORDER BY c.relname,t.tgname)
 INTO saved FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN (VALUES
  ('work_items','enforce_work_item_transition'),('work_items','audit_row_change'),('work_items','write_work_item_event'),
  ('notification_intents','guard_notification_history'),('notification_dispatches','audit_notification_dispatch_change'),
  ('notification_dispatch_attempts','guard_notification_dispatch_history'),('notification_dispatch_attempts','audit_notification_dispatch_change'),
  ('notification_dispatch_events','guard_notification_dispatch_history')
 ) expected(table_name,trigger_name) ON c.relname=expected.table_name AND t.tgname=expected.trigger_name
 WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal;
 IF jsonb_array_length(saved) IS DISTINCT FROM 8 THEN RAISE EXCEPTION 'Fixture trigger inventory changed'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(saved) LOOP
  EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I',item->>'table',item->>'trigger');
 END LOOP;
 UPDATE public.work_items SET closed_at=at_time,updated_at=at_time WHERE id=pg_temp.work(n);
 IF inject_failure THEN RAISE EXCEPTION 'Injected fixture aging failure'; END IF;
 UPDATE public.notification_intents SET captured_at=at_time,cancelled_at=CASE WHEN cancelled_at IS NOT NULL THEN at_time END WHERE id=v_intent;
 UPDATE public.notification_dispatches SET created_at=at_time,updated_at=at_time,lease_expires_at=CASE WHEN lease_expires_at IS NOT NULL THEN at_time+interval '1 second' END WHERE notification_dispatches.intent_id=v_intent;
 UPDATE public.notification_dispatch_attempts SET created_at=at_time,started_at=CASE WHEN started_at IS NOT NULL THEN at_time END,
  finished_at=CASE WHEN finished_at IS NOT NULL THEN at_time END,lease_expires_at=at_time+interval '1 second' WHERE notification_dispatch_attempts.intent_id=v_intent;
 UPDATE public.notification_dispatch_events SET recorded_at=at_time WHERE notification_dispatch_events.intent_id=v_intent;
 FOR item IN SELECT value FROM jsonb_array_elements(saved) LOOP
  EXECUTE format('ALTER TABLE public.%I %s TRIGGER %I',item->>'table',
   CASE item->>'state' WHEN 'O' THEN 'ENABLE' WHEN 'D' THEN 'DISABLE' WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'A' THEN 'ENABLE ALWAYS' END,
   item->>'trigger');
 END LOOP;
EXCEPTION WHEN OTHERS THEN
 -- The exception subtransaction restores both DDL and fixture rows before rethrow.
 RAISE;
END $$;
CREATE FUNCTION pg_temp.enroll(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT public.enroll_synthetic_notification_work(pg_temp.work(n),'disposable_synthetic_test',pg_temp.nr(n+1000))
$$;
CREATE FUNCTION pg_temp.check_work(n integer,reason text DEFAULT 'authorized_synthetic_erasure') RETURNS text LANGUAGE sql AS $$
 SELECT public.check_synthetic_notification_erasure(pg_temp.work(n),reason)->>'status'
$$;
CREATE FUNCTION pg_temp.erase(n integer,reason text DEFAULT 'authorized_synthetic_erasure') RETURNS text LANGUAGE sql AS $$
 SELECT public.erase_synthetic_notification_work(pg_temp.work(n),reason)->>'status'
$$;
CREATE FUNCTION pg_temp.prepare(n integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE claim jsonb;
BEGIN
 claim:=public.claim_notification_dispatch(pg_temp.intent(n));
 RETURN public.prepare_notification_dispatch(pg_temp.intent(n),(claim->>'token')::uuid,(claim->>'version')::bigint,true);
END $$;
CREATE FUNCTION pg_temp.start(n integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.start_notification_dispatch(a.intent_id,a.id,a.lease_token,a.lease_version,true)
 FROM public.notification_dispatch_attempts a WHERE a.intent_id=pg_temp.intent(n)
$$;
CREATE FUNCTION pg_temp.finish(n integer,p_state text,p_code text,p_http integer DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT public.finish_notification_dispatch(a.intent_id,a.id,a.lease_token,a.lease_version,p_state,p_code,p_http)
 FROM public.notification_dispatch_attempts a WHERE a.intent_id=pg_temp.intent(n)
$$;
-- HELPERS END
SET LOCAL ROLE anon;
SELECT throws_ok($q$SELECT pg_temp.enroll(101)$q$,'42501',NULL,'anonymous cannot enroll');
SELECT throws_ok($q$SELECT public.maintain_synthetic_notifications()$q$,'42501',NULL,'anonymous cannot maintain');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.erase(101)$q$,'42501',NULL,'human cannot erase');
SELECT throws_ok($q$SELECT public.check_synthetic_notification_erasure(pg_temp.nr(999),'retention_expired')$q$,'42501',NULL,'human cannot preflight');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','service_role','sub',pg_temp.nr(1))::text,true);
SELECT throws_ok($q$SELECT pg_temp.enroll(101)$q$,'42501','Notification service not authorized','service with actor denied');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(pg_temp.check_work(101),'protected','age alone is not consent to erase');
SELECT throws_ok($q$SELECT public.enroll_synthetic_notification_work(pg_temp.work(101),'real_patient',pg_temp.nr(1001))$q$,'22023',NULL,'typed synthetic purpose required');
SELECT throws_ok($q$SELECT public.enroll_synthetic_notification_work(pg_temp.work(101),'disposable_synthetic_test',NULL)$q$,'22023',NULL,'authorization reference required');
SELECT lives_ok('SELECT pg_temp.enroll(101)','service enrolls exact disposable work');
SELECT lives_ok('SELECT pg_temp.enroll(101)','enrollment retry idempotent');
SELECT throws_ok($q$SELECT public.enroll_synthetic_notification_work(pg_temp.work(101),'disposable_synthetic_test',pg_temp.nr(999))$q$,'42501',NULL,'cannot replace scope authorization');
SELECT is(pg_temp.check_work(101),'open','open work retained');
SELECT public.set_synthetic_notification_hold(pg_temp.work(101),true);
SELECT is(pg_temp.erase(101),'held','preservation hold wins');
SELECT public.set_synthetic_notification_hold(pg_temp.work(101),false);
RESET ROLE;
UPDATE public.work_items SET created_at=(SELECT activated_at FROM notification_retention_policy)-interval '1 second' WHERE id=pg_temp.work(102);
SELECT throws_ok('SELECT pg_temp.enroll(102)','42501','Historical work remains protected','legacy enrollment is forbidden');
SELECT pg_temp.close_work(101);
SELECT is(pg_temp.erase(101),'not_due','exact erasure also requires quiet period');
-- Prove exact O/D/R/A restoration and rollback with a non-superuser owner.
CREATE TEMP TABLE original_trigger_states AS SELECT oid,tgenabled FROM pg_trigger;
ALTER TABLE public.work_items ENABLE REPLICA TRIGGER audit_row_change;
ALTER TABLE public.notification_intents ENABLE ALWAYS TRIGGER guard_notification_history;
ALTER TABLE public.notification_dispatches DISABLE TRIGGER audit_notification_dispatch_change;
CREATE TEMP TABLE aging_trigger_states AS SELECT oid,tgenabled FROM pg_trigger;
CREATE TEMP TABLE aging_work_before AS SELECT to_jsonb(w) AS row FROM public.work_items w ORDER BY id;
CREATE TEMP TABLE aging_intents_before AS SELECT to_jsonb(i) AS row FROM public.notification_intents i ORDER BY id;
SELECT throws_ok($q$SELECT pg_temp.age(101,interval '31 days',true)$q$,'P0001','Injected fixture aging failure','aging failure is not swallowed');
SELECT results_eq('SELECT oid,tgenabled FROM pg_trigger ORDER BY oid','SELECT oid,tgenabled FROM aging_trigger_states ORDER BY oid','failure restores every trigger state exactly');
SELECT results_eq('SELECT to_jsonb(w) FROM public.work_items w ORDER BY id','SELECT row FROM aging_work_before','failure rolls back earlier fixture update');
SELECT results_eq('SELECT to_jsonb(i) FROM public.notification_intents i ORDER BY id','SELECT row FROM aging_intents_before','failure leaves later fixture rows unchanged');
SELECT lives_ok($q$SELECT pg_temp.age(101,interval '0 days')$q$,'fixture aging needs table ownership, not superuser');
SELECT results_eq('SELECT oid,tgenabled FROM pg_trigger ORDER BY oid','SELECT oid,tgenabled FROM aging_trigger_states ORDER BY oid','success preserves O/D/R/A and all unrelated triggers');
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT c.relname,t.tgname,s.tgenabled FROM original_trigger_states s
  JOIN pg_trigger t ON t.oid=s.oid JOIN pg_class c ON c.oid=t.tgrelid
  WHERE t.tgenabled<>s.tgenabled LOOP
  EXECUTE format('ALTER TABLE public.%I %s TRIGGER %I',item.relname,
   CASE item.tgenabled WHEN 'O' THEN 'ENABLE' WHEN 'D' THEN 'DISABLE' WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'A' THEN 'ENABLE ALWAYS' END,item.tgname);
 END LOOP;
END $$;
SELECT results_eq('SELECT oid,tgenabled FROM pg_trigger ORDER BY oid','SELECT oid,tgenabled FROM original_trigger_states ORDER BY oid','state-variation fixture restores original catalog');
SELECT pg_temp.age(101,interval '29 days');
SELECT is(pg_temp.check_work(101,'retention_expired'),'not_due','29 days is not enough');
SELECT pg_temp.age(101,interval '30 days');
SELECT is(pg_temp.check_work(101,'retention_expired'),'eligible','30-day boundary eligible after clock comparison');
CREATE TEMP TABLE saved_sources AS SELECT * FROM notification_source_state;
CREATE TEMP TABLE saved_work AS SELECT * FROM work_items;
CREATE TEMP TABLE saved_generation AS SELECT * FROM notification_work_state;
CREATE TEMP TABLE saved_intents AS SELECT * FROM notification_intents;
SELECT is(pg_temp.erase(101,'retention_expired'),'erased','eligible exact-work history removed');
SELECT is(pg_temp.erase(101,'retention_expired'),'already_erased','response-lost retry idempotent');
SELECT is((SELECT count(*)::int FROM notification_erasure_receipts),1,'one receipt only');
SELECT is((SELECT count(*)::int FROM notification_erasure_context),0,'no authorization survives function return');
SELECT is((SELECT count(*)::int FROM notification_intents),29,'other work untouched');
SELECT results_eq('SELECT * FROM notification_source_state ORDER BY alert_id','SELECT * FROM saved_sources ORDER BY alert_id','shared source counters unchanged');
SELECT results_eq('SELECT to_jsonb(w) FROM work_items w ORDER BY id','SELECT to_jsonb(w) FROM saved_work w ORDER BY id','clinical work unchanged');
SELECT results_eq('SELECT * FROM notification_work_state ORDER BY work_item_id','SELECT * FROM saved_generation ORDER BY work_item_id','work generation not reset');
SELECT is((SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='notification_erasure_receipts'
 AND column_name IN('work_item_id','patient_id','recipient_id','intent_id','authorization_id','endpoint','payload','xact_id')),0,'receipt has no subject links or transport payload');
SELECT public.capture_notification_intent(pg_temp.work(101),'critical_created',1);
SELECT is((SELECT count(*)::int FROM notification_intents WHERE work_item_id=pg_temp.work(101)),0,'closed work cannot recapture erased notification');
UPDATE public.alerts SET occurrence_count=occurrence_count+1,last_seen_at=clock_timestamp() WHERE id=pg_temp.nr(101);
SELECT is((SELECT count(*)::int FROM notification_routing_exceptions WHERE work_item_id=pg_temp.work(101)),1,'new signal remains an actionable exception after erasure');
SELECT is(pg_temp.erase(101),'routing_pending','a previous erasure does not hide new routing evidence');

-- GUC forgery and direct DML cannot authorize erasure.
SELECT set_config('heartland.notification_erasure','true',true);
SELECT throws_ok('DELETE FROM notification_intents WHERE id=pg_temp.intent(103)','P0001','Notification history is immutable','even owner DML requires internal transaction scope');
SET LOCAL ROLE service_role;
SELECT throws_ok('INSERT INTO public.notification_erasure_context VALUES(pg_temp.work(103),pg_current_xact_id())','42501',NULL,'service cannot forge private scope');
SELECT throws_ok('SELECT public.notification_erasure_authorized(pg_temp.work(103))','42501',NULL,'private authorization helper not callable');
SELECT throws_ok('SELECT public.maintain_synthetic_notifications(11)','22023',NULL,'batch bounded');
SELECT throws_ok($q$SELECT public.erase_synthetic_notification_work(pg_temp.work(103),'all')$q$,'22023',NULL,'reason cannot broaden scope');
SELECT is(public.erase_synthetic_notification_work(pg_temp.nr(999),'retention_expired')->>'status','missing','missing work distinct from successful erasure');
RESET ROLE;
SELECT pg_temp.enroll(n) FROM generate_series(103,113) n;
SELECT pg_temp.prepare(n) FROM generate_series(103,108) n;
SELECT pg_temp.start(n) FROM generate_series(104,108) n;
SELECT pg_temp.finish(104,'accepted','accepted',201);
SELECT pg_temp.finish(105,'unknown','timeout');
SELECT pg_temp.finish(106,'rejected','http_rejected',400);
-- 107 remains sending,108 started but only later finishes.
SELECT pg_temp.close_work(n) FROM generate_series(103,113) n;
SELECT is(pg_temp.check_work(103),'lease_active','cancelled prepared attempt retains active worker lease');
SELECT pg_temp.age(n,interval '31 days') FROM generate_series(103,113) n;
SELECT is(pg_temp.check_work(105),'transport_pending','unknown cannot expire');
SELECT is(pg_temp.check_work(106),'transport_pending','blocked rejection cannot expire');
SELECT is(pg_temp.check_work(107),'transport_pending','sending cannot expire');
SELECT is(pg_temp.erase(103),'erased','cancelled never-started prepared attempt erased after lease');
CREATE TEMP TABLE old_attempt AS SELECT * FROM notification_dispatch_attempts WHERE intent_id=pg_temp.intent(104);
SELECT is(pg_temp.erase(104),'erased','accepted closed history removable after quiet period');
SELECT is((SELECT public.finish_notification_dispatch(intent_id,id,lease_token,lease_version,'accepted','accepted',201) FROM old_attempt),'stale','late finish after commit cannot recreate erased history');
SELECT is(public.claim_notification_dispatch((SELECT intent_id FROM old_attempt)),NULL::jsonb,'old claim cannot replay erased intent');
INSERT INTO notification_dispatch_events(intent_id,kind,state) VALUES(pg_temp.intent(108),'late_result','accepted');
SELECT is(pg_temp.check_work(108),'transport_pending','late result does not relabel sending');
UPDATE public.alerts SET occurrence_count=occurrence_count+1,last_seen_at=clock_timestamp() WHERE id=pg_temp.nr(109);
SELECT is(pg_temp.check_work(109),'routing_pending','unadjudicated routing exception retained indefinitely');

-- Any failure during deletion rolls back children, scope and receipt together.
CREATE FUNCTION pg_temp.fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Injected retention failure'; END $$;
CREATE TRIGGER injected_retention_failure BEFORE DELETE ON public.notification_intents FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_delete();
SELECT throws_ok('SELECT pg_temp.erase(110)','P0001','Injected retention failure','late delete failure rolls back');
SELECT is((SELECT count(*)::int FROM notification_intents WHERE work_item_id=pg_temp.work(110)),1,'intent survives rollback');
SELECT is((SELECT erased_at FROM notification_retention_scopes WHERE work_item_id=pg_temp.work(110)),NULL::timestamptz,'scope survives rollback');
SELECT is((SELECT count(*)::int FROM notification_erasure_context),0,'failed transaction leaves no bypass');
DROP TRIGGER injected_retention_failure ON notification_intents;
SELECT is(pg_temp.erase(110),'erased','retry after rollback succeeds');
SELECT public.set_synthetic_notification_hold(pg_temp.work(111),true);
SELECT is(pg_temp.erase(111),'held','hold wins after due date');
SELECT public.set_synthetic_notification_hold(pg_temp.work(111),false);
INSERT INTO notification_dispatches(intent_id,state) VALUES(pg_temp.intent(112),'pending');
SELECT is(pg_temp.check_work(112),'transport_pending','nonterminal queue prevents erasure despite cancelled intent');
INSERT INTO notification_dispatches(intent_id,state) VALUES(pg_temp.intent(113),'cancelled');
SELECT is(pg_temp.check_work(113,'retention_expired'),'not_due','latest queue evidence resets retention clock');
SELECT pg_temp.age(113,interval '31 days');
INSERT INTO notification_dispatch_events(intent_id,kind,state) VALUES(pg_temp.intent(113),'late_result','accepted');
SELECT is(pg_temp.check_work(113,'retention_expired'),'not_due','late evidence resets retention clock');

-- Maintenance advances past retained scopes and purges only due enrolled work.
SELECT pg_temp.enroll(n) FROM generate_series(114,125) n;
SELECT pg_temp.close_work(125); SELECT pg_temp.age(125,interval '31 days');
SELECT lives_ok('SELECT public.maintain_synthetic_notifications(10)','first bounded batch');
SELECT lives_ok('SELECT public.maintain_synthetic_notifications(10)','second bounded batch advances cursor');
SELECT lives_ok('SELECT public.maintain_synthetic_notifications(10)','third bounded batch wraps fairly');
SELECT ok((SELECT erased_at IS NOT NULL FROM notification_retention_scopes WHERE work_item_id=pg_temp.work(125)),'eligible later work not starved by open scopes');
UPDATE notification_erasure_receipts SET recorded_at=clock_timestamp()-interval '91 days';
SELECT ok((public.maintain_synthetic_notifications(1)->>'receiptsExpired')::int>0,'aggregate receipts expire separately after90days');
SELECT is((SELECT count(*)::int FROM notification_erasure_context),0,'private scope empty at suite end');

-- Fault injection at EVERY child-to-parent boundary, using real accepted history.
SELECT pg_temp.enroll(126); SELECT pg_temp.prepare(126); SELECT pg_temp.start(126);
SELECT pg_temp.finish(126,'accepted','accepted',201); SELECT pg_temp.close_work(126); SELECT pg_temp.age(126,interval '31 days');
CREATE FUNCTION pg_temp.retention_snapshot() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'intents',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM notification_intents i),
  'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY intent_id) FROM notification_dispatches q),
  'destinations',(SELECT jsonb_agg(to_jsonb(d) ORDER BY intent_id,position) FROM notification_dispatch_destinations d),
  'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM notification_dispatch_attempts a),
  'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM notification_dispatch_events e),
  'scopes',(SELECT jsonb_agg(to_jsonb(s) ORDER BY work_item_id) FROM notification_retention_scopes s),
  'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM notification_erasure_receipts r),
  'context',(SELECT jsonb_agg(to_jsonb(c) ORDER BY work_item_id) FROM notification_erasure_context c))
$$;
CREATE FUNCTION pg_temp.rollback_at(p_table text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE before_state jsonb:=pg_temp.retention_snapshot();
BEGIN
 EXECUTE format('CREATE TRIGGER injected_retention_failure BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_delete()',p_table);
 BEGIN
  PERFORM pg_temp.erase(126);
  RAISE EXCEPTION 'Failure injection did not fire';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'Injected retention failure' THEN RAISE; END IF;
 END;
 EXECUTE format('DROP TRIGGER injected_retention_failure ON public.%I',p_table);
 RETURN before_state IS NOT DISTINCT FROM pg_temp.retention_snapshot();
END $$;
SELECT ok(pg_temp.rollback_at(t),'complete byte-for-byte rollback at '||t) FROM unnest(ARRAY[
 'notification_dispatch_events','notification_dispatch_attempts','notification_dispatch_destinations',
 'notification_dispatches','notification_intents']) t;
SELECT is(pg_temp.erase(126),'erased','same accepted history erases after faults removed');
SELECT * FROM finish();
ROLLBACK;
