-- Synthetic transport protocol. No HTTP and every fixture rolls back.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
CREATE FUNCTION pg_temp.nd(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('57000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
SELECT ok(relrowsecurity,'RLS on '||relname) FROM pg_class WHERE relname IN
 ('notification_dispatches','notification_dispatch_destinations','notification_dispatch_attempts','notification_dispatch_events');
SELECT ok(NOT has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),r||' denied direct ledger '||t)
 FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY[
 'notification_dispatches','notification_dispatch_destinations','notification_dispatch_attempts','notification_dispatch_events']) t;
SELECT ok(NOT has_any_column_privilege(r,'alert_preferences','INSERT,UPDATE'),r||' has no raw preference column grants')
 FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT is((SELECT count(*)::int FROM notification_dispatches),0,'no historical dispatch backfill');

-- FIXTURE BEGIN: committed concurrency rehearsal may reuse this isolated block.
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (pg_temp.nd(1),'dispatch-owner@example.invalid','{"consent_accepted":true}'),
 (pg_temp.nd(2),'dispatch-target@example.invalid','{"consent_accepted":true}'),
 (pg_temp.nd(11),'dispatch-patient@example.invalid','{"consent_accepted":true}');
UPDATE public.profiles SET role='provider' WHERE id IN(pg_temp.nd(1),pg_temp.nd(2));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT pg_temp.nd(n),pg_temp.nd(11),'active',now() FROM unnest(ARRAY[1,2]) n;
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES(public.primary_organization_for_provider(pg_temp.nd(1)),pg_temp.nd(2),'clinician','active',now(),pg_temp.nd(1));
UPDATE public.organization_patient_assignments SET status='revoked',revoked_at=now()
 WHERE organization_id=public.primary_organization_for_provider(pg_temp.nd(2));
INSERT INTO public.patient_accountability(organization_id,patient_id,accountable_id,designated_by)
 VALUES(public.primary_organization_for_provider(pg_temp.nd(1)),pg_temp.nd(11),pg_temp.nd(1),pg_temp.nd(1));
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',user_id FROM public.organization_memberships WHERE user_id IN(pg_temp.nd(1),pg_temp.nd(2)) AND status='active';
INSERT INTO public.push_subscriptions(id,user_id,endpoint,keys) VALUES
 (pg_temp.nd(21),pg_temp.nd(1),'https://fcm.googleapis.com/synthetic-a','{"p256dh":"synthetic","auth":"synthetic"}'),
 (pg_temp.nd(22),pg_temp.nd(1),'https://fcm.googleapis.com/synthetic-b','{"p256dh":"synthetic","auth":"synthetic"}');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.alerts(id,patient_id,severity,flags,first_seen_at,last_seen_at)
 SELECT pg_temp.nd(n),pg_temp.nd(11),'critical',ARRAY['weight_gain_3lb_2d'],now(),now() FROM generate_series(101,120) n;
