-- Local synthetic composition proof; fixture data always rolls back.
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
CREATE TEMP TABLE intent_submissions(work integer PRIMARY KEY,submission uuid);
CREATE TEMP TABLE proofs(label text PRIMARY KEY,value jsonb);
GRANT ALL ON intent_submissions,proofs TO authenticated,service_role;
CREATE FUNCTION pg_temp.fi_payload(override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('analytes','["potassium","egfr"]'::jsonb,'evidence','  Synthetic follow-up intention  ',
  'occurred_at',pg_temp.cs_instant(now()-interval '1 hour'))||override
$$;
CREATE FUNCTION pg_temp.fi_attempt(w integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE submission uuid;
BEGIN
 SELECT request_id INTO submission FROM public.prepare_lab_submission(pg_temp.cs(11));
 INSERT INTO intent_submissions VALUES(w,submission); RETURN submission;
END $$;
CREATE FUNCTION pg_temp.fi_bind(n integer,w integer,override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE flow jsonb; submission uuid;
BEGIN
 flow:=public.get_care_workflow(pg_temp.cs(w)); SELECT s.submission INTO submission FROM intent_submissions s WHERE work=w;
 RETURN public.prepare_lab_followup_intent(pg_temp.cs(n),pg_temp.cs(w),pg_temp.cs(90),pg_temp.cs(11),submission,
  (flow->>'revision')::bigint,(flow->>'ownership_revision')::bigint,pg_temp.fi_payload(override));
END $$;
CREATE FUNCTION pg_temp.fi_save(w integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE submission uuid; receipt record;
BEGIN
 SELECT s.submission INTO submission FROM intent_submissions s WHERE work=w;
 SELECT * INTO receipt FROM public.submit_lab_result(submission,pg_temp.cs(11),'2026-01-01T12:00:00.123456-04:00',4.6,NULL,1.23);
 RETURN to_jsonb(receipt);
END $$;
CREATE FUNCTION pg_temp.fi_ack(w integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE submission uuid; lab uuid;
BEGIN
 SELECT s.submission INTO submission FROM intent_submissions s WHERE work=w;
 SELECT r.lab_result_id INTO lab FROM public.lab_submission_receipts r WHERE actor_id=pg_temp.cs(1) AND patient_id=pg_temp.cs(11) AND request_id=submission;
 PERFORM public.acknowledge_lab_submission(pg_temp.cs(11),submission,lab);
END $$;

SELECT ok(NOT has_table_privilege('authenticated','public.care_lab_composition_entries','SELECT'),'source association tables private');
SELECT ok(NOT has_table_privilege('service_role','public.care_lab_composition_requests','INSERT'),'service cannot forge human composition');
SELECT ok(NOT has_function_privilege('authenticated','public.lock_care_lab_composition(uuid,jsonb,jsonb)','EXECUTE'),'unscoped lock helper private');
SELECT ok(NOT has_function_privilege('anon','public.get_care_lab_composition(uuid)','EXECUTE'),'anonymous composition denied');
SELECT ok(NOT has_function_privilege('service_role','public.apply_care_lab_composition(uuid)','EXECUTE'),'service composition denied');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.care_lab_source_invalidations'::regclass
 AND confrelid IN('public.work_items'::regclass,'public.care_workflows'::regclass)),'fan-out has no implicit work FK');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
SELECT pg_temp.cs_new(100); SELECT pg_temp.cs_new(101); SELECT pg_temp.cs_new(102,'referral'); SELECT pg_temp.cs_new(103,'laboratory_order',false);
SELECT pg_temp.cc_register(6100,pg_temp.cs(4100)); SELECT pg_temp.cc_register(6101,pg_temp.cs(4101));
SELECT pg_temp.cc_register(6102,pg_temp.cs(4102),'creatinine');
SELECT is(public.get_care_lab_composition(pg_temp.cs(100))->>'composition_event_id',NULL,'initial workflow has no fabricated composition');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(200,100)$q$,'22023',NULL,'initial all-missing without saved reconciliation denied');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(200,102,pg_temp.cc_mapping(6100))$q$,'22023',NULL,'referral cannot link laboratory composition');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(200,103,pg_temp.cc_mapping(6100))$q$,'42501',NULL,'acceptance required');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(200,100,pg_temp.cc_mapping(6100,'2'))$q$,'40001',NULL,'source revision checked');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(200,100,pg_temp.cc_mapping(6102))$q$,'42501',NULL,'wrong analyte root denied');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(200,100,pg_temp.cc_mapping(9999))$q$,'42501',NULL,'unknown root denied');
SELECT throws_ok(format('SELECT pg_temp.cc_prepare(200,100,pg_temp.cc_mapping(6100),%L::jsonb,%L::jsonb)','[]',payload),'22023',NULL,'malformed source payload refused')
 FROM unnest(ARRAY['{"sources":[]}','{"sources":[{"analyte":"potassium","root_id":null,"expected_root_revision":"1"}]}',
 '{"sources":[{"analyte":"potassium","root_id":"bad","expected_root_revision":"1"}]}','{"intent_resolutions":[{}]}',
 '{"evidence":"  "}','{"reason":"  "}','{"occurred_at":"2099-01-01T00:00:00Z"}','{"next_review_at":"2000-01-01T00:00:00Z"}','{"extra":true}']) payload;
