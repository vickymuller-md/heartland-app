-- Synthetic changed-source resolution; all fixture data and operations roll back.
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

-- BEGIN SOURCE LAB FIXTURES
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium,egfr)
 SELECT pg_temp.cs(base+n),pg_temp.cs(11),now()-interval '1 day',4.6,82 FROM generate_series(1,40) n CROSS JOIN unnest(ARRAY[40000,45000]) base;
-- END SOURCE LAB FIXTURES
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


-- BEGIN SOURCE RESOLUTION HELPERS
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
-- END SOURCE RESOLUTION HELPERS
CREATE TEMP TABLE source_proofs(label text PRIMARY KEY,value jsonb);
GRANT ALL ON source_proofs TO authenticated;
SELECT ok(NOT has_table_privilege('authenticated','public.care_source_invalidation_resolutions','INSERT'),'no direct source resolution insertion');
SELECT ok(NOT has_table_privilege('service_role','public.care_source_invalidation_resolutions','SELECT'),'no service raw resolution read');
SELECT ok(NOT has_function_privilege('authenticated','public.care_invalidation_snapshot(uuid,uuid)','EXECUTE'),'private exact source snapshot');
SELECT ok(NOT has_function_privilege('anon','public.get_care_source_resolution_context(uuid,uuid)','EXECUTE'),'no anonymous source context');
SET LOCAL ROLE authenticated;
SELECT pg_temp.csr_actor(1);
SELECT pg_temp.csr_setup(1);
SELECT pg_temp.csr_humans(1);
INSERT INTO source_proofs VALUES('original',pg_temp.csr_context(1));
INSERT INTO source_proofs VALUES('payload',pg_temp.csr_payload((SELECT value FROM source_proofs WHERE label='original')));
INSERT INTO source_proofs VALUES('prepared',pg_temp.csr_from_context(62001,(SELECT value FROM source_proofs WHERE label='original'),
 (SELECT value FROM source_proofs WHERE label='payload')));
