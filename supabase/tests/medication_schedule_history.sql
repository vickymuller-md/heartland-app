-- Fictional identities and medication records. All changes are transaction-local.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
CREATE FUNCTION pg_temp.md(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('80000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.md(n),'medication-schedule-'||n||'@example.invalid','{"consent_accepted":true}'::jsonb FROM generate_series(1,3) n;
UPDATE public.profiles SET role='provider' WHERE id=pg_temp.md(3);
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES(pg_temp.md(3),pg_temp.md(1),'active',now());

SELECT ok(NOT has_any_column_privilege('anon','public.medication_schedule_versions','SELECT'),'history is private');
SELECT ok(NOT has_any_column_privilege('authenticated','public.medication_schedule_versions','INSERT,UPDATE'),'site clients cannot write history directly');
SELECT ok(NOT has_function_privilege('authenticated','public.medication_calendar_zone_internal(uuid)','EXECUTE'),'internal calendar lookup is private');
SELECT is((SELECT sum(public.medication_dose_slots('weekly',1::smallint,'2026-11-15'::date+i)) FROM generate_series(0,6) i),1::bigint,'only one confirmed weekly slot');
SELECT is(public.medication_dose_slots('weekly',NULL,'2026-11-16'),NULL::int,'weekly without weekday is unconfirmed');
SELECT is(public.medication_dose_slots('as directed',NULL,'2026-11-16'),NULL::int,'free frequency stays unconfirmed');

INSERT INTO public.medications(id,patient_id,name,dosage,frequency,timing)
 VALUES (pg_temp.md(10),pg_temp.md(1),'Synthetic scheduled item','Recorded amount','daily',NULL),
        (pg_temp.md(11),pg_temp.md(1),'Synthetic pending item','Recorded amount','weekly','evening');
CREATE TEMP TABLE med_test_context AS SELECT (statement_timestamp() AT TIME ZONE public.medication_calendar_zone_internal(pg_temp.md(1)))::date AS day,
 (SELECT id FROM public.medication_schedule_versions WHERE medication_id=pg_temp.md(10)) AS initial_version;
GRANT SELECT ON med_test_context TO authenticated;
CREATE TEMP TABLE med_test_time(instant timestamptz);
GRANT SELECT,INSERT ON med_test_time TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.md(1),'role','authenticated','user_role','patient','aal','aal1')::text,true);
SELECT is((SELECT count(*) FROM public.medication_schedule_versions WHERE patient_id=pg_temp.md(1)),2::bigint,'patient can see own schedule');
SELECT is((SELECT count(*) FROM public.medication_schedule_versions WHERE patient_id=pg_temp.md(1) AND starts_on<(SELECT day FROM med_test_context)),0::bigint,'new profile cannot receive earlier missed doses');
SELECT lives_ok($q$SELECT public.record_medication_dose(pg_temp.md(1),pg_temp.md(10),initial_version,day,1,true) FROM med_test_context$q$,'confirmed daily alias accepts first dose');
INSERT INTO med_test_time SELECT taken_at FROM public.medication_logs WHERE medication_id=pg_temp.md(10);
SELECT lives_ok($q$SELECT public.record_medication_dose(pg_temp.md(1),pg_temp.md(10),initial_version,day,1,true) FROM med_test_context$q$,'same choice can be retried');
SELECT is((SELECT count(*) FROM public.medication_logs WHERE medication_id=pg_temp.md(10)),1::bigint,'retry does not duplicate log');
SELECT is((SELECT taken_at FROM public.medication_logs WHERE medication_id=pg_temp.md(10)),(SELECT instant FROM med_test_time),'retry keeps exact recorded time');
SELECT throws_ok($q$SELECT public.record_medication_dose(pg_temp.md(1),pg_temp.md(10),initial_version,day,2,true) FROM med_test_context$q$,'22023','Dose is not confirmed for this day','slot outside regimen rejected');
SELECT throws_ok($q$SELECT public.record_medication_dose(pg_temp.md(1),pg_temp.md(11),(SELECT id FROM public.medication_schedule_versions WHERE medication_id=pg_temp.md(11)),day,1,true) FROM med_test_context$q$,'22023','Dose is not confirmed for this day','unknown weekly date cannot be logged');
UPDATE public.medications SET dosage='Updated amount',frequency='twice_daily' WHERE id=pg_temp.md(10);
SELECT is((SELECT dosage FROM public.medication_schedule_versions WHERE medication_id=pg_temp.md(10) AND starts_on=(SELECT day FROM med_test_context)),'Recorded amount','existing dose retains exact earlier instruction');
SELECT is((SELECT ends_before FROM public.medication_schedule_versions WHERE id=(SELECT initial_version FROM med_test_context)),(SELECT day+1 FROM med_test_context),'old version remains through recorded day');
SELECT is((SELECT frequency FROM public.medication_schedule_versions WHERE medication_id=pg_temp.md(10) AND starts_on=(SELECT day+1 FROM med_test_context)),'twice_daily','edit effective next local day');
UPDATE public.medications SET active=false WHERE id=pg_temp.md(10);
SELECT is((SELECT active FROM public.medication_schedule_versions WHERE medication_id=pg_temp.md(10) AND starts_on=(SELECT day+1 FROM med_test_context)),false,'suspension closes future schedule without discarding prior day');
SELECT is((SELECT count(*) FROM public.medication_schedule_versions WHERE medication_id=pg_temp.md(10)),2::bigint,'repeated same-day change keeps one effective version per day');
SELECT throws_ok($q$SELECT public.record_medication_dose(pg_temp.md(2),pg_temp.md(10),initial_version,day,1,true) FROM med_test_context$q$,'42501','Medication session changed','another account cannot record the dose');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.md(2),'role','authenticated','user_role','patient','aal','aal1')::text,true);
SELECT is((SELECT count(*) FROM public.medication_schedule_versions WHERE patient_id=pg_temp.md(1)),0::bigint,'unrelated patient does not see history');
SELECT throws_ok($q$SELECT public.get_medication_calendar_zone(pg_temp.md(1))$q$,'42501','Medication calendar unavailable','cross-patient calendar request refused');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.md(3),'role','authenticated','user_role','provider','aal','aal2')::text,true);
SELECT is((SELECT count(*) FROM public.medication_schedule_versions WHERE patient_id=pg_temp.md(1)),3::bigint,'linked provider reads effective versions');
SELECT lives_ok($q$SELECT public.get_medication_calendar_zone(pg_temp.md(1))$q$,'linked provider can date the report for this patient');
SELECT is(public.get_provider_scheduled_adherence(),NULL::integer,'unconfirmed weekday keeps the portfolio denominator unknown');
RESET ROLE;
UPDATE public.medications SET weekly_day=extract(dow FROM (SELECT day FROM med_test_context))::smallint WHERE id=pg_temp.md(11);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.md(3),'role','authenticated','user_role','provider','aal','aal2')::text,true);
SELECT is(public.get_provider_scheduled_adherence(),50,'one logged dose across two confirmed scheduled slots');
RESET ROLE;
SELECT is(public.capture_medication_scan(pg_temp.md(1),now())->>'mode','dated-v1','scanner freezes dated schedules');
SELECT is((SELECT bool_and(NOT item ?| ARRAY['dosage','name','timing']) FROM jsonb_array_elements(public.capture_medication_scan(pg_temp.md(1),now())->'medications') item),true,'scan excludes free-text medication content');
UPDATE public.medications SET weekly_day=NULL, frequency='As recorded on a private instruction sheet' WHERE id=pg_temp.md(11);
SELECT is((SELECT item->>'schedule_frequency' FROM jsonb_array_elements(public.capture_medication_scan(pg_temp.md(1),now())->'medications') item
  WHERE item->>'medication_id'=pg_temp.md(11)::text),NULL::text,'free-form frequencies are not retained by the scan');
