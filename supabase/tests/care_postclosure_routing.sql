-- Local synthetic routing proofs; no patients, hosted writes or clinical completion.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
-- BEGIN POSTCLOSURE FIXTURES
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
-- END POSTCLOSURE FIXTURES
-- BEGIN POSTCLOSURE SHARED HELPERS
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
-- END POSTCLOSURE SHARED HELPERS

-- BEGIN POSTCLOSURE HELPERS
CREATE FUNCTION pg_temp.pc_target(n integer) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
 SELECT i.id FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries e ON e.id=i.entry_id
 JOIN public.care_lab_composition_events c ON c.id=e.event_id
 WHERE c.work_item_id=pg_temp.cs(20000+n) AND public.care_postclosure_snapshot(i.id) IS NOT NULL ORDER BY i.recorded_at DESC,i.id LIMIT 1
$$;
CREATE FUNCTION pg_temp.pc_setup(n integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.csr_setup(n);
 PERFORM pg_temp.cl_apply(600000+n,20000+n);
 PERFORM pg_temp.csr_change(n,2);
 PERFORM pg_temp.cs_new(80000+n);
END $$;
CREATE FUNCTION pg_temp.pc_payload(c jsonb,o jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('snapshot',c->'snapshot','occurred_at',pg_temp.cs_instant(clock_timestamp()),
 'reason','Explicit synthetic routing decision','evidence','Synthetic accepted follow-up evidence','review_at',c->'review_at',
 'responsibility_acknowledged',true,'supersession_acknowledged',(c->>'routing_revision')::bigint>0)||o
$$;
CREATE FUNCTION pg_temp.pc_from(n integer,c jsonb,p jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_care_postclosure_request(pg_temp.cs(n),(c#>>'{snapshot,invalidation_id}')::uuid,(c->>'work_item_id')::uuid,
 (c->>'organization_id')::uuid,(c->>'patient_id')::uuid,(c->>'workflow_revision')::bigint,(c->>'ownership_revision')::bigint,
 (c->>'routing_revision')::bigint,(c->>'previous_event_id')::uuid,p)
$$;
CREATE FUNCTION pg_temp.pc_prepare(r integer,n integer,w integer DEFAULT NULL,o jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c jsonb;
BEGIN c:=public.get_care_postclosure_context(pg_temp.pc_target(n),pg_temp.cs(COALESCE(w,80000+n)));
 RETURN pg_temp.pc_from(r,c,pg_temp.pc_payload(c,o)); END $$;
CREATE FUNCTION pg_temp.pc_apply(r integer,n integer,w integer DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.pc_prepare(r,n,w); RETURN public.apply_care_postclosure_request(pg_temp.cs(r)); END $$;
CREATE FUNCTION pg_temp.pc_fingerprint(n integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_build_object('requests',(SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]')
 FROM public.care_postclosure_requests q WHERE invalidation_id=pg_temp.pc_target(n)),
 'events',(SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM public.care_postclosure_events e WHERE invalidation_id=pg_temp.pc_target(n)),
 'work',(SELECT to_jsonb(w) FROM public.work_items w WHERE id=pg_temp.cs(80000+n)),
 'workflow',(SELECT to_jsonb(f) FROM public.care_workflows f WHERE work_item_id=pg_temp.cs(80000+n)),
 'predecessor',(SELECT to_jsonb(w) FROM public.work_items w WHERE id=pg_temp.cs(20000+n)),
 'clinical_resolutions',(SELECT count(*) FROM public.care_source_invalidation_resolutions WHERE work_item_id=pg_temp.cs(20000+n)))
$$;
CREATE FUNCTION pg_temp.pc_intent(n integer,w integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE submission uuid; c jsonb;
BEGIN
 SELECT request_id INTO submission FROM public.prepare_lab_submission(pg_temp.cs(11));
 c:=public.get_care_closure_context(pg_temp.cs(w),'close_without_completion');
 RETURN public.prepare_lab_followup_intent(pg_temp.cs(n),pg_temp.cs(w),pg_temp.cs(90),pg_temp.cs(11),submission,
  (c->>'workflow_revision')::bigint,(c->>'ownership_revision')::bigint,
  jsonb_build_object('analytes','["potassium"]'::jsonb,'evidence','Private synthetic unsaved evidence',
   'occurred_at',pg_temp.cs_instant(now()-interval '1 hour')));
END $$;
CREATE FUNCTION pg_temp.pc_unsaved(n integer,w integer,i integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c jsonb;
BEGIN
 c:=public.get_care_unsaved_intent_context(pg_temp.cs(w),pg_temp.cs(i));
 RETURN public.prepare_care_unsaved_intent_request(pg_temp.cs(n),pg_temp.cs(w),pg_temp.cs(i),pg_temp.cs(90),pg_temp.cs(11),
  (c->>'workflow_revision')::bigint,(c->>'ownership_revision')::bigint,
  jsonb_build_object('snapshot',c->'snapshot','occurred_at',pg_temp.cs_instant(clock_timestamp()),
   'evidence','Synthetic cancellation evidence','reason','Explicit synthetic non-delivery','unsaved_cancellation_acknowledged',true));
END $$;
-- END POSTCLOSURE HELPERS
CREATE TEMP TABLE pc_proofs(label text PRIMARY KEY,value jsonb);
GRANT ALL ON pc_proofs TO authenticated;
SELECT ok(NOT has_table_privilege(r,'public.'||t,p),'no raw '||r||' '||t||' '||p)
 FROM unnest(ARRAY['anon','authenticated','service_role']) r
 CROSS JOIN unnest(ARRAY['care_postclosure_requests','care_postclosure_events']) t
 CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p;
SELECT ok(NOT has_function_privilege(r,f,'EXECUTE'),'private helper '||r||' '||f)
 FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY[
 'public.care_postclosure_snapshot(uuid)','public.care_postclosure_current(uuid)','public.care_postclosure_rows(uuid)',
 'public.lock_care_postclosure(uuid,uuid)','public.verify_care_postclosure_successor(uuid,uuid,bigint,bigint)',
 'public.care_postclosure_request_state(uuid)','public.guard_care_postclosure_history()','public.guard_care_postclosure_pending()']) f;
SET LOCAL ROLE authenticated;
SELECT pg_temp.csr_actor(1);
-- All-known baseline: one resolved and one unresolved change before closure, third afterwards.
SELECT pg_temp.csr_setup(1); SELECT pg_temp.csr_humans(1); SELECT pg_temp.csr_prepare(62001,1);
SELECT public.apply_care_human_request(pg_temp.cs(62001)); SELECT pg_temp.csr_change(1,2);
INSERT INTO pc_proofs VALUES('closure',pg_temp.cl_apply(600001,20001));
SELECT is(jsonb_array_length(value#>'{payload,details,snapshot,known_invalidation_ids}'),2,'closure freezes resolved and unresolved baseline') FROM pc_proofs WHERE label='closure';
SELECT is(jsonb_array_length(public.list_care_postclosure_needs(pg_temp.cs(90))->'items'),0,'baseline changes are not new needs');
SELECT pg_temp.cs_new(81001);
SELECT pg_temp.csr_change(1,3); SELECT pg_temp.cs_new(80001);
SELECT is(jsonb_array_length(public.list_care_postclosure_needs(pg_temp.cs(90))->'items'),1,'exact later correction becomes a need');
SELECT is(public.list_care_postclosure_needs(pg_temp.cs(90))#>>'{items,0,routing_state}','unrouted','new need starts unrouted');
SELECT throws_ok($q$SELECT public.get_care_postclosure_context(pg_temp.pc_target(1),pg_temp.cs(81001))$q$,'40001',NULL,'server creation before correction rejected despite transaction-start equality');
SELECT throws_ok($q$SELECT public.get_care_postclosure_context(pg_temp.pc_target(1),pg_temp.cs(20001))$q$,'42501',NULL,'predecessor cannot be its own successor');
SELECT throws_ok($q$SELECT public.get_care_postclosure_context(pg_temp.cs(999999),pg_temp.cs(80001))$q$,'42501',NULL,'unknown need hidden');
SELECT pg_temp.cs_new(82001,'referral');
SELECT throws_ok($q$SELECT public.get_care_postclosure_context(pg_temp.pc_target(1),pg_temp.cs(82001))$q$,'40001',NULL,'wrong workflow kind rejected');
SELECT pg_temp.cs_new(82002,'laboratory_order',false);
SELECT throws_ok($q$SELECT public.get_care_postclosure_context(pg_temp.pc_target(1),pg_temp.cs(82002))$q$,'42501',NULL,'unaccepted successor rejected');
INSERT INTO pc_proofs VALUES('context',public.get_care_postclosure_context(pg_temp.pc_target(1),pg_temp.cs(80001)));
INSERT INTO pc_proofs VALUES('payload',pg_temp.pc_payload((SELECT value FROM pc_proofs WHERE label='context')));
SELECT is(value->>'routing_revision','0','initial routing revision is separate zero') FROM pc_proofs WHERE label='context';
SELECT ok(NOT(value->'snapshot' ?| ARRAY['value','evidence','reason','payload','submission_request_id']),'minimal origin omits predecessor private content and source value') FROM pc_proofs WHERE label='context';
SELECT throws_ok(format('SELECT pg_temp.pc_from(90001,(SELECT value FROM pc_proofs WHERE label=''context''),%L::jsonb)',
 jsonb_set((SELECT value FROM pc_proofs WHERE label='payload'),path,replacement)::text),code,NULL,label)
 FROM(VALUES
 (ARRAY['responsibility_acknowledged'],'false'::jsonb,'22023','unchecked responsibility'),
 (ARRAY['supersession_acknowledged'],'true'::jsonb,'22023','initial link cannot pretend supersession'),
 (ARRAY['reason'],'""'::jsonb,'22023','blank reason'),
 (ARRAY['evidence'],'null'::jsonb,'22023','null evidence'),
 (ARRAY['snapshot','analyte'],'"egfr"'::jsonb,'40001','tampered origin'),
 (ARRAY['occurred_at'],to_jsonb(pg_temp.cs_instant(clock_timestamp()+interval '1 day')),'22023','future occurrence'),
 (ARRAY['occurred_at'],to_jsonb(pg_temp.cs_instant(now())),'22023','occurrence before recorded creation'),
 (ARRAY['review_at'],to_jsonb(pg_temp.cs_instant(now()+interval '3 days')),'22023','invented review instant')
 ) v(path,replacement,code,label);
SELECT throws_ok($q$SELECT pg_temp.pc_from(90001,(SELECT value FROM pc_proofs WHERE label='context'),(SELECT value||'{"unknown":true}' FROM pc_proofs WHERE label='payload'))$q$,'22023',NULL,'unknown payload field rejected');
SELECT throws_ok($q$SELECT pg_temp.pc_from(90001,(SELECT value||'{"routing_revision":"1"}' FROM pc_proofs WHERE label='context'),(SELECT value FROM pc_proofs WHERE label='payload'))$q$,'40001',NULL,'routing CAS checked');
INSERT INTO pc_proofs VALUES('before',pg_temp.pc_fingerprint(1));
INSERT INTO pc_proofs VALUES('prepared',pg_temp.pc_from(90001,(SELECT value FROM pc_proofs WHERE label='context'),(SELECT value FROM pc_proofs WHERE label='payload')));
SELECT is(value->>'state','prepared','prepare persists immutable intention') FROM pc_proofs WHERE label='prepared';
SELECT is(pg_temp.pc_from(90001,(SELECT value FROM pc_proofs WHERE label='context'),(SELECT value FROM pc_proofs WHERE label='payload')),
 (SELECT value FROM pc_proofs WHERE label='prepared'),'same UUID exact prepare replay');
SELECT throws_ok($q$SELECT pg_temp.pc_from(90001,(SELECT value FROM pc_proofs WHERE label='context'),(SELECT value||'{"reason":"changed"}' FROM pc_proofs WHERE label='payload'))$q$,'23505',NULL,'UUID cannot be reused with different payload');
SELECT throws_ok($q$SELECT pg_temp.pc_prepare(90002,1)$q$,'23505',NULL,'one own prepared routing per child/target');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(90003,80001,'record_exception','{"exception_id":"60000000-0000-4000-8000-000000099001","code":"not_performed","reason":"Synthetic barrier"}')$q$,'23505',NULL,'route blocks typed step prepare');
SELECT is(jsonb_array_length(public.list_pending_care_postclosure_requests(pg_temp.cs(90),pg_temp.cs(11))->'items'),1,'prepared request recoverable');
SELECT throws_ok($q$SELECT public.acknowledge_care_postclosure_request(pg_temp.cs(90001))$q$,'22023',NULL,'cannot acknowledge absent receipt');
INSERT INTO pc_proofs VALUES('applied',public.apply_care_postclosure_request(pg_temp.cs(90001)));
SELECT is(value->>'state','applied','apply stores event and receipt') FROM pc_proofs WHERE label='applied';
SELECT is(value#>>'{receipt,routing_revision}','1','first journal event increments only routing revision') FROM pc_proofs WHERE label='applied';
SELECT is(value#>>'{receipt,delegated}','true','receipt records delegation') FROM pc_proofs WHERE label='applied';
SELECT is(value#>>ARRAY['receipt',f],'false','no invented '||f) FROM pc_proofs CROSS JOIN unnest(ARRAY[
 'clinical_invalidation_resolved','clinical_review_recorded','communication_confirmed','care_completed']) f WHERE label='applied';
SELECT is(pg_temp.pc_fingerprint(1)->f,(SELECT value->f FROM pc_proofs WHERE label='before'),'routing preserves '||f)
 FROM unnest(ARRAY['work','workflow','predecessor','clinical_resolutions']) f;
SELECT is(public.apply_care_postclosure_request(pg_temp.cs(90001)),(SELECT value FROM pc_proofs WHERE label='applied'),'lost apply response replays exact state');
SELECT is(public.cancel_care_postclosure_request(pg_temp.cs(90001)),(SELECT value FROM pc_proofs WHERE label='applied'),'cancel after apply does not undo routing');
SELECT is(public.list_care_postclosure_needs(pg_temp.cs(90))#>>'{items,0,routing_state}','delegated','current link visible');
SELECT is(jsonb_array_length(public.list_care_postclosure_history(pg_temp.pc_target(1))->'items'),1,'route history visible');
SELECT is(jsonb_array_length(public.list_care_postclosure_successors(pg_temp.pc_target(1))->'items'),0,'current child, earlier child and ineligible candidates excluded');
SELECT pg_temp.cs_new(83001);
SELECT throws_ok($q$SELECT pg_temp.pc_prepare(90002,1,83001,'{"supersession_acknowledged":false}')$q$,'22023',NULL,'replacement requires explicit supersession');
INSERT INTO pc_proofs VALUES('replacement',pg_temp.pc_apply(90002,1,83001));
SELECT is(value#>>'{receipt,routing_revision}','2','replacement appends second revision') FROM pc_proofs WHERE label='replacement';
SELECT is(value#>>'{receipt,previous_event_id}',(SELECT value#>>'{receipt,event_id}' FROM pc_proofs WHERE label='applied'),'replacement links exact prior event') FROM pc_proofs WHERE label='replacement';
SELECT is(jsonb_array_length(public.list_care_postclosure_history(pg_temp.pc_target(1))->'items'),2,'prior link preserved');
SELECT is(public.get_care_workflow_steps(pg_temp.cs(80001))->>'work_status',
 (SELECT value#>>'{work,status}' FROM pc_proofs WHERE label='before'),'supersession preserves prior child status');
SELECT public.acknowledge_care_postclosure_request(pg_temp.cs(90001));
SELECT public.acknowledge_care_postclosure_request(pg_temp.cs(90002));
SELECT is(jsonb_array_length(public.list_pending_care_postclosure_requests(pg_temp.cs(90),pg_temp.cs(11))->'items'),0,'ACK clears private recovery only');
SELECT is(jsonb_array_length(public.list_care_postclosure_needs(pg_temp.cs(90))->'items'),1,'ACK never hides durable need');
SELECT pg_temp.csr_change(1,4);
SELECT is(jsonb_array_length(public.list_care_postclosure_needs(pg_temp.cs(90))->'items'),2,'later correction creates separate durable need');
SELECT is(public.list_care_postclosure_needs(pg_temp.cs(90))#>>'{counts,unrouted}','1','prior route cannot cover later change');
-- Cancellation, peer-family exclusion in the reverse direction, exact frozen identity.
SELECT pg_temp.pc_setup(2);
SELECT pg_temp.cs_prepare(91000,80002,'record_exception','{"exception_id":"60000000-0000-4000-8000-000000099002","code":"not_performed","reason":"Synthetic barrier"}');
SELECT throws_ok($q$SELECT pg_temp.pc_prepare(90003,2)$q$,'23505',NULL,'step blocks routing prepare');
SELECT public.cancel_care_step(pg_temp.cs(91000));
SELECT pg_temp.pc_prepare(90003,2);
SELECT is(public.cancel_care_postclosure_request(pg_temp.cs(90003))->>'state','cancelled','cancel preparation records no delegation');
SELECT is(public.apply_care_postclosure_request(pg_temp.cs(90003))->>'state','cancelled','cancelled request is terminal');
SELECT is(jsonb_array_length(public.list_care_postclosure_history(pg_temp.pc_target(2))->'items'),0,'cancelled preparation has no journal event');
-- Current owner, not original actor, controls availability. Recovery needs monitor only.
SELECT pg_temp.pc_apply(90004,2);
SELECT public.offer_work_item_transfer(pg_temp.cs(80002),pg_temp.cs(2)); SELECT pg_temp.csr_actor(2);
SELECT public.accept_work_item_transfer(pg_temp.cs(80002));
SELECT is((SELECT j->>'routing_state' FROM jsonb_array_elements(public.list_care_postclosure_needs(pg_temp.cs(90))->'items') j WHERE j->>'invalidation_id'=pg_temp.pc_target(2)::text),'delegated','eligible transferred current assignee preserves responsibility');
SELECT is(public.list_care_postclosure_needs(pg_temp.cs(90))->'counts','null'::jsonb,'clinician does not receive org-wide counts');
SELECT throws_ok($q$SELECT public.get_care_postclosure_request(pg_temp.cs(90004))$q$,'42501',NULL,'private recovery never crosses actors');
SELECT pg_temp.csr_actor(1);
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='clinical_disposition'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));
SET LOCAL ROLE authenticated; SELECT pg_temp.csr_actor(1);
SELECT is(public.apply_care_postclosure_request(pg_temp.cs(90004))->>'state','applied','terminal recovery survives owner and clinical loss');
SELECT lives_ok($q$SELECT public.acknowledge_care_postclosure_request(pg_temp.cs(90004))$q$,'ACK needs monitor not clinical');
SELECT throws_ok($q$SELECT pg_temp.pc_prepare(90005,2,83001)$q$,'42501',NULL,'fresh routing requires clinical grant');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='clinical_disposition'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='monitor'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(2));
SET LOCAL ROLE authenticated; SELECT pg_temp.csr_actor(1);
SELECT is((SELECT j->>'routing_state' FROM jsonb_array_elements(public.list_care_postclosure_needs(pg_temp.cs(90))->'items') j WHERE j->>'invalidation_id'=pg_temp.pc_target(2)::text),'responsibility_unavailable','current owner monitor loss becomes visible');
-- No former-owner dependency for minimal need/history readers.
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='monitor';
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='monitor'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));
SET LOCAL ROLE authenticated; SELECT pg_temp.csr_actor(2);
SELECT ok(jsonb_array_length(public.list_care_postclosure_needs(pg_temp.cs(90))->'items')>=3,'new eligible clinician sees needs despite former-owner loss');
SELECT lives_ok($q$SELECT public.list_care_postclosure_history(pg_temp.pc_target(2))$q$,'minimal history does not require predecessor ownership');
SELECT pg_temp.csr_actor(1);
SELECT is(jsonb_array_length(public.list_care_postclosure_needs(pg_temp.cs(90))->'items'),0,'manager without monitor receives no details');
SELECT ok(public.list_care_postclosure_needs(pg_temp.cs(90))#>>'{counts,delegated}' IS NOT NULL,'authorized manager can receive counts only');
SELECT throws_ok($q$SELECT public.list_care_postclosure_history(pg_temp.pc_target(2))$q$,'42501',NULL,'counts never grant private patient detail');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal1')::text,true);
SELECT throws_ok($q$SELECT public.list_care_postclosure_needs(pg_temp.cs(90))$q$,'42501',NULL,'aggregate requires AAL2');
SELECT pg_temp.csr_actor(3);
SELECT is(jsonb_array_length(public.list_care_postclosure_needs(pg_temp.cs(91))->'items'),0,'other organization gets no foreign needs');
SELECT throws_ok($q$SELECT public.list_care_postclosure_needs(pg_temp.cs(90))$q$,'42501',NULL,'foreign membership denied');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL;
SELECT throws_ok($q$UPDATE public.care_postclosure_events SET revision=revision+1$q$,'42501',NULL,'journal immutable');
SELECT throws_ok($q$DELETE FROM public.care_postclosure_requests$q$,'42501',NULL,'requests cannot be deleted');
SELECT throws_ok($q$UPDATE public.care_postclosure_requests SET payload='{}'$q$,'42501',NULL,'frozen payload immutable');
-- Faults after every persistence boundary leave the entire operation retryable.
CREATE FUNCTION pg_temp.pc_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('test.postclosure_fault',true)=TG_ARGV[0] THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Synthetic routing persistence fault'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pc_fault_event AFTER INSERT ON public.care_postclosure_events FOR EACH ROW EXECUTE FUNCTION pg_temp.pc_fault('event');
CREATE TRIGGER pc_fault_receipt AFTER UPDATE ON public.care_postclosure_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.pc_fault('receipt');
CREATE TRIGGER pc_fault_prepare AFTER INSERT ON public.care_postclosure_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.pc_fault('prepare');
SET LOCAL ROLE authenticated; SELECT pg_temp.csr_actor(1);
SELECT pg_temp.pc_setup(3);
INSERT INTO pc_proofs VALUES('fault-before-prepare',pg_temp.pc_fingerprint(3));
SELECT set_config('test.postclosure_fault','prepare',true);
SELECT throws_ok($q$SELECT pg_temp.pc_prepare(90006,3)$q$,'P0001',NULL,'failure after preparation insert rolls back');
SELECT is(pg_temp.pc_fingerprint(3),(SELECT value FROM pc_proofs WHERE label='fault-before-prepare'),'no orphaned preparation after fault');
SELECT set_config('test.postclosure_fault','',true);
SELECT pg_temp.pc_prepare(90006,3);
INSERT INTO pc_proofs VALUES('fault-before-apply',pg_temp.pc_fingerprint(3));
SELECT set_config('test.postclosure_fault','event',true);
SELECT throws_ok($q$SELECT public.apply_care_postclosure_request(pg_temp.cs(90006))$q$,'P0001',NULL,'failure after event insert rolls back');
SELECT is(pg_temp.pc_fingerprint(3),(SELECT value FROM pc_proofs WHERE label='fault-before-apply'),'event fault preserves all rows byte-equivalently');
SELECT set_config('test.postclosure_fault','receipt',true);
SELECT throws_ok($q$SELECT public.apply_care_postclosure_request(pg_temp.cs(90006))$q$,'P0001',NULL,'failure after receipt update rolls back');
SELECT is(pg_temp.pc_fingerprint(3),(SELECT value FROM pc_proofs WHERE label='fault-before-apply'),'receipt fault preserves all rows byte-equivalently');
SELECT set_config('test.postclosure_fault','',true);
SELECT lives_ok($q$SELECT public.apply_care_postclosure_request(pg_temp.cs(90006))$q$,'same prepared request can be retried after both faults');
-- Due state uses the current barrier-aware work deadline, not the original routing receipt.
SELECT pg_temp.cs_step(92003,80003,'record_exception','{"exception_id":"60000000-0000-4000-8000-000000099003","code":"not_performed","reason":"Synthetic barrier"}',
 jsonb_build_object('next_review_at',pg_temp.cs_instant(clock_timestamp()+interval '300 milliseconds')));
SELECT pg_temp.cs_step(92004,80003,'record_schedule','{"appointment_date":"2026-09-30","appointment_at":null,"appointment_timezone":null}');
SELECT pg_sleep(0.35);
SELECT is((SELECT j->>'routing_state' FROM jsonb_array_elements(public.list_care_postclosure_needs(pg_temp.cs(90))->'items') j
 WHERE j->>'invalidation_id'=pg_temp.pc_target(3)::text),'overdue','barrier becomes overdue while workflow and receipt review remain future');
SELECT pg_temp.cl_apply(6000031,80003);
SELECT is((SELECT j->>'routing_state' FROM jsonb_array_elements(public.list_care_postclosure_needs(pg_temp.cs(90))->'items') j
 WHERE j->>'invalidation_id'=pg_temp.pc_target(3)::text),'successor_closed','closed successor does not disappear or resolve clinical source');
SELECT is(public.apply_care_postclosure_request(pg_temp.cs(90006))->>'state','applied','closed successor does not break terminal recovery');
-- Candidate scope/analyte validation through public creation, not forged workflow rows.
SELECT pg_temp.pc_setup(4);
SELECT public.prepare_care_workflow_request(pg_temp.cs(96000),pg_temp.cs(85004),pg_temp.cs(90),pg_temp.cs(11),
 jsonb_build_object('kind','laboratory_order','source','external_documented','purpose','Synthetic test purpose','evidence','Synthetic only',
 'occurred_at',pg_temp.cs_instant(now()),'next_review_at',pg_temp.cs_instant(now()+interval '1 day'),'analytes','["egfr"]'::jsonb));
SELECT public.apply_care_workflow_request(pg_temp.cs(96000)); SELECT public.accept_work_item(pg_temp.cs(85004));
SELECT throws_ok($q$SELECT public.get_care_postclosure_context(pg_temp.pc_target(4),pg_temp.cs(85004))$q$,'40001',NULL,'affected analyte required in successor');
SELECT pg_temp.csr_actor(3);
SELECT public.prepare_care_workflow_request(pg_temp.cs(96001),pg_temp.cs(85005),pg_temp.cs(91),pg_temp.cs(12),
 jsonb_build_object('kind','laboratory_order','source','external_documented','purpose','Synthetic test purpose','evidence','Synthetic only',
 'occurred_at',pg_temp.cs_instant(now()),'next_review_at',pg_temp.cs_instant(now()+interval '1 day'),'analytes','["potassium"]'::jsonb));
SELECT public.apply_care_workflow_request(pg_temp.cs(96001)); SELECT public.accept_work_item(pg_temp.cs(85005));
SELECT pg_temp.csr_actor(1);
SELECT throws_ok($q$SELECT public.get_care_postclosure_context(pg_temp.pc_target(4),pg_temp.cs(85005))$q$,'42501',NULL,'foreign organization and patient child rejected');
SELECT public.offer_work_item_transfer(pg_temp.cs(80004),pg_temp.cs(2));
SELECT throws_ok($q$SELECT pg_temp.pc_prepare(90007,4)$q$,'42501',NULL,'pending transfer prevents fresh delegation');
SELECT is(jsonb_array_length(public.list_care_postclosure_history(pg_temp.pc_target(4))->'items'),0,'failed candidate attempts create no route');
-- Canonical paging: many needs, candidates, private requests and replacement events.
SELECT pg_temp.csr_actor(1);
SELECT pg_temp.pc_setup(n) FROM generate_series(5,31) n;
INSERT INTO pc_proofs VALUES('need-page-1',public.list_care_postclosure_needs(pg_temp.cs(90)));
INSERT INTO pc_proofs VALUES('need-page-2',public.list_care_postclosure_needs(pg_temp.cs(90),(SELECT (value->>'next_cursor')::uuid FROM pc_proofs WHERE label='need-page-1')));
SELECT is(jsonb_array_length(value->'items'),25,'need first page capped at 25') FROM pc_proofs WHERE label='need-page-1';
SELECT is(jsonb_array_length(value->'items'),7,'need next page has all remaining exact targets') FROM pc_proofs WHERE label='need-page-2';
SELECT is(value->'next_cursor','null'::jsonb,'need final page terminates') FROM pc_proofs WHERE label='need-page-2';
SELECT is((SELECT count(DISTINCT j->>'invalidation_id') FROM pc_proofs CROSS JOIN LATERAL jsonb_array_elements(value->'items') j
 WHERE label IN('need-page-1','need-page-2')),32::bigint,'need pages contain each target once');
SELECT pg_temp.pc_prepare(100000+n,n) FROM generate_series(5,31) n;
INSERT INTO pc_proofs VALUES('pending-page-1',public.list_pending_care_postclosure_requests(pg_temp.cs(90),pg_temp.cs(11)));
INSERT INTO pc_proofs VALUES('pending-page-2',public.list_pending_care_postclosure_requests(pg_temp.cs(90),pg_temp.cs(11),
 (SELECT (value->>'next_cursor')::uuid FROM pc_proofs WHERE label='pending-page-1')));
SELECT is(jsonb_array_length(value->'items'),25,'pending first page capped') FROM pc_proofs WHERE label='pending-page-1';
SELECT is(jsonb_array_length(value->'items'),3,'pending remainder includes old unacknowledged receipt') FROM pc_proofs WHERE label='pending-page-2';
SELECT public.cancel_care_postclosure_request(pg_temp.cs(100000+n)) FROM generate_series(5,31) n;
SELECT pg_temp.cs_new(87000+n) FROM generate_series(1,28) n;
INSERT INTO pc_proofs VALUES('successors-page-1',public.list_care_postclosure_successors(pg_temp.pc_target(31)));
INSERT INTO pc_proofs VALUES('successors-page-2',public.list_care_postclosure_successors(pg_temp.pc_target(31),
 (SELECT (value->>'next_cursor')::uuid FROM pc_proofs WHERE label='successors-page-1')));
SELECT is(jsonb_array_length(value->'items'),25,'eligible candidates paginated') FROM pc_proofs WHERE label='successors-page-1';
SELECT is(jsonb_array_length(value->'items'),4,'remaining newly recorded eligible candidates preserved') FROM pc_proofs WHERE label='successors-page-2';
SELECT pg_temp.pc_apply(110000+n,31,87000+n) FROM generate_series(1,28) n;
INSERT INTO pc_proofs VALUES('history-page-1',public.list_care_postclosure_history(pg_temp.pc_target(31)));
INSERT INTO pc_proofs VALUES('history-page-2',public.list_care_postclosure_history(pg_temp.pc_target(31),25));
SELECT is(jsonb_array_length(value->'items'),25,'routing history first page capped') FROM pc_proofs WHERE label='history-page-1';
SELECT is(value->>'next_cursor','25','routing history cursor exact revision') FROM pc_proofs WHERE label='history-page-1';
SELECT is(jsonb_array_length(value->'items'),3,'routing history retains every superseded link') FROM pc_proofs WHERE label='history-page-2';
SELECT is(value->'next_cursor','null'::jsonb,'history final page ends') FROM pc_proofs WHERE label='history-page-2';
SELECT throws_ok($q$SELECT public.list_care_postclosure_history(pg_temp.pc_target(31),-1)$q$,'22023',NULL,'negative revision cursor denied');
-- The other typed families exclude routing in both directions through their real RPCs.
SELECT pg_temp.pc_prepare(120005,5);
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(120006,80005,pg_temp.cc_mapping(30005,'3'))$q$,'23505',NULL,'routing excludes composition prepare');
SELECT throws_ok($q$SELECT pg_temp.cl_prepare(120007,80005)$q$,'23505',NULL,'routing excludes human closure prepare');
SELECT throws_ok($q$SELECT pg_temp.pc_intent(120008,80005)$q$,'23505',NULL,'routing excludes laboratory save intention');
SELECT public.cancel_care_postclosure_request(pg_temp.cs(120005));
SELECT pg_temp.cc_prepare(120006,80005,pg_temp.cc_mapping(30005,'3'));
SELECT throws_ok($q$SELECT pg_temp.pc_prepare(120009,5)$q$,'23505',NULL,'composition excludes routing prepare');
SELECT public.cancel_care_lab_composition(pg_temp.cs(120006));
SELECT pg_temp.cl_prepare(120007,80005);
SELECT throws_ok($q$SELECT pg_temp.pc_prepare(120009,5)$q$,'23505',NULL,'human prepare excludes routing');
SELECT public.cancel_care_human_request(pg_temp.cs(120007));
SELECT pg_temp.pc_intent(120008,80005);
SELECT throws_ok($q$SELECT pg_temp.pc_prepare(120009,5)$q$,'23505',NULL,'laboratory save intention excludes routing');
SELECT public.cancel_lab_followup_intent(pg_temp.cs(120008));
RESET ROLE;
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'clinical_disposition',created_by FROM public.organization_memberships WHERE user_id=pg_temp.cs(2);
SET LOCAL ROLE authenticated; SELECT pg_temp.csr_actor(1);
SELECT public.offer_work_item_transfer(pg_temp.cs(80006),pg_temp.cs(2)); SELECT pg_temp.csr_actor(2);
SELECT public.accept_work_item_transfer(pg_temp.cs(80006)); SELECT pg_temp.pc_intent(120010,80006);
SELECT public.offer_work_item_transfer(pg_temp.cs(80006),pg_temp.cs(1)); SELECT pg_temp.csr_actor(1);
SELECT public.accept_work_item_transfer(pg_temp.cs(80006));
SELECT pg_temp.pc_prepare(120011,6);
SELECT throws_ok($q$SELECT pg_temp.pc_unsaved(120012,80006,120010)$q$,'23505',NULL,'routing excludes administrative unsaved disposition');
SELECT public.cancel_care_postclosure_request(pg_temp.cs(120011));
SELECT pg_temp.pc_unsaved(120012,80006,120010);
SELECT throws_ok($q$SELECT pg_temp.pc_prepare(120013,6)$q$,'23505',NULL,'administrative unsaved disposition excludes routing');
SELECT public.cancel_care_unsaved_intent_request(pg_temp.cs(120012));
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