INSERT INTO proofs VALUES('prepared',pg_temp.cc_prepare(200,100,pg_temp.cc_mapping(6100)));
SELECT is(public.get_care_lab_composition_request(pg_temp.cs(200)),(SELECT value FROM proofs WHERE label='prepared'),'prepared command recovered exactly');
SELECT is(pg_temp.cc_prepare(200,100,pg_temp.cc_mapping(6100)),(SELECT value FROM proofs WHERE label='prepared'),'identical preparation replay');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(200,100,pg_temp.cc_mapping(6101))$q$,'23505',NULL,'changed frozen mapping conflicts');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(201,100,pg_temp.cc_mapping(6100))$q$,'23505',NULL,'pending composition cannot be silently replaced');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(9000,100,'record_collection')$q$,'23505',NULL,'prepared composition excludes step');
SELECT pg_temp.fi_attempt(100);
SELECT throws_ok($q$SELECT pg_temp.fi_bind(9001,100)$q$,'23505',NULL,'prepared composition excludes new intention');
SELECT public.cancel_lab_submission(pg_temp.cs(11),(SELECT submission FROM intent_submissions WHERE work=100));
INSERT INTO proofs VALUES('applied',public.apply_care_lab_composition(pg_temp.cs(200)));
SELECT is((SELECT value#>>'{receipt,stage}' FROM proofs WHERE label='applied'),'result_received','partial mapping records result_received');
SELECT is((SELECT value#>>'{receipt,workflow_revision}' FROM proofs WHERE label='applied'),'2','one operational revision');
SELECT is((SELECT value#>>'{receipt,clinical_review_recorded}' FROM proofs WHERE label='applied'),'false','linkage is not review');
SELECT is(public.apply_care_lab_composition(pg_temp.cs(200)),(SELECT value FROM proofs WHERE label='applied'),'terminal replay has no duplicate effects');
SELECT lives_ok($q$SELECT public.acknowledge_care_lab_composition(pg_temp.cs(200))$q$,'receipt ACK supported');
INSERT INTO proofs VALUES('detail',public.get_care_lab_composition(pg_temp.cs(100)));
SELECT is((SELECT count(*)::int FROM proofs CROSS JOIN LATERAL jsonb_array_elements(value->'sources') s WHERE label='detail' AND s->>'quality'='missing'),4,'other requested analytes remain missing');
SELECT is((SELECT s->>'evaluation_status' FROM proofs CROSS JOIN LATERAL jsonb_array_elements(value->'sources') s WHERE label='detail' AND s->>'analyte'='potassium'),'pending','pending processing remains explicit');
SELECT pg_temp.cs_step(9002,100,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(9990),'code','report_missing','reason','Synthetic missing source'));
SELECT pg_temp.cc_apply(201,101,pg_temp.cc_mapping(6100));
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(3),'aal','aal2')::text,true);
SELECT public.prepare_care_workflow_request(pg_temp.cs(1300),pg_temp.cs(300),pg_temp.cs(91),pg_temp.cs(11),
 jsonb_build_object('kind','laboratory_order','source','external_documented','purpose','Synthetic shared-root follow-up','evidence','Synthetic source',
 'occurred_at',pg_temp.cs_instant(now()-interval '1 hour'),'next_review_at',pg_temp.cs_instant(now()+interval '1 day'),'analytes','["potassium"]'::jsonb));
SELECT public.apply_care_workflow_request(pg_temp.cs(1300)); SELECT public.accept_work_item(pg_temp.cs(300));
SELECT lives_ok($q$SELECT pg_temp.cc_apply(301,300,pg_temp.cc_mapping(6100))$q$,'second organization may associate visible source');
SELECT throws_ok($q$SELECT public.prepare_lab_observation_change(pg_temp.cs(9300),pg_temp.cs(6100),pg_temp.cs(91),pg_temp.cs(11),1,'cancel_source',
 jsonb_build_object('reason','Synthetic reason','evidence','Synthetic source','occurred_at',pg_temp.cs_instant(now()-interval '1 hour')))$q$,'42501',NULL,'association cannot borrow correction authority');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
SELECT pg_temp.cc_change(9200,6100);
SELECT is(public.get_care_lab_composition(pg_temp.cs(100))->>'invalidation_count','1','composition then unrelated step still invalidated');
SELECT is(public.get_care_lab_composition(pg_temp.cs(101))->>'invalidation_count','1','second dependent workflow invalidated');
SELECT is((public.list_care_lab_invalidations(pg_temp.cs(100))->'items'->0->>'root_id'),pg_temp.cs(6100)::text,'invalidation identifies exact source');
SELECT is(public.get_care_lab_composition_request(pg_temp.cs(200))->'receipt',(SELECT value->'receipt' FROM proofs WHERE label='applied'),'source correction never rewrites original link receipt');
SELECT lives_ok($q$SELECT public.prepare_care_lab_composition(pg_temp.cs(200),pg_temp.cs(100),pg_temp.cs(90),pg_temp.cs(11),1,1,(SELECT value->'payload' FROM proofs WHERE label='prepared'))$q$,'old preparation replay after changed source/work revision');
SELECT pg_temp.cc_apply(202,100,pg_temp.cc_mapping(6101));
SELECT pg_temp.cc_change(9201,6100,2,'cancel_source');
SELECT is(public.get_care_lab_composition(pg_temp.cs(100))->>'invalidation_count','1','old removed root does not fan out to replacement');
SELECT is(public.get_care_lab_composition(pg_temp.cs(101))->>'invalidation_count','2','still-linked cancelled root gets another invalidation');
SELECT is((SELECT s->>'quality' FROM jsonb_array_elements(public.get_care_lab_composition(pg_temp.cs(101))->'sources') s WHERE s->>'analyte'='potassium'),'cancelled','cancellation never falls back to earlier value');
SELECT pg_temp.cc_apply(203,100);
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.get_care_lab_composition(pg_temp.cs(100))->'sources') s WHERE s->>'quality'='missing'),5,'explicit unlink preserves complete missing mapping');
SELECT is(public.get_care_lab_composition(pg_temp.cs(100))->>'stage','result_received','unlink preserves historical stage without asserting completion');
SELECT is(public.get_care_lab_composition(pg_temp.cs(100))->>'invalidation_count','1','composition replacement does not silently resolve prior invalidation');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.care_lab_source_invalidations),5::bigint,'atomic fan-out covers all three then two dependent works');
SELECT throws_ok($q$DELETE FROM public.care_lab_composition_entries$q$,'42501',NULL,'immutable association history cannot be deleted');
SELECT throws_ok($q$UPDATE public.care_lab_source_invalidations SET recorded_at=now()$q$,'42501',NULL,'invalidation history immutable');
SELECT is((SELECT count(*) FROM public.alerts),0::bigint,'composition/correction does not run automatic evaluation');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(2),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.get_care_lab_composition(pg_temp.cs(100))$q$,'42501',NULL,'monitor alone cannot read peer work');
SELECT throws_ok($q$SELECT public.list_care_lab_intentions(pg_temp.cs(100))$q$,'42501',NULL,'peer routing requires existing work visibility');
SELECT throws_ok($q$SELECT public.get_care_lab_composition_request(pg_temp.cs(200))$q$,'42501',NULL,'peer cannot read private command');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
-- Exact save reconciliation, after ACK and ownership transfer.
SELECT pg_temp.cs_new(104); SELECT pg_temp.fi_attempt(104); SELECT pg_temp.fi_bind(9400,104); SELECT pg_temp.fi_save(104); SELECT pg_temp.fi_ack(104);
RESET ROLE;
SELECT pg_temp.cs(1);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
SELECT pg_temp.cc_register(6104,(public.get_lab_followup_intent(pg_temp.cs(9400))#>>'{submission,lab_result_id}')::uuid);
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(204,104,pg_temp.cc_mapping(6104))$q$,'23505',NULL,'own saved intention must be explicitly reconciled');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(204,104,pg_temp.cc_mapping(6101),pg_temp.cc_resolve(9400))$q$,'22023',NULL,'unrelated newer panel cannot stand in for exact save');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(204,104,pg_temp.cc_mapping(6104),pg_temp.cc_resolve(9400,'not_used'))$q$,'22023',NULL,'not-used cannot contradict a mapped source');
SELECT public.offer_work_item_transfer(pg_temp.cs(104),pg_temp.cs(2));
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(2),'aal','aal2')::text,true);
SELECT public.accept_work_item_transfer(pg_temp.cs(104));
INSERT INTO proofs VALUES('route',public.list_care_lab_intentions(pg_temp.cs(104)));
SELECT is((SELECT jsonb_array_length(value->'items') FROM proofs WHERE label='route'),1,'current owner sees predecessor saved obligation');
SELECT ok((SELECT value::text NOT LIKE '%Synthetic follow-up intention%' AND value::text NOT LIKE '%submission_request_id%' FROM proofs WHERE label='route'),'routing omits private evidence and submission identity');
SELECT lives_ok($q$SELECT pg_temp.cc_apply(204,104,pg_temp.cc_mapping(6104),pg_temp.cc_resolve(9400))$q$,'new accepted owner reconciles exact saved partial source');
SELECT is(jsonb_array_length(public.list_care_lab_intentions(pg_temp.cs(104))->'items'),0,'consumed intent leaves routing');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
INSERT INTO proofs VALUES('reconciled',public.get_lab_followup_intent(pg_temp.cs(9400)));
SELECT is((SELECT value->>'state' FROM proofs WHERE label='reconciled'),'reconciled','original actor recovers actual resolution');
SELECT is((SELECT value->>'result_linked' FROM proofs WHERE label='reconciled'),'true','linked subset is explicitly recorded');
SELECT is((SELECT value#>'{reconciliation,missing_analytes}' FROM proofs WHERE label='reconciled'),'["egfr"]'::jsonb,'missing intended analyte retained');
SELECT ok((SELECT value::text NOT LIKE '%Private current-owner rationale%' FROM proofs WHERE label='reconciled'),'prior actor cannot recover new owner private reason');
SELECT is(public.cancel_lab_followup_intent(pg_temp.cs(9400))->>'state','reconciled','late intent cancellation cannot undo a link');
SELECT pg_temp.cs_new(105); SELECT pg_temp.fi_attempt(105); SELECT pg_temp.fi_bind(9401,105); SELECT pg_temp.fi_save(105); SELECT pg_temp.fi_ack(105);
SELECT lives_ok($q$SELECT pg_temp.cc_apply(205,105,'{}',pg_temp.cc_resolve(9401,'not_used'))$q$,'initial all-missing not-used reconciliation has a safe exit');
SELECT is(public.get_care_lab_composition(pg_temp.cs(105))->>'stage','requested','not-used escape does not manufacture result_received');
SELECT is(public.get_lab_followup_intent(pg_temp.cs(9401))->>'result_linked','false','not-used is not linked');
SELECT lives_ok($q$SELECT pg_temp.cs_step(9500,105,'record_collection')$q$,'reconciled intent releases the next operational command');

-- All thirteen requested analytes remain individually identified.
SELECT public.prepare_care_workflow_request(pg_temp.cs(1200),pg_temp.cs(2000),pg_temp.cs(90),pg_temp.cs(11),
 jsonb_build_object('kind','laboratory_order','source','external_documented','purpose','Synthetic full source map','evidence','Synthetic evidence',
 'occurred_at',pg_temp.cs_instant(now()-interval '1 hour'),'next_review_at',pg_temp.cs_instant(now()+interval '1 day'),
 'analytes','["potassium","creatinine","egfr","bun","bnp","nt_probnp","hba1c","glucose","sodium","hemoglobin","ferritin","tsat","ldl"]'::jsonb));
SELECT public.apply_care_workflow_request(pg_temp.cs(1200)); SELECT public.accept_work_item(pg_temp.cs(2000));
SELECT pg_temp.cc_register(6200+n::int,pg_temp.cs(4103),a) FROM unnest(ARRAY['potassium','creatinine','egfr','bun','bnp','nt_probnp','hba1c','glucose','sodium','hemoglobin','ferritin','tsat','ldl']) WITH ORDINALITY v(a,n);
INSERT INTO proofs SELECT 'all13',pg_temp.cc_apply(210,2000,jsonb_object_agg(a,jsonb_build_object('root_id',pg_temp.cs(6200+n::int),'expected_root_revision','1')))
 FROM unnest(ARRAY['potassium','creatinine','egfr','bun','bnp','nt_probnp','hba1c','glucose','sodium','hemoglobin','ferritin','tsat','ldl']) WITH ORDINALITY v(a,n);
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(public.get_care_lab_composition(pg_temp.cs(2000))->'sources') s WHERE s->>'quality'='available'),13,'all thirteen sources projected without panel collapse');
SELECT pg_temp.cs_new(106); SELECT pg_temp.cs_prepare(9501,106,'record_collection');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(206,106,pg_temp.cc_mapping(6101))$q$,'23505',NULL,'prepared step excludes composition in opposite order');
SELECT public.cancel_care_step(pg_temp.cs(9501));
SELECT pg_temp.cc_apply(206,106,pg_temp.cc_mapping(6101));
SELECT throws_ok($q$SELECT public.prepare_care_lab_composition(pg_temp.cs(209),pg_temp.cs(106),pg_temp.cs(90),pg_temp.cs(11),1,1,pg_temp.cc_payload(106,pg_temp.cc_mapping(6101)))$q$,'40001',NULL,'workflow revision fences fresh mapping');
SELECT throws_ok($q$SELECT public.prepare_care_lab_composition(pg_temp.cs(209),pg_temp.cs(106),pg_temp.cs(90),pg_temp.cs(11),2,99,pg_temp.cc_payload(106,pg_temp.cc_mapping(6101)))$q$,'40001',NULL,'ownership revision fences fresh mapping');
SELECT throws_ok($q$SELECT public.prepare_care_lab_composition(pg_temp.cs(209),pg_temp.cs(106),pg_temp.cs(91),pg_temp.cs(11),2,1,pg_temp.cc_payload(106,pg_temp.cc_mapping(6101)))$q$,'42501',NULL,'explicit wrong organization rejected');