CREATE FUNCTION pg_temp.selection(n integer,med_name text,quantity text,frequency text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_array(jsonb_build_object('request_id',pg_temp.md(n),'name',med_name,'dosage',quantity,'frequency',frequency))
$$;
SELECT ok(NOT has_function_privilege('anon','public.record_gdmt_medications(uuid,uuid,jsonb)','EXECUTE'),'GDMT write is unavailable without sign-in');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.md(3),'role','authenticated','user_role','provider','aal','aal1')::text,true);
SELECT throws_ok($q$SELECT public.record_gdmt_medications(pg_temp.md(3),pg_temp.md(1),pg_temp.selection(21,'Confirmed item','Recorded dose','daily'))$q$,'42501','Provider session unavailable','GDMT requires the current provider MFA session');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.md(3),'role','authenticated','user_role','provider','aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.record_gdmt_medications(pg_temp.md(3),pg_temp.md(2),pg_temp.selection(21,'Confirmed item','Recorded dose','daily'))$q$,'42501','Patient link unavailable','GDMT rejects an unrelated patient');
SELECT is(public.record_gdmt_medications(pg_temp.md(3),pg_temp.md(1),pg_temp.selection(21,'Confirmed item','Recorded dose','daily')),'{"added":1,"existing":0}'::jsonb,'one confirmed medication is added');
SELECT is(public.record_gdmt_medications(pg_temp.md(3),pg_temp.md(1),pg_temp.selection(21,'Confirmed item','Recorded dose','daily')),'{"added":0,"existing":1}'::jsonb,'retry after loss returns the existing record');
SELECT is(public.record_gdmt_medications(pg_temp.md(3),pg_temp.md(1),pg_temp.selection(22,' confirmed item ','Other suggested dose','twice_daily')),'{"added":0,"existing":1}'::jsonb,'new selection of an active item preserves original dosage');
SELECT is((SELECT count(*) FROM public.medications WHERE name='Confirmed item' AND frequency='once_daily' AND dosage='Recorded dose' AND timing IS NULL),1::bigint,'provider writes canonical frequency and no undocumented time');
SELECT throws_ok($q$SELECT public.record_gdmt_medications(pg_temp.md(3),pg_temp.md(1),pg_temp.selection(21,'Confirmed item','Changed amount','daily'))$q$,'22023','Medication changed after the earlier save','same request cannot change its instruction');
SELECT throws_ok($q$SELECT public.record_gdmt_medications(pg_temp.md(3),pg_temp.md(1),pg_temp.selection(23,'First batch item','Recorded dose','daily')||pg_temp.selection(24,'One or another item','Recorded dose','daily'))$q$,'22023','Confirm one medication and its recorded instructions','catalog alternatives cannot be persisted as one item');
SELECT is((SELECT count(*) FROM public.medications WHERE name='First batch item'),0::bigint,'invalid second selection rolls back the entire batch');
RESET ROLE;
SELECT ok(NOT has_any_column_privilege('authenticated','public.gdmt_medication_receipts','SELECT,INSERT,UPDATE'),'GDMT receipts stay private');
UPDATE public.medications SET active=false WHERE patient_id=pg_temp.md(1) AND name='Confirmed item';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.md(3),'role','authenticated','user_role','provider','aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.record_gdmt_medications(pg_temp.md(3),pg_temp.md(1),pg_temp.selection(22,' confirmed item ','Other suggested dose','twice_daily'))$q$,'22023','Medication changed after the earlier save','replay of an already-listed item cannot reactivate a later suspension');
SELECT is((SELECT count(*) FROM public.medications WHERE name='Confirmed item' AND active),0::bigint,'suspended medication remains suspended');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
