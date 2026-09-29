-- Synthetic mixed history. Every fixture rolls back.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
-- BEGIN COMPOSITION FIXTURES
CREATE FUNCTION pg_temp.cs(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.cs(n),'care-step-'||n||'@example.invalid','{"consent_accepted":true}' FROM unnest(ARRAY[1,2,3,11,12]) n;
UPDATE public.profiles SET role='provider' WHERE id=ANY(ARRAY[pg_temp.cs(1),pg_temp.cs(2),pg_temp.cs(3)]);
INSERT INTO public.organizations(id,name,created_by) VALUES
 (pg_temp.cs(90),'Synthetic step A',pg_temp.cs(1)),(pg_temp.cs(91),'Synthetic step B',pg_temp.cs(3));
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 SELECT pg_temp.cs(90),pg_temp.cs(n),CASE WHEN n=1 THEN 'owner' ELSE 'clinician' END,'active',now(),pg_temp.cs(1)
 FROM generate_series(1,2) n;
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES(pg_temp.cs(91),pg_temp.cs(3),'owner','active',now(),pg_temp.cs(3));
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',created_by FROM public.organization_memberships WHERE organization_id=ANY(ARRAY[pg_temp.cs(90),pg_temp.cs(91)]);
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by) VALUES
 (pg_temp.cs(90),pg_temp.cs(11),pg_temp.cs(1)),(pg_temp.cs(91),pg_temp.cs(12),pg_temp.cs(3));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 (pg_temp.cs(1),pg_temp.cs(11),'active',now()),(pg_temp.cs(2),pg_temp.cs(11),'active',now()),(pg_temp.cs(3),pg_temp.cs(12),'active',now());

INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'clinical_disposition',created_by FROM public.organization_memberships WHERE user_id IN(pg_temp.cs(1),pg_temp.cs(3));
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by) VALUES(pg_temp.cs(91),pg_temp.cs(11),pg_temp.cs(3));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES(pg_temp.cs(3),pg_temp.cs(11),'active',now());
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium,creatinine,egfr,bun,bnp,nt_probnp,hba1c,glucose,sodium,hemoglobin,ferritin,tsat,ldl)
 SELECT pg_temp.cs(n),pg_temp.cs(11),now()-interval '1 day',4.6,1.23,82,10,20,100,6.2,100,140,13,100,25,100 FROM generate_series(4100,4103) n;
