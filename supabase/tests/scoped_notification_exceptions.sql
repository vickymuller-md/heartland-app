-- Real00054 capture, minimized00055 read; entirely synthetic and rolled back.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
CREATE FUNCTION pg_temp.n(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('55000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.n(n),'notification-view-'||n||'@example.invalid','{"consent_accepted":true}'::jsonb
 FROM unnest(ARRAY[1,2,3,4,5,6,11,12,13]) n;
UPDATE public.profiles SET role='provider' WHERE id IN(pg_temp.n(1),pg_temp.n(2),pg_temp.n(3),pg_temp.n(4),pg_temp.n(5));
UPDATE public.profiles SET role='tester',sandbox_expires_at=now()+interval '1 day' WHERE id=pg_temp.n(6);
CREATE TEMP TABLE fixture_orgs AS SELECT n AS member_number,public.primary_organization_for_provider(pg_temp.n(n)) AS organization_id
 FROM generate_series(1,5) n;
CREATE FUNCTION pg_temp.org(n integer DEFAULT 1) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT organization_id FROM pg_temp.fixture_orgs WHERE member_number=n
$$;
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT pg_temp.n(provider),pg_temp.n(patient),'active',now() FROM (VALUES(1,11),(2,11),(2,12),(3,11),(3,13)) AS pairs(provider,patient);
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 SELECT pg_temp.org(),pg_temp.n(n),CASE WHEN n=4 THEN 'admin' ELSE 'clinician' END,'active',now(),pg_temp.n(1)
 FROM unnest(ARRAY[2,4]) n;
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by)
 VALUES(pg_temp.org(),pg_temp.n(12),pg_temp.n(1));
UPDATE public.organization_patient_assignments SET status='revoked',revoked_at=now() WHERE organization_id=pg_temp.org(2);
INSERT INTO public.patient_accountability(organization_id,patient_id,accountable_id,designated_by)
 SELECT pg_temp.org(),pg_temp.n(n),pg_temp.n(2),pg_temp.n(1) FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',user_id FROM public.organization_memberships WHERE user_id IN(pg_temp.n(1),pg_temp.n(2),pg_temp.n(3)) AND status='active';
INSERT INTO public.alert_preferences(provider_id,patient_id,alert_type,muted) VALUES(pg_temp.n(2),pg_temp.n(11),'weight_gain',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.alerts(id,patient_id,severity,flags,first_seen_at,last_seen_at)
 SELECT pg_temp.n(n),pg_temp.n(11),'critical',ARRAY[CASE WHEN n=302 THEN 'weight_gain' ELSE 'private_synthetic_flag' END],now(),now()
 FROM generate_series(301,332) n;
INSERT INTO public.alerts(id,patient_id,severity,flags,first_seen_at,last_seen_at)
 SELECT pg_temp.n(n),pg_temp.n(12),'critical',ARRAY['hidden_flag'],now(),now() FROM generate_series(401,404) n;
INSERT INTO public.alerts(id,patient_id,severity,flags,first_seen_at,last_seen_at)
 VALUES(pg_temp.n(501),pg_temp.n(13),'critical',ARRAY['other_org_flag'],now(),now());
CREATE FUNCTION pg_temp.work(n integer) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT id FROM public.work_items WHERE source_id=pg_temp.n(n) AND organization_id=pg_temp.org()
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n(2),'role','authenticated','aal','aal2')::text,true);
UPDATE public.work_items SET status='closed',outcome='Synthetic reviewed disposition',outcome_code='clinical_action_taken' WHERE id=pg_temp.work(301);
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.alerts SET occurrence_count=occurrence_count+1 WHERE id=pg_temp.n(301);
UPDATE public.alerts SET flags=flags||ARRAY['additional_private_flag'] WHERE id=pg_temp.n(303);
-- Restoring preference must not rewrite a capture-time block or turn it into a current decision.
UPDATE public.alert_preferences SET muted=false WHERE provider_id=pg_temp.n(2);
SELECT is((SELECT state FROM public.notification_intents WHERE work_item_id=pg_temp.work(301)),'cancelled','fixture has true cancelled intent');
SELECT is((SELECT blocked_reason FROM public.notification_intents WHERE work_item_id=pg_temp.work(302)),'blocked_preference','fixture keeps actual historic preference block');
SELECT is((SELECT count(*)::int FROM public.notification_routing_exceptions WHERE organization_id=pg_temp.org()),2,'real closed/new-flag routing fixtures');

