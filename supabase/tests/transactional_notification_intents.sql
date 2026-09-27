-- Inert capture only. Synthetic fixtures and every test roll back.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
CREATE FUNCTION pg_temp.ni(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('54000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN
 ('public.notification_source_state'::regclass,'public.notification_work_state'::regclass,
 'public.notification_intents'::regclass,'public.notification_routing_exceptions'::regclass)),'all private capture tables enable RLS');
SELECT ok(NOT has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),r||' has no ledger privilege on '||t)
 FROM unnest(ARRAY['anon','authenticated','service_role']) AS r
 CROSS JOIN unnest(ARRAY['public.notification_source_state','public.notification_work_state',
 'public.notification_intents','public.notification_routing_exceptions']) AS t;
SELECT ok(NOT has_function_privilege(r,f,'EXECUTE'),r||' cannot call '||f)
 FROM unnest(ARRAY['anon','authenticated','service_role']) AS r
 CROSS JOIN unnest(ARRAY['public.capture_notification_intent(uuid,text,bigint)',
 'public.notification_capture_block_reason(uuid,uuid,uuid,text[],timestamptz)',
 'public.capture_work_notification_change()','public.guard_notification_history()']) AS f;
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE contype='f' AND conrelid IN
 ('public.notification_intents'::regclass,'public.notification_work_state'::regclass,
 'public.notification_routing_exceptions'::regclass) AND confrelid<>'public.work_items'::regclass),0,
 'no account, actor, receipt, source or source-state FK after the work lock');
SELECT is((SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgrelid='public.alerts'::regclass
 AND tgname IN ('refresh_coalesced_alert_work_item','sync_alert_work_items')),1,'single source projection binding');
SELECT is((SELECT count(*)::int FROM public.notification_intents),0,'install has no historical enqueue');

-- FIXTURE BEGIN (also usable in a committed two-connection rehearsal).
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.ni(n),'intent-'||n||'@example.invalid','{"consent_accepted":true}'::jsonb
 FROM unnest(ARRAY[1,2,3,11]) AS n;
UPDATE public.profiles SET role='provider' WHERE id IN(pg_temp.ni(1),pg_temp.ni(2),pg_temp.ni(3));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT pg_temp.ni(n),pg_temp.ni(11),'active',now() FROM unnest(ARRAY[1,2,3]) AS n;
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES(public.primary_organization_for_provider(pg_temp.ni(1)),pg_temp.ni(2),'clinician','active',now(),pg_temp.ni(1));
UPDATE public.organization_patient_assignments SET status='revoked',revoked_at=now()
 WHERE organization_id=public.primary_organization_for_provider(pg_temp.ni(2));
INSERT INTO public.patient_accountability(organization_id,patient_id,accountable_id,designated_by)
 VALUES(public.primary_organization_for_provider(pg_temp.ni(1)),pg_temp.ni(11),pg_temp.ni(1),pg_temp.ni(1));
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',user_id FROM public.organization_memberships WHERE user_id IN(pg_temp.ni(1),pg_temp.ni(2),pg_temp.ni(3)) AND status='active';
-- FIXTURE END
CREATE FUNCTION pg_temp.nw(n integer,owner_n integer DEFAULT 1) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT id FROM public.work_items WHERE source_id=pg_temp.ni(n)
 AND organization_id=public.primary_organization_for_provider(pg_temp.ni(owner_n))
$$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.alerts(id,patient_id,severity,flags,first_seen_at,last_seen_at) VALUES(pg_temp.ni(301),pg_temp.ni(11),'critical',ARRAY['weight_gain'],now(),now());
SELECT is((SELECT count(*)::int FROM public.notification_intents WHERE alert_id=pg_temp.ni(301)),2,'new critical source captures one intent in each organization');
SELECT is((SELECT count(DISTINCT organization_id)::int FROM public.notification_intents WHERE alert_id=pg_temp.ni(301)),2,'organization identity retained');
SELECT is((SELECT count(*)::int FROM public.notification_intents WHERE alert_id=pg_temp.ni(301)
 AND event_kind='critical_created' AND source_revision=1 AND generation=1 AND state='pending'),2,'new events are eligible but unsent');
