-- Local synthetic source-command context proof. Every fixture rolls back.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
-- BEGIN OBSERVATION FIXTURES
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
-- END OBSERVATION FIXTURES
-- BEGIN OBSERVATION HELPERS
CREATE FUNCTION pg_temp.lo_payload() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('evidence','  Synthetic source_document  ','occurred_at',to_char(now() AT TIME ZONE 'UTC'-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;
CREATE FUNCTION pg_temp.lo_prepare(n integer,a text DEFAULT 'potassium',p jsonb DEFAULT pg_temp.lo_payload(),o integer DEFAULT 90) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_lab_observation(pg_temp.lo(n+1000),pg_temp.lo(n+2000),pg_temp.lo(o),pg_temp.lo(11),pg_temp.lo(n),a,p)
$$;
-- END OBSERVATION HELPERS

CREATE TEMP TABLE context_proofs(label text PRIMARY KEY,value jsonb);
GRANT ALL ON context_proofs TO authenticated;
SELECT is((SELECT provolatile::text FROM pg_proc WHERE oid='public.get_lab_source_context(uuid,uuid,text,text)'::regprocedure),'v','locking context RPC is not incorrectly STABLE');
SELECT ok(NOT has_function_privilege('anon','public.get_lab_source_context(uuid,uuid,text,text)','EXECUTE'),'anonymous context refused');
SELECT ok(NOT has_function_privilege('service_role','public.get_lab_source_context(uuid,uuid,text,text)','EXECUTE'),'service context refused');
SELECT ok(has_function_privilege('authenticated','public.get_lab_source_context(uuid,uuid,text,text)','EXECUTE'),'authenticated context RPC available');
SELECT ok(NOT has_table_privilege('authenticated','public.lab_observation_roots','SELECT'),'authority table stays private');
SELECT ok(NOT has_table_privilege('authenticated','public.lab_observation_requests','SELECT'),'request payload stays private');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11))$q$,'42501',NULL,'no principal refused');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(1),'aal','aal1')::text,true);
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11))$q$,'42501',NULL,'AAL1 refused');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(1),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(91),pg_temp.lo(11))$q$,'42501',NULL,'explicit organization cannot be inferred from another scope');
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(12))$q$,'42501',NULL,'directory membership alone is not patient authority');
SELECT throws_ok($q$SELECT public.get_lab_source_context(NULL,pg_temp.lo(11))$q$,'42501',NULL,'null organization denied');
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11),pg_temp.lo(100)||':potassium')$q$,'22023',NULL,'cursor requires signature');
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11),NULL,repeat('a',64))$q$,'22023',NULL,'signature requires cursor');
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11),'bad',repeat('a',64))$q$,'22023',NULL,'malformed key refused');
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11),pg_temp.lo(100)||':potassium','bad')$q$,'22023',NULL,'malformed signature refused');
INSERT INTO context_proofs VALUES('first',public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11)));
SELECT is((SELECT value->>'actor_id' FROM context_proofs WHERE label='first'),pg_temp.lo(1)::text,'expected actor explicit');
SELECT is((SELECT value->>'organization_id' FROM context_proofs WHERE label='first'),pg_temp.lo(90)::text,'selected organization explicit');
SELECT is((SELECT value->>'patient_id' FROM context_proofs WHERE label='first'),pg_temp.lo(11)::text,'patient explicit');
SELECT is((SELECT value->>'can_mutate' FROM context_proofs WHERE label='first'),'true','current clinical authority is scoped affordance');
SELECT is((SELECT jsonb_array_length(value->'items') FROM context_proofs WHERE label='first'),250,'bounded250 page');
SELECT is((SELECT value->>'next_cursor' FROM context_proofs WHERE label='first'),pg_temp.lo(183)||':creatinine','explicit last-visible cursor');
SELECT ok((SELECT value#>'{items,0,source_authority_organization_id}'='null'::jsonb FROM context_proofs WHERE label='first'),'unregistered source has no authority organization');
SELECT is((SELECT value#>'{items,0,observation}' FROM context_proofs WHERE label='first'),
 public.get_effective_lab_observations(ARRAY[pg_temp.lo(11)])#>'{items,0}','shared effective DTO unchanged');
DO $loop$ DECLARE previous jsonb; next jsonb; n integer:=2; BEGIN
 SELECT value INTO previous FROM context_proofs WHERE label='first';
 LOOP
  EXIT WHEN previous->>'next_cursor' IS NULL;
  next:=public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11),previous->>'next_cursor',previous->>'snapshot');
  INSERT INTO context_proofs VALUES('page'||n,next); n:=n+1; previous:=next;
 END LOOP;
END $loop$;
SELECT is((SELECT count(*) FROM context_proofs),5::bigint,'all five pages recovered');
SELECT is((SELECT sum(jsonb_array_length(value->'items')) FROM context_proofs),1054::bigint,'all original analytes preserved');
SELECT is((SELECT jsonb_array_length(value->'items') FROM context_proofs WHERE label='page5'),54,'tail54 explicit');
SELECT is((SELECT count(DISTINCT item#>>'{observation,id}') FROM context_proofs CROSS JOIN LATERAL jsonb_array_elements(value->'items') item),1054::bigint,'no duplicate keys');
SELECT is((SELECT count(DISTINCT value->>'snapshot') FROM context_proofs),1::bigint,'same whole-composition hash');
SELECT pg_temp.lo_prepare(100); SELECT public.apply_lab_observation(pg_temp.lo(1100));
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11),(SELECT value->>'next_cursor' FROM context_proofs WHERE label='first'),(SELECT value->>'snapshot' FROM context_proofs WHERE label='first'))$q$,
 '40001',NULL,'registration invalidates old signature');
INSERT INTO context_proofs VALUES('registered',public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11)));
SELECT is((SELECT value#>>'{items,2,source_authority_organization_id}' FROM context_proofs WHERE label='registered'),pg_temp.lo(90)::text,'registered authority is explicit');
SELECT ok(NOT((SELECT value#>'{items,2}' FROM context_proofs WHERE label='registered') ?| ARRAY['actor_id','organization_name','payload','source_fingerprint']),'no extra identifying private metadata');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(3),'aal','aal2')::text,true);
INSERT INTO context_proofs VALUES('other-org',public.get_lab_source_context(pg_temp.lo(91),pg_temp.lo(11)));
SELECT is((SELECT value#>>'{items,2,source_authority_organization_id}' FROM context_proofs WHERE label='other-org'),pg_temp.lo(90)::text,'another scope sees authority without transferring it');
SELECT throws_ok($q$SELECT public.prepare_lab_observation_change(pg_temp.lo(9000),pg_temp.lo(2100),pg_temp.lo(91),pg_temp.lo(11),1,'cancel_source',pg_temp.lo_payload()||'{"reason":"Invalid synthetic source"}')$q$,
 '42501',NULL,'other organization cannot change visible source');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(2),'aal','aal2')::text,true);
SELECT is(public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11))->>'can_mutate','false','monitor-only source context allowed without mutation');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(1),'aal','aal2')::text,true);
RESET ROLE;
UPDATE public.member_authorizations SET granted_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()-interval '1 second'
 WHERE capability='clinical_disposition' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.lo(1));
