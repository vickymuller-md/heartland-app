-- Local synthetic read-projection verification; no mutation API or hosted proof.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
CREATE FUNCTION pg_temp.lo(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('61000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.lo(n),'observation-'||n||'@example.invalid','{"consent_accepted":true}' FROM unnest(ARRAY[1,2,3,11,12]) n;
UPDATE public.profiles SET role='provider' WHERE id=ANY(ARRAY[pg_temp.lo(1),pg_temp.lo(2),pg_temp.lo(3)]);
INSERT INTO public.organizations(id,name,created_by) VALUES(pg_temp.lo(90),'Synthetic source A',pg_temp.lo(1)),(pg_temp.lo(91),'Synthetic source B',pg_temp.lo(3));
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 SELECT pg_temp.lo(90),pg_temp.lo(n),CASE WHEN n=1 THEN 'owner' ELSE 'clinician' END,'active',now(),pg_temp.lo(1) FROM generate_series(1,2) n;
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES(pg_temp.lo(91),pg_temp.lo(3),'owner','active',now(),pg_temp.lo(3));
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',created_by FROM public.organization_memberships WHERE organization_id IN(pg_temp.lo(90),pg_temp.lo(91));
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'clinical_disposition',created_by FROM public.organization_memberships WHERE user_id IN(pg_temp.lo(1),pg_temp.lo(3)) AND organization_id IN(pg_temp.lo(90),pg_temp.lo(91));
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by) VALUES
 (pg_temp.lo(90),pg_temp.lo(11),pg_temp.lo(1)),(pg_temp.lo(91),pg_temp.lo(11),pg_temp.lo(3)),(pg_temp.lo(91),pg_temp.lo(12),pg_temp.lo(3));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 (pg_temp.lo(1),pg_temp.lo(11),'active',now()),(pg_temp.lo(2),pg_temp.lo(11),'active',now()),
 (pg_temp.lo(3),pg_temp.lo(11),'active',now()),(pg_temp.lo(3),pg_temp.lo(12),'active',now());
-- Emulate pre-outbox rows in this disposable fixture only, never alter hosted evidence.
ALTER TABLE public.lab_results DISABLE TRIGGER USER;
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium,creatinine,egfr,ordered_by,notes)
 SELECT pg_temp.lo(n),pg_temp.lo(11),now()-interval '1 day',4.6,1.23,82,pg_temp.lo(2),'Legacy synthetic source'
 FROM generate_series(100,450) n;
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium) VALUES
 (pg_temp.lo(500),pg_temp.lo(12),now()-interval '1 day',4.6),
 (pg_temp.lo(501),pg_temp.lo(11),now()+interval '1 day',4.6);
ALTER TABLE public.lab_results ENABLE TRIGGER USER;