CREATE FUNCTION pg_temp.ledger_snapshot() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
 'intents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.notification_intents t),
 'routing',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.notification_routing_exceptions t),
 'source',(SELECT jsonb_agg(to_jsonb(t) ORDER BY alert_id) FROM public.notification_source_state t),
 'generation',(SELECT jsonb_agg(to_jsonb(t) ORDER BY work_item_id) FROM public.notification_work_state t),
 'work',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.work_items t),
 'events',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.work_item_events t),
 'alerts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.alerts t))
$$;
CREATE TEMP TABLE before_read AS SELECT pg_temp.ledger_snapshot() saved;
CREATE TEMP TABLE pages(label text PRIMARY KEY,result jsonb);
GRANT ALL ON pages TO authenticated;
CREATE FUNCTION pg_temp.page(p_after text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.get_operational_exceptions(pg_temp.org(),p_after,25)
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n(1),'role','authenticated','aal','aal2')::text,true);
INSERT INTO pages VALUES('first',pg_temp.page());
INSERT INTO pages VALUES('second',pg_temp.page((SELECT result->>'next_cursor' FROM pages WHERE label='first')));
SELECT is((SELECT jsonb_array_length(result->'items') FROM pages WHERE label='first'),25,'notification first page bounded after scope');
SELECT is((SELECT count(*)::int FROM pages,jsonb_array_elements(result->'items') row WHERE row->>'category'='notification'),31,'31 visible unsent intents across pages');
SELECT is((SELECT count(DISTINCT row->>'key')::int FROM pages,jsonb_array_elements(result->'items') row WHERE row->>'category'='notification'),31,'no duplicate notification keys');
SELECT is((SELECT count(*)::int FROM pages,jsonb_array_elements(result->'items') row WHERE row->>'category'='notification_routing'),2,'both routing records accessible');
SELECT is((SELECT row->>'state' FROM pages,jsonb_array_elements(result->'items') row
 WHERE row->>'work_item_id'=pg_temp.work(302)::text AND row->>'category'='notification'),'blocked','blocked is not pending or sent');
SELECT is((SELECT row->'reasons' FROM pages,jsonb_array_elements(result->'items') row
 WHERE row->>'work_item_id'=pg_temp.work(302)::text AND row->>'category'='notification'),
 '["critical_created","captured_blocked_preference"]'::jsonb,'historic reason explicitly contextualized after preference restored');
SELECT is((SELECT count(*)::int FROM pages,jsonb_array_elements(result->'items') row
 WHERE row->>'work_item_id'=pg_temp.work(301)::text AND row->>'category'='notification'),0,'cancelled not projected as current pending');
SELECT is((SELECT result#>>'{counts,notification}' FROM pages WHERE label='first'),'35','manager count includes four hidden patient records');
SELECT is((SELECT result#>>'{counts,notification_routing}' FROM pages WHERE label='first'),'2','manager counts only own organization routing');
SELECT is((SELECT count(*)::int FROM jsonb_each((SELECT result->'counts' FROM pages WHERE label='first'))),8,'exact eight-count schema');
SELECT ok((SELECT bool_and(jsonb_typeof(value)='number') FROM pages,jsonb_each(result->'counts')),'counts only numbers');
SELECT ok((SELECT bool_and(result::text NOT LIKE '%'||pg_temp.n(12)::text||'%'
 AND result::text NOT LIKE '%'||pg_temp.n(13)::text||'%' AND result::text NOT LIKE '%private_flag%'
 AND result::text NOT LIKE '%recipient%' AND result::text NOT LIKE '%source_revision%'
 AND result::text NOT LIKE '%endpoint%' AND result::text NOT LIKE '%payload%') FROM pages),'no hidden identity, recipient, values or payload');
SELECT ok((SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(row) k)
 =ARRAY['category','key','patient_id','reasons','recorded_at','state','work_item_id'])
 FROM pages,jsonb_array_elements(result->'items') row),'exact seven-field row shape');
-- Query tail after notification keys: hidden rows cannot produce a cursor or empty intermediate page.
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(pg_temp.page('notification:zzzz')->'items') row
 WHERE row->>'category'='notification_routing'),2,'routing remains separate from notification category');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n(4),'role','authenticated','aal','aal2')::text,true);
