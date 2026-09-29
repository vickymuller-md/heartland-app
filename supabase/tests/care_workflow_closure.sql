-- Synthetic closure contract; every fixture rolls back.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
-- BEGIN CLOSURE FIXTURES
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
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium,egfr)
 SELECT pg_temp.cs(base+n),pg_temp.cs(11),now()-interval '1 day',4.6,82 FROM generate_series(1,40) n CROSS JOIN unnest(ARRAY[40000,45000]) base;
-- END CLOSURE FIXTURES
-- BEGIN CLOSURE SHARED HELPERS
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
CREATE FUNCTION pg_temp.csr_actor(n integer) RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(n),'aal','aal2')::text,true)
$$;
CREATE FUNCTION pg_temp.csr_change(n integer,revision bigint DEFAULT 1,cancelled boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE payload jsonb; result jsonb;
BEGIN
 PERFORM pg_temp.csr_actor(3);
 payload:=jsonb_build_object('reason','Synthetic revised source','evidence','Private source-authority evidence',
  'occurred_at',pg_temp.cs_instant(clock_timestamp()-interval '1 hour'));
 IF NOT cancelled THEN payload:=payload||jsonb_build_object('value','4.2','collected_at',pg_temp.cs_instant(now()-interval '1 day')); END IF;
 PERFORM public.prepare_lab_observation_change(pg_temp.cs(70000+n*100+revision::integer),pg_temp.cs(30000+n),pg_temp.cs(91),pg_temp.cs(11),
  revision,CASE WHEN cancelled THEN 'cancel_source' ELSE 'correct_source' END,payload);
 result:=public.apply_lab_observation(pg_temp.cs(70000+n*100+revision::integer));
 PERFORM pg_temp.csr_actor(1); RETURN result;
END $$;
CREATE FUNCTION pg_temp.csr_setup(n integer,removed boolean DEFAULT false,cancelled boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.csr_actor(1); PERFORM pg_temp.cs_new(20000+n);
 PERFORM pg_temp.csr_actor(3); PERFORM pg_temp.cc_register(30000+n,pg_temp.cs(40000+n),'potassium',91);
 PERFORM pg_temp.csr_actor(1); PERFORM pg_temp.cc_apply(50000+n,20000+n,pg_temp.cc_mapping(30000+n));
 PERFORM pg_temp.csr_change(n,1,cancelled);
 IF removed THEN
  PERFORM pg_temp.csr_actor(3); PERFORM pg_temp.cc_register(35000+n,pg_temp.cs(45000+n),'potassium',91);
  PERFORM pg_temp.csr_actor(1); PERFORM pg_temp.cc_apply(51000+n,20000+n,pg_temp.cc_mapping(35000+n));
 END IF;
END $$;
CREATE FUNCTION pg_temp.csr_humans(n integer,uppercase boolean DEFAULT false,k integer DEFAULT 0) RETURNS void LANGUAGE plpgsql AS $$
DECLARE review text;
BEGIN
 PERFORM pg_temp.ch_apply(60000+n+k*100,20000+n,'record_review','{}',jsonb_build_object('occurred_at',pg_temp.cs_instant(clock_timestamp())));
 review:=public.get_care_human_request(pg_temp.cs(60000+n+k*100))#>>'{receipt,event_id}';
 IF uppercase THEN review:=upper(review); END IF;
 PERFORM pg_temp.ch_apply(61000+n+k*100,20000+n,'record_contact',jsonb_build_object('review_event_id',review,'review_addressed',true),
  jsonb_build_object('occurred_at',pg_temp.cs_instant(clock_timestamp())));
END $$;
CREATE FUNCTION pg_temp.csr_context(n integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.get_care_source_resolution_context(pg_temp.cs(20000+n),
  (public.list_care_lab_invalidations(pg_temp.cs(20000+n))#>>'{items,0,id}')::uuid)
$$;
CREATE FUNCTION pg_temp.csr_payload(c jsonb,override jsonb DEFAULT '{}',details_override jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.cs_payload(jsonb_build_object('invalidation',c->'invalidation','review_event_id',c#>'{latest_review,event_id}',
  'contact_event_id',c#>'{contact,event_id}','disposition',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(c#>'{basis,sources}') j
   WHERE j->>'root_id'=c#>>'{invalidation,root_id}') THEN 'retained_in_current_composition' ELSE 'no_longer_used' END,
  'resolution_reason','Synthetic explicit reconciliation','source_reviewed',true,'change_addressed_in_contact',true,
  'source_review_evidence','Explicitly reviewed this exact corrected source',
  'source_communication_evidence','Explicitly discussed this exact source change in the referenced contact')||details_override,
  jsonb_build_object('occurred_at',pg_temp.cs_instant(clock_timestamp()))||override)
$$;
CREATE FUNCTION pg_temp.csr_from_context(n integer,c jsonb,payload jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_care_human_request(pg_temp.cs(n),(c->>'work_item_id')::uuid,(c->>'organization_id')::uuid,(c->>'patient_id')::uuid,
  (c->>'workflow_revision')::bigint,(c->>'ownership_revision')::bigint,'resolve_source_invalidation',c->'basis',c->>'basis_signature',payload)
$$;
CREATE FUNCTION pg_temp.csr_prepare(n integer,w integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c jsonb;
BEGIN c:=pg_temp.csr_context(w); RETURN pg_temp.csr_from_context(n,c,pg_temp.csr_payload(c)); END $$;
CREATE FUNCTION pg_temp.csr_counts(w integer,n integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_build_array(
  (SELECT count(*) FROM public.care_human_events WHERE work_item_id=pg_temp.cs(20000+w)),
  (SELECT count(*) FROM public.care_source_invalidation_resolutions WHERE work_item_id=pg_temp.cs(20000+w)),
  (SELECT to_jsonb(f) FROM public.care_workflows f WHERE work_item_id=pg_temp.cs(20000+w)),
  (SELECT to_jsonb(i) FROM public.work_items i WHERE id=pg_temp.cs(20000+w)),
  (SELECT to_jsonb(r) FROM public.care_human_requests r WHERE id=pg_temp.cs(n)),
  (SELECT count(*) FROM public.care_workflow_write_context))
$$;
-- END CLOSURE SHARED HELPERS
-- BEGIN CLOSURE HELPERS
CREATE FUNCTION pg_temp.cl_payload(c jsonb,d jsonb DEFAULT '{}',o jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurred_at',pg_temp.cs_instant(clock_timestamp()),'evidence','Synthetic explicit closure evidence','details',
  jsonb_build_object('snapshot',c->'snapshot','outcome','Documented synthetic workflow outcome')||
  CASE WHEN c->>'command'='close_success' THEN jsonb_build_object('review_event_id',c#>'{latest_review,event_id}',
   'contact_event_id',c#>'{contact,event_id}','workflow_completed',true,'review_contact_accepted',true)
  ELSE jsonb_build_object('disposition','not_performed','reason','Documented synthetic non-delivery',
   'declarations',COALESCE((SELECT jsonb_agg(jsonb_build_object('target_type',t.kind,'target_id',t.id,
    'reason','Explicit non-delivery for this exact target','non_delivery_acknowledged',true) ORDER BY t.kind,t.id)
   FROM(SELECT 'exception' AS kind,j->>'exception_id' AS id FROM jsonb_array_elements(c#>'{snapshot,exceptions}') j
    UNION ALL SELECT 'source_invalidation',j->>'invalidation_id' FROM jsonb_array_elements(c#>'{snapshot,invalidations}') j) t),'[]')) END||d)||o
$$;
CREATE FUNCTION pg_temp.cl_from(n integer,c jsonb,p jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_care_human_request(pg_temp.cs(n),(c->>'work_item_id')::uuid,(c->>'organization_id')::uuid,(c->>'patient_id')::uuid,
  (c->>'workflow_revision')::bigint,(c->>'ownership_revision')::bigint,c->>'command',c->'basis',c->>'basis_signature',p)
$$;
CREATE FUNCTION pg_temp.cl_prepare(n integer,w integer,c text DEFAULT 'close_without_completion',d jsonb DEFAULT '{}',o jsonb DEFAULT '{}')
 RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE context jsonb;
BEGIN context:=public.get_care_closure_context(pg_temp.cs(w),c); RETURN pg_temp.cl_from(n,context,pg_temp.cl_payload(context,d,o)); END $$;
CREATE FUNCTION pg_temp.cl_apply(n integer,w integer,c text DEFAULT 'close_without_completion',d jsonb DEFAULT '{}',o jsonb DEFAULT '{}')
 RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.cl_prepare(n,w,c,d,o); RETURN public.apply_care_human_request(pg_temp.cs(n)); END $$;
CREATE FUNCTION pg_temp.cl_humans(n integer,w integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
 r:=pg_temp.ch_apply(n,w,'record_review','{}',jsonb_build_object('occurred_at',pg_temp.cs_instant(clock_timestamp())));
 PERFORM pg_temp.ch_apply(n+1,w,'record_contact',jsonb_build_object('review_event_id',r#>'{receipt,event_id}','review_addressed',true),
  jsonb_build_object('occurred_at',pg_temp.cs_instant(clock_timestamp())));
END $$;
CREATE FUNCTION pg_temp.cl_ready(n integer,w integer,kind text DEFAULT 'referral',humans boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.cs_new(w,kind);
 IF kind='referral' THEN
  PERFORM pg_temp.cs_step(n,w,'record_destination_acceptance','{"destination":"Synthetic clinic"}');
  PERFORM pg_temp.cs_step(n+1,w,'record_schedule','{"appointment_date":"2026-09-01","appointment_at":null,"appointment_timezone":null}');
  PERFORM pg_temp.cs_step(n+2,w,'record_attendance');
  PERFORM pg_temp.cs_step(n+3,w,'record_report','{"report_reference":"Synthetic_report_A"}');
 ELSIF kind='medication_access' THEN
  PERFORM pg_temp.cs_step(n,w,'record_assistance_request','{"assistance_program":"Synthetic support","request_reference":"Synthetic_request_A"}');
  PERFORM pg_temp.cs_step(n+1,w,'record_assistance_response','{"outcome":"approved","response_reference":"Synthetic_response_A"}');
  PERFORM pg_temp.cs_step(n+2,w,'record_obtained','{"source":"patient_report"}');
 END IF;
 IF humans THEN PERFORM pg_temp.cl_humans(n+4,w); END IF;
END $$;
CREATE FUNCTION pg_temp.cl_counts(w integer,n integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_build_array(
  (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM public.care_human_events e WHERE work_item_id=pg_temp.cs(w)),
  (SELECT to_jsonb(c) FROM public.care_workflow_closures c WHERE work_item_id=pg_temp.cs(w)),
  (SELECT to_jsonb(f) FROM public.care_workflows f WHERE work_item_id=pg_temp.cs(w)),
  (SELECT to_jsonb(i) FROM public.work_items i WHERE id=pg_temp.cs(w)),
  (SELECT to_jsonb(r) FROM public.care_human_requests r WHERE id=pg_temp.cs(n)),
  (SELECT count(*) FROM public.care_workflow_write_context))
$$;
CREATE FUNCTION pg_temp.cl_intent(n integer,w integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE submission uuid; c jsonb;
BEGIN
 SELECT request_id INTO submission FROM public.prepare_lab_submission(pg_temp.cs(11));
 c:=public.get_care_closure_context(pg_temp.cs(w),'close_without_completion');
 RETURN public.prepare_lab_followup_intent(pg_temp.cs(n),pg_temp.cs(w),pg_temp.cs(90),pg_temp.cs(11),submission,
  (c->>'workflow_revision')::bigint,(c->>'ownership_revision')::bigint,
  jsonb_build_object('analytes','["potassium"]'::jsonb,'evidence','Private synthetic intention not exposed in closure',
   'occurred_at',pg_temp.cs_instant(now()-interval '1 hour')));
END $$;
-- END CLOSURE HELPERS
CREATE TEMP TABLE closure_proofs(label text PRIMARY KEY,value jsonb);
GRANT ALL ON closure_proofs TO authenticated;
SELECT ok(NOT has_table_privilege(r,'public.care_workflow_closures',p),'no direct closure '||r||' '||p)
 FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p;
SELECT ok(NOT has_function_privilege(r,f,'EXECUTE'),'private closure helper '||r||' '||f)
 FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY[
 'public.care_closure_targets(uuid)','public.lock_care_closure(uuid,boolean)','public.care_closure_snapshot(uuid)',
 'public.validate_care_closure_payload(text,jsonb)','public.verify_care_closure(public.work_items,public.care_workflows,text,jsonb,jsonb)',
 'public.guard_care_closure_origin()','public.project_care_closure_time()']) f;
SET LOCAL ROLE authenticated;
SELECT pg_temp.csr_actor(1);
SELECT pg_temp.cs_new(100); SELECT pg_temp.cs_new(101,'referral'); SELECT pg_temp.cs_new(102,'medication_access');
SELECT throws_ok($q$SELECT public.get_care_closure_context(pg_temp.cs(100),'record_review')$q$,'22023',NULL,'context only accepts closure variants');
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(2000,100,'close_success')$q$,'22023',NULL,'successful closure cannot use absent review/contact');
SELECT is(pg_temp.cl_apply(2000,100)#>>'{receipt,care_completed}','false','laboratory non-completion is never successful care');
SELECT is(pg_temp.cl_apply(2001,101,'close_without_completion','{"disposition":"refused"}')#>>'{receipt,completion_outcome}','refused','referral refusal retained');
SELECT is(pg_temp.cl_apply(2002,102,'close_without_completion','{"disposition":"transferred"}')#>>'{receipt,completion_outcome}','transferred','access transfer is non-completion');
SELECT is(public.apply_care_human_request(pg_temp.cs(2000))#>>'{receipt,stage}','requested','closure does not invent final factual stage');
SELECT is(public.get_care_workflow_steps(pg_temp.cs(100))->>'work_status','closed','history reports closed work');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(2003,100,'record_schedule','{"appointment_date":"2026-09-01","appointment_at":null,"appointment_timezone":null}')$q$,'42501',NULL,'typed advance after closure denied');
RESET ROLE;
SELECT is(w.closed_at,e.recorded_at,'final closed_at matches immutable recording after all triggers') FROM public.work_items w
 JOIN public.care_workflow_closures c ON c.work_item_id=w.id JOIN public.care_human_events e ON e.id=c.human_event_id;
SELECT ok(w.closed_at>now(),'closed_at does not use transaction start') FROM public.work_items w WHERE w.id IN(pg_temp.cs(100),pg_temp.cs(101),pg_temp.cs(102));
SELECT is(outcome_code,'transferred_to_other_team','transfer uses existing non-success code') FROM public.work_items WHERE id=pg_temp.cs(102);
SELECT throws_ok($q$DELETE FROM public.care_workflow_closures WHERE work_item_id=pg_temp.cs(100)$q$,'42501',NULL,'closure immutable even for privileged SQL');
SET LOCAL ROLE authenticated;
SELECT pg_temp.cl_ready(3000,103); SELECT pg_temp.cl_ready(3100,104,'medication_access');
INSERT INTO closure_proofs VALUES('referral-context',public.get_care_closure_context(pg_temp.cs(103),'close_success'));
INSERT INTO closure_proofs VALUES('referral-payload',pg_temp.cl_payload((SELECT value FROM closure_proofs WHERE label='referral-context')));
SELECT throws_ok(format('SELECT pg_temp.cl_from(3200,(SELECT value FROM closure_proofs WHERE label=''referral-context''),%L::jsonb)',
 (jsonb_set((SELECT value FROM closure_proofs WHERE label='referral-payload'),path,replacement))::text),'22023',NULL,label)
 FROM(VALUES(ARRAY['details','workflow_completed'],'false'::jsonb,'explicit completion unchecked denied'),
 (ARRAY['details','review_contact_accepted'],'false'::jsonb,'evidence acceptance unchecked denied'),
 (ARRAY['details','outcome'],'" "'::jsonb,'blank outcome denied'),
 (ARRAY['details','review_event_id'],'null'::jsonb,'missing exact review denied')) v(path,replacement,label);
SELECT throws_ok($q$SELECT pg_temp.cl_from(3200,(SELECT value FROM closure_proofs WHERE label='referral-context'),
 (SELECT value||jsonb_build_object('next_review_at',pg_temp.cs_instant(now()+interval '1 day')) FROM closure_proofs WHERE label='referral-payload'))$q$,
 '22023',NULL,'closure forbids invented next deadline');
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3200,103,'close_success','{}',jsonb_build_object('occurred_at',pg_temp.cs_instant(now()-interval '1 day')))$q$,
 '22023',NULL,'closure cannot predate any workflow event');
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3200,103,'close_success',jsonb_build_object('contact_event_id',pg_temp.cs(3201)))$q$,
 '40001',NULL,'wrong exact contact denied');
INSERT INTO closure_proofs VALUES('before-success',pg_temp.cl_counts(103,3200));
INSERT INTO closure_proofs VALUES('success',pg_temp.cl_apply(3200,103,'close_success'));
SELECT is(value#>>'{receipt,care_completed}','true','documented workflow completion explicitly recorded') FROM closure_proofs WHERE label='success';
SELECT is(value#>>'{receipt,communication_confirmed}','false','success not independently confirmed transport') FROM closure_proofs WHERE label='success';
SELECT is(value#>>'{receipt,clinical_review_recorded}','false','closure is not another review') FROM closure_proofs WHERE label='success';
SELECT ok(NOT(value->'payload' ? 'next_action') AND NOT(value->'receipt' ? 'due_at'),'no new active next action/deadline') FROM closure_proofs WHERE label='success';
SELECT is(pg_temp.cl_counts(103,3200)#>'{2,next_review_at}',(SELECT value#>'{2,next_review_at}' FROM closure_proofs WHERE label='before-success'),'prior flow deadline preserved as historical');
SELECT is(pg_temp.cl_apply(3201,104,'close_success')#>>'{receipt,basis,operational_event,payload,details,source}','patient_report','access source label retained at completion');
SELECT is(public.cancel_care_human_request(pg_temp.cs(3200))#>'{receipt}',(SELECT value->'receipt' FROM closure_proofs WHERE label='success'),'cancel after success replays terminal decision');
SELECT is(public.acknowledge_care_human_request(pg_temp.cs(3200))#>'{receipt}',(SELECT value->'receipt' FROM closure_proofs WHERE label='success'),'ACK preserves closure receipt');

-- Exact obligations and all-known baseline, including resolved historical changes.
SELECT pg_temp.csr_setup(1); SELECT pg_temp.csr_humans(1); SELECT pg_temp.csr_prepare(62001,1); SELECT public.apply_care_human_request(pg_temp.cs(62001));
SELECT pg_temp.csr_change(1,2);
SELECT pg_temp.cs_step(3300,20001,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(3301),'code','not_performed','reason','Documented missing service'));
INSERT INTO closure_proofs VALUES('obligations',public.get_care_closure_context(pg_temp.cs(20001),'close_without_completion'));
SELECT is(jsonb_array_length(value#>'{snapshot,known_invalidation_ids}'),2,'all-known baseline contains resolved and unresolved targets') FROM closure_proofs WHERE label='obligations';
SELECT is(jsonb_array_length(value#>'{snapshot,invalidations}'),1,'unresolved snapshot excludes previously resolved target') FROM closure_proofs WHERE label='obligations';
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3302,20001,'close_without_completion','{"declarations":[]}')$q$,'22023',NULL,'each unresolved source and exception needs its own declaration');
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3302,20001,'close_without_completion','{}',jsonb_build_object('occurred_at',pg_temp.cs_instant(now())))$q$,
 '22023',NULL,'non-completion occurrence cannot precede learned source change');
INSERT INTO closure_proofs VALUES('noncompletion',pg_temp.cl_apply(3302,20001));
SELECT pg_temp.csr_change(1,3);
RESET ROLE;
SELECT is((SELECT count(*) FROM public.care_source_invalidation_resolutions WHERE work_item_id=pg_temp.cs(20001)),1::bigint,'non-completion creates no fictional source resolution');
SELECT is((SELECT count(*) FROM public.care_exception_resolutions WHERE work_item_id=pg_temp.cs(20001)),0::bigint,'non-completion creates no fictional barrier resolution');
SELECT is((SELECT count(*) FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries e ON e.id=i.entry_id
 JOIN public.care_lab_composition_events c ON c.id=e.event_id WHERE c.work_item_id=pg_temp.cs(20001)
 AND NOT((SELECT value#>'{payload,details,snapshot,known_invalidation_ids}' FROM closure_proofs WHERE label='noncompletion') ? i.id::text)),1::bigint,
 'only genuinely new post-closure invalidation is absent from complete baseline');
SET LOCAL ROLE authenticated;
SELECT is(public.apply_care_human_request(pg_temp.cs(3302))#>'{receipt}',(SELECT value->'receipt' FROM closure_proofs WHERE label='noncompletion'),'later source correction does not replay a new decision');

-- Prepared unsaved intention is not silently cancelled, even for non-completion.
SELECT pg_temp.cs_new(105); SELECT pg_temp.cl_intent(3400,105);
SELECT is(jsonb_array_length(public.get_care_closure_context(pg_temp.cs(105),'close_without_completion')#>'{snapshot,prepared_intents}'),1,'pending intention is visible');
SELECT is((public.get_care_closure_context(pg_temp.cs(105),'close_without_completion')#>'{snapshot,prepared_intents,0}')-ARRAY['intent_id','state','recorded_at'],'{}'::jsonb,'private intention evidence and submission payload not disclosed');
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3401,105)$q$,'40001',NULL,'unsaved intention blocks non-completion');

-- Missing grant and terminal monitor-only recovery.
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='clinical_disposition'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));
SET LOCAL ROLE authenticated;
SELECT pg_temp.cs_new(106);
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3500,106)$q$,'42501',NULL,'clinical permission required for fresh closure');
SELECT is(public.apply_care_human_request(pg_temp.cs(3200))#>'{receipt}',(SELECT value->'receipt' FROM closure_proofs WHERE label='success'),'terminal recovery requires no new clinical decision');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='clinical_disposition';
SET LOCAL ROLE authenticated;
SELECT pg_temp.cl_prepare(3500,106);
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(3501,106,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(3502),'code','other','reason','Pending family conflict'))$q$,'23505',NULL,'closure shares existing human/step pending exclusion');
SELECT pg_temp.cc_register(6100,pg_temp.cs(4100));
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(3501,106,pg_temp.cc_mapping(6100))$q$,'23505',NULL,'closure shares human/composition exclusion');
SELECT throws_ok($q$SELECT pg_temp.cl_intent(3501,106)$q$,'23505',NULL,'closure shares human/save-intention exclusion');
SELECT public.cancel_care_human_request(pg_temp.cs(3500));

-- Full laboratory completion must wait for processing, not merely a human review.
SELECT pg_temp.cs_new(110); SELECT pg_temp.cs_new(111);
SELECT pg_temp.cc_register(6101,pg_temp.cs(4100),'creatinine');
SELECT pg_temp.cc_register(6102,pg_temp.cs(4100),'egfr');
SELECT pg_temp.cc_register(6103,pg_temp.cs(4100),'sodium');
SELECT pg_temp.cc_register(6104,pg_temp.cs(4100),'bnp');
SELECT pg_temp.cc_apply(3600,110,pg_temp.cc_mapping(6100)||pg_temp.cc_mapping(6101,'1','creatinine')||pg_temp.cc_mapping(6102,'1','egfr')
 ||pg_temp.cc_mapping(6103,'1','sodium')||pg_temp.cc_mapping(6104,'1','bnp'));
SELECT pg_temp.cl_humans(3601,110);
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3603,110,'close_success')$q$,'40001',NULL,'complete source set but pending evaluation denies success');
SELECT pg_temp.cc_apply(3610,111,pg_temp.cc_mapping(6100)); SELECT pg_temp.cl_humans(3611,111);
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3613,111,'close_success')$q$,'40001',NULL,'partial panel never success despite review and contact');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT * FROM public.process_lab_alert_event(pg_temp.cs(4100));
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.csr_actor(1);
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3603,110,'close_success',jsonb_build_object('contact_event_id',
 public.get_care_human_request(pg_temp.cs(3602))#>'{receipt,event_id}'))$q$,'40001',NULL,'processing changes invalidate earlier human basis');
SELECT pg_temp.cl_humans(3604,110);
SELECT is(pg_temp.cl_apply(3606,110,'close_success')#>>'{receipt,care_completed}','true','all requested available analytes with reviewed completed processing allow success');
-- Explicitly seed the supported legacy terminal representation in this disposable fixture only.
RESET ROLE;
UPDATE public.lab_alert_evaluations SET source_assessment=NULL WHERE lab_result_id=pg_temp.cs(4100);
SET LOCAL ROLE authenticated;
SELECT pg_temp.cs_new(112);
SELECT pg_temp.cc_apply(3620,112,pg_temp.cc_mapping(6100)||pg_temp.cc_mapping(6101,'1','creatinine')||pg_temp.cc_mapping(6102,'1','egfr')
 ||pg_temp.cc_mapping(6103,'1','sodium')||pg_temp.cc_mapping(6104,'1','bnp'));
SELECT pg_temp.cl_humans(3621,112);
SELECT is(pg_temp.cl_apply(3623,112,'close_success')#>'{receipt,basis,processing,0,evaluation,source_assessment}','null'::jsonb,
 'legacy terminal processing allowed without manufacturing version-aware assessment');

-- Cancelled sources remain separate unresolved obligations and cannot be successful care.
SELECT pg_temp.csr_setup(2,false,true); SELECT pg_temp.csr_humans(2);
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3630,20002,'close_success')$q$,'40001',NULL,'cancelled source never authorizes successful closure');
SELECT is(pg_temp.cl_apply(3630,20002,'close_without_completion','{"disposition":"cancelled"}')#>>'{receipt,care_completed}','false','cancelled source can be explicitly acknowledged as non-completion');

-- Generic updates cannot manufacture closure, even with the service column grant.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($q$UPDATE public.work_items SET status='closed',outcome='Generic bypass attempt',outcome_code='followup_completed' WHERE id=pg_temp.cs(106)$q$,
 '42501',NULL,'generic close bypass denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.csr_actor(1);
SELECT pg_temp.cl_prepare(3700,106);
INSERT INTO closure_proofs VALUES('rollback',pg_temp.cl_counts(106,3700));
RESET ROLE;
CREATE FUNCTION pg_temp.reject_closure_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Synthetic closure failure'; END $$;


CREATE TRIGGER closure_failure AFTER INSERT ON public.care_human_events FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_closure_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(3700))$q$,'P0001','Synthetic closure failure','rollback after care_human_events');
SELECT is(pg_temp.cl_counts(106,3700),(SELECT value FROM closure_proofs WHERE label='rollback'),'complete rollback after care_human_events');
RESET ROLE;
DROP TRIGGER closure_failure ON public.care_human_events;

CREATE TRIGGER closure_failure AFTER INSERT ON public.care_workflow_closures FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_closure_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(3700))$q$,'P0001','Synthetic closure failure','rollback after care_workflow_closures');
SELECT is(pg_temp.cl_counts(106,3700),(SELECT value FROM closure_proofs WHERE label='rollback'),'complete rollback after care_workflow_closures');
RESET ROLE;
DROP TRIGGER closure_failure ON public.care_workflow_closures;

CREATE TRIGGER closure_failure AFTER UPDATE ON public.care_workflows FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_closure_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(3700))$q$,'P0001','Synthetic closure failure','rollback after care_workflows');
SELECT is(pg_temp.cl_counts(106,3700),(SELECT value FROM closure_proofs WHERE label='rollback'),'complete rollback after care_workflows');
RESET ROLE;
DROP TRIGGER closure_failure ON public.care_workflows;

CREATE TRIGGER closure_failure AFTER UPDATE ON public.work_items FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_closure_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(3700))$q$,'P0001','Synthetic closure failure','rollback after work_items');
SELECT is(pg_temp.cl_counts(106,3700),(SELECT value FROM closure_proofs WHERE label='rollback'),'complete rollback after work_items');
RESET ROLE;
DROP TRIGGER closure_failure ON public.work_items;

CREATE TRIGGER closure_failure AFTER UPDATE ON public.care_human_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_closure_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(3700))$q$,'P0001','Synthetic closure failure','rollback after care_human_requests');
SELECT is(pg_temp.cl_counts(106,3700),(SELECT value FROM closure_proofs WHERE label='rollback'),'complete rollback after care_human_requests');
RESET ROLE;
DROP TRIGGER closure_failure ON public.care_human_requests;

SET LOCAL ROLE authenticated;
SELECT is(public.apply_care_human_request(pg_temp.cs(3700))->>'state','applied','same closure succeeds after all injected failures');

-- A transferred owner's private evidence is not cancelled or ACKed by another person's closure.
RESET ROLE;
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'clinical_disposition',pg_temp.cs(1) FROM public.organization_memberships WHERE user_id=pg_temp.cs(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.cl_ready(3800,120,'referral',false);
SELECT pg_temp.ch_prepare(3806,120);
SELECT public.offer_work_item_transfer(pg_temp.cs(120),pg_temp.cs(2));
SELECT pg_temp.csr_actor(2); SELECT public.accept_work_item_transfer(pg_temp.cs(120));
SELECT is(pg_temp.cl_apply(3807,120)#>>'{receipt,work_closed}','true','new accepted owner can explicitly close despite peer private stale review');
SELECT pg_temp.csr_actor(1);
SELECT is(public.get_care_human_request(pg_temp.cs(3806))->>'state','prepared','peer private review remains prepared and recoverable');
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(3806))$q$,'42501',NULL,'peer stale review cannot apply after closure');
SELECT is(public.cancel_care_human_request(pg_temp.cs(3806))->>'state','cancelled','original actor can cancel stale private review after closure');

-- The known orphan-unsaved dependency is denied, not bypassed by the new owner.
SELECT public.cancel_lab_followup_intent(pg_temp.cs(3400));
SELECT pg_temp.cs_new(121); SELECT pg_temp.cl_intent(3810,121);
SELECT public.offer_work_item_transfer(pg_temp.cs(121),pg_temp.cs(2));
SELECT pg_temp.csr_actor(2); SELECT public.accept_work_item_transfer(pg_temp.cs(121));
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3811,121)$q$,'40001',NULL,'another actor unsaved intent also blocks closure');
SELECT throws_ok($q$SELECT public.cancel_lab_followup_intent(pg_temp.cs(3810))$q$,'42501',NULL,'closure authority does not cancel another private intention');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='monitor'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3811,121)$q$,'40001',NULL,'orphan intent remains explicit dependency after prior owner loses monitoring');
SELECT pg_temp.csr_actor(1);
SELECT throws_ok($q$SELECT public.cancel_lab_followup_intent(pg_temp.cs(3810))$q$,'42501',NULL,'prior owner without monitor cannot silently cancel orphan intention');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='monitor';
SET LOCAL ROLE authenticated;
SELECT pg_temp.csr_actor(1);

-- Canonical declaration coverage is exact, including duplicate/wrong-target denials.
SELECT pg_temp.cs_new(122);
SELECT pg_temp.cs_step(3820,122,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(3821),'code','not_performed','reason','Explicit missing service'));
INSERT INTO closure_proofs VALUES('declarations',public.get_care_closure_context(pg_temp.cs(122),'close_without_completion'));
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3822,122,'close_without_completion',jsonb_build_object('declarations',
 (pg_temp.cl_payload((SELECT value FROM closure_proofs WHERE label='declarations'))#>'{details,declarations}')||
 (pg_temp.cl_payload((SELECT value FROM closure_proofs WHERE label='declarations'))#>'{details,declarations}')))$q$,
 '22023',NULL,'duplicate target declaration denied');
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3822,122,'close_without_completion',jsonb_build_object('declarations',jsonb_build_array(
 jsonb_build_object('target_type','exception','target_id',pg_temp.cs(9999),'reason','Wrong target rationale','non_delivery_acknowledged',true))))$q$,
 '22023',NULL,'unrelated target cannot substitute exact unresolved obligation');
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(3822,122,'close_without_completion',jsonb_build_object('snapshot',
 (SELECT (value->'snapshot')-'known_invalidation_ids' FROM closure_proofs WHERE label='declarations')))$q$,
 '22023',NULL,'complete baseline is mandatory even when empty');
SELECT pg_temp.cs_step(3823,122,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(3824),'code','other','reason','Later independent barrier'));
SELECT throws_ok($q$SELECT pg_temp.cl_from(3822,(SELECT value FROM closure_proofs WHERE label='declarations'),
 pg_temp.cl_payload((SELECT value FROM closure_proofs WHERE label='declarations')))$q$,'40001',NULL,'old displayed closure context cannot omit a newly recorded barrier');

-- Private predicate unit checks complement public exact-basis CAS and registration validation.
-- No malformed source row is inserted or changed by these checks.
RESET ROLE;
SELECT throws_ok(format($q$SELECT public.verify_care_closure(
 (SELECT w FROM public.work_items w WHERE id=pg_temp.cs(112)),(SELECT f FROM public.care_workflows f WHERE work_item_id=pg_temp.cs(112)),
 'close_success',%L::jsonb,(SELECT payload FROM public.care_human_requests WHERE id=pg_temp.cs(3623)))$q$,
 jsonb_set((SELECT basis FROM public.care_human_requests WHERE id=pg_temp.cs(3623)),path,replacement)::text),
 '40001',NULL,label) FROM(VALUES
 (ARRAY['sources','0','quality'],'"invalid"'::jsonb,'invalid current source projection denies success'),
 (ARRAY['sources','0','head','collected_at'],'"infinity"'::jsonb,'non-finite collection denies success'),
 (ARRAY['sources','0','head','collected_at'],'"9999-01-01T00:00:00Z"'::jsonb,'future collection denies success'),
 (ARRAY['processing','0','evaluation'],'null'::jsonb,'absent processing proof denies success'),
 (ARRAY['processing','0','evaluation','status'],'"invalidated"'::jsonb,'invalidated processing denies success'),
 (ARRAY['processing','0','evaluation','completed_at'],'null'::jsonb,'terminal label without completion denies success')
 ) v(path,replacement,label);

SELECT * FROM finish();
ROLLBACK;