-- Authorized successors can read immutable compositions and reasons, not private intentions.
SELECT public.offer_work_item_transfer(pg_temp.cs(105),pg_temp.cs(2));
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(2),'aal','aal2')::text,true);
SELECT public.accept_work_item_transfer(pg_temp.cs(105));
INSERT INTO proofs VALUES('successor-history',public.list_care_lab_composition_history(pg_temp.cs(105)));
SELECT is((SELECT value#>>'{items,0,receipt,intent_resolutions,0,reason}' FROM proofs WHERE label='successor-history'),'Private current-owner rationale','successor sees documented reconciliation rationale');
SELECT ok((SELECT value::text NOT LIKE '%Synthetic follow-up intention%' FROM proofs WHERE label='successor-history'),'history never embeds predecessor private intention evidence');
SELECT throws_ok($q$SELECT public.get_care_lab_composition_request(pg_temp.cs(205))$q$,'42501',NULL,'shared history does not make private request public');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);

-- Every new write rolls back with its surrounding command.
SELECT pg_temp.cs_new(108); SELECT pg_temp.fi_attempt(108); SELECT pg_temp.fi_bind(9403,108); SELECT pg_temp.fi_save(108); SELECT pg_temp.fi_ack(108);
SELECT pg_temp.cc_register(6108,(public.get_lab_followup_intent(pg_temp.cs(9403))#>>'{submission,lab_result_id}')::uuid);
SELECT pg_temp.cc_prepare(208,108,pg_temp.cc_mapping(6108),pg_temp.cc_resolve(9403));
RESET ROLE;
CREATE FUNCTION pg_temp.fail_composition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Synthetic composition failure'; END $$;
CREATE FUNCTION pg_temp.composition_write_failures() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE t text; operation text; before_count bigint;
BEGIN
 SELECT count(*) INTO before_count FROM public.care_lab_composition_events;
 FOREACH t IN ARRAY ARRAY['care_lab_composition_events','care_lab_composition_entries','lab_followup_intent_resolutions',
  'lab_followup_submission_intents','care_workflows','work_items','care_lab_composition_requests'] LOOP
  operation:=CASE WHEN t IN('care_lab_composition_events','care_lab_composition_entries','lab_followup_intent_resolutions') THEN 'INSERT' ELSE 'UPDATE' END;
  EXECUTE format('CREATE TRIGGER force_composition_failure AFTER %s ON public.%I FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_composition()',operation,t);
  SET LOCAL ROLE authenticated;
  RETURN NEXT throws_ok('SELECT public.apply_care_lab_composition(pg_temp.cs(208))','P0001','Synthetic composition failure','rollback after '||t);
  RESET ROLE;
  EXECUTE format('DROP TRIGGER force_composition_failure ON public.%I',t);
  RETURN NEXT ok((SELECT revision=1 AND stage='requested' FROM public.care_workflows WHERE work_item_id=pg_temp.cs(108))
   AND(SELECT state='prepared' FROM public.lab_followup_submission_intents WHERE id=pg_temp.cs(9403))
   AND(SELECT state='prepared' FROM public.care_lab_composition_requests WHERE id=pg_temp.cs(208))
   AND(SELECT count(*)=before_count FROM public.care_lab_composition_events)
   AND NOT EXISTS(SELECT 1 FROM public.lab_followup_intent_resolutions WHERE intent_id=pg_temp.cs(9403)),
   'all composition and intention effects rolled back after '||t);
 END LOOP;
END $$;
SELECT * FROM pg_temp.composition_write_failures();
CREATE TRIGGER force_composition_failure AFTER INSERT ON public.care_lab_composition_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_composition();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(211,106,pg_temp.cc_mapping(6101))$q$,'P0001','Synthetic composition failure','prepare insert failure rolls back');
RESET ROLE;
DROP TRIGGER force_composition_failure ON public.care_lab_composition_requests;
SELECT ok(NOT EXISTS(SELECT 1 FROM public.care_lab_composition_requests WHERE id=pg_temp.cs(211)),'failed preparation leaves no identity');
CREATE TRIGGER force_composition_failure AFTER INSERT ON public.care_lab_source_invalidations FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_composition();
CREATE TEMP TABLE before_change AS SELECT (SELECT count(*) FROM public.lab_results) AS labs,(SELECT count(*) FROM public.lab_observation_versions) AS versions,
 (SELECT count(*) FROM public.lab_observation_change_events) AS changes,(SELECT count(*) FROM public.care_lab_source_invalidations) AS invalidations;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.cc_change(9202,6101)$q$,'P0001','Synthetic composition failure','fan-out failure rolls amendment and all dependent invalidations back');
RESET ROLE;
DROP TRIGGER force_composition_failure ON public.care_lab_source_invalidations;
SELECT ok((SELECT labs=(SELECT count(*) FROM public.lab_results) AND versions=(SELECT count(*) FROM public.lab_observation_versions)
 AND changes=(SELECT count(*) FROM public.lab_observation_change_events) AND invalidations=(SELECT count(*) FROM public.care_lab_source_invalidations) FROM before_change),'all source-change effects rolled back');
SELECT is(public.lab_observation_head_snapshot(pg_temp.cs(6101))->>'revision','1','failed fan-out preserves exact source head');
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT public.apply_care_lab_composition(pg_temp.cs(208))$q$,'same frozen request succeeds after transient write failures');