SET LOCAL ROLE authenticated;
SELECT is(public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11))->>'can_mutate','false','expired clinical grant does not disable monitor recovery');
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11),(SELECT value->>'next_cursor' FROM context_proofs WHERE label='registered'),(SELECT value->>'snapshot' FROM context_proofs WHERE label='registered'))$q$,
 '40001',NULL,'capability changes invalidate signature');
SELECT lives_ok($q$SELECT public.get_lab_observation_request(pg_temp.lo(1100)); SELECT public.acknowledge_lab_observation(pg_temp.lo(1100))$q$,'monitor recovers and acknowledges historical state after clinical expiry');
RESET ROLE;
UPDATE public.member_authorizations SET expires_at=NULL WHERE capability='clinical_disposition';
UPDATE public.lab_results SET notes='Changed beyond page one' WHERE id=pg_temp.lo(449);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11),(SELECT value->>'next_cursor' FROM context_proofs WHERE label='registered'),(SELECT value->>'snapshot' FROM context_proofs WHERE label='registered'))$q$,
 '40001',NULL,'unseen tail source change invalidates whole composition');
RESET ROLE;
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.lo(1);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11))$q$,'42501',NULL,'revoked patient link denied');
RESET ROLE;
UPDATE public.provider_patient_links SET status='active' WHERE provider_id=pg_temp.lo(1);
UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.lo(1);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11))$q$,'42501',NULL,'revoked registration consent denied');
RESET ROLE;
UPDATE public.consents SET accepted=true WHERE user_id=pg_temp.lo(1);
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='monitor' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.lo(1));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11))$q$,'42501',NULL,'clinical grant alone never replaces monitoring scope');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.alerts),0::bigint,'context reads do not generate alerts');
SELECT is((SELECT count(*) FROM public.work_items),0::bigint,'context reads do not create care work');
SELECT * FROM finish();
ROLLBACK;