SELECT is(pg_temp.page()->>'detail_authorized','false','manager with no monitor grant has counts only');
SELECT is(pg_temp.page()#>>'{counts,notification}','35','unlinked ungranted manager gets identifier-free totals');
SELECT is(pg_temp.page()->'items','[]'::jsonb,'unlinked manager receives no records');
SELECT is(pg_temp.page()->'next_cursor','null'::jsonb,'unlinked manager receives no cursor');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n(2),'role','authenticated','aal','aal2')::text,true);
SELECT is(pg_temp.page()->'counts','null'::jsonb,'ordinary monitor cannot see organization aggregates');
SELECT is(jsonb_array_length(pg_temp.page()->'items'),25,'ordinary linked monitor has scoped detail');
RESET ROLE;
SELECT is(pg_temp.ledger_snapshot(),(SELECT saved FROM before_read),'all read paths leave seven source/work/notification ledgers unchanged');

-- New helper and all notification tables remain private, even for service role.
SELECT ok(NOT has_function_privilege(r,'public.operational_monitor_current(uuid,uuid,timestamp with time zone)','EXECUTE'),r||' cannot call current-monitor helper')
 FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SET LOCAL ROLE anon;
SELECT throws_ok($q$SELECT public.get_operational_exceptions('55000000-0000-4000-8000-000000000001')$q$,'42501',NULL,'anon cannot invoke RPC');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT public.get_operational_exceptions('55000000-0000-4000-8000-000000000001')$q$,'42501',NULL,'service cannot invoke human RPC');
SELECT throws_ok($q$SELECT * FROM public.notification_intents$q$,'42501',NULL,'service cannot read raw intents');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT * FROM public.notification_routing_exceptions$q$,'42501',NULL,'authenticated cannot read raw routing');
SELECT throws_ok($q$SELECT public.operational_monitor_current('55000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001',clock_timestamp())$q$,'42501',NULL,'authenticated cannot call helper');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n(1),'role','authenticated','aal','aal1')::text,true);
SELECT throws_ok($q$SELECT pg_temp.page()$q$,'42501','Operational exceptions not authorized','AAL1 denied with notification records present');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n(11),'role','authenticated','aal','aal2')::text,true);
SELECT throws_ok($q$SELECT pg_temp.page()$q$,'42501','Operational exceptions not authorized','patient denied');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n(6),'role','authenticated','aal','aal2')::text,true);
SELECT throws_ok($q$SELECT pg_temp.page()$q$,'42501','Operational exceptions not authorized','tester denied');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n(5),'role','authenticated','aal','aal2')::text,true);
SELECT throws_ok($q$SELECT pg_temp.page()$q$,'42501','Operational exceptions not authorized','outsider denied');
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n(1),'role','authenticated','aal','aal2')::text,true);
UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.n(1);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.page()$q$,'42501','Operational exceptions not authorized','provider registration revoked');
RESET ROLE;
UPDATE public.consents SET accepted=true WHERE user_id=pg_temp.n(1);
UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.n(11);
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.page()->'items','[]'::jsonb,'patient registration revoked hides notification and routing');
SELECT is(pg_temp.page()->'next_cursor','null'::jsonb,'revoked patient leaves no cursor');
RESET ROLE;
UPDATE public.consents SET accepted=true WHERE user_id=pg_temp.n(11);
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.n(1);
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.page()->'items','[]'::jsonb,'revoked direct link hides all detail');
RESET ROLE;
UPDATE public.provider_patient_links SET status='active' WHERE provider_id=pg_temp.n(1);
UPDATE public.organization_patient_assignments SET status='revoked',revoked_at=now() WHERE organization_id=pg_temp.org() AND patient_id=pg_temp.n(11);
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.page()->'items','[]'::jsonb,'revoked organization patient assignment hides both categories');
RESET ROLE;
UPDATE public.organization_patient_assignments SET status='active',revoked_at=NULL WHERE organization_id=pg_temp.org() AND patient_id=pg_temp.n(11);
UPDATE public.member_authorizations SET revoked_at=now() WHERE membership_id IN(SELECT id FROM public.organization_memberships WHERE organization_id=pg_temp.org() AND user_id=pg_temp.n(1));
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.page()->>'detail_authorized','false','revoked monitor disables detail flag');
SELECT is(pg_temp.page()->'items','[]'::jsonb,'revoked monitor hides records');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE membership_id IN(SELECT id FROM public.organization_memberships WHERE organization_id=pg_temp.org() AND user_id=pg_temp.n(1));
UPDATE public.organization_memberships SET status='revoked' WHERE organization_id=pg_temp.org() AND user_id=pg_temp.n(1);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.page()$q$,'42501','Operational exceptions not authorized','inactive membership denies RPC');
RESET ROLE;
UPDATE public.organization_memberships SET status='active' WHERE organization_id=pg_temp.org() AND user_id=pg_temp.n(1);
UPDATE public.organizations SET status='suspended' WHERE id=pg_temp.org();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.page()$q$,'42501','Operational exceptions not authorized','inactive organization denies RPC');
RESET ROLE;
UPDATE public.organizations SET status='active' WHERE created_by=pg_temp.n(1);