-- FIXTURE END
CREATE FUNCTION pg_temp.ev(n integer) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT id FROM public.notification_intents WHERE alert_id=pg_temp.nd(n) AND recipient_id=pg_temp.nd(1)
$$;
CREATE FUNCTION pg_temp.tk(n integer) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT lease_token FROM public.notification_dispatches WHERE intent_id=pg_temp.ev(n)
$$;
CREATE FUNCTION pg_temp.ver(n integer) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT lease_version FROM public.notification_dispatches WHERE intent_id=pg_temp.ev(n)
$$;
CREATE FUNCTION pg_temp.attempt(n integer) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT id FROM public.notification_dispatch_attempts WHERE intent_id=pg_temp.ev(n) ORDER BY created_at DESC,id DESC LIMIT 1
$$;
CREATE FUNCTION pg_temp.prepare(n integer,ready boolean DEFAULT true) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_notification_dispatch(pg_temp.ev(n),pg_temp.tk(n),pg_temp.ver(n),ready)
$$;
CREATE FUNCTION pg_temp.start(n integer,ready boolean DEFAULT true) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.start_notification_dispatch(pg_temp.ev(n),pg_temp.attempt(n),pg_temp.tk(n),pg_temp.ver(n),ready)
$$;
CREATE FUNCTION pg_temp.finish(n integer,state text,code text,http integer DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT public.finish_notification_dispatch(pg_temp.ev(n),pg_temp.attempt(n),pg_temp.tk(n),pg_temp.ver(n),state,code,http)
$$;

SET LOCAL ROLE anon;
SELECT throws_ok('SELECT public.claim_notification_dispatch(pg_temp.ev(101))','42501',NULL,'anonymous cannot claim');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT public.claim_notification_dispatch(pg_temp.ev(101))','42501',NULL,'authenticated cannot claim');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.nd(1),'aal','aal2')::text,true);
SELECT lives_ok($q$SELECT public.set_alert_notification_preference(pg_temp.nd(11),'no_checkin',true)$q$,'first mute through receipted gate');
SELECT throws_ok($q$SELECT public.set_alert_notification_preference(pg_temp.nd(11),'sbp_low',true)$q$,'22023','Invalid alert preference','protected flags unchanged');
SELECT throws_ok($q$UPDATE public.alert_preferences SET muted=false$q$,'42501',NULL,'column grants cannot bypass preference lock');
SELECT lives_ok($q$SELECT public.set_alert_notification_preference(pg_temp.nd(11),'no_checkin',false)$q$,'unmute uses same gate');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','service_role','sub',pg_temp.nd(1))::text,true);
SELECT throws_ok('SELECT public.claim_notification_dispatch(pg_temp.ev(101))','42501','Notification service not authorized','service role with actor is denied');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(public.claim_notification_dispatch(pg_temp.ev(101))->>'eventId',pg_temp.ev(101)::text,'service claims existing intent');
SELECT is(public.claim_notification_dispatch(pg_temp.ev(101)),NULL::jsonb,'live claim is exclusive');
SELECT is(jsonb_array_length(public.get_notification_dispatch_snapshot(pg_temp.ev(101),pg_temp.tk(101),pg_temp.ver(101))->'destinations'),2,'full ordered destination set');
SELECT is(pg_temp.prepare(101)->>'channel','push','first push prepared');
SELECT is(pg_temp.start(101)->>'kind','started','start persisted before external transport');
SELECT is(pg_temp.start(101),NULL::jsonb,'second start forbidden');
SELECT is(pg_temp.finish(101,'accepted','accepted',201),'recorded','HTTP acceptance recorded');
SELECT is(public.claim_notification_dispatch(pg_temp.ev(101)),NULL::jsonb,'accepted suppresses every later attempt');
RESET ROLE;
SELECT is((SELECT state FROM notification_dispatches WHERE intent_id=pg_temp.ev(101)),'accepted','accepted not delivered');
SELECT is((SELECT count(*)::int FROM notification_dispatch_attempts WHERE intent_id=pg_temp.ev(101)),1,'one accepted destination only');

-- 410 continuation, version-fenced invalidation, then email only after exhaustion.
SET LOCAL ROLE service_role;
SELECT public.claim_notification_dispatch(pg_temp.ev(102));
SELECT pg_temp.prepare(102);
SELECT pg_temp.start(102)->>'kind';
RESET ROLE;
UPDATE public.push_subscriptions SET endpoint='https://fcm.googleapis.com/new-device' WHERE id=pg_temp.nd(21);
SET LOCAL ROLE service_role;
SELECT is(pg_temp.finish(102,'rejected','subscription_expired',410),'recorded','old version rejection retained');
RESET ROLE;
SELECT is((SELECT notification_version FROM push_subscriptions WHERE id=pg_temp.nd(21)),2::bigint,'endpoint update advances version');
SELECT is((SELECT notification_invalid_at FROM push_subscriptions WHERE id=pg_temp.nd(21)),NULL::timestamptz,'late old rejection cannot invalidate new endpoint');
INSERT INTO push_subscriptions(id,user_id,endpoint,keys) VALUES(pg_temp.nd(23),pg_temp.nd(1),'https://fcm.googleapis.com/later','{"p256dh":"x","auth":"y"}');
SET LOCAL ROLE service_role;
SELECT public.claim_notification_dispatch(pg_temp.ev(102));
SELECT is(pg_temp.prepare(102)->>'channel','push','next destination in stable set');
SELECT pg_temp.start(102)->>'kind';
SELECT is(pg_temp.finish(102,'rejected','subscription_expired',404),'recorded','second destination definitively unusable');
SELECT public.claim_notification_dispatch(pg_temp.ev(102));
SELECT is(pg_temp.prepare(102)->>'channel','email','one email only after complete exhaustion');
SELECT is(pg_temp.start(102)->>'channel','email','email resolved only at start');
SELECT is(pg_temp.finish(102,'unknown','timeout'),'recorded','ambiguous email result remains unknown');
SELECT is(public.claim_notification_dispatch(pg_temp.ev(102)),NULL::jsonb,'unknown email never replays');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM notification_dispatch_destinations WHERE intent_id=pg_temp.ev(102)),2,'new device cannot expand frozen event');
SELECT is((SELECT notification_invalid_reason FROM push_subscriptions WHERE id=pg_temp.nd(22)),'subscription_expired','invalid subscription has stored reason');
SELECT is((SELECT count(*)::int FROM notification_dispatch_attempts WHERE intent_id=pg_temp.ev(102) AND channel='email'),1,'NULL destination has unique email identity');

