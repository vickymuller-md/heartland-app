-- Explicit runtime minimum, not an exclusive ACL allowlist for upgraded installs.
-- Synthetic fixtures only; real role/RLS checks and all writes roll back.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
CREATE FUNCTION pg_temp.rt(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('77000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE runtime_reads(name text PRIMARY KEY);
INSERT INTO runtime_reads SELECT unnest(ARRAY['profiles','consents','patients','provider_patient_links',
 'vitals','symptoms','medications','medication_logs','education_progress','alerts','provider_notes',
 'alert_preferences','scheduled_followups','discharge_records','discharge_followups','provider_messages','quality_metric_records']);
GRANT SELECT ON runtime_reads TO authenticated,anon;
SELECT ok(has_table_privilege('authenticated','public.'||name,'SELECT'),'authenticated runtime SELECT: '||name) FROM runtime_reads;
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||name)::regclass),'RLS retained: '||name) FROM runtime_reads;
SELECT ok(NOT has_any_column_privilege('anon','public.'||name,'SELECT'),'no anonymous column read: '||name) FROM runtime_reads;

-- Explicit revocations must hold even when old table/column defaults were broad.
SELECT ok(NOT has_table_privilege(r,t,'INSERT'),r||' raw INSERT denied: '||t)
 FROM unnest(ARRAY['anon','authenticated','service_role']) r
 CROSS JOIN unnest(ARRAY['public.vitals','public.symptoms']) t;
SELECT ok(NOT has_column_privilege(r,c.oid,a.attnum,'INSERT'),r||' INSERT denied: '||c.relname||'.'||a.attname)
 FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r
 WHERE c.oid IN('public.vitals'::regclass,'public.symptoms'::regclass);
SELECT ok(NOT has_any_column_privilege(r,'public.education_progress','INSERT,UPDATE'),r||' cannot bypass education response receipt')
 FROM unnest(ARRAY['anon','authenticated']) r;
SELECT ok(NOT has_any_column_privilege(r,'public.alert_preferences','INSERT,UPDATE'),r||' cannot bypass preference RPC')
 FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT ok(NOT has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),r||' private journal: '||t)
 FROM unnest(ARRAY['anon','authenticated','service_role']) r
 CROSS JOIN unnest(ARRAY['public.education_response_state','public.notification_dispatches',
  'public.notification_dispatch_destinations','public.notification_dispatch_attempts','public.notification_dispatch_events']) t;
SELECT ok(NOT has_any_column_privilege(r,t,'SELECT,INSERT,UPDATE'),r||' no journal column bypass: '||t)
 FROM unnest(ARRAY['anon','authenticated','service_role']) r
 CROSS JOIN unnest(ARRAY['public.education_response_state','public.notification_dispatches',
  'public.notification_dispatch_destinations','public.notification_dispatch_attempts','public.notification_dispatch_events']) t;
SELECT ok(has_column_privilege('service_role','public.'||t,c,'SELECT'),'service runtime column: '||t||'.'||c)
 FROM (VALUES ('profiles','id'),('profiles','role'),('profiles','sandbox_expires_at'),('profiles','state'),('profiles','created_at'),
  ('alerts','id'),('provider_notes','id'),('provider_notes','content'),('access_requests','id'),('access_requests','status'),
  ('provider_patient_links','id'),('provider_patient_links','status')) cols(t,c);

INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.rt(n),'runtime-'||n||'@example.invalid','{"consent_accepted":true}'::jsonb FROM unnest(ARRAY[1,2,3,4,5,11,12]) n;
UPDATE public.profiles SET role='provider',state='NY' WHERE id IN(SELECT pg_temp.rt(n) FROM generate_series(1,5) n);
UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.rt(4);
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 (pg_temp.rt(1),pg_temp.rt(11),'active',now()),(pg_temp.rt(3),pg_temp.rt(11),'active',now()),
 (pg_temp.rt(4),pg_temp.rt(11),'active',now()),(pg_temp.rt(5),pg_temp.rt(12),'active',now());
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES(public.primary_organization_for_provider(pg_temp.rt(1)),pg_temp.rt(2),'clinician','active',now(),pg_temp.rt(1));
-- Two patients' real rows make an accidentally broadened RLS visibly fail.
INSERT INTO public.vitals(id,patient_id,recorded_at,weight_lbs)
 SELECT pg_temp.rt(100+n),pg_temp.rt(n),now(),180 FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.symptoms(id,patient_id,recorded_at,dyspnea)
 SELECT pg_temp.rt(100+n),pg_temp.rt(n),now(),0 FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.medications(id,patient_id,name) SELECT pg_temp.rt(100+n),pg_temp.rt(n),'Synthetic medication' FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.medication_logs(medication_id,patient_id,scheduled_date,dose_number)
 SELECT pg_temp.rt(100+n),pg_temp.rt(n),current_date,1 FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.education_progress(patient_id,domain_id) SELECT pg_temp.rt(n),'daily_weight' FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.provider_notes(patient_id,provider_id,content)
 SELECT pg_temp.rt(n),pg_temp.rt(CASE n WHEN 11 THEN 1 ELSE 5 END),'[Titration] Synthetic documentation' FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.alert_preferences(provider_id,patient_id,alert_type)
 SELECT pg_temp.rt(CASE n WHEN 11 THEN 1 ELSE 5 END),pg_temp.rt(n),'no_checkin' FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.scheduled_followups(patient_id,provider_id,scheduled_at,type)
 SELECT pg_temp.rt(n),pg_temp.rt(CASE n WHEN 11 THEN 1 ELSE 5 END),now()+interval '1 day','Synthetic follow-up' FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.discharge_records(id,patient_id,provider_id,discharged_at,facility_tier)
 SELECT pg_temp.rt(100+n),pg_temp.rt(n),pg_temp.rt(CASE n WHEN 11 THEN 1 ELSE 5 END),now(),1 FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.discharge_followups(discharge_record_id,patient_id,provider_id,type,label,due_at)
 SELECT pg_temp.rt(100+n),pg_temp.rt(n),pg_temp.rt(CASE n WHEN 11 THEN 1 ELSE 5 END),'call_48h','Synthetic call',now()+interval '2 days' FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.provider_messages(id,patient_id,provider_id,template_type,subject,body)
 SELECT pg_temp.rt(100+n),pg_temp.rt(n),pg_temp.rt(CASE n WHEN 11 THEN 1 ELSE 5 END),'general','Synthetic message','No clinical instruction.' FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.quality_metric_records(provider_id,metric_key,period_month)
 SELECT pg_temp.rt(n),'synthetic_runtime_check',date_trunc('month',now())::date FROM unnest(ARRAY[1,5]) n;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.alerts(id,patient_id,severity,flags,first_seen_at,last_seen_at)
 SELECT pg_temp.rt(100+n),pg_temp.rt(n),'warning',ARRAY['synthetic_runtime'],now(),now() FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium)
 SELECT pg_temp.rt(100+n),pg_temp.rt(n),now()-interval '1 day',4.5 FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.access_requests(id,full_name,email) VALUES(pg_temp.rt(200),'Synthetic Runtime','runtime@example.invalid');
INSERT INTO public.provider_patient_links(id,provider_id,invite_email,status)
 VALUES(pg_temp.rt(201),pg_temp.rt(1),'invite-runtime@example.invalid','invited');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rt(1),'role','authenticated','aal','aal2')::text,true);
SELECT lives_ok(format('SELECT * FROM public.%I LIMIT 1',name),'runtime query executes: '||name) FROM runtime_reads;
SELECT results_eq(format('SELECT count(*) FROM public.%I WHERE patient_id=%L',name,pg_temp.rt(11)),
 'SELECT 1::bigint','linked provider sees existing row: '||name)
 FROM runtime_reads WHERE name NOT IN('profiles','consents','patients','provider_patient_links','quality_metric_records');