CREATE TEMP TABLE initial_intents AS SELECT * FROM public.notification_intents;
UPDATE public.alerts SET occurrence_count=occurrence_count+1,last_seen_at=now() WHERE id=pg_temp.ni(301);
SELECT is((SELECT source_revision FROM public.notification_source_state WHERE alert_id=pg_temp.ni(301)),2::bigint,'count-only same-transaction source revision advances');
SELECT results_eq('SELECT to_jsonb(i) FROM public.notification_intents i ORDER BY id',
 'SELECT to_jsonb(i) FROM initial_intents i ORDER BY id','critical repeat never duplicates, cancels or rewrites pending generation');
UPDATE public.alerts SET flags=flags||ARRAY['new_flag'] WHERE id=pg_temp.ni(301);
SELECT is((SELECT count(*)::int FROM public.notification_routing_exceptions WHERE alert_id=pg_temp.ni(301) AND reason='critical_new_flag'),2,'new flag on critical creates per-work exceptions');
SELECT is((SELECT count(*)::int FROM public.notification_intents),2,'new critical flag is not a new clinical episode or send');
UPDATE public.alerts SET flags=flags,occurrence_count=occurrence_count WHERE id=pg_temp.ni(301);
SELECT is((SELECT source_revision FROM public.notification_source_state WHERE alert_id=pg_temp.ni(301)),3::bigint,'semantic no-op does not advance revision');

-- After ACK, escalation still reaches current assignee, without clinical timing changes.
INSERT INTO public.alerts(id,patient_id,severity,flags,first_seen_at,last_seen_at) VALUES(pg_temp.ni(302),pg_temp.ni(11),'warning',ARRAY['fixture_warning'],now(),now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ni(1),'role','authenticated','aal','aal2')::text,true);
SELECT public.accept_work_item(pg_temp.nw(302));
UPDATE public.alerts SET status='acknowledged' WHERE id=pg_temp.ni(302);
SELECT public.offer_work_item_transfer(pg_temp.nw(302),pg_temp.ni(2),'Synthetic transfer');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ni(2),'role','authenticated','aal','aal2')::text,true);
SELECT public.accept_work_item_transfer(pg_temp.nw(302));
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.notification_intents WHERE alert_id=pg_temp.ni(302)),0,'offer/acceptance of warning does not create transport');
CREATE TEMP TABLE prior_escalation AS SELECT * FROM public.work_items WHERE id=pg_temp.nw(302);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.alerts SET severity='critical',occurrence_count=occurrence_count+1 WHERE id=pg_temp.ni(302);
SELECT is((SELECT recipient_id FROM public.notification_intents WHERE work_item_id=pg_temp.nw(302)),pg_temp.ni(2),'escalation uses actual transferee, not designated owner');
SELECT is((SELECT event_kind FROM public.notification_intents WHERE work_item_id=pg_temp.nw(302)),'critical_escalated','post-ACK escalation recorded');
SELECT is((SELECT status FROM public.work_items WHERE id=pg_temp.nw(302)),'reviewed','ACK review remains recorded');
SELECT is((SELECT source_revision FROM public.notification_source_state WHERE alert_id=pg_temp.ni(302)),2::bigint,'ACK/transfer did not invent signal revision');
SELECT is((SELECT row(priority,due_at,accepted_by,accepted_at)::text FROM public.work_items WHERE id=pg_temp.nw(302)),
 (SELECT row(priority,due_at,accepted_by,accepted_at)::text FROM prior_escalation),'priority, due and acceptance preserved');