-- Claims after configuration/preference failure are not timer retries.
SET LOCAL ROLE service_role;
SELECT public.claim_notification_dispatch(pg_temp.ev(103));
SELECT is(pg_temp.prepare(103,false),NULL::jsonb,'configuration failure blocks before preparation');
SELECT is(public.claim_notification_dispatch(pg_temp.ev(103)),NULL::jsonb,'configuration block never auto-releases');
SELECT public.claim_notification_dispatch(pg_temp.ev(104));
SELECT pg_temp.prepare(104);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.nd(1),'aal','aal2')::text,true);
SELECT public.set_alert_notification_preference(pg_temp.nd(11),'weight_gain_3lb_2d',true);
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(pg_temp.start(104),NULL::jsonb,'new actual-recipient mute after prepare blocks start');
RESET ROLE;
SELECT is((SELECT state FROM notification_dispatches WHERE intent_id=pg_temp.ev(104)),'blocked','preference block visible');
SELECT is((SELECT started_at FROM notification_dispatch_attempts WHERE intent_id=pg_temp.ev(104)),NULL::timestamptz,'no start marker under mute');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.nd(1),'aal','aal2')::text,true);
SELECT public.set_alert_notification_preference(pg_temp.nd(11),'weight_gain_3lb_2d',false);
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);

-- Stale token AND version independently fenced; never-started lease can recover.
SET LOCAL ROLE service_role;
SELECT public.claim_notification_dispatch(pg_temp.ev(105));
SELECT pg_temp.prepare(105);
SELECT is(public.start_notification_dispatch(pg_temp.ev(105),pg_temp.attempt(105),gen_random_uuid(),pg_temp.ver(105),true),NULL::jsonb,'stale token denied');
SELECT is(public.start_notification_dispatch(pg_temp.ev(105),pg_temp.attempt(105),pg_temp.tk(105),pg_temp.ver(105)+1,true),NULL::jsonb,'stale version denied');
RESET ROLE;
CREATE TEMP TABLE old_claim AS SELECT * FROM notification_dispatches WHERE intent_id=pg_temp.ev(105);
UPDATE notification_dispatches SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE intent_id=pg_temp.ev(105);
SET LOCAL ROLE service_role;
SELECT ok(public.claim_notification_dispatch(pg_temp.ev(105)) IS NOT NULL,'unstarted expired lease reclaimed');
RESET ROLE;
SELECT is(pg_temp.ver(105),(SELECT lease_version+1 FROM old_claim),'recovery advances fencing version');
SELECT isnt(pg_temp.tk(105),(SELECT lease_token FROM old_claim),'recovery rotates token');
SELECT is((SELECT lease_token FROM notification_dispatch_attempts WHERE intent_id=pg_temp.ev(105)),pg_temp.tk(105),'prepared identity refenced atomically');
SET LOCAL ROLE service_role;
SELECT is(pg_temp.start(105)->>'kind','started','recovered prepared attempt can start once');
RESET ROLE;
UPDATE notification_dispatches SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE intent_id=pg_temp.ev(105);
SET LOCAL ROLE service_role;
SELECT is(public.claim_notification_dispatch(pg_temp.ev(105)),NULL::jsonb,'started crash is not reclaimed');
SELECT is(pg_temp.finish(105,'accepted','accepted',202),'late_evidence','late result evidence does not overwrite unknown');
RESET ROLE;
SELECT is((SELECT state FROM notification_dispatch_attempts WHERE intent_id=pg_temp.ev(105)),'unknown','unknown persists after late acceptance');
SELECT is((SELECT count(*)::int FROM notification_dispatch_events WHERE intent_id=pg_temp.ev(105) AND kind='late_result'),1,'late receipt separately retained');

