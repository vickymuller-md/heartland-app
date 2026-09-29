-- Synthetic human evidence contract. Every fixture rolls back.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
-- BEGIN HUMAN FIXTURES
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
-- END HUMAN FIXTURES
-- BEGIN HUMAN HELPERS
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
-- END HUMAN HELPERS
-- BEGIN HUMAN COMMAND HELPERS

CREATE FUNCTION pg_temp.ch_payload(command text DEFAULT 'record_review',d jsonb DEFAULT '{}',o jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.cs_payload(CASE WHEN command='record_review' THEN '{"decision":"Documented synthetic professional decision","limitations":"Partial evidence and processing limitations retained"}'::jsonb
 ELSE '{"channel":"phone","recipient_type":"patient","recipient_reference":"Synthetic recipient","outcome":"human_reached","review_event_id":null,"review_addressed":false,"exception_id":null,"reason":null}'::jsonb END||d,o)
$$;
CREATE FUNCTION pg_temp.ch_prepare(n integer,w integer,command text DEFAULT 'record_review',d jsonb DEFAULT '{}',o jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c jsonb;
BEGIN
 c:=public.get_care_human_context(pg_temp.cs(w),command);
 RETURN public.prepare_care_human_request(pg_temp.cs(n),pg_temp.cs(w),pg_temp.cs(90),pg_temp.cs(11),
  (c->>'workflow_revision')::bigint,(c->>'ownership_revision')::bigint,command,c->'basis',c->>'basis_signature',pg_temp.ch_payload(command,d,o));
END $$;
CREATE FUNCTION pg_temp.ch_apply(n integer,w integer,command text DEFAULT 'record_review',d jsonb DEFAULT '{}',o jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.ch_prepare(n,w,command,d,o); RETURN public.apply_care_human_request(pg_temp.cs(n)); END $$;
CREATE FUNCTION pg_temp.ch_from_context(n integer,c jsonb,command text DEFAULT 'record_review',d jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_care_human_request(pg_temp.cs(n),(c->>'work_item_id')::uuid,(c->>'organization_id')::uuid,(c->>'patient_id')::uuid,
 (c->>'workflow_revision')::bigint,(c->>'ownership_revision')::bigint,command,c->'basis',c->>'basis_signature',pg_temp.ch_payload(command,d))
$$;
-- END HUMAN COMMAND HELPERS
CREATE TEMP TABLE human_proofs(label text PRIMARY KEY,value jsonb);
GRANT ALL ON human_proofs TO authenticated,service_role;
SELECT ok(has_function_privilege('authenticated','public.get_care_human_context(uuid,text)','EXECUTE'),'authenticated context entry point');
SELECT ok(NOT has_function_privilege('anon','public.get_care_human_context(uuid,text)','EXECUTE'),'anonymous context denied');
SELECT ok(NOT has_function_privilege('service_role','public.apply_care_human_request(uuid)','EXECUTE'),'service cannot attest human review');
SELECT ok(NOT has_function_privilege('authenticated','public.care_human_basis(uuid)','EXECUTE'),'raw basis helper not public');
SELECT ok(NOT has_function_privilege('authenticated','public.care_latest_human_review(uuid,jsonb)','EXECUTE'),'raw review helper not public');
SELECT ok(NOT has_table_privilege('authenticated','public.care_human_requests','INSERT'),'raw request insert denied');
SELECT ok(NOT has_table_privilege('service_role','public.care_human_events','INSERT'),'raw event insert denied');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
SELECT pg_temp.cs_new(100); SELECT pg_temp.cs_new(101); SELECT pg_temp.cs_new(103,'referral'); SELECT pg_temp.cs_new(104,'medication_access');
INSERT INTO human_proofs VALUES('empty',public.get_care_human_context(pg_temp.cs(100),'record_contact'));
SELECT is((SELECT value#>'{basis,composition_event_id}' FROM human_proofs WHERE label='empty'),'null'::jsonb,'absent composition explicit');
SELECT is(jsonb_array_length((SELECT value#>'{basis,sources}' FROM human_proofs WHERE label='empty')),5,'every requested missing analyte retained');
SELECT is((SELECT value->'latest_review' FROM human_proofs WHERE label='empty'),'null'::jsonb,'no fabricated prior review');
SELECT throws_ok($q$SELECT pg_temp.ch_prepare(10000,100)$q$,'22023',NULL,'no review before a result');
SELECT throws_ok($q$SELECT pg_temp.ch_prepare(10000,100,'record_contact','{"review_addressed":true}')$q$,'22023',NULL,'addressed requires exact review identity');
SELECT pg_temp.ch_apply(10001,100,'record_contact',jsonb_build_object('outcome','no_answer','exception_id',pg_temp.cs(9001),'reason','Synthetic no answer evidence'));
SELECT is(public.get_care_human_request(pg_temp.cs(10001))#>>'{receipt,stage}','requested','early contact preserves requested stage');
SELECT is(public.get_care_human_request(pg_temp.cs(10001))#>>'{receipt,addresses_current_review}','false','early contact not reviewed communication');
SELECT is(public.get_care_human_request(pg_temp.cs(10001))#>>'{receipt,care_completed}','false','early contact not care completion');
SELECT is(public.get_care_workflow_steps(pg_temp.cs(100))#>>'{exceptions,0,code}','no_answer','failed contact creates its barrier atomically');
SELECT pg_temp.cc_register(6100,pg_temp.cs(4100));
SELECT pg_temp.cc_apply(7000,100,pg_temp.cc_mapping(6100)); SELECT pg_temp.cc_apply(7001,101,pg_temp.cc_mapping(6100));
INSERT INTO human_proofs VALUES('partial',public.get_care_human_context(pg_temp.cs(100),'record_review'));
SELECT is(jsonb_array_length((SELECT value#>'{basis,processing}' FROM human_proofs WHERE label='partial')),1,'processing proof distinct from analyte count');
SELECT is((SELECT value#>>'{basis,processing,0,evaluation,status}' FROM human_proofs WHERE label='partial'),'pending','pending evidence remains pending');
SELECT is((SELECT value#>'{basis,processing,0,evaluation,source_assessment}' FROM human_proofs WHERE label='partial'),'null'::jsonb,'NULL assessment explicitly retained');
INSERT INTO human_proofs VALUES('review1',pg_temp.ch_apply(10002,100));
SELECT is((SELECT value#>>'{receipt,clinical_review_recorded}' FROM human_proofs WHERE label='review1'),'true','explicit authorized human review recorded');
SELECT is((SELECT value#>>'{receipt,communication_confirmed}' FROM human_proofs WHERE label='review1'),'false','review does not imply contact');
SELECT is((SELECT value#>>'{receipt,care_completed}' FROM human_proofs WHERE label='review1'),'false','partial review not completion');
SELECT is(public.get_care_human_context(pg_temp.cs(100),'record_contact')#>>'{latest_review,is_current}','true','exact partial attestation current, not complete');
SELECT is(public.cancel_care_human_request(pg_temp.cs(10002))->>'state','applied','losing cancellation preserves review');
SELECT is(public.acknowledge_care_human_request(pg_temp.cs(10002))#>'{receipt}',(SELECT value->'receipt' FROM human_proofs WHERE label='review1'),'ACK preserves immutable receipt');
SELECT is(public.get_care_human_request(pg_temp.cs(10002))#>'{receipt}',(SELECT value->'receipt' FROM human_proofs WHERE label='review1'),'ACK does not erase evidence');
SELECT pg_temp.ch_apply(10003,100,'record_contact',jsonb_build_object('review_event_id',(SELECT value#>>'{receipt,event_id}' FROM human_proofs WHERE label='review1'),'review_addressed',true));
SELECT is(public.get_care_human_request(pg_temp.cs(10003))#>>'{receipt,addresses_current_review}','true','contact explicitly addresses current exact review');
SELECT is(public.get_care_human_request(pg_temp.cs(10003))#>>'{receipt,communication_confirmed}','false','attestation is not transport or comprehension certification');
SELECT is(public.get_care_human_context(pg_temp.cs(100),'record_contact')#>>'{latest_review,is_current}','true','contact revision does not invalidate review basis');
SELECT pg_temp.cs_step(7100,100,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(9002),'code','report_missing','reason','Independent missing report'));
SELECT is(public.get_care_human_context(pg_temp.cs(100),'record_contact')#>>'{latest_review,is_current}','true','barrier revision does not invalidate review basis');
SELECT is(jsonb_array_length(public.get_care_workflow_steps(pg_temp.cs(100))->'exceptions'),2,'contact and step barriers coexist');
SELECT throws_ok($q$SELECT pg_temp.ch_prepare(10004,101,'record_contact',jsonb_build_object('review_event_id',(SELECT value#>>'{receipt,event_id}' FROM human_proofs WHERE label='review1')))$q$,'42501',NULL,'foreign-work review reference rejected even if not addressed');
INSERT INTO human_proofs VALUES('review2',pg_temp.ch_apply(10005,100));
SELECT isnt((SELECT value#>>'{receipt,event_id}' FROM human_proofs WHERE label='review2'),(SELECT value#>>'{receipt,event_id}' FROM human_proofs WHERE label='review1'),'same evidence can have a later human decision');
SELECT throws_ok($q$SELECT pg_temp.ch_prepare(10006,100,'record_contact',jsonb_build_object('review_event_id',(SELECT value#>>'{receipt,event_id}' FROM human_proofs WHERE label='review1'),'review_addressed',true))$q$,'40001',NULL,'old contact target does not cover newer review');
SELECT pg_temp.ch_apply(10006,100,'record_contact',jsonb_build_object('review_event_id',(SELECT value#>>'{receipt,event_id}' FROM human_proofs WHERE label='review1')));
SELECT is(public.get_care_human_request(pg_temp.cs(10006))#>>'{receipt,addresses_current_review}','false','explicit historical review reference remains historical');

-- A processing completion changes evidence without incrementing workflow revision.
INSERT INTO human_proofs VALUES('before-processing',public.get_care_human_context(pg_temp.cs(101),'record_review'));
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT * FROM public.process_lab_alert_event(pg_temp.cs(4100));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT pg_temp.ch_from_context(10007,(SELECT value FROM human_proofs WHERE label='before-processing'))$q$,'40001',NULL,'view-to-prepare processing change refuses silent new proof');
SELECT is(public.get_care_human_context(pg_temp.cs(100),'record_contact')#>>'{latest_review,is_current}','false','processing change stales human evidence but not source quality');
SELECT throws_ok($q$SELECT pg_temp.ch_prepare(10007,100,'record_contact',jsonb_build_object('review_event_id',(SELECT value#>>'{receipt,event_id}' FROM human_proofs WHERE label='review2'),'review_addressed',true))$q$,'40001',NULL,'contact cannot qualify stale reviewed processing');

-- Prepare then source change: no automatic rebase on application or replay.
SELECT pg_temp.ch_prepare(10008,101);
INSERT INTO human_proofs VALUES('prepared',public.get_care_human_request(pg_temp.cs(10008)));
SELECT pg_temp.cc_change(7200,6100);
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(10008))$q$,'40001',NULL,'source correction after prepare prevents attestation of unshown values');
SELECT is(public.get_care_human_request(pg_temp.cs(10008))->'basis',(SELECT value->'basis' FROM human_proofs WHERE label='prepared'),'prepared source snapshot remains immutable');
SELECT is(public.cancel_care_human_request(pg_temp.cs(10008))->>'state','cancelled','stale preparation can be deliberately cancelled');
SELECT is(public.cancel_care_human_request(pg_temp.cs(10008))->>'state','cancelled','cancellation idempotent');
SELECT throws_ok($q$SELECT public.acknowledge_care_human_request(pg_temp.cs(10008))$q$,'22023',NULL,'cancelled request has no ACK');
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(10008))$q$,'22023',NULL,'cancelled request cannot apply');
SELECT pg_temp.ch_prepare(10009,101);
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(7101,101,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(9003),'code','other','reason','Conflicting command'))$q$,'23505',NULL,'human preparation blocks care step');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(7102,101,pg_temp.cc_mapping(6100,'2'))$q$,'23505',NULL,'human preparation blocks composition');
SELECT public.cancel_care_human_request(pg_temp.cs(10009));
SELECT pg_temp.cs_prepare(7101,101,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(9003),'code','other','reason','Conflicting command'));
SELECT throws_ok($q$SELECT pg_temp.ch_prepare(10010,101)$q$,'23505',NULL,'step preparation blocks human command');
SELECT public.cancel_care_step(pg_temp.cs(7101));

-- Nonlaboratory evidence binds the exact operational fact, not arbitrary text.
SELECT is(public.get_care_human_context(pg_temp.cs(103),'record_contact')#>'{basis,operational_event}','null'::jsonb,'pre-report contact has explicit absence');
SELECT throws_ok($q$SELECT pg_temp.ch_prepare(10020,103)$q$,'22023',NULL,'referral review needs report');
SELECT pg_temp.cs_step(7110,103,'record_destination_acceptance','{"destination":"Synthetic clinic"}');
SELECT pg_temp.cs_step(7111,103,'record_schedule','{"appointment_date":"2026-09-01","appointment_at":null,"appointment_timezone":null}');
SELECT pg_temp.cs_step(7112,103,'record_attendance');
SELECT pg_temp.cs_step(7113,103,'record_report','{"report_reference":"Synthetic_report_A"}');
SELECT pg_temp.ch_apply(10020,103);
SELECT is(public.get_care_human_request(pg_temp.cs(10020))#>>'{basis,operational_event,command}','record_report','referral review retains exact report command');
SELECT is(public.get_care_human_request(pg_temp.cs(10020))#>'{basis,sources}','[]'::jsonb,'referral does not fabricate laboratory sources');
SELECT pg_temp.cs_step(7120,104,'record_assistance_request','{"assistance_program":"Synthetic support","request_reference":"Synthetic_request_A"}');
SELECT pg_temp.cs_step(7121,104,'record_assistance_response','{"outcome":"approved","response_reference":"Synthetic_response_A"}');
SELECT pg_temp.cs_step(7122,104,'record_obtained','{"source":"patient_report"}');
SELECT pg_temp.ch_apply(10021,104);
SELECT is(public.get_care_human_request(pg_temp.cs(10021))#>>'{basis,operational_event,payload,details,source}','patient_report','medication self-report remains explicitly self-report');
SELECT is(public.get_care_human_request(pg_temp.cs(10021))#>>'{receipt,stage}','obtained','review preserves factual access stage');

-- Strict payloads, exact identity, cursor recovery and rollback boundaries.
SELECT throws_ok(format('SELECT pg_temp.ch_prepare(10100,101,%L,%L::jsonb)',c,d::text),'22023',NULL,label)
FROM (VALUES
 ('record_review','{"decision":"  "}'::jsonb,'blank decision denied'),
 ('record_review','{"limitations":"  "}','blank limitations denied'),
 ('record_review','{"extra":true}','unknown review field denied'),
 ('record_contact','{"channel":"sms_auto"}','unsupported channel denied'),
 ('record_contact','{"recipient_type":"unknown"}','unsupported recipient denied'),
 ('record_contact','{"recipient_reference":" "}','blank recipient denied'),
 ('record_contact','{"outcome":"sent"}','transport is not a human contact outcome'),
 ('record_contact','{"review_addressed":"true"}','string boolean denied'),
 ('record_contact','{"review_event_id":"invalid"}','invalid review UUID denied'),
 ('record_contact','{"outcome":"no_answer"}','failed contact requires separate barrier identity'),
 ('record_contact','{"reason":"unexpected"}','successful contact cannot fabricate failed-contact barrier')
) q(c,d,label);
SELECT throws_ok(format('SELECT pg_temp.ch_prepare(10100,101,''record_review'',''{}'',%L::jsonb)',o::text),'22023',NULL,label)
FROM (VALUES
 ('{"extra":true}'::jsonb,'unknown common field denied'),
 ('{"evidence":" "}','blank evidence denied'),
 ('{"next_action":" "}','blank next action denied'),
 (jsonb_build_object('occurred_at',pg_temp.cs_instant(now()+interval '1 day')),'future occurrence denied'),
 (jsonb_build_object('next_review_at',pg_temp.cs_instant(now()-interval '1 second')),'past next review denied'),
 ('{"occurred_at":"infinity"}','infinite occurrence denied')
) q(o,label);
INSERT INTO human_proofs VALUES('identity-context',public.get_care_human_context(pg_temp.cs(101),'record_review'));
SELECT throws_ok(format('SELECT pg_temp.ch_from_context(10100,%L::jsonb)',(value||o)::text),code,NULL,q.label)
FROM human_proofs CROSS JOIN (VALUES
 (jsonb_build_object('workflow_revision','999'),'40001','workflow CAS checked'),
 (jsonb_build_object('ownership_revision','999'),'40001','ownership CAS checked'),
 (jsonb_build_object('organization_id',pg_temp.cs(91)),'42501','organization envelope checked'),
 (jsonb_build_object('patient_id',pg_temp.cs(12)),'42501','patient envelope checked'),
 (jsonb_build_object('basis_signature',repeat('0',64)),'40001','signature alone cannot substitute evidence'),
 ('{"basis":{}}'::jsonb,'40001','missing evidence cannot rebase')
) q(o,code,label) WHERE human_proofs.label='identity-context';
SELECT pg_temp.ch_prepare(10100,101);
SELECT is(pg_temp.ch_prepare(10100,101)->>'state','prepared','exact preparation replay is idempotent');
SELECT throws_ok($q$SELECT pg_temp.ch_prepare(10100,101,'record_review','{"decision":"Different decision"}')$q$,'23505',NULL,'same request cannot change decision');
SELECT public.cancel_care_human_request(pg_temp.cs(10100));

-- A new composition stales the owner CAS, not just the source signature.
SELECT pg_temp.ch_apply(10101,101);
INSERT INTO human_proofs VALUES('composition-review',public.get_care_human_context(pg_temp.cs(101),'record_contact'));
SELECT pg_temp.cc_apply(7103,101,pg_temp.cc_mapping(6100,'2'));
SELECT is(public.get_care_human_context(pg_temp.cs(101),'record_contact')#>>'{latest_review,is_current}','false','even a replacement using the same root is a new reviewed composition');
SELECT throws_ok($q$SELECT pg_temp.ch_from_context(10102,(SELECT value FROM human_proofs WHERE label='composition-review'),'record_contact')$q$,'40001',NULL,'old composition envelope cannot prepare contact');

-- Every prepared write family blocks both ways.
SELECT pg_temp.cc_prepare(7104,101,pg_temp.cc_mapping(6100,'2'));
SELECT throws_ok($q$SELECT pg_temp.ch_prepare(10102,101)$q$,'23505',NULL,'composition preparation blocks human evidence');
SELECT public.cancel_care_lab_composition(pg_temp.cs(7104));
CREATE FUNCTION pg_temp.ch_intent(n integer,w integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE submission uuid; c jsonb;
BEGIN
 SELECT request_id INTO submission FROM public.prepare_lab_submission(pg_temp.cs(11));
 c:=public.get_care_human_context(pg_temp.cs(w),'record_contact');
 RETURN public.prepare_lab_followup_intent(pg_temp.cs(n),pg_temp.cs(w),pg_temp.cs(90),pg_temp.cs(11),submission,
  (c->>'workflow_revision')::bigint,(c->>'ownership_revision')::bigint,
  jsonb_build_object('analytes','["potassium"]'::jsonb,'evidence','Synthetic private intention',
   'occurred_at',pg_temp.cs_instant(now()-interval '1 hour')));
END $$;
SELECT pg_temp.ch_prepare(10102,101);
SELECT throws_ok($q$SELECT pg_temp.ch_intent(10103,101)$q$,'23505',NULL,'human preparation blocks submission intention');
SELECT public.cancel_care_human_request(pg_temp.cs(10102));
SELECT pg_temp.ch_intent(10103,101);
SELECT throws_ok($q$SELECT pg_temp.ch_prepare(10104,101)$q$,'23505',NULL,'submission intention blocks human preparation');
SELECT public.cancel_lab_followup_intent(pg_temp.cs(10103));

-- A trigger failure after insertion of the barrier must roll back every write.
SELECT pg_temp.ch_prepare(10104,101,'record_contact',jsonb_build_object('outcome','refused','exception_id',pg_temp.cs(9010),'reason','Documented refusal'));
RESET ROLE;
CREATE FUNCTION pg_temp.reject_human_tail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Synthetic failure after human exception'; END $$;
CREATE TRIGGER human_test_failure BEFORE UPDATE ON public.care_workflows FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_human_tail();
INSERT INTO human_proofs VALUES('rollback-counts',jsonb_build_array((SELECT count(*) FROM public.care_human_events),
 (SELECT count(*) FROM public.care_workflow_exceptions),(SELECT revision FROM public.care_workflows WHERE work_item_id=pg_temp.cs(101))));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(10104))$q$,'P0001','Synthetic failure after human exception','late failure rolls back transaction');
SELECT is(public.get_care_human_request(pg_temp.cs(10104))->>'state','prepared','failed transaction leaves prepared request recoverable');
RESET ROLE;
SELECT is(jsonb_build_array((SELECT count(*) FROM public.care_human_events),(SELECT count(*) FROM public.care_workflow_exceptions),
 (SELECT revision FROM public.care_workflows WHERE work_item_id=pg_temp.cs(101))),
 (SELECT value FROM human_proofs WHERE label='rollback-counts'),'no event, barrier or revision survived rollback');
SELECT is((SELECT count(*) FROM public.care_workflow_write_context),0::bigint,'rollback removes private authorization context');
DROP TRIGGER human_test_failure ON public.care_workflows;
SET LOCAL ROLE authenticated;
SELECT is(public.apply_care_human_request(pg_temp.cs(10104))->>'state','applied','same exact preparation retries after transaction failure');

-- Legacy NULL assessment remains different from no evaluation; cancellation remains explicit.
SELECT pg_temp.cs_new(105); SELECT pg_temp.cc_register(6101,pg_temp.cs(4101)); SELECT pg_temp.cc_apply(7105,105,pg_temp.cc_mapping(6101));
RESET ROLE;
UPDATE public.lab_alert_evaluations SET status='not_required',completed_at=clock_timestamp(),source_assessment=NULL WHERE lab_result_id=pg_temp.cs(4101);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ch_apply(10105,105);
SELECT is(public.get_care_human_request(pg_temp.cs(10105))#>>'{basis,processing,0,evaluation,status}','not_required','legacy terminal status retained');
SELECT is(public.get_care_human_request(pg_temp.cs(10105))#>'{basis,processing,0,evaluation,source_assessment}','null'::jsonb,'legacy assessment not backfilled by review');
SELECT pg_temp.cc_change(7201,6101,1,'cancel_source');
SELECT pg_temp.ch_apply(10106,105);
SELECT is(public.get_care_human_request(pg_temp.cs(10106))#>'{basis,processing}','[]'::jsonb,'cancelled source does not invent effective result');
SELECT is(public.get_care_human_request(pg_temp.cs(10106))#>>'{basis,sources,3,quality}','cancelled','cancelled analyte is explicit in the attestation');
SELECT is(public.get_care_human_request(pg_temp.cs(10106))#>>'{receipt,care_completed}','false','cancelled partial review does not close care');
SELECT pg_temp.cs_new(107);
RESET ROLE;
-- Model a pre-outbox row in this rolled-back fixture, not by rewriting evaluation history.
ALTER TABLE public.lab_results DISABLE TRIGGER create_lab_alert_evaluation;
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium) VALUES(pg_temp.cs(4199),pg_temp.cs(11),now()-interval '1 day',4.1);
ALTER TABLE public.lab_results ENABLE TRIGGER create_lab_alert_evaluation;
SET LOCAL ROLE authenticated;
SELECT pg_temp.cc_register(6199,pg_temp.cs(4199)); SELECT pg_temp.cc_apply(7199,107,pg_temp.cc_mapping(6199));
SELECT pg_temp.ch_apply(10199,107);
SELECT is(public.get_care_human_request(pg_temp.cs(10199))#>'{basis,processing,0,evaluation}','null'::jsonb,'absent legacy processing is not fabricated as terminal');
SELECT is(public.get_care_human_request(pg_temp.cs(10199))#>>'{receipt,care_completed}','false','missing processing does not close care');

-- Transfer does not transfer a private request or manufacture the new owner's review.
SELECT pg_temp.cs_new(106); SELECT pg_temp.ch_prepare(10107,106,'record_contact');
SELECT public.offer_work_item_transfer(pg_temp.cs(106),pg_temp.cs(2));
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(10107))$q$,'42501',NULL,'pending transfer blocks human advancement');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(2),'aal','aal2')::text,true);
SELECT public.accept_work_item_transfer(pg_temp.cs(106));
SELECT throws_ok($q$SELECT public.get_care_human_request(pg_temp.cs(10107))$q$,'42501',NULL,'new owner cannot adopt prior private request');
SELECT is(public.get_care_human_context(pg_temp.cs(106),'record_contact')->'latest_review','null'::jsonb,'accepting transfer does not create a review');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
SELECT is(public.get_care_human_request(pg_temp.cs(10107))->>'state','prepared','former owner can recover own preparation with current monitor scope');
SELECT is(public.cancel_care_human_request(pg_temp.cs(10107))->>'state','cancelled','former owner can cancel own stale preparation');

-- Exact 25-item cursor with a nonempty tail; no metadata-only completeness claim.
RESET ROLE;
DO $$ DECLARE r record; BEGIN FOR r IN SELECT id FROM public.care_human_requests WHERE state='applied' LOOP
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
 PERFORM public.acknowledge_care_human_request(r.id); END LOOP; END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN FOR n IN 500..526 LOOP PERFORM pg_temp.cs_new(n); PERFORM pg_temp.ch_prepare(n+20000,n,'record_contact'); END LOOP; END $$;
INSERT INTO human_proofs VALUES('page1',public.list_pending_care_human_requests(pg_temp.cs(90),pg_temp.cs(11)));
INSERT INTO human_proofs VALUES('page2',public.list_pending_care_human_requests(pg_temp.cs(90),pg_temp.cs(11),
 (SELECT(value->>'next_cursor')::uuid FROM human_proofs WHERE label='page1')));
SELECT is(jsonb_array_length((SELECT value->'items' FROM human_proofs WHERE label='page1')),25,'first pending page is full');
SELECT is(jsonb_array_length((SELECT value->'items' FROM human_proofs WHERE label='page2')),2,'nonempty pending tail recovered');
SELECT is((SELECT value->'next_cursor' FROM human_proofs WHERE label='page2'),'null'::jsonb,'terminal cursor explicit');
SELECT is((SELECT count(DISTINCT j->>'request_id') FROM human_proofs CROSS JOIN LATERAL jsonb_array_elements(value->'items') j
 WHERE label IN('page1','page2')),27::bigint,'pagination covers all own requests without duplicates');

-- Clinical permission loss prevents fresh attestation, not authorized private recovery.
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='clinical_disposition'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.ch_prepare(10030,101)$q$,'42501',NULL,'fresh review requires current clinical permission');
SELECT is(public.get_care_human_request(pg_temp.cs(10002))->>'state','applied','monitor can recover own historical clinical receipt after grant loss');
SELECT is(public.apply_care_human_request(pg_temp.cs(10002))->>'state','applied','terminal replay does not rereview current sources');
SELECT is(public.acknowledge_care_human_request(pg_temp.cs(10002))->>'state','applied','terminal ACK survives clinical grant loss');
SELECT pg_temp.ch_apply(10031,101,'record_contact');
SELECT is(public.get_care_human_request(pg_temp.cs(10031))#>>'{receipt,clinical_review_recorded}','false','monitor contact does not forge clinical review');
SELECT throws_ok($q$SELECT public.care_human_basis(pg_temp.cs(100))$q$,'42501',NULL,'internal basis helper cannot bypass authorization');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(2),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.get_care_human_context(pg_temp.cs(100),'record_contact')$q$,'42501',NULL,'monitor alone does not grant peer workflow visibility');
SELECT throws_ok($q$SELECT public.get_care_human_request(pg_temp.cs(10002))$q$,'42501',NULL,'other actor cannot read private review request');
RESET ROLE;
SELECT throws_ok($q$DELETE FROM public.care_human_requests WHERE id=pg_temp.cs(10002)$q$,'42501',NULL,'even owner cannot erase immutable human request');
SELECT throws_ok($q$UPDATE public.care_human_requests SET payload='{}' WHERE id=pg_temp.cs(10002)$q$,'42501',NULL,'even owner cannot rewrite attestation payload');
SELECT throws_ok($q$DELETE FROM public.care_human_events WHERE request_id=pg_temp.cs(10002)$q$,'42501',NULL,'even owner cannot erase human event');
SELECT throws_ok($q$UPDATE public.care_human_events SET occurred_at=now() WHERE request_id=pg_temp.cs(10002)$q$,'42501',NULL,'even owner cannot rewrite human event occurrence');
SELECT throws_ok($q$INSERT INTO public.care_workflow_exceptions(id,work_item_id,human_origin_event_id,code,reason,next_action,next_review_at)
 SELECT pg_temp.cs(9900),pg_temp.cs(101),id,'no_answer','Forged source','Forged action',now()+interval '1 day'
 FROM public.care_human_events WHERE request_id=pg_temp.cs(10001)$q$,'42501',NULL,'raw foreign-work human origin denied');
SELECT is((SELECT due_at FROM public.work_items WHERE id=pg_temp.cs(100)),
 (SELECT min(next_review_at) FROM public.care_workflow_exceptions WHERE work_item_id=pg_temp.cs(100)),'oldest barrier deadline retained alongside newer human work');
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='monitor'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.get_care_human_request(pg_temp.cs(10002))$q$,'42501',NULL,'private recovery still requires current monitor scope');
SELECT throws_ok($q$SELECT public.acknowledge_care_human_request(pg_temp.cs(10002))$q$,'42501',NULL,'ACK cannot bypass monitor revocation');
SELECT throws_ok($q$SELECT public.cancel_care_human_request(pg_temp.cs(20500))$q$,'42501',NULL,'cancel cannot bypass monitor revocation');
SELECT throws_ok($q$SELECT public.list_pending_care_human_requests(pg_temp.cs(90),pg_temp.cs(11))$q$,'42501',NULL,'pending list cannot bypass monitor revocation');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.care_workflow_write_context),0::bigint,'no private write context escapes a command');
SELECT * FROM finish();
ROLLBACK;