CREATE FUNCTION pg_temp.lo_payload() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('evidence','  Synthetic source_document  ','occurred_at',to_char(now() AT TIME ZONE 'UTC'-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;
CREATE FUNCTION pg_temp.lo_prepare(n integer,a text DEFAULT 'potassium',p jsonb DEFAULT pg_temp.lo_payload(),o integer DEFAULT 90) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_lab_observation(pg_temp.lo(n+1000),pg_temp.lo(n+2000),pg_temp.lo(o),pg_temp.lo(11),pg_temp.lo(n),a,p)
$$;

CREATE TEMP TABLE projection_proofs(label text PRIMARY KEY,value jsonb);
GRANT ALL ON projection_proofs TO authenticated;
SELECT is((SELECT provolatile::text FROM pg_proc WHERE oid='public.get_effective_lab_observations(uuid[],text,text)'::regprocedure),'s','whole call uses a STABLE statement snapshot');
SELECT ok(NOT has_function_privilege('anon','public.get_effective_lab_observations(uuid[],text,text)','EXECUTE'),'no anonymous projection grant');
SELECT ok(NOT has_function_privilege('service_role','public.get_effective_lab_observations(uuid[],text,text)','EXECUTE'),'no service projection grant');
SELECT ok(has_function_privilege('authenticated','public.get_effective_lab_observations(uuid[],text,text)','EXECUTE'),'authenticated read RPC granted');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)])$q$,'42501','Laboratory projection not authorized','missing principal refused');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','service_role','sub',pg_temp.lo(1),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)])$q$,'42501','Laboratory projection not authorized','forged role in authenticated session refused');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(1),'aal','aal1')::text,true);
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)])$q$,'42501','Laboratory projection not authorized','provider requires AAL2');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(1),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(NULL)$q$,'22023','Invalid laboratory projection scope','null scope rejected');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations('{}'::uuid[])$q$,'22023','Invalid laboratory projection scope','empty scope rejected');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11),NULL])$q$,'22023','Invalid laboratory projection scope','null member rejected');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11),pg_temp.lo(11)])$q$,'22023','Invalid laboratory projection scope','duplicate patient rejected');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(array_fill(pg_temp.lo(11),ARRAY[501]))$q$,'22023','Invalid laboratory projection scope','oversized scope rejected');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(999)])$q$,'42501','Laboratory projection not authorized','absent patient not empty success');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11),pg_temp.lo(12)])$q$,'42501','Laboratory projection not authorized','one unauthorized patient refuses complete request');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)],pg_temp.lo(100)||':potassium')$q$,'22023','Invalid laboratory projection cursor','cursor requires snapshot');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)],NULL,repeat('a',64))$q$,'22023','Invalid laboratory projection cursor','snapshot requires cursor');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)],'bad',repeat('a',64))$q$,'22023','Invalid laboratory projection cursor','cursor key shape validated');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)],pg_temp.lo(100)||':potassium','bad')$q$,'22023','Invalid laboratory projection cursor','signature shape validated');
INSERT INTO projection_proofs VALUES('first',public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)]));
SELECT is((SELECT value->>'actor_id' FROM projection_proofs WHERE label='first'),pg_temp.lo(1)::text,'actor echoed explicitly');
SELECT is((SELECT value->'patient_ids' FROM projection_proofs WHERE label='first'),jsonb_build_array(pg_temp.lo(11)),'complete scope echoed');
SELECT is((SELECT jsonb_array_length(value->'items') FROM projection_proofs WHERE label='first'),250,'first page250');
SELECT is((SELECT value->>'next_cursor' FROM projection_proofs WHERE label='first'),pg_temp.lo(183)||':creatinine','cursor is last visible observation key');
SELECT is((SELECT value#>>'{items,0,id}' FROM projection_proofs WHERE label='first'),pg_temp.lo(100)||':creatinine','canonical analyte ordering');
SELECT is((SELECT value#>>'{items,0,value}' FROM projection_proofs WHERE label='first'),'1.23','decimal string not JSON float');
SELECT is((SELECT value#>>'{items,0,effective_lab_result_id}' FROM projection_proofs WHERE label='first'),pg_temp.lo(100)::text,'unregistered source remains original');
SELECT ok((SELECT value#>'{items,0,root_id}'='null'::jsonb AND value#>'{items,0,revision}'='null'::jsonb AND value#>'{items,0,version_id}'='null'::jsonb FROM projection_proofs WHERE label='first'),'unregistered original has no invented root or revision');
SELECT is((SELECT value#>>'{items,0,status}' FROM projection_proofs WHERE label='first'),'original','unregistered original labelled');
SELECT ok(NOT((SELECT value#>'{items,0}' FROM projection_proofs WHERE label='first') ?| ARRAY['payload','source_fingerprint','organization_id','registered_by']),'private registration metadata absent');
SELECT is(public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)]),(SELECT value FROM projection_proofs WHERE label='first'),'unchanged call retains signature and output');
SET LOCAL timezone='America/New_York';
SELECT is(public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)]),(SELECT value FROM projection_proofs WHERE label='first'),'caller timezone cannot change signature');
SET LOCAL timezone='UTC';
DO $loop$ DECLARE previous jsonb; next jsonb; n integer:=2; BEGIN
 SELECT value INTO previous FROM projection_proofs WHERE label='first';
 LOOP
  EXIT WHEN previous->>'next_cursor' IS NULL;
  next:=public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)],previous->>'next_cursor',previous->>'snapshot');
  INSERT INTO projection_proofs VALUES('page'||n,next); n:=n+1; previous:=next;
 END LOOP;
END $loop$;
SELECT is((SELECT count(*) FROM projection_proofs),5::bigint,'all five pages recovered');
SELECT is((SELECT sum(jsonb_array_length(value->'items')) FROM projection_proofs),1054::bigint,'partial original panels flatten without loss');
SELECT is((SELECT jsonb_array_length(value->'items') FROM projection_proofs WHERE label='page5'),54,'explicit tail54');
SELECT ok((SELECT value->>'next_cursor' IS NULL FROM projection_proofs WHERE label='page5'),'tail terminal');
SELECT is((SELECT count(DISTINCT item->>'id') FROM projection_proofs CROSS JOIN LATERAL jsonb_array_elements(value->'items') item),1054::bigint,'no duplicate observations across pages');
SELECT ok((SELECT (item->>'collected_at')::timestamptz>now() FROM projection_proofs CROSS JOIN LATERAL jsonb_array_elements(value->'items') item WHERE item->>'id'=pg_temp.lo(501)||':potassium'),'future source preserved for invalid-data handling, not filtered');
SELECT is((SELECT count(DISTINCT value->>'snapshot') FROM projection_proofs),1::bigint,'all pages bind same composition');
SELECT pg_temp.lo_prepare(100); SELECT public.apply_lab_observation(pg_temp.lo(1100));
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)],(SELECT value->>'next_cursor' FROM projection_proofs WHERE label='first'),(SELECT value->>'snapshot' FROM projection_proofs WHERE label='first'))$q$,
 '40001','Laboratory projection changed; restart the complete read','registering a source invalidates old pagination signature');
