-- N2p2: real triggers/indexes/RLS with synthetic SQL claims, never a hosted run.
-- The transaction rolls back every fixture. Two-connection insert contention is
-- a separate local rehearsal receipt; this sequential suite is not that proof.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

CREATE FUNCTION pg_temp.n2id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('43000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- FIXTURE BEGIN: also reused in an isolated, committed contention rehearsal.
INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT pg_temp.n2id(n), 'n2p2-' || n || '@example.invalid', '{"consent_accepted":true}'::jsonb
FROM unnest(ARRAY[1,2,3,4,5,6,7,101,102,103]) AS n;
UPDATE public.profiles SET role = 'provider', full_name = 'Synthetic N2p2 provider'
WHERE id IN (SELECT pg_temp.n2id(n) FROM generate_series(1,6) AS n);
UPDATE public.organization_memberships SET status = 'revoked', is_default = false
WHERE user_id IN (SELECT pg_temp.n2id(n) FROM generate_series(1,6) AS n);
UPDATE public.organizations SET status = 'suspended'
WHERE is_personal AND created_by IN (SELECT pg_temp.n2id(n) FROM generate_series(1,6) AS n);

INSERT INTO public.organizations(id, name, created_by) VALUES
 (pg_temp.n2id(201), 'N2p2 organization A', pg_temp.n2id(5)),
 (pg_temp.n2id(202), 'N2p2 organization B', pg_temp.n2id(5)),
 (pg_temp.n2id(203), 'N2p2 outside organization', pg_temp.n2id(4));
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,is_default,joined_at,created_by)
SELECT pg_temp.n2id(org), pg_temp.n2id(member), role, status, is_default, now(), pg_temp.n2id(5)
FROM (VALUES
 (201,1,'clinician','active',true), (202,1,'clinician','active',false),
 (201,2,'clinician','active',true), (202,2,'clinician','active',false),
 (202,3,'clinician','active',true), (203,4,'owner','active',true),
 (201,5,'owner','active',true), (202,5,'owner','active',false),
 (201,6,'clinician','revoked',false), (201,7,'clinician','active',false)
) AS m(org,member,role,status,is_default);
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by)
SELECT pg_temp.n2id(org), pg_temp.n2id(patient), pg_temp.n2id(5)
FROM unnest(ARRAY[201,202]) AS org CROSS JOIN unnest(ARRAY[101,102,103]) AS patient;
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
SELECT pg_temp.n2id(member), pg_temp.n2id(patient), 'active', now()
FROM unnest(ARRAY[1,2,3,4,6,7]) AS member CROSS JOIN unnest(ARRAY[101,102,103]) AS patient;
-- The outsider link provisions its own patient scope; revoke that scope so the
-- outsider cannot become a third, legitimate organization in these scenarios.
UPDATE public.organization_patient_assignments SET status='revoked', revoked_at=now()
WHERE organization_id=pg_temp.n2id(203);
INSERT INTO public.patient_accountability(organization_id,patient_id,accountable_id,designated_by) VALUES
 (pg_temp.n2id(201),pg_temp.n2id(101),pg_temp.n2id(1),pg_temp.n2id(5)),
 (pg_temp.n2id(202),pg_temp.n2id(101),pg_temp.n2id(1),pg_temp.n2id(5)),
 (pg_temp.n2id(201),pg_temp.n2id(102),pg_temp.n2id(1),pg_temp.n2id(5));
-- Transfer actors have explicit fixture authority; resolver scenarios are unchanged.
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',pg_temp.n2id(5) FROM public.organization_memberships
 WHERE organization_id IN(pg_temp.n2id(201),pg_temp.n2id(202))
 AND user_id IN(pg_temp.n2id(1),pg_temp.n2id(2)) AND status='active';
-- FIXTURE END

SELECT ok(to_regclass('public.work_items_source_unique') IS NULL, 'old cross-organization alert arbiter removed');
SELECT has_index('public','work_items','work_items_non_alert_source_unique','non-alert identity index exists');
SELECT has_index('public','work_items','work_items_alert_org_source_unique','alert identity index exists');
SELECT has_index('public','work_items','work_items_one_accountable_per_alert','canonical accountable index retained');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE oid IN (
 'public.sync_alert_work_items()'::regprocedure,
 'public.sync_scheduled_followup_work_item()'::regprocedure,
 'public.sync_discharge_followup_work_item()'::regprocedure)
 AND prosecdef AND proconfig=ARRAY['search_path=""']),3,'all three writers retain definer and empty search_path');
