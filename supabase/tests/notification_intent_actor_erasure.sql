-- Actor-only cleanup compatibility, NOT recipient/patient erasure or retention.
-- Third-party tester receipts are privileged fixtures, not authorization for a
-- tester to submit clinical observations. All data and erasures are rolled back.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
CREATE FUNCTION pg_temp.ne(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('56000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.ne(n),'intent-erasure-'||n||'@example.invalid',
 CASE WHEN n>=21 THEN '{"signup_intent":"sandbox","consent_accepted":true}'::jsonb ELSE '{"consent_accepted":true}'::jsonb END
 FROM unnest(ARRAY[1,11,12,13,21,22,23,24]) AS n;
UPDATE public.profiles SET role='provider' WHERE id=pg_temp.ne(1);
UPDATE public.profiles SET sandbox_expires_at=now()-interval '1 day' WHERE id IN(pg_temp.ne(21),pg_temp.ne(22),pg_temp.ne(23));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT pg_temp.ne(1),pg_temp.ne(n),'active',now() FROM unnest(ARRAY[11,12,13]) AS n;
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',user_id FROM public.organization_memberships WHERE user_id=pg_temp.ne(1) AND status='active';
INSERT INTO public.alert_preferences(provider_id,patient_id,alert_type,muted)
 VALUES(pg_temp.ne(1),pg_temp.ne(12),'low_egfr',true);
INSERT INTO public.lab_results(id,patient_id,collected_at,egfr)
 SELECT pg_temp.ne(100+n),pg_temp.ne(n),now(),14 FROM unnest(ARRAY[11,12,13]) AS n;
INSERT INTO public.lab_submission_receipts(actor_id,patient_id,request_id,payload,lab_result_id)
 SELECT pg_temp.ne(n+10),pg_temp.ne(n),pg_temp.ne(n+200),'{"egfr":14}'::jsonb,pg_temp.ne(n+100) FROM unnest(ARRAY[11,12,13]) AS n;
INSERT INTO public.lab_submission_attempts(actor_id,patient_id,request_id,closed_status,closed_at,acknowledged_lab_result_id)
 SELECT pg_temp.ne(n+10),pg_temp.ne(n),pg_temp.ne(n+200),'acknowledged',now(),pg_temp.ne(n+100) FROM unnest(ARRAY[11,12,13]) AS n;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is((SELECT status FROM public.process_lab_alert_event(pg_temp.ne(n+100))),'recorded','third-party lab processed for patient '||n)
 FROM unnest(ARRAY[11,12,13]) AS n;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ne(1),'role','authenticated','aal','aal2')::text,true);
UPDATE public.work_items SET status='closed',outcome='Synthetic closed task',outcome_code='clinical_action_taken' WHERE patient_id=pg_temp.ne(13);
RESET ROLE;
SELECT results_eq('SELECT state FROM public.notification_intents ORDER BY patient_id',
 $$SELECT unnest(ARRAY['pending','blocked','cancelled'])$$,'three lifecycle states exist before tester erasure');
SELECT is((SELECT blocked_reason FROM public.notification_intents WHERE patient_id=pg_temp.ne(12)),'blocked_preference','blocked fixture uses actual recipient preference');
CREATE TEMP TABLE preserved_intents AS SELECT * FROM public.notification_intents;
CREATE TEMP TABLE preserved_work AS SELECT * FROM public.work_items;
CREATE TEMP TABLE preserved_sources AS SELECT * FROM public.lab_alert_sources;
CREATE TEMP TABLE preserved_alerts AS SELECT * FROM public.alerts;
CREATE TEMP TABLE preserved_labs AS SELECT * FROM public.lab_results;
SELECT throws_ok(format('DELETE FROM auth.users WHERE id=%L',pg_temp.ne(n)),
 '23503',NULL,'actor '||n||' remains protected before provenance purge') FROM unnest(ARRAY[21,22,23]) AS n;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.purge_expired_tester_provenance(pg_temp.ne(21))$q$,'42501',NULL,'human cannot invoke cleanup');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$SELECT public.purge_expired_tester_provenance(pg_temp.ne(24))$q$,'42501',NULL,'active tester remains protected');
SELECT throws_ok($q$SELECT public.purge_expired_tester_provenance(pg_temp.ne(1))$q$,'42501',NULL,'provider cannot use tester erasure');
SELECT lives_ok(format('SELECT public.purge_expired_tester_provenance(%L)',pg_temp.ne(n)),
 'existing audited purge works for actor '||n) FROM unnest(ARRAY[21,22,23]) AS n;
RESET ROLE;
SELECT lives_ok(format('DELETE FROM auth.users WHERE id=%L',pg_temp.ne(n)),
 'auth deletion succeeds for purged third-party actor '||n) FROM unnest(ARRAY[21,22,23]) AS n;
SELECT is((SELECT count(*)::int FROM auth.users WHERE id IN(pg_temp.ne(21),pg_temp.ne(22),pg_temp.ne(23))),0,'all expired actors deleted');
SELECT is((SELECT count(*)::int FROM public.profiles WHERE id=pg_temp.ne(24)),1,'active tester not deleted');
SELECT results_eq('SELECT to_jsonb(i) FROM public.notification_intents i ORDER BY id',
 'SELECT to_jsonb(i) FROM preserved_intents i ORDER BY id','all third-party intents retained byte-for-byte across actor deletion');
SELECT results_eq('SELECT to_jsonb(w) FROM public.work_items w ORDER BY id',
 'SELECT to_jsonb(w) FROM preserved_work w ORDER BY id','third-party work unchanged');
SELECT results_eq('SELECT to_jsonb(s) FROM public.lab_alert_sources s ORDER BY id',
 'SELECT to_jsonb(s) FROM preserved_sources s ORDER BY id','immutable laboratory source evidence unchanged');
SELECT results_eq('SELECT to_jsonb(a) FROM public.alerts a ORDER BY id',
 'SELECT to_jsonb(a) FROM preserved_alerts a ORDER BY id','alerts unchanged');
SELECT results_eq('SELECT to_jsonb(l) FROM public.lab_results l ORDER BY id',
 'SELECT to_jsonb(l) FROM preserved_labs l ORDER BY id','laboratory observations unchanged');
SELECT is((SELECT count(*)::int FROM public.lab_provenance_erasures WHERE actor_id IN(pg_temp.ne(21),pg_temp.ne(22),pg_temp.ne(23))),3,'one audited purge per actor');
SELECT throws_ok($q$DELETE FROM auth.users WHERE id=pg_temp.ne(1)$q$,'23503',NULL,'existing provider/work restrictions remain: no general erasure claim');
SELECT throws_ok($q$DELETE FROM auth.users WHERE id=pg_temp.ne(11)$q$,'23503',NULL,'existing patient/work restrictions remain');

-- Blocked intent is cancellable, but captured blocked reason cannot be erased.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ne(1),'role','authenticated','aal','aal2')::text,true);
UPDATE public.work_items SET status='closed',outcome='Synthetic disposition after block',outcome_code='clinical_action_taken' WHERE patient_id=pg_temp.ne(12);
RESET ROLE;
SELECT is((SELECT state FROM public.notification_intents WHERE patient_id=pg_temp.ne(12)),'cancelled','unstarted blocked intent cancels on close');
SELECT is((SELECT blocked_reason FROM public.notification_intents WHERE patient_id=pg_temp.ne(12)),'blocked_preference','initial blocked observation stays in history');
SELECT is((SELECT capture_state FROM public.notification_intents WHERE patient_id=pg_temp.ne(12)),'blocked','cancellation does not rewrite initial capture');
SELECT * FROM finish();
ROLLBACK;
