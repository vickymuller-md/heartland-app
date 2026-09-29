-- Exact barrier resolution; synthetic fixtures and every mutation roll back.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
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

-- BEGIN RESOLUTION HELPERS
CREATE FUNCTION pg_temp.cr_payload(c jsonb,x uuid,disposition text DEFAULT 'barrier_addressed',override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.cs_payload(jsonb_build_object('exception',(SELECT value FROM jsonb_array_elements(c->'exceptions') WHERE (value->>'exception_id')::uuid=x),
  'disposition',disposition,'resolution_reason','Documented synthetic barrier resolution'),override)
$$;
CREATE FUNCTION pg_temp.cr_from_context(n integer,c jsonb,payload jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_care_human_request(pg_temp.cs(n),(c->>'work_item_id')::uuid,(c->>'organization_id')::uuid,(c->>'patient_id')::uuid,
  (c->>'workflow_revision')::bigint,(c->>'ownership_revision')::bigint,'resolve_exception',c->'basis',c->>'basis_signature',payload)
$$;
CREATE FUNCTION pg_temp.cr_prepare(n integer,w integer,x uuid,disposition text DEFAULT 'barrier_addressed',override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c jsonb;
BEGIN c:=public.get_care_human_context(pg_temp.cs(w),'resolve_exception');
 RETURN pg_temp.cr_from_context(n,c,pg_temp.cr_payload(c,x,disposition,override)); END $$;
CREATE FUNCTION pg_temp.cr_apply(n integer,w integer,x uuid,disposition text DEFAULT 'barrier_addressed',override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.cr_prepare(n,w,x,disposition,override); RETURN public.apply_care_human_request(pg_temp.cs(n)); END $$;
CREATE FUNCTION pg_temp.cr_counts(w integer,n integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_build_array(
  (SELECT count(*) FROM public.care_human_events WHERE work_item_id=pg_temp.cs(w)),
  (SELECT count(*) FROM public.care_exception_resolutions WHERE work_item_id=pg_temp.cs(w)),
  (SELECT to_jsonb(f) FROM public.care_workflows f WHERE work_item_id=pg_temp.cs(w)),
  (SELECT to_jsonb(i) FROM public.work_items i WHERE id=pg_temp.cs(w)),
  (SELECT to_jsonb(r) FROM public.care_human_requests r WHERE id=pg_temp.cs(n)),
  (SELECT count(*) FROM public.care_workflow_write_context))
$$;
-- END RESOLUTION HELPERS
CREATE TEMP TABLE resolution_proofs(label text PRIMARY KEY,value jsonb);
GRANT ALL ON resolution_proofs TO authenticated;
SELECT ok(NOT has_table_privilege('authenticated','public.care_exception_resolutions','INSERT'),'no direct resolution insert');
SELECT ok(NOT has_table_privilege('service_role','public.care_exception_resolutions','SELECT'),'no service resolution reader');
SELECT ok(NOT has_function_privilege('authenticated','public.care_exception_snapshot(uuid,uuid)','EXECUTE'),'private snapshot helper');
SELECT ok(NOT has_function_privilege('authenticated','public.care_followup_deadline(uuid)','EXECUTE'),'private deadline helper');
SELECT ok(NOT has_function_privilege('anon','public.get_care_human_context(uuid,text)','EXECUTE'),'anonymous context denied');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
SELECT pg_temp.cs_new(100);
SELECT pg_temp.ch_apply(10000,100,'record_contact',jsonb_build_object('outcome','no_answer','exception_id',pg_temp.cs(9001),'reason','Earlier synthetic no answer'),
 jsonb_build_object('next_review_at',pg_temp.cs_instant(now()+interval '6 hours')));
SELECT pg_temp.ch_apply(10001,100,'record_contact',jsonb_build_object('outcome','refused','exception_id',pg_temp.cs(9002),'reason','Independent synthetic refusal'),
 jsonb_build_object('next_review_at',pg_temp.cs_instant(now()+interval '10 hours')));
INSERT INTO resolution_proofs VALUES('original',public.get_care_human_context(pg_temp.cs(100),'resolve_exception'));
SELECT is(jsonb_array_length((SELECT value->'exceptions' FROM resolution_proofs WHERE label='original')),2,'two separately identified open barriers');
SELECT is((SELECT value#>>'{exceptions,0,origin_revision}' FROM resolution_proofs WHERE label='original'),'2','origin revision is not current workflow revision');
SELECT is((SELECT value#>'{exceptions,0,origin_event_id}' FROM resolution_proofs WHERE label='original'),'null'::jsonb,'human origin not falsified as step');
SELECT is((SELECT value#>>'{exceptions,0,human_origin_event_id}' FROM resolution_proofs WHERE label='original'),
 public.get_care_human_request(pg_temp.cs(10000))#>>'{receipt,event_id}','exact human origin retained');
SELECT ok(NOT(public.get_care_human_context(pg_temp.cs(100),'record_contact')?'exceptions'),'existing contact context shape unchanged');
INSERT INTO resolution_proofs VALUES('prepared',pg_temp.cr_prepare(11000,100,pg_temp.cs(9001)));
SELECT is(public.get_care_workflow(pg_temp.cs(100))->>'due_at',(SELECT value#>>'{exceptions,0,next_review_at}' FROM resolution_proofs WHERE label='original'),'preparation does not remove earlier deadline');
INSERT INTO resolution_proofs VALUES('applied',public.apply_care_human_request(pg_temp.cs(11000)));
SELECT is((SELECT value#>>'{receipt,resolved_exception_id}' FROM resolution_proofs WHERE label='applied'),pg_temp.cs(9001)::text,'receipt names exact resolved barrier');
SELECT is((SELECT value#>'{receipt,exception_id}' FROM resolution_proofs WHERE label='applied'),'null'::jsonb,'does not pretend to create a contact barrier');
SELECT is((SELECT value#>>'{receipt,resolution_event_id}' FROM resolution_proofs WHERE label='applied'),
 (SELECT value#>>'{receipt,event_id}' FROM resolution_proofs WHERE label='applied'),'resolution references its immutable human event');
SELECT is((SELECT value#>>'{receipt,stage}' FROM resolution_proofs WHERE label='applied'),'requested','resolution preserves factual stage');
SELECT is((SELECT value#>>'{receipt,workflow_revision}' FROM resolution_proofs WHERE label='applied'),'4','one operational revision');
SELECT is((SELECT value#>>ARRAY['receipt',flag] FROM resolution_proofs WHERE label='applied'),'false','resolution flag stays false: '||flag)
 FROM unnest(ARRAY['clinical_review_recorded','addresses_current_review','communication_confirmed','care_completed']) flag;
SELECT is(public.get_care_workflow(pg_temp.cs(100))->>'due_at',(SELECT value#>>'{exceptions,1,next_review_at}' FROM resolution_proofs WHERE label='original'),'second barrier retains earliest deadline');
SELECT is(jsonb_array_length(public.get_care_human_context(pg_temp.cs(100),'resolve_exception')->'exceptions'),1,'only unresolved barrier in current context');
SELECT is(public.get_care_human_context(pg_temp.cs(100),'resolve_exception')#>'{exceptions,0}',
 (SELECT value#>'{exceptions,1}' FROM resolution_proofs WHERE label='original'),'other barrier is byte-identical');
SELECT is(public.get_care_workflow_steps(pg_temp.cs(100))#>>'{exceptions,0,id}',pg_temp.cs(9001)::text,'history preserves resolved origin');
SELECT is(jsonb_array_length(public.get_care_workflow_steps(pg_temp.cs(100))->'exceptions'),2,'history retains both barriers');
SELECT is(public.get_care_human_context(pg_temp.cs(100),'resolve_exception')->'basis',
 (SELECT value->'basis' FROM resolution_proofs WHERE label='original'),'resolution does not change clinical evidence basis');
SELECT is(public.apply_care_human_request(pg_temp.cs(11000)),(SELECT value FROM resolution_proofs WHERE label='applied'),'exact replay is historical');
SELECT is(pg_temp.cr_from_context(11000,(SELECT value FROM resolution_proofs WHERE label='original'),
 (SELECT value->'payload' FROM resolution_proofs WHERE label='prepared')),(SELECT value FROM resolution_proofs WHERE label='applied'),'prepare replay preserves identity and terminal state');
SELECT throws_ok($q$SELECT pg_temp.cr_from_context(11001,public.get_care_human_context(pg_temp.cs(100),'resolve_exception'),
 (SELECT value->'payload' FROM resolution_proofs WHERE label='prepared'))$q$,'40001',NULL,'another request cannot resolve the same target');
SELECT is(public.acknowledge_care_human_request(pg_temp.cs(11000))->>'state','applied','ACK is receipt processing only');
SELECT is(public.cancel_care_human_request(pg_temp.cs(11000))->>'state','applied','cancel of terminal resolution reports applied');

SELECT pg_temp.cs_step(12000,100,'record_collection');
SELECT is(public.get_care_workflow(pg_temp.cs(100))->>'due_at',(SELECT value#>>'{exceptions,1,next_review_at}' FROM resolution_proofs WHERE label='original'),'later step does not resurrect resolved deadline');
SELECT pg_temp.cc_register(6100,pg_temp.cs(4100)); SELECT pg_temp.cc_apply(12001,100,pg_temp.cc_mapping(6100));
SELECT is(public.get_care_workflow(pg_temp.cs(100))->>'due_at',(SELECT value#>>'{exceptions,1,next_review_at}' FROM resolution_proofs WHERE label='original'),'later composition does not resurrect resolved deadline');
SELECT pg_temp.ch_apply(12002,100,'record_contact');
SELECT is(public.get_care_workflow(pg_temp.cs(100))->>'due_at',(SELECT value#>>'{exceptions,1,next_review_at}' FROM resolution_proofs WHERE label='original'),'later contact does not resurrect resolved deadline');
SELECT pg_temp.ch_apply(12003,100);
SELECT pg_temp.cr_apply(12004,100,pg_temp.cs(9002),'clinical_non_delivery');
SELECT is(public.get_care_human_context(pg_temp.cs(100),'record_contact')#>>'{latest_review,is_current}','true','resolving a barrier does not stale unchanged clinical evidence');
SELECT is(jsonb_array_length(public.get_care_human_context(pg_temp.cs(100),'resolve_exception')->'exceptions'),0,'all exact targets resolved');
SELECT is((public.get_care_workflow(pg_temp.cs(100))->>'due_at')::timestamptz,now()+interval '2 days','workflow deadline remains after last barrier resolution');

SELECT pg_temp.cs_step(12005,100,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(9003),'code','other','reason','Third distinct barrier'));
INSERT INTO resolution_proofs VALUES('target',public.get_care_human_context(pg_temp.cs(100),'resolve_exception'));
INSERT INTO resolution_proofs VALUES('target-payload',pg_temp.cr_payload((SELECT value FROM resolution_proofs WHERE label='target'),pg_temp.cs(9003)));
SELECT throws_ok(format('SELECT pg_temp.cr_from_context(13000,(SELECT value FROM resolution_proofs WHERE label=''target''),%L::jsonb)',
 jsonb_set((SELECT value FROM resolution_proofs WHERE label='target-payload'),path,changed)::text),sqlstate,NULL,label)
FROM (VALUES
 ('{details,exception,exception_id}'::text[],to_jsonb('invalid'::text),'22023','malformed target identity'),
 ('{details,exception,exception_id}',to_jsonb(pg_temp.cs(9999)::text),'42501','nonexistent target not visible'),
 ('{details,exception,origin_revision}','"999"','40001','false origin revision'),
 ('{details,exception,origin_revision}','"9223372036854775808"','22023','origin revision overflow'),
 ('{details,exception,origin_event_id}',to_jsonb(pg_temp.cs(9999)::text),'40001','false event origin'),
 ('{details,exception,origin_event_id}','null','22023','no origin is not valid'),
 ('{details,exception,human_origin_event_id}',to_jsonb(pg_temp.cs(9999)::text),'22023','two origins not valid'),
 ('{details,exception,reason}','"Changed old reason"','40001','cannot rewrite barrier reason'),
 ('{details,exception,next_action}','"Changed old action"','40001','cannot rewrite barrier next action'),
 ('{details,exception,next_review_at}','"2020-01-01T00:00:00Z"','40001','cannot rewrite barrier deadline'),
 ('{details,exception,code}','"no_answer"','40001','cannot reclassify origin'),
 ('{details,exception,recorded_at}','"2020-01-01T00:00:00Z"','40001','cannot rewrite origin recording'),
 ('{details,exception,origin_occurred_at}','"2020-01-01T00:00:00Z"','40001','cannot rewrite origin occurrence'),
 ('{details,disposition}','"completed_success"','22023','cannot disguise completion as resolution'),
 ('{details,resolution_reason}','" "','22023','resolution reason required'),
 ('{occurred_at}','"2020-01-01T00:00:00Z"','22023','resolution cannot predate origin'),
 ('{next_review_at}','"2020-01-01T00:00:00Z"','22023','future review required'),
 ('{unknown}','true','22023','unknown top-level field rejected')
) q(path,changed,sqlstate,label);
SELECT throws_ok(format('SELECT pg_temp.cr_from_context(13000,(SELECT value FROM resolution_proofs WHERE label=''target''),%L::jsonb)',
 ((SELECT value FROM resolution_proofs WHERE label='target-payload')#-ARRAY['details','exception',field])::text),'22023',NULL,'required snapshot field: '||field)
 FROM unnest(ARRAY['exception_id','origin_event_id','human_origin_event_id','origin_revision','origin_occurred_at','code','reason','next_action','next_review_at','recorded_at']) field;
SELECT throws_ok(format('SELECT pg_temp.cr_from_context(13000,(SELECT value FROM resolution_proofs WHERE label=''target''),%L::jsonb)',
 jsonb_set((SELECT value FROM resolution_proofs WHERE label='target-payload'),ARRAY['details','exception',field],'null'::jsonb)::text),'22023',NULL,'nonnullable snapshot field: '||field)
 FROM unnest(ARRAY['exception_id','origin_revision','origin_occurred_at','code','reason','next_action','next_review_at','recorded_at']) field;

-- Non-laboratory origins remain typed and immutable.
SELECT pg_temp.cs_new(200,'medication_access');
SELECT pg_temp.cs_step(20000,200,'record_assistance_request','{"assistance_program":"Synthetic program","request_reference":"Synthetic request"}');
SELECT pg_temp.cs_step(20001,200,'record_assistance_response','{"outcome":"denied","response_reference":"Synthetic denial"}');
INSERT INTO resolution_proofs VALUES('denied',public.get_care_human_context(pg_temp.cs(200),'resolve_exception'));
SELECT is((SELECT value#>>'{exceptions,0,code}' FROM resolution_proofs WHERE label='denied'),'assistance_denied','operational assistance denial retained');
SELECT is(pg_temp.cr_apply(20002,200,(SELECT (value#>>'{exceptions,0,exception_id}')::uuid FROM resolution_proofs WHERE label='denied'))#>>'{receipt,stage}',
 'response_received','resolving assistance barrier does not imply medication obtained');
SELECT throws_ok($q$SELECT pg_temp.cr_from_context(20003,(SELECT value FROM resolution_proofs WHERE label='target'),
 pg_temp.cr_payload((SELECT value FROM resolution_proofs WHERE label='denied'),(SELECT (value#>>'{exceptions,0,exception_id}')::uuid FROM resolution_proofs WHERE label='denied')))$q$,
 '42501',NULL,'other-work target cannot be resolved through current work');

-- Grant split: operational attestation allowed, clinical non-delivery requires the current clinical grant.
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='clinical_disposition'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.cr_prepare(13000,100,pg_temp.cs(9003),'clinical_non_delivery')$q$,'42501',NULL,'clinical disposition denied without grant');
SELECT is(pg_temp.cr_prepare(13000,100,pg_temp.cs(9003))->>'state','prepared','operational resolution can be prepared without clinical grant');
SELECT is(public.cancel_care_human_request(pg_temp.cs(13000))->>'state','cancelled','operational cancellation remains recoverable');
SELECT is(public.get_care_human_request(pg_temp.cs(12004))->>'state','applied','old clinical receipt recoverable after grant loss');
SELECT is(public.acknowledge_care_human_request(pg_temp.cs(12004))->>'state','applied','old clinical ACK does not need fresh clinical grant');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='clinical_disposition';
SET LOCAL ROLE authenticated;
SELECT pg_temp.cr_prepare(13001,100,pg_temp.cs(9003),'clinical_non_delivery');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='clinical_disposition'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(13001))$q$,'42501',NULL,'grant revoked after preparation prevents application');
SELECT is(public.get_care_human_request(pg_temp.cs(13001))->>'state','prepared','revoked attempt remains recoverable');
SELECT public.cancel_care_human_request(pg_temp.cs(13001));
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='clinical_disposition';
SET LOCAL ROLE authenticated;

-- A source invalidation is a separate outstanding entity, never consumed by resolving a barrier.
SELECT pg_temp.cc_change(14000,6100);
INSERT INTO resolution_proofs VALUES('invalidations',public.list_care_lab_invalidations(pg_temp.cs(100)));
SELECT pg_temp.cr_prepare(14001,100,pg_temp.cs(9003));
SELECT throws_ok($q$SELECT pg_temp.ch_prepare(14002,100)$q$,'23505',NULL,'resolution preparation blocks review');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(14002,100,pg_temp.cc_mapping(6100,'2'))$q$,'23505',NULL,'resolution preparation blocks composition');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(14002,100,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(9099),'code','other','reason','Conflicting step'))$q$,'23505',NULL,'resolution preparation blocks operational step');
SELECT public.cancel_care_human_request(pg_temp.cs(14001));
SELECT pg_temp.cc_prepare(14002,100,pg_temp.cc_mapping(6100,'2'));
SELECT throws_ok($q$SELECT pg_temp.cr_prepare(14003,100,pg_temp.cs(9003))$q$,'23505',NULL,'composition preparation blocks resolution');
SELECT public.cancel_care_lab_composition(pg_temp.cs(14002));
SELECT pg_temp.ch_prepare(14003,100,'record_contact');
SELECT throws_ok($q$SELECT pg_temp.cr_prepare(14004,100,pg_temp.cs(9003))$q$,'23505',NULL,'human contact preparation blocks resolution');
SELECT public.cancel_care_human_request(pg_temp.cs(14003));
SELECT pg_temp.cs_prepare(14004,100,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(9099),'code','other','reason','Conflicting step'));
SELECT throws_ok($q$SELECT pg_temp.cr_prepare(14005,100,pg_temp.cs(9003))$q$,'23505',NULL,'step preparation blocks resolution');
SELECT public.cancel_care_step(pg_temp.cs(14004));
CREATE FUNCTION pg_temp.cr_intent(n integer,w integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE submission uuid; c jsonb;
BEGIN
 SELECT request_id INTO submission FROM public.prepare_lab_submission(pg_temp.cs(11));
 c:=public.get_care_human_context(pg_temp.cs(w),'record_contact');
 RETURN public.prepare_lab_followup_intent(pg_temp.cs(n),pg_temp.cs(w),pg_temp.cs(90),pg_temp.cs(11),submission,
  (c->>'workflow_revision')::bigint,(c->>'ownership_revision')::bigint,
  jsonb_build_object('analytes','["potassium"]'::jsonb,'evidence','Synthetic private intention','occurred_at',pg_temp.cs_instant(now()-interval '1 hour')));
END $$;
SELECT pg_temp.cr_prepare(14005,100,pg_temp.cs(9003));
SELECT throws_ok($q$SELECT pg_temp.cr_intent(14006,100)$q$,'23505',NULL,'resolution blocks submission intention');
SELECT public.cancel_care_human_request(pg_temp.cs(14005));
SELECT pg_temp.cr_intent(14006,100);
SELECT throws_ok($q$SELECT pg_temp.cr_prepare(14007,100,pg_temp.cs(9003))$q$,'23505',NULL,'submission intention blocks resolution');
SELECT public.cancel_lab_followup_intent(pg_temp.cs(14006));

-- Retain an exact prepared request across failures at every write boundary.
SELECT pg_temp.cr_prepare(15000,100,pg_temp.cs(9003));
INSERT INTO resolution_proofs VALUES('rollback',pg_temp.cr_counts(100,15000));
RESET ROLE;
CREATE FUNCTION pg_temp.reject_resolution_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Synthetic resolution failure'; END $$;

CREATE TRIGGER resolution_failure AFTER INSERT ON public.care_human_events FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_resolution_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(15000))$q$,'P0001','Synthetic resolution failure','rollback after care_human_events');
SELECT is(pg_temp.cr_counts(100,15000),(SELECT value FROM resolution_proofs WHERE label='rollback'),'all writes rolled back after care_human_events');
RESET ROLE;
DROP TRIGGER resolution_failure ON public.care_human_events;

CREATE TRIGGER resolution_failure AFTER INSERT ON public.care_exception_resolutions FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_resolution_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(15000))$q$,'P0001','Synthetic resolution failure','rollback after care_exception_resolutions');
SELECT is(pg_temp.cr_counts(100,15000),(SELECT value FROM resolution_proofs WHERE label='rollback'),'all writes rolled back after care_exception_resolutions');
RESET ROLE;
DROP TRIGGER resolution_failure ON public.care_exception_resolutions;

CREATE TRIGGER resolution_failure AFTER UPDATE ON public.care_workflows FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_resolution_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(15000))$q$,'P0001','Synthetic resolution failure','rollback after care_workflows');
SELECT is(pg_temp.cr_counts(100,15000),(SELECT value FROM resolution_proofs WHERE label='rollback'),'all writes rolled back after care_workflows');
RESET ROLE;
DROP TRIGGER resolution_failure ON public.care_workflows;

CREATE TRIGGER resolution_failure AFTER UPDATE ON public.work_items FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_resolution_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(15000))$q$,'P0001','Synthetic resolution failure','rollback after work_items');
SELECT is(pg_temp.cr_counts(100,15000),(SELECT value FROM resolution_proofs WHERE label='rollback'),'all writes rolled back after work_items');
RESET ROLE;
DROP TRIGGER resolution_failure ON public.work_items;

CREATE TRIGGER resolution_failure AFTER UPDATE ON public.care_human_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_resolution_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(15000))$q$,'P0001','Synthetic resolution failure','rollback after care_human_requests');
SELECT is(pg_temp.cr_counts(100,15000),(SELECT value FROM resolution_proofs WHERE label='rollback'),'all writes rolled back after care_human_requests');
RESET ROLE;
DROP TRIGGER resolution_failure ON public.care_human_requests;

SET LOCAL ROLE authenticated;
SELECT is(public.apply_care_human_request(pg_temp.cs(15000))->>'state','applied','same request applies after failed transactions');
SELECT is(public.list_care_lab_invalidations(pg_temp.cs(100)),(SELECT value FROM resolution_proofs WHERE label='invalidations'),'source invalidations preserved byte-identically');
SELECT is(jsonb_array_length(public.get_care_workflow_steps(pg_temp.cs(100))->'exceptions'),3,'every resolved barrier remains historical');

-- Transfer and scope do not grant the new actor an old private request.
SELECT pg_temp.cs_new(300,'referral');
SELECT pg_temp.cs_step(30000,300,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(9300),'code','destination_refused','reason','Synthetic destination refusal'));
SELECT pg_temp.cr_prepare(30001,300,pg_temp.cs(9300));
SELECT public.offer_work_item_transfer(pg_temp.cs(300),pg_temp.cs(2));
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(30001))$q$,'42501',NULL,'pending transfer prevents resolution');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(2),'aal','aal2')::text,true);
SELECT public.accept_work_item_transfer(pg_temp.cs(300));
SELECT throws_ok($q$SELECT public.get_care_human_request(pg_temp.cs(30001))$q$,'42501',NULL,'new owner cannot adopt old private request');
SELECT is(pg_temp.cr_apply(30002,300,pg_temp.cs(9300))->>'state','applied','new owner records a distinct operational resolution');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);
SELECT is(public.cancel_care_human_request(pg_temp.cs(30001))->>'state','cancelled','former owner can cancel exact old preparation');
SELECT throws_ok($q$SELECT public.get_care_human_request(pg_temp.cs(30002))$q$,'42501',NULL,'former owner cannot read another private receipt');

RESET ROLE;
SELECT throws_ok($q$DELETE FROM public.care_exception_resolutions WHERE exception_id=pg_temp.cs(9001)$q$,'42501',NULL,'even owner cannot erase resolution');
SELECT throws_ok($q$UPDATE public.care_exception_resolutions SET work_item_id=pg_temp.cs(200) WHERE exception_id=pg_temp.cs(9001)$q$,'42501',NULL,'even owner cannot redirect resolution');
SELECT throws_ok($q$DELETE FROM public.care_workflow_exceptions WHERE id=pg_temp.cs(9001)$q$,'42501',NULL,'resolved origin remains immutable');
SELECT throws_ok($q$INSERT INTO public.care_exception_resolutions(exception_id,human_event_id,work_item_id)
 VALUES(pg_temp.cs(9999),pg_temp.cs(9998),pg_temp.cs(100))$q$,'42501',NULL,'insert without typed write context refused');
SELECT is((SELECT count(*) FROM public.care_workflow_write_context),0::bigint,'no leaked private write context');
SELECT is((SELECT count(*) FROM public.care_exception_resolutions r JOIN public.care_human_events h ON h.id=r.human_event_id
 JOIN public.care_human_requests q ON q.id=h.request_id WHERE q.command<>'resolve_exception'),0::bigint,'all resolutions have a typed human origin');
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='monitor'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_care_human_request(pg_temp.cs(15000))$q$,'42501',NULL,'recovery still requires current original scope');
SELECT throws_ok($q$SELECT public.get_care_human_context(pg_temp.cs(100),'resolve_exception')$q$,'42501',NULL,'resolution context fails after scope loss');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