SELECT ok(NOT has_function_privilege('authenticated','public.sync_alert_work_items()','EXECUTE'),
 'authenticated cannot execute the trigger function');

SELECT lives_ok($q$INSERT INTO public.alerts(id,patient_id,severity,flags,status,first_seen_at,last_seen_at)
 VALUES(pg_temp.n2id(301),pg_temp.n2id(101),'critical',ARRAY['weight_gain'],'open',now(),now())$q$,
 'one new alert creates accountable items with the same provider in two organizations');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id=pg_temp.n2id(301)),2,'both organization items exist');
SELECT is((SELECT count(DISTINCT organization_id)::int FROM public.work_items WHERE source_id=pg_temp.n2id(301)),2,'organizations remain distinct');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id=pg_temp.n2id(301)
 AND provider_id=pg_temp.n2id(1) AND assigned_to=pg_temp.n2id(1) AND accountability_source='designated'),2,
 'both retain designated responsibility without implicit acceptance');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id=pg_temp.n2id(301) AND accepted_at IS NOT NULL),0,'creation does not accept work');

SELECT lives_ok($q$INSERT INTO public.alerts(id,patient_id,severity,flags,status,first_seen_at,last_seen_at)
 VALUES(pg_temp.n2id(302),pg_temp.n2id(102),'warning',ARRAY['bp_low'],'open',now(),now())$q$,
 'mixed accountable and fallback branches do not collide');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id=pg_temp.n2id(302) AND organization_id=pg_temp.n2id(201)),1,'organization A has only its accountable item');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id=pg_temp.n2id(302)
 AND organization_id=pg_temp.n2id(202) AND accountability_source='legacy_fan_out'),3,'organization B has three scoped fallback items');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id=pg_temp.n2id(302)
 AND provider_id=pg_temp.n2id(1)),2,'shared member gets distinct accountable and fallback identities');

SELECT lives_ok($q$INSERT INTO public.alerts(id,patient_id,severity,flags,status,first_seen_at,last_seen_at)
 VALUES(pg_temp.n2id(303),pg_temp.n2id(103),'critical',ARRAY['potassium_high'],'open',now(),now())$q$,
 'fallback works in both organizations regardless of provider default');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id=pg_temp.n2id(303) AND organization_id=pg_temp.n2id(201)),2,'A receives its two active linked providers');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id=pg_temp.n2id(303) AND organization_id=pg_temp.n2id(202)),3,'B receives its three active linked providers');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id IN (pg_temp.n2id(301),pg_temp.n2id(302),pg_temp.n2id(303))
 AND provider_id IN (pg_temp.n2id(4),pg_temp.n2id(6),pg_temp.n2id(7))),0,'outside, revoked and non-provider members receive no fallback work');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id=pg_temp.n2id(303) AND accountability_source IS DISTINCT FROM 'legacy_fan_out'),0,'new fallback labels never become NULL or accountable');

-- Helper uses the actual accountable conflict target; every allowed origin must
-- find the SAME canonical row even if provider_id differs. No targetless ignore.
CREATE FUNCTION pg_temp.n2accountable(label text, source integer DEFAULT 301) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.work_items(patient_id,provider_id,assigned_to,organization_id,source_type,source_id,
 title,reason,priority,severity,accountability_source)
 VALUES(pg_temp.n2id(101),pg_temp.n2id(2),pg_temp.n2id(2),pg_temp.n2id(201),'alert',pg_temp.n2id(source),
 'Identity test','Synthetic accountable conflict','today','warning',label)
 ON CONFLICT (organization_id,source_id) WHERE source_type='alert' AND source_id IS NOT NULL
 AND accountability_source IN ('designated','coverage','sole_member','org_owner','accepted_transfer','manager_reassigned')
 DO NOTHING