-- Reverse order: transfer critical work creates a new event and cancels only unsent previous generation.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ni(1),'role','authenticated','aal','aal2')::text,true);
SELECT public.offer_work_item_transfer(pg_temp.nw(301),pg_temp.ni(2),'Synthetic critical transfer');
RESET ROLE;
SELECT is((SELECT generation FROM public.notification_work_state WHERE work_item_id=pg_temp.nw(301)),1::bigint,'offer is not a new owner');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ni(2),'role','authenticated','aal','aal2')::text,true);
SELECT public.accept_work_item_transfer(pg_temp.nw(301));
RESET ROLE;
SELECT is((SELECT state FROM public.notification_intents WHERE work_item_id=pg_temp.nw(301) AND generation=1),'cancelled','superseded unstarted generation cancelled');
SELECT is((SELECT recipient_id FROM public.notification_intents WHERE work_item_id=pg_temp.nw(301) AND generation=1),pg_temp.ni(1),'historical recipient remains immutable');
SELECT is((SELECT cancellation_reason FROM public.notification_intents WHERE work_item_id=pg_temp.nw(301) AND generation=1),'recipient_superseded','safe cancellation reason retained');
SELECT is((SELECT event_kind FROM public.notification_intents WHERE work_item_id=pg_temp.nw(301) AND generation=2),'critical_reassigned','actual critical transfer has its own generation');
SELECT is((SELECT recipient_id FROM public.notification_intents WHERE work_item_id=pg_temp.nw(301) AND generation=2),pg_temp.ni(2),'new intent belongs only to actual new owner');
SELECT is((SELECT state FROM public.notification_intents WHERE work_item_id=pg_temp.nw(301,3)),'pending','other organization remains independent');

-- Close A, retain B. A's completed context never changes on a later source observation.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ni(2),'role','authenticated','aal','aal2')::text,true);
UPDATE public.work_items SET status='closed',outcome='Synthetic disposition',outcome_code='clinical_action_taken' WHERE id=pg_temp.nw(301);
RESET ROLE;
CREATE TEMP TABLE closed_item AS SELECT * FROM public.work_items WHERE id=pg_temp.nw(301);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.alerts SET occurrence_count=occurrence_count+1 WHERE id=pg_temp.ni(301);
SELECT is((SELECT to_jsonb(w) FROM public.work_items w WHERE id=pg_temp.nw(301)),(SELECT to_jsonb(w) FROM closed_item w),'closed work context is immutable');
SELECT is((SELECT count(*)::int FROM public.notification_routing_exceptions WHERE work_item_id=pg_temp.nw(301) AND reason='closed_work_later_signal'),1,'closed row receives exception without UPDATE');
SELECT is((SELECT state FROM public.notification_intents WHERE work_item_id=pg_temp.nw(301) AND generation=2),'cancelled','closing cancels unsent new owner intent');
SELECT is((SELECT state FROM public.notification_intents WHERE work_item_id=pg_temp.nw(301,3)),'pending','open organization count-only refresh preserves its intent');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ni(3),'role','authenticated','aal','aal2')::text,true);
UPDATE public.alerts SET status='resolved',resolution_note='Synthetic source disposition' WHERE id=pg_temp.ni(301);
RESET ROLE;
SELECT is((SELECT cancellation_reason FROM public.notification_intents WHERE work_item_id=pg_temp.nw(301,3)),'source_resolved','resolved source cancels open work unsent intent');
SELECT is((SELECT status FROM public.work_items WHERE id=pg_temp.nw(301,3)),'new','source resolution never asserts clinical closure');

-- Matching mute of actual recipient, including one flag in a composite source.
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.alert_preferences(provider_id,patient_id,alert_type,muted) VALUES
 (pg_temp.ni(2),pg_temp.ni(11),'low_egfr',true),(pg_temp.ni(1),pg_temp.ni(11),'weight_gain',true);