SELECT is(public.get_care_lab_composition(pg_temp.cs(20001))->>'invalidation_count','1','preparation does not resolve source obligation');
INSERT INTO source_proofs VALUES('applied',public.apply_care_human_request(pg_temp.cs(62001)));
SELECT is((SELECT value#>>'{receipt,resolved_invalidation_id}' FROM source_proofs WHERE label='applied'),
 (SELECT value#>>'{invalidation,invalidation_id}' FROM source_proofs WHERE label='original'),'exact target resolved');
SELECT is((SELECT value#>>'{receipt,resolution_event_id}' FROM source_proofs WHERE label='applied'),
 (SELECT value#>>'{receipt,event_id}' FROM source_proofs WHERE label='applied'),'resolution names actual event');
SELECT is((SELECT value#>>'{receipt,workflow_revision}' FROM source_proofs WHERE label='applied'),'5','one source-resolution revision');
SELECT is((SELECT value#>>'{receipt,stage}' FROM source_proofs WHERE label='applied'),'result_received','source resolution does not advance stage');
SELECT is((SELECT value#>>ARRAY['receipt',flag] FROM source_proofs WHERE label='applied'),'false','not inferred: '||flag)
 FROM unnest(ARRAY['clinical_review_recorded','addresses_current_review','communication_confirmed','care_completed']) flag;
SELECT is((SELECT value#>>ARRAY['receipt',flag] FROM source_proofs WHERE label='applied'),'true','new target-specific attestation: '||flag)
 FROM unnest(ARRAY['source_review_attested','source_contact_attested']) flag;
SELECT is(public.get_care_lab_composition(pg_temp.cs(20001))->>'invalidation_count','0','resolved source leaves unresolved count');
SELECT is(jsonb_array_length(public.list_care_lab_invalidations(pg_temp.cs(20001))->'items'),1,'original invalidation remains in history');
SELECT is(public.list_care_lab_invalidations(pg_temp.cs(20001))#>>'{items,0,resolution,event_id}',
 (SELECT value#>>'{receipt,event_id}' FROM source_proofs WHERE label='applied'),'list names resolution separately');
SELECT is(public.get_care_human_context(pg_temp.cs(20001),'record_contact')->'latest_review',
 (SELECT value->'latest_review' FROM source_proofs WHERE label='original'),'standard review remains intact and current');
SELECT is(public.apply_care_human_request(pg_temp.cs(62001)),(SELECT value FROM source_proofs WHERE label='applied'),'same-ID application replay exact');
SELECT is(pg_temp.csr_from_context(62001,(SELECT value FROM source_proofs WHERE label='original'),(SELECT value FROM source_proofs WHERE label='payload')),
 (SELECT value FROM source_proofs WHERE label='applied'),'same-ID prepare replay exact');
SELECT throws_ok($q$SELECT pg_temp.csr_context(1)$q$,'40001',NULL,'fresh context does not hide already-resolved state');
SELECT is(public.cancel_care_human_request(pg_temp.cs(62001))->>'state','applied','late cancellation reports actual application');
SELECT isnt(public.acknowledge_care_human_request(pg_temp.cs(62001))->>'acknowledged_at',NULL::text,'separate acknowledgement');
SELECT ok(NOT((SELECT value::text FROM source_proofs WHERE label='original') LIKE '%Private source-authority evidence%'),'context does not disclose private lab request evidence');

-- Existing contact storage preserves UUID spelling; identity must not depend on case.
SELECT pg_temp.csr_setup(2,true);
SELECT pg_temp.csr_humans(2,true);
SELECT isnt(pg_temp.csr_context(2)->'contact','null'::jsonb,'uppercase review reference remains a qualifying applied contact');
SELECT lives_ok($q$SELECT pg_temp.csr_prepare(62002,2)$q$,'prepare with uppercase contact review identity');
SELECT lives_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(62002))$q$,'apply with uppercase contact review identity');

-- Cancelled sources can be explicitly reconciled, without claiming the missing values are complete.
SELECT pg_temp.csr_setup(3,false,true);
SELECT pg_temp.csr_humans(3);
SELECT is(pg_temp.csr_context(3)#>>'{invalidation,head,status}','cancelled','cancelled historical head displayed');
SELECT pg_temp.csr_prepare(62003,3);
SELECT is(public.apply_care_human_request(pg_temp.cs(62003))#>>'{receipt,care_completed}','false','cancellation resolution never completes missing care');

-- A removed source remains in the lock/read set; a newer historical head needs new review/contact.
SELECT pg_temp.csr_setup(4,true); SELECT pg_temp.csr_humans(4);
INSERT INTO source_proofs VALUES('removed',pg_temp.csr_context(4));
SELECT pg_temp.csr_change(4,2);
SELECT throws_ok($q$SELECT pg_temp.csr_from_context(62004,(SELECT value FROM source_proofs WHERE label='removed'),
 pg_temp.csr_payload((SELECT value FROM source_proofs WHERE label='removed')))$q$,'40001',NULL,'historical head changed since it was displayed');
SELECT is(pg_temp.csr_context(4)#>>'{latest_review,is_current}','true','current basis alone does not cover a removed source change');
SELECT throws_ok($q$SELECT pg_temp.csr_prepare(62004,4)$q$,'40001',NULL,'old current review/contact cannot attest to a later historical head');
SELECT pg_temp.csr_humans(4,false,1);
SELECT throws_ok($q$SELECT pg_temp.csr_from_context(62404,pg_temp.csr_context(4),
 jsonb_set(pg_temp.csr_payload(pg_temp.csr_context(4)),'{details,source_reviewed}','false'))$q$,
 '22023',NULL,'later review on replacement source does not substitute for explicit target attestation');
SELECT throws_ok($q$SELECT pg_temp.csr_from_context(62404,pg_temp.csr_context(4),
 jsonb_set(pg_temp.csr_payload(pg_temp.csr_context(4)),'{details,change_addressed_in_contact}','false'))$q$,
 '22023',NULL,'later contact on replacement source does not prove the removed change was addressed');
SELECT lives_ok($q$SELECT pg_temp.csr_prepare(62004,4)$q$,'fresh review/contact with explicit target declaration needs no artificial recomposition');
SELECT is(public.apply_care_human_request(pg_temp.cs(62004))->>'state','applied','removed-source resolution applies after explicit fresh evidence');

SELECT pg_temp.csr_setup(5); SELECT pg_temp.csr_humans(5); SELECT pg_temp.csr_prepare(62005,5);
SELECT pg_temp.csr_change(5,2);
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(62005))$q$,'40001',NULL,'current source correction invalidates a prepared resolution');
SELECT is(public.get_care_human_request(pg_temp.cs(62005))->>'state','prepared','stale attempt remains recoverable');
SELECT public.cancel_care_human_request(pg_temp.cs(62005));
SELECT is(public.get_care_lab_composition(pg_temp.cs(20005))->>'invalidation_count','2','later associated-source change creates its own unresolved obligation');

SELECT pg_temp.csr_setup(6); SELECT pg_temp.csr_humans(6);
INSERT INTO source_proofs VALUES('negative',pg_temp.csr_context(6));
SELECT throws_ok($q$SELECT public.get_care_human_context(pg_temp.cs(20006),'resolve_source_invalidation')$q$,'22023',NULL,'fourth command cannot enter generic context lock path');
SELECT throws_ok($q$SELECT public.get_care_source_resolution_context(pg_temp.cs(20006),
 (SELECT (value#>>'{invalidation,invalidation_id}')::uuid FROM source_proofs WHERE label='original'))$q$,'42501',NULL,'foreign-work invalidation not exposed');
SELECT throws_ok(format('SELECT pg_temp.csr_from_context(62600,%L::jsonb,%L::jsonb)',c, p||jsonb_build_object('details',(p->'details')-k)),
 '22023',NULL,'required explicit source attestation field: '||k)
 FROM(SELECT value c,pg_temp.csr_payload(value) p FROM source_proofs WHERE label='negative') f,
 unnest(ARRAY['invalidation','review_event_id','contact_event_id','disposition','resolution_reason','source_reviewed',
  'change_addressed_in_contact','source_review_evidence','source_communication_evidence']) k;
SELECT throws_ok(format('SELECT pg_temp.csr_from_context(62600,%L::jsonb,%L::jsonb)',c,jsonb_set(p,'{details,invalidation}',(p#>'{details,invalidation}')-k)),
 '22023',NULL,'required exact invalidation snapshot field: '||k)
 FROM(SELECT value c,pg_temp.csr_payload(value) p FROM source_proofs WHERE label='negative') f,
 unnest(ARRAY['invalidation_id','entry_id','composition_event_id','composition_revision','analyte','root_id','observed_version_id',
  'change_version_id','change_revision','change_status','change_recorded_at','recorded_at','head','head_recorded_at']) k;
SELECT throws_ok(format('SELECT pg_temp.csr_from_context(62600,%L::jsonb,%L::jsonb)',c,pg_temp.csr_payload(c,'{}',change)),
 '22023',NULL,'malformed or absent attestation: '||change::text)
 FROM(SELECT value c FROM source_proofs WHERE label='negative') f,
 (VALUES('{"source_reviewed":false}'::jsonb),('{"change_addressed_in_contact":false}'),('{"source_reviewed":"true"}'),
 ('{"source_review_evidence":"  "}'),('{"source_communication_evidence":null}'),('{"resolution_reason":""}'),('{"disposition":"done"}'),
 ('{"contact_event_id":"bad"}'),('{"extra":true}')) x(change);
SELECT throws_ok(format('SELECT pg_temp.csr_from_context(62600,%L::jsonb,%L::jsonb)',c,jsonb_set(pg_temp.csr_payload(c),ARRAY['details','invalidation',k],to_jsonb(pg_temp.cs(9999)::text))),
 '40001',NULL,'altered immutable source field: '||k)
 FROM(SELECT value c FROM source_proofs WHERE label='negative') f,
 unnest(ARRAY['entry_id','composition_event_id','root_id','observed_version_id','change_version_id']) k;
SELECT throws_ok(format('SELECT pg_temp.csr_from_context(62600,%L::jsonb,%L::jsonb)',c,jsonb_set(pg_temp.csr_payload(c),'{details,invalidation,head}','{}')),
 '40001',NULL,'altered head never accepted') FROM(SELECT value c FROM source_proofs WHERE label='negative') f;
SELECT throws_ok(format('SELECT pg_temp.csr_from_context(62600,%L::jsonb,%L::jsonb)',c,pg_temp.csr_payload(c,'{}','{"disposition":"no_longer_used"}')),
 '40001',NULL,'retained source cannot be declared removed') FROM(SELECT value c FROM source_proofs WHERE label='negative') f;
SELECT throws_ok(format('SELECT pg_temp.csr_from_context(62600,%L::jsonb,%L::jsonb)',c,pg_temp.csr_payload(c,'{}',jsonb_build_object('contact_event_id',
 public.get_care_human_request(pg_temp.cs(61001))#>'{receipt,event_id}'))),
 '40001',NULL,'other-work applied contact is not pertinent') FROM(SELECT value c FROM source_proofs WHERE label='negative') f;
SELECT throws_ok(format('SELECT pg_temp.csr_from_context(62600,%L::jsonb,%L::jsonb)',c,pg_temp.csr_payload(c,'{}',jsonb_build_object('review_event_id',
 public.get_care_human_request(pg_temp.cs(60001))#>'{receipt,event_id}'))),
 '40001',NULL,'other-work review is not current') FROM(SELECT value c FROM source_proofs WHERE label='negative') f;
SELECT throws_ok(format('SELECT pg_temp.csr_from_context(62600,%L::jsonb,%L::jsonb)',c,pg_temp.csr_payload(c,
 jsonb_build_object('occurred_at',pg_temp.cs_instant((c#>>'{contact,occurred_at}')::timestamptz-interval '1 microsecond')))),
 '40001',NULL,'resolution occurrence cannot predate its exact contact') FROM(SELECT value c FROM source_proofs WHERE label='negative') f;
SELECT pg_temp.csr_setup(7);
SELECT is(pg_temp.csr_context(7)->'latest_review','null'::jsonb,'no review invented for a changed source');
SELECT is(pg_temp.csr_context(7)->'contact','null'::jsonb,'no pertinent contact invented');
SELECT throws_ok($q$SELECT pg_temp.csr_from_context(62007,pg_temp.csr_context(7),pg_temp.csr_payload(pg_temp.csr_context(7),'{}',
 jsonb_build_object('review_event_id',pg_temp.cs(9999),'contact_event_id',pg_temp.cs(9998))))$q$,'40001',NULL,'attestation cannot replace actual review and contact');

-- Recovery must not require a fresh clinical grant.
SELECT pg_temp.csr_setup(8); SELECT pg_temp.csr_humans(8); SELECT pg_temp.csr_prepare(62008,8);
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='clinical_disposition'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(62008))$q$,'42501',NULL,'clinical grant rechecked on apply');
SELECT is(public.get_care_human_request(pg_temp.cs(62008))->>'state','prepared','private recovery after clinical loss');
SELECT is(public.cancel_care_human_request(pg_temp.cs(62008))->>'state','cancelled','private cancellation after clinical loss');
SELECT is(public.get_care_human_request(pg_temp.cs(62001))->>'state','applied','applied receipt recoverable after clinical loss');
SELECT is(public.acknowledge_care_human_request(pg_temp.cs(62002))->>'state','applied','receipt acknowledgement after clinical loss');
SELECT throws_ok($q$SELECT pg_temp.csr_prepare(62808,6)$q$,'42501',NULL,'fresh source resolution denied without clinical grant');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='clinical_disposition';
SET LOCAL ROLE authenticated;

-- All family exclusions remain bidirectional.
CREATE FUNCTION pg_temp.cr_intent(n integer,w integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE submission uuid; c jsonb;
BEGIN
 SELECT request_id INTO submission FROM public.prepare_lab_submission(pg_temp.cs(11));
 c:=public.get_care_human_context(pg_temp.cs(w),'record_contact');
 RETURN public.prepare_lab_followup_intent(pg_temp.cs(n),pg_temp.cs(w),pg_temp.cs(90),pg_temp.cs(11),submission,
  (c->>'workflow_revision')::bigint,(c->>'ownership_revision')::bigint,
  jsonb_build_object('analytes','["potassium"]'::jsonb,'evidence','Synthetic private intention','occurred_at',pg_temp.cs_instant(now()-interval '1 hour')));
END $$;
SELECT pg_temp.csr_prepare(62601,6);
SELECT throws_ok($q$SELECT pg_temp.ch_prepare(62602,20006,'record_contact')$q$,'23505',NULL,'source resolution blocks another human request');
SELECT throws_ok($q$SELECT pg_temp.cc_prepare(62602,20006,pg_temp.cc_mapping(30006,'2'))$q$,'23505',NULL,'source resolution blocks composition');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(62602,20006,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(9000),'code','other','reason','Synthetic barrier'))$q$,
 '23505',NULL,'source resolution blocks step');
SELECT throws_ok($q$SELECT pg_temp.cr_intent(62602,20006)$q$,'23505',NULL,'source resolution blocks save intention');
SELECT public.cancel_care_human_request(pg_temp.cs(62601));
SELECT pg_temp.ch_prepare(62602,20006,'record_contact');
SELECT throws_ok($q$SELECT pg_temp.csr_prepare(62603,6)$q$,'23505',NULL,'human request blocks source resolution');
SELECT public.cancel_care_human_request(pg_temp.cs(62602));
SELECT pg_temp.cc_prepare(62603,20006,pg_temp.cc_mapping(30006,'2'));
SELECT throws_ok($q$SELECT pg_temp.csr_prepare(62604,6)$q$,'23505',NULL,'composition blocks source resolution');
SELECT public.cancel_care_lab_composition(pg_temp.cs(62603));
SELECT pg_temp.cs_prepare(62604,20006,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(9000),'code','other','reason','Synthetic barrier'));
SELECT throws_ok($q$SELECT pg_temp.csr_prepare(62605,6)$q$,'23505',NULL,'step blocks source resolution');
SELECT public.cancel_care_step(pg_temp.cs(62604));
SELECT pg_temp.cr_intent(62605,20006);
SELECT throws_ok($q$SELECT pg_temp.csr_prepare(62606,6)$q$,'23505',NULL,'save intention blocks source resolution');
SELECT public.cancel_lab_followup_intent(pg_temp.cs(62605));

-- Fail after each transactional write and compare the whole state, not just row counts.
SELECT pg_temp.csr_setup(9); SELECT pg_temp.csr_humans(9); SELECT pg_temp.csr_prepare(62009,9);
INSERT INTO source_proofs VALUES('rollback',pg_temp.csr_counts(9,62009));
RESET ROLE;
CREATE FUNCTION pg_temp.reject_source_resolution_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Synthetic source-resolution failure'; END $$;

CREATE TRIGGER source_resolution_failure AFTER INSERT ON public.care_human_events FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_source_resolution_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(62009))$q$,'P0001','Synthetic source-resolution failure','rollback after care_human_events');
SELECT is(pg_temp.csr_counts(9,62009),(SELECT value FROM source_proofs WHERE label='rollback'),'complete rollback after care_human_events');
RESET ROLE;
DROP TRIGGER source_resolution_failure ON public.care_human_events;

CREATE TRIGGER source_resolution_failure AFTER INSERT ON public.care_source_invalidation_resolutions FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_source_resolution_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(62009))$q$,'P0001','Synthetic source-resolution failure','rollback after care_source_invalidation_resolutions');
SELECT is(pg_temp.csr_counts(9,62009),(SELECT value FROM source_proofs WHERE label='rollback'),'complete rollback after care_source_invalidation_resolutions');
RESET ROLE;
DROP TRIGGER source_resolution_failure ON public.care_source_invalidation_resolutions;

CREATE TRIGGER source_resolution_failure AFTER UPDATE ON public.care_workflows FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_source_resolution_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(62009))$q$,'P0001','Synthetic source-resolution failure','rollback after care_workflows');
SELECT is(pg_temp.csr_counts(9,62009),(SELECT value FROM source_proofs WHERE label='rollback'),'complete rollback after care_workflows');
RESET ROLE;
DROP TRIGGER source_resolution_failure ON public.care_workflows;

CREATE TRIGGER source_resolution_failure AFTER UPDATE ON public.work_items FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_source_resolution_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(62009))$q$,'P0001','Synthetic source-resolution failure','rollback after work_items');
SELECT is(pg_temp.csr_counts(9,62009),(SELECT value FROM source_proofs WHERE label='rollback'),'complete rollback after work_items');
RESET ROLE;
DROP TRIGGER source_resolution_failure ON public.work_items;

CREATE TRIGGER source_resolution_failure AFTER UPDATE ON public.care_human_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_source_resolution_write();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(62009))$q$,'P0001','Synthetic source-resolution failure','rollback after care_human_requests');
SELECT is(pg_temp.csr_counts(9,62009),(SELECT value FROM source_proofs WHERE label='rollback'),'complete rollback after care_human_requests');
RESET ROLE;
DROP TRIGGER source_resolution_failure ON public.care_human_requests;

SET LOCAL ROLE authenticated;
SELECT is(public.apply_care_human_request(pg_temp.cs(62009))->>'state','applied','same request succeeds after injected failures');

-- Shared roots affect every current dependent composition, but one resolution consumes only one target.
SELECT pg_temp.csr_setup(10); SELECT pg_temp.cs_new(20011);
SELECT pg_temp.cc_apply(50011,20011,pg_temp.cc_mapping(30010,'2'));
SELECT pg_temp.csr_change(10,2);
SELECT pg_temp.csr_humans(11); SELECT pg_temp.csr_prepare(62011,11);
SELECT public.apply_care_human_request(pg_temp.cs(62011));
SELECT is(public.get_care_lab_composition(pg_temp.cs(20011))->>'invalidation_count','0','exact dependent-work target resolved');
SELECT is(public.get_care_lab_composition(pg_temp.cs(20010))->>'invalidation_count','2','other dependent work obligations remain');

SELECT pg_temp.csr_setup(12); SELECT pg_temp.csr_humans(12); SELECT pg_temp.csr_prepare(62012,12);
SELECT public.offer_work_item_transfer(pg_temp.cs(20012),pg_temp.cs(2));
SELECT throws_ok($q$SELECT public.apply_care_human_request(pg_temp.cs(62012))$q$,'42501',NULL,'pending transfer blocks source resolution');
RESET ROLE;
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'clinical_disposition',pg_temp.cs(1) FROM public.organization_memberships WHERE user_id=pg_temp.cs(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.csr_actor(2); SELECT public.accept_work_item_transfer(pg_temp.cs(20012));
SELECT throws_ok($q$SELECT public.get_care_human_request(pg_temp.cs(62012))$q$,'42501',NULL,'new owner cannot adopt old private preparation');
SELECT pg_temp.csr_prepare(62013,12);
SELECT is(public.apply_care_human_request(pg_temp.cs(62013))->>'state','applied','new qualified owner can explicitly attest with a new identity');
SELECT pg_temp.csr_actor(1);
SELECT is(public.cancel_care_human_request(pg_temp.cs(62012))->>'state','cancelled','former owner cancels historical preparation without replacing it');
SELECT throws_ok($q$SELECT public.get_care_human_request(pg_temp.cs(62013))$q$,'42501',NULL,'former owner cannot read new private receipt');

RESET ROLE;
SELECT throws_ok($q$UPDATE public.care_source_invalidation_resolutions SET work_item_id=pg_temp.cs(20002)
 WHERE work_item_id=pg_temp.cs(20001)$q$,'42501',NULL,'owner cannot redirect source resolution');
SELECT throws_ok($q$DELETE FROM public.care_source_invalidation_resolutions WHERE work_item_id=pg_temp.cs(20001)$q$,'42501',NULL,'owner cannot erase source resolution');
SELECT throws_ok($q$DELETE FROM public.care_lab_source_invalidations WHERE id=(SELECT (value#>>'{invalidation,invalidation_id}')::uuid
 FROM source_proofs WHERE label='original')$q$,'42501',NULL,'resolved invalidation remains immutable');
SELECT throws_ok($q$INSERT INTO public.care_source_invalidation_resolutions(invalidation_id,human_event_id,work_item_id)
 VALUES(pg_temp.cs(9999),pg_temp.cs(9998),pg_temp.cs(20001))$q$,'42501',NULL,'private typed write context required for insertion');
SELECT is((SELECT count(*) FROM public.care_workflow_write_context),0::bigint,'no private write-context residue');
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='monitor'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_care_human_request(pg_temp.cs(62001))$q$,'42501',NULL,'receipt recovery still requires current monitoring scope');
SELECT throws_ok($q$SELECT pg_temp.csr_context(6)$q$,'42501',NULL,'target reader denied after scope loss');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