$$;
SELECT lives_ok(format('SELECT pg_temp.n2accountable(%L)',label),'accountable arbiter recognizes origin '||label)
FROM unnest(ARRAY['designated','coverage','sole_member','org_owner','accepted_transfer','manager_reassigned']) AS label;
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id=pg_temp.n2id(301)),2,'six repeat origins never create another accountable item');
SELECT throws_ok($q$SELECT pg_temp.n2accountable('unsupported_origin')$q$,'23514',NULL,'targeted conflict does not hide a CHECK violation');
SELECT throws_ok($q$INSERT INTO public.work_items(patient_id,provider_id,assigned_to,organization_id,source_type,source_id,title,reason,priority,severity,accountability_source)
 VALUES(pg_temp.n2id(103),pg_temp.n2id(1),pg_temp.n2id(1),pg_temp.n2id(201),'alert',pg_temp.n2id(303),'Duplicate fallback','Synthetic duplicate','now','critical','legacy_fan_out')$q$,
 '23505',NULL,'same provider organization and fallback alert cannot duplicate');

-- NULL legacy and labelled fallback rows remain outside accountable uniqueness.
SELECT lives_ok($q$INSERT INTO public.work_items(patient_id,provider_id,assigned_to,organization_id,source_type,source_id,title,reason,priority,severity)
 VALUES(pg_temp.n2id(101),pg_temp.n2id(2),pg_temp.n2id(2),pg_temp.n2id(201),'alert',pg_temp.n2id(301),'Historical fixture','Synthetic NULL legacy','today','warning')$q$,
 'a distinct historical NULL item can coexist with the accountable item');
INSERT INTO public.work_items(patient_id,provider_id,assigned_to,organization_id,source_type,source_id,title,reason,priority,severity)
VALUES
 (pg_temp.n2id(101),pg_temp.n2id(2),pg_temp.n2id(2),pg_temp.n2id(201),'alert',pg_temp.n2id(304),'Historical fixture','Synthetic NULL-only legacy','today','warning');
CREATE TEMP TABLE n2_legacy_snapshot AS SELECT to_jsonb(w) AS row FROM public.work_items w
WHERE source_id=pg_temp.n2id(301) AND accountability_source IS NULL;
SELECT is((SELECT count(*)::int FROM n2_legacy_snapshot),1,'NULL legacy coexists with the canonical item');
-- No canonical row exists for 304: the generic index is the ONLY conflict.
SELECT throws_ok($q$SELECT pg_temp.n2accountable('designated',304)$q$,'23505',NULL,
 'a generic legacy-identity collision is not silently converted or ignored');

-- Real transfer RPC: provider_id is immutable; assigned_to changes only in A.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n2id(1),'role','authenticated','aal','aal2')::text,true);
SELECT lives_ok($q$SELECT public.offer_work_item_transfer((SELECT id FROM public.work_items WHERE source_id=pg_temp.n2id(301) AND organization_id=pg_temp.n2id(201) AND accountability_source='designated'),pg_temp.n2id(2),'Synthetic transfer')$q$,
 'accountable member offers a transfer');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n2id(2),'role','authenticated','aal','aal2')::text,true);
SELECT lives_ok($q$SELECT public.accept_work_item_transfer((SELECT id FROM public.work_items WHERE source_id=pg_temp.n2id(301) AND organization_id=pg_temp.n2id(201) AND accountability_source='designated'))$q$,
 'recipient accepts without colliding with own legacy row');
RESET ROLE;
SELECT set_config('request.jwt.claims',NULL,true);
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id=pg_temp.n2id(301)
 AND organization_id=pg_temp.n2id(201) AND provider_id=pg_temp.n2id(1) AND assigned_to=pg_temp.n2id(2)
 AND accepted_by=pg_temp.n2id(2) AND accountability_source='accepted_transfer'),1,'transfer preserves original provider identity');
SELECT is((SELECT assigned_to FROM public.work_items WHERE source_id=pg_temp.n2id(301) AND organization_id=pg_temp.n2id(202)),pg_temp.n2id(1),'other organization assignment is unaffected');
SELECT is((SELECT to_jsonb(w) FROM public.work_items w WHERE source_id=pg_temp.n2id(301) AND accountability_source IS NULL),
 (SELECT row FROM n2_legacy_snapshot),'historical row is byte-for-field unchanged by another item transfer');