INSERT INTO public.alerts(id,patient_id,severity,flags,first_seen_at,last_seen_at) VALUES(pg_temp.ni(303),pg_temp.ni(11),'critical',ARRAY['low_egfr'],now(),now());
SELECT is((SELECT state FROM public.notification_intents WHERE work_item_id=pg_temp.nw(303)),'pending','unrelated linked provider mute does not suppress detection/intent');
INSERT INTO public.alerts(id,patient_id,severity,flags,first_seen_at,last_seen_at) VALUES(pg_temp.ni(304),pg_temp.ni(11),'critical',ARRAY['weight_gain','low_egfr'],now(),now());
SELECT is((SELECT blocked_reason FROM public.notification_intents WHERE work_item_id=pg_temp.nw(304)),'blocked_preference','one actual recipient mute blocks whole composite transport');
SELECT is((SELECT state FROM public.notification_intents WHERE work_item_id=pg_temp.nw(304,3)),'pending','mute is not inherited by other organization recipient');
SELECT is((SELECT count(*)::int FROM public.alerts WHERE id=pg_temp.ni(304)),1,'mute never suppresses persisted detection');

-- Legacy boundary: privileged fixture creates pre-install sources with no capture state.
ALTER TABLE public.alerts DISABLE TRIGGER sync_alert_work_items;
INSERT INTO public.alerts(id,patient_id,severity,flags,first_seen_at,last_seen_at)
 SELECT pg_temp.ni(n),pg_temp.ni(11),CASE WHEN n=311 THEN 'warning' ELSE 'critical' END,ARRAY['legacy_fixture'],now(),now()
 FROM generate_series(311,315) AS n;
ALTER TABLE public.alerts ENABLE TRIGGER sync_alert_work_items;
INSERT INTO public.work_items(patient_id,provider_id,assigned_to,organization_id,source_type,source_id,title,reason,priority,severity,accountability_source)
 SELECT patient_id,pg_temp.ni(1),pg_temp.ni(1),public.primary_organization_for_provider(pg_temp.ni(1)),
 'alert',id,'Legacy fixture','Pre-install context','today',severity,CASE WHEN id=pg_temp.ni(315) THEN 'legacy_fan_out' ELSE 'designated' END
 FROM public.alerts WHERE id BETWEEN pg_temp.ni(311) AND pg_temp.ni(315);