-- END COMPOSITION FIXTURES
-- BEGIN COMPOSITION HELPERS
CREATE FUNCTION pg_temp.cs_instant(p_time timestamptz) RETURNS text LANGUAGE sql AS $$
 SELECT to_char(p_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
CREATE FUNCTION pg_temp.cs_new(n integer,p_kind text DEFAULT 'laboratory_order',p_accept boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM public.prepare_care_workflow_request(pg_temp.cs(n+1000),pg_temp.cs(n),pg_temp.cs(90),pg_temp.cs(11),
  jsonb_build_object('kind',p_kind,'source','external_documented','purpose','Synthetic documented follow-up',
   'evidence','Synthetic source only','occurred_at',pg_temp.cs_instant(now()-interval '1 hour'),
   'next_review_at',pg_temp.cs_instant(now()+interval '1 day'),'analytes',
   CASE WHEN p_kind='laboratory_order' THEN '["potassium","creatinine","egfr","sodium","bnp"]'::jsonb ELSE '[]'::jsonb END));
 PERFORM public.apply_care_workflow_request(pg_temp.cs(n+1000));
 IF p_accept THEN PERFORM public.accept_work_item(pg_temp.cs(n)); END IF;
END $$;
CREATE FUNCTION pg_temp.cs_payload(p_details jsonb DEFAULT '{}',p_override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurred_at',pg_temp.cs_instant(now()-interval '30 minutes'),'evidence','Synthetic event evidence',
  'next_action','Review the pending synthetic need','next_review_at',pg_temp.cs_instant(now()+interval '2 days'),'details',p_details)||p_override
$$;
CREATE FUNCTION pg_temp.cs_prepare(n integer,w integer,c text,d jsonb DEFAULT '{}',o jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f jsonb;
BEGIN
 f:=public.get_care_workflow(pg_temp.cs(w));
 RETURN public.prepare_care_step(pg_temp.cs(n),pg_temp.cs(w),(f->>'revision')::bigint,(f->>'ownership_revision')::bigint,c,pg_temp.cs_payload(d,o));
END $$;
CREATE FUNCTION pg_temp.cs_step(n integer,w integer,c text,d jsonb DEFAULT '{}',o jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.cs_prepare(n,w,c,d,o); RETURN public.apply_care_step(pg_temp.cs(n));
END $$;

CREATE FUNCTION pg_temp.cc_register(n integer,lab uuid,a text DEFAULT 'potassium',org integer DEFAULT 90) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM public.prepare_lab_observation(pg_temp.cs(n+10000),pg_temp.cs(n),pg_temp.cs(org),pg_temp.cs(11),lab,a,
  jsonb_build_object('evidence','Synthetic source only','occurred_at',pg_temp.cs_instant(now()-interval '1 hour')));
 PERFORM public.apply_lab_observation(pg_temp.cs(n+10000));
END $$;
CREATE FUNCTION pg_temp.cc_mapping(n integer,rev text DEFAULT '1',a text DEFAULT 'potassium') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(a,jsonb_build_object('root_id',pg_temp.cs(n),'expected_root_revision',rev))
$$;
CREATE FUNCTION pg_temp.cc_payload(w integer,mapping jsonb DEFAULT '{}',resolutions jsonb DEFAULT '[]',override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f jsonb; sources jsonb;
BEGIN
 f:=public.get_care_workflow(pg_temp.cs(w));
 SELECT jsonb_agg(jsonb_build_object('analyte',a#>>'{}','root_id',mapping#>ARRAY[a#>>'{}','root_id'],
  'expected_root_revision',mapping#>ARRAY[a#>>'{}','expected_root_revision']) ORDER BY (a#>>'{}') COLLATE "C") INTO sources
 FROM jsonb_array_elements(f->'requested_analytes') a;
 RETURN jsonb_build_object('sources',sources,'intent_resolutions',resolutions,'occurred_at',pg_temp.cs_instant(now()-interval '1 hour'),
  'next_review_at',pg_temp.cs_instant(now()+interval '2 days'),'next_action','Review synthetic missing evidence',
  'evidence','  Synthetic result evidence  ','reason','  Synthetic source selection  ')||override;
END $$;
CREATE FUNCTION pg_temp.cc_prepare(n integer,w integer,mapping jsonb DEFAULT '{}',resolutions jsonb DEFAULT '[]',override jsonb DEFAULT '{}')
 RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f jsonb;
BEGIN
 f:=public.get_care_workflow(pg_temp.cs(w));
 RETURN public.prepare_care_lab_composition(pg_temp.cs(n),pg_temp.cs(w),(f->>'organization_id')::uuid,pg_temp.cs(11),
  (f->>'revision')::bigint,(f->>'ownership_revision')::bigint,pg_temp.cc_payload(w,mapping,resolutions,override));
END $$;
CREATE FUNCTION pg_temp.cc_apply(n integer,w integer,mapping jsonb DEFAULT '{}',resolutions jsonb DEFAULT '[]') RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.cc_prepare(n,w,mapping,resolutions); RETURN public.apply_care_lab_composition(pg_temp.cs(n)); END $$;
CREATE FUNCTION pg_temp.cc_resolve(n integer,disposition text DEFAULT 'linked') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_array(jsonb_build_object('intent_id',pg_temp.cs(n),'disposition',disposition,'reason','Private current-owner rationale'))
$$;
CREATE FUNCTION pg_temp.cc_change(n integer,r integer,rev bigint DEFAULT 1,c text DEFAULT 'correct_source') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE payload jsonb;
BEGIN
 payload:=jsonb_build_object('reason','Synthetic corrected report','evidence','Synthetic source','occurred_at',pg_temp.cs_instant(now()-interval '1 hour'));
 IF c='correct_source' THEN payload:=payload||jsonb_build_object('value','4.2','collected_at',pg_temp.cs_instant(now()-interval '1 day')); END IF;
 PERFORM public.prepare_lab_observation_change(pg_temp.cs(n),pg_temp.cs(r),pg_temp.cs(90),pg_temp.cs(11),rev,c,payload);
 RETURN public.apply_lab_observation(pg_temp.cs(n));
END $$;
-- END COMPOSITION HELPERS
CREATE TEMP TABLE mixed_proofs(label text PRIMARY KEY,value jsonb);
GRANT ALL ON mixed_proofs TO authenticated;
SELECT ok(has_function_privilege('authenticated','public.get_care_workflow_steps(uuid)','EXECUTE'),'authorized reader grant preserved');
SELECT ok(NOT has_function_privilege('anon','public.get_care_workflow_steps(uuid)','EXECUTE'),'anonymous reader denied');
SELECT ok(NOT has_function_privilege('service_role','public.get_care_workflow_steps(uuid)','EXECUTE'),'service cannot impersonate human reader');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
SELECT pg_temp.cs_new(100); SELECT pg_temp.cs_new(101,'referral');
SELECT is(public.get_care_workflow_steps(pg_temp.cs(100))->'compositions','[]'::jsonb,'empty initial composition is explicit');
SELECT is(public.get_care_workflow_steps(pg_temp.cs(101))->'compositions','[]'::jsonb,'nonlaboratory history remains explicit and empty');
SELECT pg_temp.cc_register(6100,pg_temp.cs(4100));
SELECT pg_temp.cs_step(9000,100,'record_collection');
SELECT pg_temp.cc_apply(200,100,pg_temp.cc_mapping(6100));
SELECT pg_temp.cs_step(9001,100,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(9990),'code','report_missing','reason','Synthetic missing source'));
SELECT pg_temp.cc_apply(201,100);
INSERT INTO mixed_proofs VALUES('initial',public.get_care_workflow_steps(pg_temp.cs(100)));
SELECT is((SELECT value->>'revision' FROM mixed_proofs WHERE label='initial'),'5','full mixed revision counts each command');
SELECT is((SELECT value->>'stage' FROM mixed_proofs WHERE label='initial'),'result_received','historical received stage survives explicit unlink');
SELECT is((SELECT value#>>'{steps,0,revision}' FROM mixed_proofs WHERE label='initial'),'2','collection occurs before composition');
SELECT is((SELECT value#>>'{compositions,0,revision}' FROM mixed_proofs WHERE label='initial'),'3','composition interleaves with steps');
SELECT is((SELECT value#>>'{steps,1,revision}' FROM mixed_proofs WHERE label='initial'),'4','barrier interleaves after composition');
SELECT is((SELECT value#>>'{compositions,1,revision}' FROM mixed_proofs WHERE label='initial'),'5','unlink remains an explicit composition event');
SELECT is((SELECT value#>>'{steps,1,from_stage}' FROM mixed_proofs WHERE label='initial'),'result_received','barrier stage after composition preserved');
SELECT is((SELECT value#>>'{compositions,1,receipt,previous_event_id}' FROM mixed_proofs WHERE label='initial'),
 (SELECT value#>>'{compositions,0,id}' FROM mixed_proofs WHERE label='initial'),'composition predecessor skips intermediate step');
SELECT is((SELECT value#>>'{compositions,0,ownership_revision}' FROM mixed_proofs WHERE label='initial'),'1','historical ownership kept');
SELECT is((SELECT value#>>'{compositions,0,payload,evidence}' FROM mixed_proofs WHERE label='initial'),'  Synthetic result evidence  ','frozen evidence not rewritten');
SELECT ok((SELECT NOT(value::text LIKE '%submission_request_id%') FROM mixed_proofs WHERE label='initial'),'private intention request not exposed');
SELECT pg_temp.cc_change(9200,6100);
SELECT is(public.get_care_workflow_steps(pg_temp.cs(100)),(SELECT value FROM mixed_proofs WHERE label='initial'),'source change never changes immutable mixed history');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(9002,100,'record_collection')$q$,'22023',NULL,'old commands cannot regress result_received');
SELECT public.offer_work_item_transfer(pg_temp.cs(100),pg_temp.cs(2));
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(2),'aal','aal2')::text,true);
SELECT public.accept_work_item_transfer(pg_temp.cs(100));
INSERT INTO mixed_proofs VALUES('successor',public.get_care_workflow_steps(pg_temp.cs(100)));
SELECT is((SELECT value->'compositions' FROM mixed_proofs WHERE label='successor'),
 (SELECT value->'compositions' FROM mixed_proofs WHERE label='initial'),'successor gets unchanged prior composition evidence');
SELECT is((SELECT value#>>'{compositions,0,actor_id}' FROM mixed_proofs WHERE label='successor'),pg_temp.cs(1)::text,'historical actor is not rewritten to current owner');
SELECT is((SELECT value->>'assigned_to' FROM mixed_proofs WHERE label='successor'),pg_temp.cs(2)::text,'current owner still distinct');
SELECT pg_temp.cs_step(9003,100,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(9991),'code','other','reason','Synthetic new-owner barrier'));
SELECT is(public.get_care_workflow_steps(pg_temp.cs(100))->>'revision','6','new-owner exception can extend mixed chain');
SELECT throws_ok($q$SELECT public.get_care_workflow_steps(pg_temp.cs(101))$q$,'42501',NULL,'peer monitor alone cannot see unrelated history');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(3),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.get_care_workflow_steps(pg_temp.cs(100))$q$,'42501',NULL,'other organization source authority cannot read work history');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(2),'aal','aal1')::text,true);
SELECT throws_ok($q$SELECT public.get_care_workflow_steps(pg_temp.cs(100))$q$,'42501',NULL,'AAL1 mixed history denied');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.alerts),0::bigint,'history read and association never evaluate alerts');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.care_workflow_write_context),'no write context leaked');
SELECT * FROM finish();
ROLLBACK;