-- Closing after start is not cancellation/non-delivery. Finishing survives revocation.
SET LOCAL ROLE service_role;
SELECT public.claim_notification_dispatch(pg_temp.ev(106));
SELECT pg_temp.prepare(106);
SELECT pg_temp.start(106)->>'kind';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.nd(1),'aal','aal2')::text,true);
UPDATE public.work_items SET status='closed',outcome_code='clinical_action_taken',outcome='Synthetic closure'
 WHERE source_id=pg_temp.nd(106);
RESET ROLE;
SELECT is((SELECT state FROM notification_intents WHERE id=pg_temp.ev(106)),'pending','started intent history not cancelled');
SELECT is((SELECT state FROM notification_dispatches WHERE intent_id=pg_temp.ev(106)),'sending','started transport truth preserved');
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='monitor'
 AND membership_id IN(SELECT id FROM organization_memberships WHERE user_id=pg_temp.nd(1));
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(pg_temp.finish(106,'accepted','accepted',201),'recorded','result persisted even after current access revoked');
SELECT is(public.claim_notification_dispatch(pg_temp.ev(107)),NULL::jsonb,'revoked monitor blocks new claim');
RESET ROLE;
SELECT is((SELECT state FROM notification_dispatches WHERE intent_id=pg_temp.ev(107)),'blocked','authorization block explicit');

-- No direct ledger DML, immutable destinations/observed attempts/evidence.
SELECT throws_ok($q$UPDATE notification_dispatch_attempts SET state='rejected' WHERE intent_id=pg_temp.ev(101)$q$,'P0001','Notification transport history is immutable','terminal attempt cannot be rewritten');
SELECT throws_ok($q$DELETE FROM notification_dispatch_events$q$,'P0001','Notification transport history is immutable','ordinary audit erasure denied');
SELECT throws_ok($q$UPDATE notification_dispatch_destinations SET subscription_version=99$q$,'P0001','Notification transport history is immutable','frozen identity immutable');
SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT * FROM notification_dispatches$q$,'42501',NULL,'service cannot bypass RPC snapshot');
SELECT throws_ok($q$SELECT public.notification_dispatch_next(pg_temp.ev(101))$q$,'42501',NULL,'service cannot call private helper');
SELECT throws_ok($q$SELECT public.finish_notification_dispatch(pg_temp.ev(101),pg_temp.attempt(101),pg_temp.tk(101),pg_temp.ver(101),'accepted','accepted',500)$q$,
 '22023','Invalid notification result','impossible HTTP/state pair rejected');
RESET ROLE;
SELECT ok(NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name LIKE 'notification_dispatch%'
 AND column_name IN('email','endpoint','keys','payload','response_body')),'ledger stores no destinations/secrets/payload');

-- Cancellation of a prepared attempt is final; recovery must not revive it.
UPDATE member_authorizations SET revoked_at=NULL WHERE capability='monitor'
 AND membership_id IN(SELECT id FROM organization_memberships WHERE user_id=pg_temp.nd(1));
