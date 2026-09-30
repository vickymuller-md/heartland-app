BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
SELECT ok(NOT has_function_privilege('authenticated','public.coalesce_patient_alert(uuid,uuid,text,text[])','EXECUTE'),'browser still cannot coalesce');
SELECT ok(NOT has_function_privilege('anon','public.coalesce_patient_alert(uuid,uuid,text,text[])','EXECUTE'),'anonymous still cannot coalesce');
SELECT ok(has_function_privilege('service_role','public.coalesce_patient_alert(uuid,uuid,text,text[])','EXECUTE'),'service grant preserved');
SELECT ok((SELECT prosecdef AND proconfig=ARRAY['search_path=""']::text[] FROM pg_proc
  WHERE oid='public.coalesce_patient_alert(uuid,uuid,text,text[])'::regprocedure),'definer and empty search path preserved');
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('47000000-0000-4000-8000-000000000001','scan-provider@example.invalid','{"consent_accepted":true}'),
 ('47000000-0000-4000-8000-000000000011','scan-patient@example.invalid','{"consent_accepted":true}');
UPDATE public.profiles SET role='provider' WHERE id='47000000-0000-4000-8000-000000000001';
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 ('47000000-0000-4000-8000-000000000001','47000000-0000-4000-8000-000000000011','active',now());
CREATE TEMP TABLE sc_result(label text PRIMARY KEY,alert_id uuid,created boolean);
GRANT ALL ON sc_result TO service_role;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO sc_result SELECT 'first',* FROM public.coalesce_patient_alert('47000000-0000-4000-8000-000000000011',NULL,'informational',ARRAY['no_checkin']);
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT severity FROM public.alerts WHERE id=(SELECT alert_id FROM sc_result WHERE label='first')),'informational','informational persists without severity promotion');
SET LOCAL ROLE service_role;
SELECT is((SELECT created FROM sc_result WHERE label='first'),true,'first signal creates alert');
INSERT INTO sc_result SELECT 'same',* FROM public.coalesce_patient_alert('47000000-0000-4000-8000-000000000011',NULL,'informational',ARRAY['no_checkin']);
SELECT is((SELECT alert_id FROM sc_result WHERE label='same'),(SELECT alert_id FROM sc_result WHERE label='first'),'same active informational signal coalesces');
SELECT is((SELECT created FROM sc_result WHERE label='same'),false,'second distinct observation is not a new alert');
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT occurrence_count FROM public.alerts WHERE id=(SELECT alert_id FROM sc_result WHERE label='first')),2,'coalescer alone still counts distinct calls; receipt idempotence belongs to producer');
SELECT is((SELECT severity FROM public.alerts WHERE id=(SELECT alert_id FROM sc_result WHERE label='first')),'informational','informational remains informational');
SET LOCAL ROLE service_role;
INSERT INTO sc_result SELECT 'due',* FROM public.coalesce_patient_alert('47000000-0000-4000-8000-000000000011',NULL,'informational',ARRAY['followup_due']);
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT flags FROM public.alerts WHERE id=(SELECT alert_id FROM sc_result WHERE label='due')),ARRAY['followup_due'],'second informational rule supported');
SET LOCAL ROLE service_role;
INSERT INTO sc_result SELECT 'warning',* FROM public.coalesce_patient_alert('47000000-0000-4000-8000-000000000011',NULL,'warning',ARRAY['no_checkin','low_adherence']);
SELECT is((SELECT alert_id FROM sc_result WHERE label='warning'),(SELECT alert_id FROM sc_result WHERE label='first'),'overlapping warning coalesces into original identity');
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT severity FROM public.alerts WHERE id=(SELECT alert_id FROM sc_result WHERE label='first')),'warning','existing severity ordering preserved');
SET LOCAL ROLE service_role;
INSERT INTO sc_result SELECT 'critical',* FROM public.coalesce_patient_alert('47000000-0000-4000-8000-000000000011',NULL,'critical',ARRAY['low_adherence','hyperkalemia']);
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT severity FROM public.alerts WHERE id=(SELECT alert_id FROM sc_result WHERE label='first')),'critical','critical dominates warning');
SET LOCAL ROLE service_role;
INSERT INTO sc_result SELECT 'later-info',* FROM public.coalesce_patient_alert('47000000-0000-4000-8000-000000000011',NULL,'informational',ARRAY['no_checkin']);
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT severity FROM public.alerts WHERE id=(SELECT alert_id FROM sc_result WHERE label='first')),'critical','later informational observation never downgrades critical alert');
SELECT is((SELECT flags FROM public.alerts WHERE id=(SELECT alert_id FROM sc_result WHERE label='first')),ARRAY['hyperkalemia','low_adherence','no_checkin'],'normalized merged flags preserved');
SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT public.coalesce_patient_alert('47000000-0000-4000-8000-000000000011',NULL,NULL,ARRAY['no_checkin'])$q$,'P0001','invalid alert severity','null severity rejected explicitly');
SELECT throws_ok($q$SELECT public.coalesce_patient_alert('47000000-0000-4000-8000-000000000011',NULL,'urgent',ARRAY['no_checkin'])$q$,'P0001','invalid alert severity','unknown severity rejected');
SELECT throws_ok($q$SELECT public.coalesce_patient_alert('47000000-0000-4000-8000-000000000011',NULL,'informational',ARRAY[]::text[])$q$,'P0001','at least one alert flag is required','empty flags still rejected');
SELECT throws_ok($q$SELECT public.coalesce_patient_alert('47000000-0000-4000-8000-000000000011',NULL,'informational',ARRAY[NULL,'']::text[])$q$,'P0001','at least one alert flag is required','blank flags still rejected');
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.alerts),2,'invalid inputs add no alerts');
SET LOCAL ROLE service_role;
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