INSERT INTO projection_proofs VALUES('registered',public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)]));
SELECT is((SELECT value#>>'{items,2,root_id}' FROM projection_proofs WHERE label='registered'),pg_temp.lo(2100)::text,'registered potassium root explicit');
SELECT is((SELECT value#>>'{items,2,revision}' FROM projection_proofs WHERE label='registered'),'1','registered revision string');
SELECT is((SELECT value#>>'{items,2,value}' FROM projection_proofs WHERE label='registered'),'4.6','source registration does not change value');
SELECT is((SELECT value#>>'{items,0,root_id}' FROM projection_proofs WHERE label='registered'),NULL,'another original analyte not implicitly registered');
RESET ROLE;
UPDATE public.lab_results SET notes='Changed on an unseen page' WHERE id=pg_temp.lo(449);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)],(SELECT value->>'next_cursor' FROM projection_proofs WHERE label='registered'),(SELECT value->>'snapshot' FROM projection_proofs WHERE label='registered'))$q$,
 '40001','Laboratory projection changed; restart the complete read','metadata outside current page changes whole-set signature');
INSERT INTO projection_proofs VALUES('current',public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)]));
RESET ROLE;
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.lo(1);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)],(SELECT value->>'next_cursor' FROM projection_proofs WHERE label='current'),(SELECT value->>'snapshot' FROM projection_proofs WHERE label='current'))$q$,
 '42501','Laboratory projection not authorized','valid signature cannot bypass link revocation on next page');