-- Follow-up identity does not widen, even when primary organization changes.
INSERT INTO public.scheduled_followups(id,patient_id,provider_id,scheduled_at,type)
VALUES(pg_temp.n2id(401),pg_temp.n2id(101),pg_temp.n2id(1),now()+interval '2 days','Synthetic follow-up');
INSERT INTO public.discharge_records(id,patient_id,provider_id,discharged_at,facility_tier)
VALUES(pg_temp.n2id(410),pg_temp.n2id(101),pg_temp.n2id(1),now(),1);
INSERT INTO public.discharge_followups(id,discharge_record_id,patient_id,provider_id,type,label,due_at)
VALUES(pg_temp.n2id(402),pg_temp.n2id(410),pg_temp.n2id(101),pg_temp.n2id(1),'call_48h','Synthetic discharge follow-up',now()+interval '2 days');
CREATE TEMP TABLE n2_followup_identity AS SELECT id,organization_id,provider_id,source_type,source_id FROM public.work_items
WHERE source_id IN (pg_temp.n2id(401),pg_temp.n2id(402));
UPDATE public.organization_memberships SET is_default=false WHERE user_id=pg_temp.n2id(1) AND is_default;
UPDATE public.organization_memberships SET is_default=true WHERE user_id=pg_temp.n2id(1) AND organization_id=pg_temp.n2id(202);
SELECT is(public.primary_organization_for_provider(pg_temp.n2id(1)),pg_temp.n2id(202),'provider primary organization actually changed to B');
SELECT lives_ok($q$UPDATE public.scheduled_followups SET scheduled_at=scheduled_at+interval '1 day' WHERE id=pg_temp.n2id(401)$q$,'scheduled follow-up still updates');
SELECT lives_ok($q$UPDATE public.discharge_followups SET due_at=due_at+interval '1 day' WHERE id=pg_temp.n2id(402)$q$,'discharge follow-up still updates');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id IN (pg_temp.n2id(401),pg_temp.n2id(402))),2,'no duplicate follow-up created');
SELECT is((SELECT count(*)::int FROM public.work_items w JOIN n2_followup_identity s
 USING(id,organization_id,provider_id,source_type,source_id)),2,'both original identities and organizations remain');
SELECT lives_ok($q$UPDATE public.scheduled_followups SET completed=true WHERE id=pg_temp.n2id(401)$q$,'scheduled follow-up completion still works');
SELECT lives_ok($q$UPDATE public.discharge_followups SET status='skipped' WHERE id=pg_temp.n2id(402)$q$,'discharge skipped disposition still works');
SELECT is((SELECT outcome_code FROM public.work_items WHERE source_id=pg_temp.n2id(401)),'followup_completed','scheduled outcome remains structured');
SELECT is((SELECT outcome_code FROM public.work_items WHERE source_id=pg_temp.n2id(402)),'followup_skipped','discharge outcome remains structured');

-- Non-alert uniqueness also protects other source types with a source_id.
INSERT INTO public.work_items(patient_id,provider_id,assigned_to,organization_id,source_type,source_id,title,reason,priority,severity)
VALUES(pg_temp.n2id(101),pg_temp.n2id(1),pg_temp.n2id(1),pg_temp.n2id(201),'manual',pg_temp.n2id(450),'Manual identity','Synthetic identity fixture','watching','informational');
SELECT throws_ok($q$INSERT INTO public.work_items(patient_id,provider_id,assigned_to,organization_id,source_type,source_id,title,reason,priority,severity)
 VALUES(pg_temp.n2id(101),pg_temp.n2id(1),pg_temp.n2id(1),pg_temp.n2id(202),'manual',pg_temp.n2id(450),'Manual identity','Synthetic identity fixture','watching','informational')$q$,
 '23505',NULL,'non-alert identity does not widen by organization');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n2id(4),'role','authenticated','aal','aal2')::text,true);
SELECT is((SELECT count(*)::int FROM public.work_items),0,'linked outside provider cannot read organization A/B work');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.n2id(1),'role','authenticated','aal','aal1')::text,true);
SELECT is((SELECT count(*)::int FROM public.work_items),0,'organization identity does not bypass AAL2');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
