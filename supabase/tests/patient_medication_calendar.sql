-- Fictitious patient calendars and UTC instants, transaction-local.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
CREATE FUNCTION pg_temp.z(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
SELECT ('84000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data) SELECT pg_temp.z(i),'calendar-'||i||'@example.invalid','{"consent_accepted":true}'::jsonb FROM generate_series(1,5)i;
UPDATE public.profiles SET role='provider' WHERE id=pg_temp.z(2);
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES(pg_temp.z(2),pg_temp.z(1),'active',now());
UPDATE public.organizations SET timezone='America/New_York' WHERE id=public.primary_organization_for_provider(pg_temp.z(2));
INSERT INTO public.medications(id,patient_id,name,dosage,frequency) VALUES(pg_temp.z(10),pg_temp.z(1),'Synthetic home calendar','Recorded dose','twice_daily');
CREATE TEMP TABLE zone_context AS SELECT c.day,c.revision,(SELECT id FROM public.medication_schedule_versions WHERE medication_id=pg_temp.z(10)) AS version
 FROM public.medication_calendar_at(pg_temp.z(1),now()) c;
GRANT SELECT ON zone_context TO authenticated;
SELECT ok(NOT has_any_column_privilege('authenticated','public.patient_medication_calendars','SELECT,INSERT,UPDATE') AND NOT has_table_privilege('authenticated','public.patient_medication_calendars','DELETE'),'private calendar history has no raw grants');
SELECT ok(NOT has_any_column_privilege('authenticated','public.medication_logs','INSERT,UPDATE'),'dated dose cannot bypass its authenticated receipt');
SELECT ok(NOT has_function_privilege('authenticated','public.record_medication_dose_core(uuid,uuid,uuid,date,integer,boolean)','EXECUTE'),'raw internal dose setter stays private');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.z(1),'role','authenticated','aal','aal1')::text,true);
SELECT is(public.get_patient_medication_calendar(pg_temp.z(1))->>'source','care_team','existing team zone is identified explicitly');
SELECT lives_ok($q$SELECT public.record_medication_dose(pg_temp.z(1),pg_temp.z(10),version,day,1,true) FROM zone_context$q$,'existing patient flow still records against the original calendar before a preference');
CREATE TEMP TABLE dose_before AS SELECT id,taken_at,calendar_source,calendar_time_zone FROM public.medication_logs WHERE medication_id=pg_temp.z(10);
SELECT is((SELECT calendar_source FROM dose_before),'care_team','first dose retains individual source actually used');
SELECT is((SELECT public.set_patient_medication_timezone(pg_temp.z(1),pg_temp.z(20),revision,'America/Toronto') FROM zone_context),pg_temp.z(20),'a patient may choose another named zone on the same civil day');
SELECT is(public.get_patient_medication_calendar(pg_temp.z(1))->>'zone','America/Toronto','new timezone effective immediately when civil date is shared');
SELECT is(public.get_patient_timezone(),'America/Toronto','existing own-calendar reader uses patient choice');
SELECT lives_ok($q$SELECT public.set_patient_medication_timezone(pg_temp.z(1),pg_temp.z(20),revision,'America/Toronto') FROM zone_context$q$,'retry confirms the same receipt');
SELECT throws_ok($q$SELECT public.set_patient_medication_timezone(pg_temp.z(1),pg_temp.z(20),revision,'UTC') FROM zone_context$q$,'22023','Calendar request changed','a receipt cannot change timezone on replay');
SELECT throws_ok($q$SELECT public.set_patient_medication_timezone(pg_temp.z(1),pg_temp.z(21),revision,'UTC') FROM zone_context$q$,'22023','Reload the current calendar choice','a concurrent form based on the old revision cannot overwrite the preference');
SELECT throws_ok($q$SELECT public.record_medication_dose(pg_temp.z(1),pg_temp.z(10),version,day,2,true) FROM zone_context$q$,'22023','Reload the medication calendar','old form cannot add a second dose after a same-civil-day zone change');
SELECT lives_ok($q$SELECT public.record_medication_dose(pg_temp.z(1),pg_temp.z(10),version,day,1,true) FROM zone_context$q$,'old exact replay can confirm an already existing log');
SELECT lives_ok($q$SELECT public.record_medication_dose_in_calendar(pg_temp.z(1),pg_temp.z(10),version,day,1,true,revision) FROM zone_context$q$,'stale dated receipt can confirm the same durable choice without rewriting its source');
SELECT is((SELECT taken_at FROM public.medication_logs WHERE medication_id=pg_temp.z(10) AND dose_number=1),(SELECT taken_at FROM dose_before),'replay preserves original dose time');
SELECT is((SELECT calendar_source FROM public.medication_logs WHERE medication_id=pg_temp.z(10) AND dose_number=1),'care_team','replay does not attribute a personal zone to an earlier dose');
SELECT throws_ok($q$SELECT public.record_medication_dose_in_calendar(pg_temp.z(1),pg_temp.z(10),version,day,2,true,revision) FROM zone_context$q$,'22023','Reload the medication calendar','new writer also rejects stale displayed revision');
SELECT lives_ok($q$SELECT public.record_medication_dose_in_calendar(pg_temp.z(1),pg_temp.z(10),version,day,2,true,pg_temp.z(20)) FROM zone_context$q$,'current calendar records confirmed slot');
SELECT is((SELECT calendar_time_zone FROM public.medication_logs WHERE medication_id=pg_temp.z(10) AND dose_number=2),'America/Toronto','new dose has its actual patient-selected timezone');
SELECT throws_ok($q$SELECT public.set_patient_medication_timezone(pg_temp.z(1),pg_temp.z(21),pg_temp.z(20),'ABC')$q$,'22023','Choose a recognized timezone','unknown or abbreviated timezone refused');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.z(2),'role','authenticated','aal','aal2')::text,true);
SELECT is(public.get_patient_medication_calendar(pg_temp.z(1))->>'source','patient','linked clinical reader sees who chose the timezone');
SELECT throws_ok($q$SELECT public.set_patient_medication_timezone(pg_temp.z(1),pg_temp.z(21),pg_temp.z(20),'UTC')$q$,'42501','Patient session unavailable','a provider cannot change the patient preference');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.z(3),'role','authenticated','aal','aal1')::text,true);
SELECT throws_ok($q$SELECT public.get_patient_medication_calendar(pg_temp.z(1))$q$,'42501','Medication calendar unavailable','unrelated patient cannot read calendar');
SELECT throws_ok($q$SELECT public.set_patient_medication_timezone(pg_temp.z(1),pg_temp.z(20),pg_temp.z(20),'America/Toronto')$q$,'42501','Patient session unavailable','account switch cannot replay choice');
RESET ROLE;
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.z(2) AND patient_id=pg_temp.z(1);
SELECT is(public.medication_calendar_zone_internal(pg_temp.z(1)),'America/Toronto','changing the team leaves the patient timezone intact');