-- Complete25+tail request and immutable-history pagination.
SELECT pg_temp.cs_new(109);
SELECT pg_temp.cc_apply(3000+n,109,pg_temp.cc_mapping(6101)) FROM generate_series(1,27) n;
INSERT INTO proofs VALUES('history1',public.list_care_lab_composition_history(pg_temp.cs(109)));
INSERT INTO proofs VALUES('history2',public.list_care_lab_composition_history(pg_temp.cs(109),(SELECT(value->>'next_cursor')::bigint FROM proofs WHERE label='history1')));
SELECT is((SELECT jsonb_array_length(value->'items') FROM proofs WHERE label='history1'),25,'history page bounded25');
SELECT is((SELECT jsonb_array_length(value->'items') FROM proofs WHERE label='history2'),2,'history tail complete');
SELECT is((SELECT value#>>'{items,0,receipt,workflow_revision}' FROM proofs WHERE label='history2'),'27','history revision cursor does not round or skip');
INSERT INTO proofs VALUES('pending1',public.list_pending_care_lab_compositions(pg_temp.cs(90),pg_temp.cs(11)));
INSERT INTO proofs VALUES('pending2',public.list_pending_care_lab_compositions(pg_temp.cs(90),pg_temp.cs(11),(SELECT(value->>'next_cursor')::uuid FROM proofs WHERE label='pending1')));
SELECT is((SELECT jsonb_array_length(value->'items') FROM proofs WHERE label='pending1'),25,'pending commands bounded25');
SELECT ok((SELECT jsonb_array_length(value->'items')>0 FROM proofs WHERE label='pending2'),'pending commands tail preserved');

-- A later fan-out failure also rolls back invalidations already inserted.
RESET ROLE;
CREATE SEQUENCE pg_temp.fanout_insert_counter;
CREATE FUNCTION pg_temp.fail_second_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF nextval('pg_temp.fanout_insert_counter')=2 THEN RAISE EXCEPTION 'Synthetic second fan-out failure'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER force_second_fanout_failure AFTER INSERT ON public.care_lab_source_invalidations FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_second_invalidation();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.cc_change(9203,6101)$q$,'P0001','Synthetic second fan-out failure','second dependent insert failure rolls back prior invalidation');
RESET ROLE;
DROP TRIGGER force_second_fanout_failure ON public.care_lab_source_invalidations;
SELECT is((SELECT last_value FROM pg_temp.fanout_insert_counter),2::bigint,'failure occurred after first invalidation write');
SELECT ok((SELECT labs=(SELECT count(*) FROM public.lab_results) AND versions=(SELECT count(*) FROM public.lab_observation_versions)
 AND changes=(SELECT count(*) FROM public.lab_observation_change_events) AND invalidations=(SELECT count(*) FROM public.care_lab_source_invalidations) FROM before_change),
 'second fan-out failure preserves all original source and invalidation counts');
SET LOCAL ROLE authenticated;
SELECT pg_temp.cc_change(100000+n,6101,n) FROM generate_series(1,27) n;
INSERT INTO proofs VALUES('invalidations1',public.list_care_lab_invalidations(pg_temp.cs(109)));
INSERT INTO proofs VALUES('invalidations2',public.list_care_lab_invalidations(pg_temp.cs(109),(SELECT(value->>'next_cursor')::uuid FROM proofs WHERE label='invalidations1')));
SELECT is((SELECT jsonb_array_length(value->'items') FROM proofs WHERE label='invalidations1'),25,'invalidation page bounded25');
SELECT is((SELECT jsonb_array_length(value->'items') FROM proofs WHERE label='invalidations2'),2,'invalidation tail complete');
SELECT is((SELECT count(DISTINCT row->>'id') FROM proofs CROSS JOIN LATERAL jsonb_array_elements(value->'items') row
 WHERE label IN('invalidations1','invalidations2')),27::bigint,'all exact invalidations recovered once');
SELECT ok((SELECT value->>'next_cursor' IS NULL FROM proofs WHERE label='invalidations2'),'invalidation tail explicitly terminal');

-- Reconciled intentions still preserve exact save provenance against erasure.
RESET ROLE;
SELECT is((SELECT count(*) FROM public.lab_followup_submission_intents WHERE actor_id=pg_temp.cs(1) AND state='prepared'),0::bigint,'erasure fixture has no prepared intention hiding the reconciled case');
CREATE TEMP TABLE before_erasure AS SELECT (SELECT count(*) FROM public.lab_submission_receipts) AS receipts,
 (SELECT count(*) FROM public.lab_followup_intent_resolutions) AS resolutions,(SELECT count(*) FROM public.lab_results) AS labs;
UPDATE public.profiles SET role='tester',sandbox_expires_at=clock_timestamp()-interval '1 day' WHERE id=pg_temp.cs(1);
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$SELECT public.purge_expired_tester_provenance(pg_temp.cs(1))$q$,'23503',NULL,'reconciled exact save remains protected against erasure');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.lab_provenance_erasures),0::bigint,'refused reconciled erasure leaves no ledger');
SELECT ok((SELECT receipts=(SELECT count(*) FROM public.lab_submission_receipts) AND resolutions=(SELECT count(*) FROM public.lab_followup_intent_resolutions)
 AND labs=(SELECT count(*) FROM public.lab_results) FROM before_erasure),'reconciled saves and resolutions retained');