SELECT is((SELECT count(*)::int FROM public.notification_intents WHERE alert_id BETWEEN pg_temp.ni(311) AND pg_temp.ni(315)),0,'generic/manual work INSERT never creates historical transport');
UPDATE public.alerts SET severity='critical' WHERE id=pg_temp.ni(311);
SELECT is((SELECT event_kind FROM public.notification_intents WHERE alert_id=pg_temp.ni(311)),'critical_escalated','first source observation preserves real warning-to-critical delta');
UPDATE public.alerts SET flags=flags||ARRAY['new_legacy_flag'] WHERE id=pg_temp.ni(312);
SELECT is((SELECT reason FROM public.notification_routing_exceptions WHERE alert_id=pg_temp.ni(312)),'critical_new_flag','first new flag retains real critical delta');
UPDATE public.alerts SET occurrence_count=occurrence_count+1 WHERE id=pg_temp.ni(313);
SELECT is((SELECT count(*)::int FROM public.notification_intents WHERE alert_id=pg_temp.ni(313)),0,'first count-only observation is not created/backfill');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ni(1),'role','authenticated','aal','aal2')::text,true);
SELECT public.offer_work_item_transfer(pg_temp.nw(314),pg_temp.ni(2),'Legacy actual transfer');
SELECT public.offer_work_item_transfer(pg_temp.nw(315),pg_temp.ni(2),'Legacy fanout transfer');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ni(2),'role','authenticated','aal','aal2')::text,true);
SELECT public.accept_work_item_transfer(pg_temp.nw(314));
SELECT public.accept_work_item_transfer(pg_temp.nw(315));
RESET ROLE;
SELECT is((SELECT source_revision FROM public.notification_intents WHERE alert_id=pg_temp.ni(314)),0::bigint,'actual legacy critical reassignment uses explicit revision0');
SELECT is((SELECT count(*)::int FROM public.notification_source_state WHERE alert_id=pg_temp.ni(314)),0,'work trigger never initializes source-state');
SELECT is((SELECT count(*)::int FROM public.notification_intents WHERE alert_id=pg_temp.ni(315)),0,'legacy fanout remains ineligible after transfer');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.alerts SET occurrence_count=occurrence_count+1 WHERE id=pg_temp.ni(314);
SELECT is((SELECT source_revision FROM public.notification_source_state WHERE alert_id=pg_temp.ni(314)),1::bigint,'first later source observation initializes revision1');
SELECT is((SELECT state FROM public.notification_intents WHERE alert_id=pg_temp.ni(314)),'pending','revision0 intent not cancelled or duplicated by count');
UPDATE public.alerts SET flags=flags||ARRAY['new_legacy_flag'] WHERE id=pg_temp.ni(314);
SELECT is((SELECT count(*)::int FROM public.notification_intents WHERE alert_id=pg_temp.ni(314)),1,'later new flag keeps prior event identity');
SELECT is((SELECT source_revision FROM public.notification_routing_exceptions WHERE alert_id=pg_temp.ni(314)),2::bigint,'new flag gets separate routing exception revision2');
SELECT throws_ok($q$UPDATE public.work_items SET assigned_to=pg_temp.ni(2),severity='warning' WHERE id=pg_temp.nw(303)$q$,
 'P0001','Combined source and ownership mutation is unsupported','unsupported combined owner/severity write rolls back');
SELECT is((SELECT assigned_to FROM public.work_items WHERE id=pg_temp.nw(303)),pg_temp.ni(1),'rejected combined write did not change owner');

-- Pre-existing work with the source identity: ON CONFLICT is not a created event.
INSERT INTO public.work_items(patient_id,provider_id,assigned_to,organization_id,source_type,source_id,title,reason,priority,severity,accountability_source)
 VALUES(pg_temp.ni(11),pg_temp.ni(1),pg_temp.ni(1),public.primary_organization_for_provider(pg_temp.ni(1)),
 'alert',pg_temp.ni(316),'Synthetic prior identity','Pre-existing source identity','today','critical','designated');
INSERT INTO public.alerts(id,patient_id,severity,flags,first_seen_at,last_seen_at)
 VALUES(pg_temp.ni(316),pg_temp.ni(11),'critical',ARRAY['conflict_fixture'],now(),now());
SELECT is((SELECT count(*)::int FROM public.notification_intents WHERE work_item_id=pg_temp.nw(316)),0,'conflict without INSERT RETURNING ID never mints created event');
SELECT is((SELECT count(*)::int FROM public.notification_intents WHERE work_item_id=pg_temp.nw(316,3)),1,'other organization actual INSERT captures independently');

-- Current authorization observations, no implicit grants. Fresh SQL clock is passed.
SELECT is(public.notification_capture_block_reason(public.primary_organization_for_provider(pg_temp.ni(1)),pg_temp.ni(11),pg_temp.ni(1),ARRAY['unmuted'],clock_timestamp()),NULL::text,'fully scoped fixture eligible');
UPDATE public.member_authorizations SET granted_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()-interval '1 second'
 WHERE capability='monitor' AND membership_id=(SELECT id FROM public.organization_memberships WHERE organization_id=public.primary_organization_for_provider(pg_temp.ni(1)) AND user_id=pg_temp.ni(1));