RESET ROLE;
UPDATE public.provider_patient_links SET status='active' WHERE provider_id=pg_temp.lo(1);
UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.lo(1);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)])$q$,'42501','Laboratory projection not authorized','current registration consent mandatory');
RESET ROLE;
UPDATE public.consents SET accepted=true WHERE user_id=pg_temp.lo(1);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(3),'aal','aal2')::text,true);
INSERT INTO projection_proofs VALUES('scope',public.get_effective_lab_observations(ARRAY[pg_temp.lo(12),pg_temp.lo(11)]));
SELECT is((SELECT value->'patient_ids' FROM projection_proofs WHERE label='scope'),jsonb_build_array(pg_temp.lo(11),pg_temp.lo(12)),'patient scope canonically sorted');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)],(SELECT value->>'next_cursor' FROM projection_proofs WHERE label='current'),(SELECT value->>'snapshot' FROM projection_proofs WHERE label='current'))$q$,
 '40001','Laboratory projection changed; restart the complete read','another authorized actor cannot reuse signature as same read');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(11),'aal','aal1')::text,true);
SELECT lives_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)])$q$,'patient self-read preserves existing consent boundary without provider MFA rule');
SELECT throws_ok($q$SELECT public.get_effective_lab_observations(ARRAY[pg_temp.lo(12)])$q$,'42501','Laboratory projection not authorized','patient cannot read another patient');
RESET ROLE;
-- New raw source belongs to the disposable fixture; its outbox state is not human review.
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium) VALUES(pg_temp.lo(99),pg_temp.lo(11),now()-interval '1 day',4.7);
SET LOCAL ROLE authenticated;
SELECT ok(public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)])#>'{items,0,evaluation_status}'='null'::jsonb,'patient does not receive provider-only evaluation state');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(1),'aal','aal2')::text,true);
SELECT is(public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)])#>>'{items,0,evaluation_status}','pending','provider sees pending processing, never clinical review');
SELECT pg_temp.lo_prepare(190);
RESET ROLE;
CREATE FUNCTION pg_temp.broken_projection(kind text) RETURNS void LANGUAGE plpgsql AS $broken$
BEGIN
 INSERT INTO public.lab_observation_roots(id,request_id,patient_id,organization_id,original_lab_result_id,analyte,registered_by)
 VALUES(pg_temp.lo(2190),pg_temp.lo(1190),CASE WHEN kind='patient' THEN pg_temp.lo(12) ELSE pg_temp.lo(11) END,pg_temp.lo(90),pg_temp.lo(190),
  CASE WHEN kind IN('null_analyte','null_analyte_head') THEN 'bnp' ELSE 'potassium' END,pg_temp.lo(1));
 IF kind IN('patient','null_analyte_head') THEN
  INSERT INTO public.lab_observation_versions(root_id,request_id,revision,predecessor_id,lab_result_id,status,actor_id,occurred_at)
  VALUES(pg_temp.lo(2190),pg_temp.lo(1190),1,NULL,pg_temp.lo(190),'original',pg_temp.lo(1),now());
 END IF;
 PERFORM public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)]);
END $broken$;
SELECT throws_ok($q$SELECT pg_temp.broken_projection('head')$q$,'22000','Laboratory source history is inconsistent','missing head fails closed, no fallback to original');
SELECT throws_ok($q$SELECT pg_temp.broken_projection('patient')$q$,'22000','Laboratory source history is inconsistent','inconsistent root patient fails closed');
SELECT throws_ok($q$SELECT pg_temp.broken_projection('null_analyte')$q$,'22000','Laboratory source history is inconsistent','missing-head root on null original analyte is not silently filtered');
SELECT throws_ok($q$SELECT pg_temp.broken_projection('null_analyte_head')$q$,'22000','Laboratory source history is inconsistent','null original analyte fails even when an original head exists');
SELECT is((SELECT count(*) FROM public.lab_observation_roots WHERE id=pg_temp.lo(2190)),0::bigint,'corruption fixtures rolled back, not normalized into valid sources');
SELECT * FROM finish();
ROLLBACK;