UPDATE public.profiles SET role='provider',sandbox_expires_at=NULL WHERE id=pg_temp.cs(1);

--27 accepted owners save and acknowledge independent attempts on one workflow.
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.cs(n),'composition-owner-'||n||'@example.invalid','{"consent_accepted":true}' FROM generate_series(7001,7027) n;
UPDATE public.profiles SET role='provider' WHERE id BETWEEN pg_temp.cs(7001) AND pg_temp.cs(7027);
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 SELECT pg_temp.cs(90),pg_temp.cs(n),'clinician','active',now(),pg_temp.cs(1) FROM generate_series(7001,7027) n;
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',pg_temp.cs(1) FROM public.organization_memberships WHERE user_id BETWEEN pg_temp.cs(7001) AND pg_temp.cs(7027);
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT pg_temp.cs(n),pg_temp.cs(11),'active',now() FROM generate_series(7001,7027) n;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
SELECT pg_temp.cs_new(110);
DO $routing$
DECLARE n integer; submission uuid; flow jsonb; lab uuid;
BEGIN
 FOR n IN 1..27 LOOP
  PERFORM public.offer_work_item_transfer(pg_temp.cs(110),pg_temp.cs(7000+n));
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(7000+n),'aal','aal2')::text,true);
  PERFORM public.accept_work_item_transfer(pg_temp.cs(110));
  SELECT request_id INTO submission FROM public.prepare_lab_submission(pg_temp.cs(11));
  flow:=public.get_care_workflow(pg_temp.cs(110));
  PERFORM public.prepare_lab_followup_intent(pg_temp.cs(7500+n),pg_temp.cs(110),pg_temp.cs(90),pg_temp.cs(11),submission,
   (flow->>'revision')::bigint,(flow->>'ownership_revision')::bigint,pg_temp.fi_payload());
  SELECT lab_result_id INTO lab FROM public.submit_lab_result(submission,pg_temp.cs(11),'2026-01-01T12:00:00.123456-04:00',4.6,NULL,1.23);
  PERFORM public.acknowledge_lab_submission(pg_temp.cs(11),submission,lab);
 END LOOP;