SELECT is(public.notification_capture_block_reason(public.primary_organization_for_provider(pg_temp.ni(1)),pg_temp.ni(11),pg_temp.ni(1),ARRAY['unmuted'],clock_timestamp()),'no_monitor_authorization','expired monitor is blocked');
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.ni(1) AND patient_id=pg_temp.ni(11);
SELECT is(public.notification_capture_block_reason(public.primary_organization_for_provider(pg_temp.ni(1)),pg_temp.ni(11),pg_temp.ni(1),ARRAY['unmuted'],clock_timestamp()),'no_active_link','revoked link is blocked');
UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.ni(11) AND consent_type='registration';
SELECT is(public.notification_capture_block_reason(public.primary_organization_for_provider(pg_temp.ni(1)),pg_temp.ni(11),pg_temp.ni(1),ARRAY['unmuted'],clock_timestamp()),'no_patient_scope','patient consent revocation blocks');
UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.ni(1) AND consent_type='registration';
SELECT is(public.notification_capture_block_reason(public.primary_organization_for_provider(pg_temp.ni(1)),pg_temp.ni(11),pg_temp.ni(1),ARRAY['unmuted'],clock_timestamp()),'inactive_member','recipient registration revocation blocks');
UPDATE public.organizations SET status='suspended' WHERE id=public.primary_organization_for_provider(pg_temp.ni(1));
SELECT is(public.notification_capture_block_reason((SELECT organization_id FROM initial_intents WHERE recipient_id=pg_temp.ni(1)),pg_temp.ni(11),pg_temp.ni(1),ARRAY['unmuted'],clock_timestamp()),'inactive_org','inactive organization blocks');

SELECT throws_ok($q$UPDATE public.notification_intents SET recipient_id=pg_temp.ni(3)$q$,'P0001','Notification history is immutable','historical recipients cannot be rewritten');
SELECT throws_ok($q$DELETE FROM public.notification_intents$q$,'P0001','Notification history is immutable','ordinary history delete denied even to fixture owner');
SELECT throws_ok($q$DELETE FROM public.notification_routing_exceptions$q$,'P0001','Notification history is immutable','ordinary routing evidence delete denied');
SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT * FROM public.notification_intents$q$,'42501',NULL,'actual service read denied until scoped operator slice');
SELECT throws_ok($q$SELECT public.capture_notification_intent(pg_temp.ni(999),'critical_created',1)$q$,'42501',NULL,'service cannot forge a captured event');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$DELETE FROM public.notification_intents$q$,'42501',NULL,'authenticated cannot erase ledger');
SELECT throws_ok($q$INSERT INTO public.notification_work_state VALUES(pg_temp.ni(999),1)$q$,'42501',NULL,'authenticated cannot forge counter');
RESET ROLE;
-- True API-role execution, not only catalog assertions. No fixture definer.
CREATE FUNCTION pg_temp.notification_api_denials() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE t text; key_column text;
BEGIN
 FOR t,key_column IN SELECT * FROM (VALUES('notification_source_state','alert_id'),('notification_work_state','work_item_id'),
   ('notification_intents','id'),('notification_routing_exceptions','id')) AS targets(table_name,key_name)
 LOOP
  RETURN NEXT throws_ok(format('SELECT * FROM public.%I LIMIT 0',t),'42501',NULL,current_user||' cannot read '||t);
  RETURN NEXT throws_ok(format('INSERT INTO public.%I DEFAULT VALUES',t),'42501',NULL,current_user||' cannot insert '||t);
  RETURN NEXT throws_ok(format('UPDATE public.%I SET %I=%I WHERE false',t,key_column,key_column),'42501',NULL,current_user||' cannot update '||t);
  RETURN NEXT throws_ok(format('DELETE FROM public.%I WHERE false',t),'42501',NULL,current_user||' cannot delete '||t);
  RETURN NEXT throws_ok(format('TRUNCATE public.%I',t),'42501',NULL,current_user||' cannot truncate '||t);
 END LOOP;
END;
$$;
SET LOCAL ROLE anon;
SELECT * FROM pg_temp.notification_api_denials();
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.notification_api_denials();
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT * FROM pg_temp.notification_api_denials();
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