SELECT results_eq(format('SELECT count(*) FROM public.%I WHERE patient_id=%L',name,pg_temp.rt(12)),
 'SELECT 0::bigint','unlinked patient stays hidden: '||name)
 FROM runtime_reads WHERE name NOT IN('profiles','consents','patients','provider_patient_links','quality_metric_records');
SELECT is((SELECT role FROM public.profiles WHERE id=pg_temp.rt(1)),'provider','server authorization reads own authoritative role');
SELECT is((SELECT count(*) FROM public.consents WHERE user_id=pg_temp.rt(1) AND accepted),1::bigint,'server authorization reads current consent');
SELECT is((SELECT count(*) FROM public.patients WHERE id=pg_temp.rt(11)),1::bigint,'clinical profile visible to linked provider');
SELECT is((SELECT count(*) FROM public.patients WHERE id=pg_temp.rt(12)),0::bigint,'unlinked clinical profile hidden');
SELECT is((SELECT count(*) FROM public.provider_patient_links WHERE patient_id=pg_temp.rt(11)),1::bigint,'only provider own link visible');
SELECT is((SELECT count(*) FROM public.quality_metric_records),1::bigint,'only own metrics visible');
SELECT is((SELECT count(*) FROM public.notification_deliveries WHERE message_id=pg_temp.rt(111)),1::bigint,'delivery policy can read provider_messages dependency');
SELECT is((SELECT count(*) FROM public.notification_deliveries WHERE message_id=pg_temp.rt(112)),0::bigint,'other provider message delivery hidden');
SELECT is(jsonb_array_length(public.get_effective_lab_observations(ARRAY[pg_temp.rt(11)])->'items'),1,'effective lab read does not need raw table SELECT');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.rt(11),pg_temp.rt(12)])$q$,'42501',NULL,'mixed lab scope cannot leak authorized subset');

SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rt(1),'role','authenticated','aal','aal1')::text,true);
SELECT is((SELECT count(*) FROM public.vitals),0::bigint,'provider AAL1 cannot read observations');
SELECT is((SELECT count(*) FROM public.provider_messages),0::bigint,'provider AAL1 cannot read message content');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.rt(11)])$q$,'42501',NULL,'provider AAL1 cannot read effective labs');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rt(4),'role','authenticated','aal','aal2')::text,true);
SELECT is((SELECT count(*) FROM public.vitals),0::bigint,'linked provider without consent cannot read observations');
SELECT is((SELECT count(*) FROM public.profiles WHERE id=pg_temp.rt(4)),1::bigint,'own profile remains readable before consent');
SELECT is((SELECT accepted FROM public.consents WHERE user_id=pg_temp.rt(4)),false,'own declined consent remains readable for registration');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rt(2),'role','authenticated','aal','aal2')::text,true);
SELECT is((SELECT count(*) FROM public.vitals),0::bigint,'organization membership alone does not substitute clinical link');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rt(3),'role','authenticated','aal','aal2')::text,true);
SELECT is((SELECT count(*) FROM public.vitals WHERE patient_id=pg_temp.rt(11)),1::bigint,'separately linked provider keeps authorized access across organizations');

SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rt(11),'role','authenticated','aal','aal1')::text,true);
SELECT is((SELECT count(*) FROM public.vitals),1::bigint,'patient reads own observation at AAL1');
SELECT is((SELECT count(*) FROM public.symptoms WHERE patient_id=pg_temp.rt(12)),0::bigint,'patient cannot read another patient symptoms');
SELECT is((SELECT count(*) FROM public.provider_messages),1::bigint,'patient reads only own messages');
SELECT is(jsonb_array_length(public.get_effective_lab_observations(ARRAY[pg_temp.rt(11)])->'items'),1,'patient reads own effective laboratory data');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.rt(12)])$q$,'42501',NULL,'patient cannot read another patient laboratory projection');
SELECT throws_ok($q$INSERT INTO public.vitals(patient_id,recorded_at) VALUES(pg_temp.rt(11),now())$q$,'42501',NULL,'patient raw vitals insert still denied');
SELECT throws_ok($q$INSERT INTO public.symptoms(patient_id,recorded_at) VALUES(pg_temp.rt(11),now())$q$,'42501',NULL,'patient raw symptoms insert still denied');
SELECT throws_ok($q$UPDATE public.education_progress SET completed=true$q$,'42501',NULL,'education write still requires receipt RPC');
SELECT throws_ok($q$UPDATE public.alert_preferences SET muted=false$q$,'42501',NULL,'preference write still requires scoped RPC');
SELECT throws_ok($q$SELECT * FROM public.notification_dispatch_attempts$q$,'42501',NULL,'authenticated transport history remains private');
SELECT throws_ok($q$SELECT public.lab_observation_request_state(pg_temp.rt(999))$q$,'42501',NULL,'private laboratory helper remains inaccessible');
RESET ROLE;
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.rt(1) AND patient_id=pg_temp.rt(11);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rt(1),'role','authenticated','aal','aal2')::text,true);
SELECT is((SELECT count(*) FROM public.vitals),0::bigint,'revoked link immediately removes observation access');
SELECT is((SELECT count(*) FROM public.provider_messages),0::bigint,'revoked link immediately removes message access');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.rt(11)])$q$,'42501',NULL,'revoked link removes laboratory projection access');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT throws_ok(format('SELECT * FROM public.%I LIMIT 1',name),'42501',NULL,'anonymous runtime query refused: '||name) FROM runtime_reads;
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.rt(11)])$q$,'42501',NULL,'anonymous projection RPC refused');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT lives_ok('SELECT id FROM public.profiles LIMIT 1','health query available');
SELECT lives_ok($q$SELECT id FROM public.profiles WHERE role='tester' AND sandbox_expires_at<=now() LIMIT 100$q$,'cleanup lookup available without invoking cleanup');
SELECT is((SELECT count(id) FROM public.profiles WHERE role='provider'),5::bigint,'aggregate provider count available');
SELECT is((SELECT count(id) FROM public.profiles WHERE role='patient'),2::bigint,'aggregate patient count available');
SELECT lives_ok('SELECT state FROM public.profiles WHERE state IS NOT NULL','aggregate geographic query available');
SELECT lives_ok($q$SELECT created_at FROM public.profiles WHERE role='provider'$q$,'aggregate month query available');
SELECT is((SELECT count(id) FROM public.alerts),2::bigint,'aggregate alert count available with id grant');
SELECT is((SELECT count(id) FROM public.provider_notes WHERE content ILIKE '[Titration]%'),2::bigint,'aggregate note filter available');
SELECT is((SELECT count(id) FROM public.access_requests WHERE status='pending'),1::bigint,'aggregate access-request count available');
SELECT lives_ok($q$DELETE FROM public.provider_patient_links WHERE id=pg_temp.rt(201) AND status='invited'$q$,'failed invitation compensates exact invited row');
SELECT is((SELECT count(id) FROM public.provider_patient_links WHERE id=pg_temp.rt(201)),0::bigint,'invitation compensation removed only target');
SELECT is((SELECT count(id) FROM public.provider_patient_links),4::bigint,'clinical links untouched by compensation');
SELECT throws_ok($q$INSERT INTO public.vitals(patient_id,recorded_at) VALUES(pg_temp.rt(11),now())$q$,'42501',NULL,'service raw vitals insert stays revoked');
SELECT throws_ok($q$INSERT INTO public.symptoms(patient_id,recorded_at) VALUES(pg_temp.rt(11),now())$q$,'42501',NULL,'service raw symptoms insert stays revoked');
SELECT throws_ok($q$SELECT * FROM public.notification_dispatch_attempts$q$,'42501',NULL,'service cannot read transport journal directly');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.rt(11)])$q$,'42501',NULL,'service cannot impersonate human laboratory reader');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