END $routing$;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
INSERT INTO proofs VALUES('routing1',public.list_care_lab_intentions(pg_temp.cs(110)));
INSERT INTO proofs VALUES('routing2',public.list_care_lab_intentions(pg_temp.cs(110),(SELECT(value->>'next_cursor')::uuid FROM proofs WHERE label='routing1')));
SELECT is((SELECT jsonb_array_length(value->'items') FROM proofs WHERE label='routing1'),25,'routing page bounded25');
SELECT is((SELECT jsonb_array_length(value->'items') FROM proofs WHERE label='routing2'),2,'routing tail complete after27 actual transfers');
SELECT is((SELECT count(DISTINCT row->>'intent_id') FROM proofs CROSS JOIN LATERAL jsonb_array_elements(value->'items') row
 WHERE label IN('routing1','routing2')),27::bigint,'all predecessor saved obligations recovered once');
SELECT ok((SELECT value->>'next_cursor' IS NULL FROM proofs WHERE label='routing2'),'routing tail explicitly terminal');
SELECT ok((SELECT bool_and(value::text NOT LIKE '%Synthetic follow-up intention%' AND value::text NOT LIKE '%submission_request_id%')
 FROM proofs WHERE label IN('routing1','routing2')),'routing across owners keeps private evidence and attempt identity out');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal1')::text,true);
SELECT throws_ok($q$SELECT public.get_care_lab_composition(pg_temp.cs(109))$q$,'42501',NULL,'AAL1 denied for current detail');
SELECT throws_ok($q$SELECT public.list_care_lab_composition_history(pg_temp.cs(109))$q$,'42501',NULL,'AAL1 denied for shared history');
RESET ROLE;
SELECT ok(NOT EXISTS(SELECT 1 FROM public.care_workflow_write_context),'no transaction write capability left behind');
SELECT * FROM finish();
ROLLBACK;