SELECT public.claim_notification_dispatch(pg_temp.ev(108));
SELECT pg_temp.prepare(108);
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.nd(1),'aal','aal2')::text,true);
UPDATE work_items SET status='closed',outcome_code='clinical_action_taken',outcome='Synthetic closure before start' WHERE source_id=pg_temp.nd(108);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(pg_temp.start(108),NULL::jsonb,'prepared attempt cannot start after closure');
UPDATE notification_dispatches SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE intent_id=pg_temp.ev(108);
SELECT is(public.claim_notification_dispatch(pg_temp.ev(108)),NULL::jsonb,'cancelled prepared attempt cannot recover');
SELECT is((SELECT state FROM notification_dispatches WHERE intent_id=pg_temp.ev(108)),'cancelled','unsent closure is actually cancelled');
SELECT is((SELECT started_at FROM notification_dispatch_attempts WHERE intent_id=pg_temp.ev(108)),NULL::timestamptz,'cancelled preparation has no HTTP start');

-- Endpoint mutation or deletion after preparation yields known no-HTTP evidence.
SELECT public.claim_notification_dispatch(pg_temp.ev(109));
SELECT pg_temp.prepare(109);
UPDATE push_subscriptions SET keys='{"p256dh":"new","auth":"new"}' WHERE id=pg_temp.nd(21);
SELECT is(pg_temp.start(109)->>'kind','not_attempted','changed subscription cannot use stale keys');
SELECT is((SELECT notification_version FROM push_subscriptions WHERE id=pg_temp.nd(21)),3::bigint,'key update advances destination version');
SELECT public.claim_notification_dispatch(pg_temp.ev(110));
SELECT pg_temp.prepare(110);
DELETE FROM push_subscriptions WHERE id=pg_temp.nd(21);
SELECT is(pg_temp.start(110)->>'kind','not_attempted','deleted subscription cannot be transported');
SELECT is((SELECT count(*)::int FROM notification_dispatch_destinations WHERE intent_id=pg_temp.ev(110)),2,'subscription deletion preserves frozen evidence');

-- The size guard rejects a whole destination set instead of silently truncating it.
DELETE FROM push_subscriptions WHERE user_id=pg_temp.nd(1);
INSERT INTO push_subscriptions(id,user_id,endpoint,keys)
 SELECT pg_temp.nd(n),pg_temp.nd(1),'https://fcm.googleapis.com/limit-'||n,'{"p256dh":"x","auth":"y"}' FROM generate_series(1001,1100) n;
SELECT ok(public.claim_notification_dispatch(pg_temp.ev(111)) IS NOT NULL,'exactly 100 destinations can be frozen');
SELECT is((SELECT count(*)::int FROM notification_dispatch_destinations WHERE intent_id=pg_temp.ev(111)),100,'complete 100-device set retained');
INSERT INTO push_subscriptions(id,user_id,endpoint,keys) VALUES(pg_temp.nd(1101),pg_temp.nd(1),'https://fcm.googleapis.com/limit-1101','{"p256dh":"x","auth":"y"}');
SELECT is(public.claim_notification_dispatch(pg_temp.ev(112)),NULL::jsonb,'101 destinations cannot acquire a dispatch lease');
SELECT is((SELECT reason FROM notification_dispatches WHERE intent_id=pg_temp.ev(112)),'destination_limit','destination-limit block is actionable');
SELECT is((SELECT count(*)::int FROM notification_dispatch_destinations WHERE intent_id=pg_temp.ev(112)),0,'over-limit set is not truncated');
DELETE FROM push_subscriptions WHERE id=pg_temp.nd(1101);
SELECT is(public.claim_notification_dispatch(pg_temp.ev(112)),NULL::jsonb,'dropping below limit does not automatically release a block');