-- Synthetic old and future instants exercise the exact production handover clock.
INSERT INTO public.patient_medication_calendars(patient_id,id,time_zone,source,recorded_at,effective_at,first_day)
 VALUES(pg_temp.z(4),pg_temp.z(30),'America/New_York','default','2026-03-01Z','-infinity','2026-03-01'),
       (pg_temp.z(5),pg_temp.z(31),'Etc/GMT+12','default','2026-03-01Z','-infinity','2026-03-01');
SELECT is((SELECT end_at-start_at FROM public.medication_calendar_day_bounds(pg_temp.z(4),'2026-11-01')),interval '25 hours','autumn daylight-saving day includes all 25 hours');
SELECT is((SELECT end_at-start_at FROM public.medication_calendar_day_bounds(pg_temp.z(4),'2026-03-08')),interval '23 hours','spring daylight-saving day includes exactly 23 hours');
INSERT INTO public.patient_medication_calendars(patient_id,id,previous_id,time_zone,source,recorded_at,effective_at,previous_day,first_day)
 SELECT pg_temp.z(4),pg_temp.z(32),pg_temp.z(30),'America/Los_Angeles','patient','2026-11-02T05:30Z',b,'2026-11-02',(b AT TIME ZONE 'America/Los_Angeles')::date
 FROM public.medication_calendar_handover('2026-11-02T05:30Z','2026-11-02','America/New_York','America/Los_Angeles') b;
SELECT is((SELECT day FROM public.medication_calendar_at(pg_temp.z(4),'2026-11-03T07:59:59Z')),'2026-11-02'::date,'western move keeps exactly one medication day open while dates disagree');
SELECT is((SELECT day FROM public.medication_calendar_at(pg_temp.z(4),'2026-11-03T08:00Z')),'2026-11-03'::date,'new zone takes effect without a background job');
SELECT is((SELECT end_at-start_at FROM public.medication_calendar_day_bounds(pg_temp.z(4),'2026-11-02')),interval '27 hours','held day includes earlier and later check-ins in the same calendar task');
INSERT INTO public.patient_medication_calendars(patient_id,id,previous_id,time_zone,source,recorded_at,effective_at,previous_day,first_day)
 SELECT pg_temp.z(5),pg_temp.z(33),pg_temp.z(31),'Pacific/Kiritimati','patient','2026-11-16T13:00Z',b,'2026-11-16',(b AT TIME ZONE 'Pacific/Kiritimati')::date
 FROM public.medication_calendar_handover('2026-11-16T13:00Z','2026-11-16','Etc/GMT+12','Pacific/Kiritimati') b;
SELECT is(ARRAY(SELECT * FROM public.unclassified_medication_dates(pg_temp.z(5),'2026-11-15','2026-11-19')),ARRAY['2026-11-17'::date],'a skipped international-date-line day remains unclassified');
SELECT is(public.capture_medication_scan(pg_temp.z(5),'2026-11-18T12:01Z')->>'mode','calendar-unconfirmed','scan cannot infer a missed dose in an unclassified interval');
SELECT * FROM finish();
ROLLBACK;