-- Transaction now() deliberately still precedes expiry. No sleep or network needed:
-- midpoint of transaction start and actual clock is already in the past at the next read.
UPDATE public.member_authorizations SET granted_at=now()-interval '1 day',
 expires_at=now()+(clock_timestamp()-now())/2
 WHERE membership_id IN(SELECT id FROM public.organization_memberships WHERE organization_id=pg_temp.org() AND user_id IN(pg_temp.n(1),pg_temp.n(2)));
SELECT ok((SELECT bool_and(expires_at>now() AND expires_at<clock_timestamp()) FROM public.member_authorizations
 WHERE membership_id IN(SELECT id FROM public.organization_memberships WHERE organization_id=pg_temp.org() AND user_id IN(pg_temp.n(1),pg_temp.n(2)))),'fixture proves clock crossed expiry inside the same transaction');
SELECT ok(public.member_capability_granted('monitor',pg_temp.org(),pg_temp.n(1)),'old now-based lookup would still allow monitor');
SELECT ok(NOT public.operational_exception_detail_allowed(pg_temp.org(),pg_temp.n(11)),'detail predicate independently rejects clock-expired grant');
SELECT ok((SELECT bool_and('no_monitor_authorization'=ANY(reasons)) FROM public.operational_exception_rows(pg_temp.org()) WHERE category='ownership'),'ownership reasons use current clock for assigned member');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.page()->>'detail_authorized','false','operator flag uses server clock, not transaction start');
SELECT is(pg_temp.page()->'items','[]'::jsonb,'clock-expired manager receives no detail');
SELECT is(pg_temp.page()->'next_cursor','null'::jsonb,'clock-expired manager receives no cursor');
SELECT is(pg_temp.page()#>>'{counts,notification}','35','expired manager still receives permitted numeric totals');
SELECT is((SELECT count(*)::int FROM public.get_unowned_work(pg_temp.org())),0,'legacy ownership RPC also denies clock-expired access');
RESET ROLE;
SELECT is(pg_temp.ledger_snapshot(),(SELECT saved FROM before_read),'scope revocation/read tests never mutated notification or clinical ledgers');

-- Real dispatch RPCs replace capture-only labels without broadening human scope.
UPDATE member_authorizations SET expires_at=NULL WHERE membership_id IN
 (SELECT id FROM organization_memberships WHERE organization_id=pg_temp.org() AND user_id IN(pg_temp.n(1),pg_temp.n(2)));
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE FUNCTION pg_temp.dispatch_fixture(n integer,outcome text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e uuid; c jsonb; a jsonb;
BEGIN
 SELECT id INTO e FROM notification_intents WHERE work_item_id=pg_temp.work(n);
 c:=claim_notification_dispatch(e);
 IF outcome='pending' THEN RETURN; END IF;
 a:=prepare_notification_dispatch(e,(c->>'token')::uuid,(c->>'version')::bigint,outcome<>'blocked');
 IF outcome='blocked' THEN RETURN; END IF;
 PERFORM start_notification_dispatch(e,(a->>'id')::uuid,(c->>'token')::uuid,(c->>'version')::bigint,true);
 IF outcome='sending' THEN RETURN; END IF;
 PERFORM finish_notification_dispatch(e,(a->>'id')::uuid,(c->>'token')::uuid,(c->>'version')::bigint,outcome,
  CASE outcome WHEN 'accepted' THEN 'accepted' ELSE 'timeout' END,CASE WHEN outcome='accepted' THEN 202 END);
END $$;
SELECT pg_temp.dispatch_fixture(n,state) FROM (VALUES(304,'blocked'),(305,'sending'),(306,'accepted'),(307,'unknown'),(308,'pending')) fixture(n,state);
CREATE TEMP TABLE dispatch_before_read AS SELECT jsonb_build_object(
 'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY intent_id) FROM notification_dispatches q),
 'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM notification_dispatch_attempts a),
 'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM notification_dispatch_events e)) saved;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n(1),'role','authenticated','aal','aal2')::text,true);
SET LOCAL ROLE authenticated;
DELETE FROM pages;
INSERT INTO pages VALUES('dispatch-first',pg_temp.page());
INSERT INTO pages VALUES('dispatch-second',pg_temp.page((SELECT result->>'next_cursor' FROM pages WHERE label='dispatch-first')));
SELECT is((SELECT row->'reasons' FROM pages,jsonb_array_elements(result->'items') row WHERE row->>'work_item_id'=pg_temp.work(304)::text AND row->>'category'='notification'),
 '["critical_created","transport_blocked","dispatch_configuration"]'::jsonb,'configuration block reaches human projection');
SELECT is((SELECT row->>'state' FROM pages,jsonb_array_elements(result->'items') row WHERE row->>'work_item_id'=pg_temp.work(n)::text AND row->>'category'='notification'),
 state,'human projection retains actual '||state) FROM (VALUES(305,'sending'),(306,'accepted'),(307,'unknown'),(308,'pending')) fixture(n,state);
SELECT ok((SELECT bool_and(result::text NOT LIKE '%endpoint%' AND result::text NOT LIKE '%lease_token%' AND result::text NOT LIKE '%recipient_id%') FROM pages),'dispatch projection does not expose contact or lease');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n(4),'role','authenticated','aal','aal2')::text,true);
SELECT is(pg_temp.page()->'items','[]'::jsonb,'aggregate-only manager cannot read transport detail');
SELECT is(pg_temp.page()#>>'{counts,notification}','35','transport outcomes preserve scoped aggregate total');
RESET ROLE;
SELECT is(jsonb_build_object(
 'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY intent_id) FROM notification_dispatches q),
 'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM notification_dispatch_attempts a),
 'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM notification_dispatch_events e)),(SELECT saved FROM dispatch_before_read),
 'reading transport projection never mutates queue, attempts or evidence');
SELECT * FROM finish();
ROLLBACK;