-- A genuinely empty set can use email; missing contact is not a failed delivery.
DELETE FROM push_subscriptions WHERE user_id=pg_temp.nd(1);
SELECT public.claim_notification_dispatch(pg_temp.ev(113));
SELECT is(pg_temp.prepare(113)->>'channel','email','known empty frozen set prepares email');
UPDATE profiles SET email='' WHERE id=pg_temp.nd(1);
SELECT is(pg_temp.start(113)->>'kind','not_attempted','missing contact is detected before HTTP start');
SELECT is((SELECT code FROM notification_dispatch_attempts WHERE intent_id=pg_temp.ev(113)),'missing_recipient','contact failure retains typed evidence');
SELECT is(public.claim_notification_dispatch(pg_temp.ev(113)),NULL::jsonb,'missing email does not generate repeated attempts');
UPDATE profiles SET email='dispatch-owner@example.invalid' WHERE id=pg_temp.nd(1);

-- Both finish/work-transition orderings converge to the same operational block.
INSERT INTO push_subscriptions(id,user_id,endpoint,keys) VALUES
 (pg_temp.nd(21),pg_temp.nd(1),'https://fcm.googleapis.com/order-a','{"p256dh":"x","auth":"y"}'),
 (pg_temp.nd(22),pg_temp.nd(1),'https://fcm.googleapis.com/order-b','{"p256dh":"x","auth":"y"}');
CREATE FUNCTION pg_temp.stop_work(n integer,kind text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE w uuid;
BEGIN
 SELECT work_item_id INTO w FROM notification_intents WHERE id=pg_temp.ev(n);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.nd(1),'aal','aal2')::text,true);
 IF kind='closed' THEN UPDATE work_items SET status='closed',outcome_code='clinical_action_taken',outcome='Synthetic closure' WHERE id=w;
 ELSIF kind='resolved' THEN UPDATE alerts SET status='resolved',resolution_note='Synthetic resolution' WHERE id=pg_temp.nd(n);
 ELSE
  PERFORM offer_work_item_transfer(w,pg_temp.nd(2),'Synthetic transfer');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.nd(2),'aal','aal2')::text,true);
  PERFORM accept_work_item_transfer(w);
 END IF;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
END $$;
CREATE FUNCTION pg_temp.finish_race(n integer,kind text,change_first boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE push_subscriptions SET endpoint=endpoint||'-'||n WHERE id IN(pg_temp.nd(21),pg_temp.nd(22));
 PERFORM claim_notification_dispatch(pg_temp.ev(n)); PERFORM pg_temp.prepare(n); PERFORM pg_temp.start(n);
 IF change_first THEN PERFORM pg_temp.stop_work(n,kind); END IF;
 PERFORM pg_temp.finish(n,'rejected','subscription_expired',410);
 IF NOT change_first THEN PERFORM pg_temp.stop_work(n,kind); END IF;
END $$;
CREATE TEMP TABLE finish_cases AS SELECT * FROM (VALUES(114,'closed',true),(115,'closed',false),
 (116,'resolved',true),(117,'resolved',false),(118,'superseded_recipient',true),(119,'superseded_recipient',false)) v(n,kind,change_first);
SELECT pg_temp.finish_race(n,kind,change_first) FROM finish_cases ORDER BY n;
SELECT is((SELECT state||':'||reason FROM notification_dispatches WHERE intent_id=pg_temp.ev(n)),
 'blocked:'||kind,'finish/transition order converges: '||n) FROM finish_cases;
SELECT is(claim_notification_dispatch(pg_temp.ev(n)),NULL::jsonb,'structurally blocked continuation cannot claim: '||n) FROM finish_cases;
SELECT is(pg_temp.start(n),NULL::jsonb,'structurally blocked continuation cannot restart: '||n) FROM finish_cases;
SELECT is((SELECT state FROM notification_dispatch_attempts WHERE intent_id=pg_temp.ev(n)),'rejected','observed attempt preserved: '||n) FROM finish_cases;

SELECT ok(NOT has_function_privilege(r,p.oid,'EXECUTE'),r||' denied '||p.proname)
 FROM pg_proc p CROSS JOIN unnest(ARRAY['anon','authenticated']) r
 WHERE p.pronamespace='public'::regnamespace AND p.proname IN('claim_notification_dispatch','get_notification_dispatch_snapshot',
 'prepare_notification_dispatch','start_notification_dispatch','finish_notification_dispatch');
SELECT * FROM finish();
ROLLBACK;
