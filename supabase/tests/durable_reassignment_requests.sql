-- Synthetic durable request/receipt lifecycle; all fixtures roll back.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
SELECT ok(NOT has_function_privilege('service_role','public.prepare_work_reassignment(uuid,uuid,uuid,bigint,uuid,text)','EXECUTE'),'service cannot prepare a human request');
SELECT ok(NOT has_function_privilege('authenticated','public.work_reassignment_request_state(uuid,uuid)','EXECUTE'),'arbitrary-actor state helper private');
SELECT ok(NOT has_function_privilege('authenticated','public.unresolved_work_reassignment(uuid,uuid)','EXECUTE'),'arbitrary-actor pending helper private');
SELECT matches((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='work_reassignment_receipt_shape'),
 'to_status IS NOT NULL','request shape rejects nullable status rather than relying on three-valued equality');
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT ('49000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'exceptions-'||n||'@example.invalid','{"consent_accepted":true}'
 FROM unnest(ARRAY[1,2,3,4,5,6,11,12,13,14]) AS n;
UPDATE public.profiles SET role='provider' WHERE id IN(
 '49000000-0000-4000-8000-000000000001','49000000-0000-4000-8000-000000000002',
 '49000000-0000-4000-8000-000000000003','49000000-0000-4000-8000-000000000004','49000000-0000-4000-8000-000000000005');
UPDATE public.profiles SET role='tester',sandbox_expires_at=now()+interval '1 day' WHERE id='49000000-0000-4000-8000-000000000006';
INSERT INTO public.organizations(id,name,created_by) VALUES
 ('49000000-0000-4000-8000-0000000000aa','Exception fixture A','49000000-0000-4000-8000-000000000001'),
 ('49000000-0000-4000-8000-0000000000bb','Exception fixture B','49000000-0000-4000-8000-000000000005');
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 SELECT '49000000-0000-4000-8000-0000000000aa',('49000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 CASE WHEN n=1 THEN 'owner' WHEN n=2 THEN 'admin' ELSE 'clinician' END,'active',now(),'49000000-0000-4000-8000-000000000001'
 FROM generate_series(1,4) n;
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by) VALUES
 ('49000000-0000-4000-8000-0000000000bb','49000000-0000-4000-8000-000000000005','owner','active',now(),'49000000-0000-4000-8000-000000000005');
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor','49000000-0000-4000-8000-000000000001' FROM public.organization_memberships
 WHERE organization_id='49000000-0000-4000-8000-0000000000aa';
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by)
 SELECT '49000000-0000-4000-8000-0000000000aa',('49000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'49000000-0000-4000-8000-000000000001'
 FROM generate_series(11,13) n;
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 ('49000000-0000-4000-8000-000000000001','49000000-0000-4000-8000-000000000011','active',now()),
 ('49000000-0000-4000-8000-000000000003','49000000-0000-4000-8000-000000000011','active',now()),
 ('49000000-0000-4000-8000-000000000003','49000000-0000-4000-8000-000000000012','active',now()),
 ('49000000-0000-4000-8000-000000000003','49000000-0000-4000-8000-000000000013','active',now()),
 ('49000000-0000-4000-8000-000000000004','49000000-0000-4000-8000-000000000011','active',now());
INSERT INTO public.work_items(id,patient_id,provider_id,assigned_to,organization_id,source_type,title,reason,priority,severity,
  status,due_at,data_quality,accountability_source,accepted_at,accepted_by)
 SELECT ('49000000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,
 '49000000-0000-4000-8000-000000000011','49000000-0000-4000-8000-000000000003','49000000-0000-4000-8000-000000000003',
 '49000000-0000-4000-8000-0000000000aa','manual','Private synthetic title','Private synthetic reason','today','warning','new',now(),
 'verified','designated',CASE WHEN n=0 THEN now() END,CASE WHEN n=0 THEN '49000000-0000-4000-8000-000000000003'::uuid END
 FROM generate_series(0,31) n;
INSERT INTO public.work_items(patient_id,provider_id,assigned_to,organization_id,source_type,title,reason,priority,severity,status,due_at,data_quality)
 SELECT ('49000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '49000000-0000-4000-8000-000000000003','49000000-0000-4000-8000-000000000003','49000000-0000-4000-8000-0000000000aa',
 'manual','Hidden title','Hidden reason','today','warning','new',now(),'verified' FROM unnest(ARRAY[12,13]) n;
INSERT INTO public.patient_accountability(organization_id,patient_id,accountable_id,designated_by)
 VALUES('49000000-0000-4000-8000-0000000000aa','49000000-0000-4000-8000-000000000012',
 '49000000-0000-4000-8000-000000000003','49000000-0000-4000-8000-000000000001');
UPDATE public.organization_patient_assignments SET status='revoked',revoked_at=now()
 WHERE organization_id='49000000-0000-4000-8000-0000000000aa' AND patient_id='49000000-0000-4000-8000-000000000013';
UPDATE public.provider_patient_links SET status='revoked'
 WHERE provider_id='49000000-0000-4000-8000-000000000003' AND patient_id='49000000-0000-4000-8000-000000000011';



CREATE TEMP TABLE request_results(label text PRIMARY KEY,result jsonb);
GRANT ALL ON request_results TO authenticated;
CREATE FUNCTION pg_temp.request(n integer DEFAULT 901,item integer DEFAULT 100,old_owner integer DEFAULT 3,revision bigint DEFAULT 0,target integer DEFAULT 4)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_work_reassignment(
 ('49000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('49000000-0000-4000-8000-'||lpad(item::text,12,'0'))::uuid,
 ('49000000-0000-4000-8000-'||lpad(old_owner::text,12,'0'))::uuid,revision,
 ('49000000-0000-4000-8000-'||lpad(target::text,12,'0'))::uuid,'Synthetic durable handover')
$$;
CREATE FUNCTION pg_temp.apply(n integer DEFAULT 901,item integer DEFAULT 100,old_owner integer DEFAULT 3,revision bigint DEFAULT 0,target integer DEFAULT 4)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.reassign_work_item_recoverable(
 ('49000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('49000000-0000-4000-8000-'||lpad(item::text,12,'0'))::uuid,
 ('49000000-0000-4000-8000-'||lpad(old_owner::text,12,'0'))::uuid,revision,
 ('49000000-0000-4000-8000-'||lpad(target::text,12,'0'))::uuid,'Synthetic durable handover')
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT pg_temp.apply()$q$,'55000','Prepare work reassignment before applying','new apply requires saved preparation');
INSERT INTO request_results VALUES('prepared',pg_temp.request());
SELECT is((SELECT result->>'state' FROM request_results WHERE label='prepared'),'prepared','request is durably prepared');
SELECT is((SELECT assigned_to FROM public.work_items WHERE id='49000000-0000-4000-8000-000000000100'),'49000000-0000-4000-8000-000000000003'::uuid,'preparation does not move work');
SELECT is(pg_temp.request(),(SELECT result FROM request_results WHERE label='prepared'),'lost preparation response replays exactly');
SELECT is(pg_temp.request(902),(SELECT result FROM request_results WHERE label='prepared'),'a second identity recovers the existing unresolved request');
SELECT is((SELECT count(*)::int FROM public.work_item_events WHERE event_type='reassignment_requested'),1,'no second unresolved request created');
SELECT throws_ok($q$SELECT public.prepare_work_reassignment('49000000-0000-4000-8000-000000000901','49000000-0000-4000-8000-000000000100',
 '49000000-0000-4000-8000-000000000003',0,'49000000-0000-4000-8000-000000000004','Changed reason')$q$,'23505','Reassignment request conflict','preparation payload immutable');
SELECT is(public.get_my_work_reassignment_requests()#>>'{items,0,state}','prepared','own projection exposes prepared request');
INSERT INTO request_results VALUES('applied',pg_temp.apply());
SELECT is(public.get_my_work_reassignment_requests()#>>'{items,0,state}','applied','applied but unseen receipt stays recoverable outside the work queue');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE id='49000000-0000-4000-8000-000000000100' AND assigned_to=auth.uid()),0,'caller does not own the repaired item');
SELECT is(public.recover_work_reassignment('49000000-0000-4000-8000-000000000100')->'receipt',
 (SELECT result FROM request_results WHERE label='applied'),'per-item recovery returns recorded receipt');
SELECT is(public.finish_work_reassignment_request('49000000-0000-4000-8000-000000000901',NULL,true)->>'state','applied','applied transition cannot be relabelled cancelled');
SELECT throws_ok($q$SELECT public.finish_work_reassignment_request('49000000-0000-4000-8000-000000000901','49000000-0000-4000-8000-000000000999',false)$q$,
 '22023','An exact recorded receipt is required','acknowledgement requires exact receipt');
SELECT is(public.finish_work_reassignment_request('49000000-0000-4000-8000-000000000901',
 (SELECT (result->>'event_id')::uuid FROM request_results WHERE label='applied'),false)->>'state','seen','explicit receipt acknowledgement');
SELECT is(jsonb_array_length(public.get_my_work_reassignment_requests()->'items'),0,'acknowledged receipt leaves only technical pending projection');
SELECT is(pg_temp.request()->>'state','seen','preparation replay does not recreate a seen request');
SELECT is(pg_temp.request(902,100,4,1,1)->>'state','prepared','a new request is admitted after acknowledgement');
SELECT is(public.finish_work_reassignment_request('49000000-0000-4000-8000-000000000901',
 (SELECT (result->>'event_id')::uuid FROM request_results WHERE label='applied'),false)->>'state','seen','old acknowledgement replay is stable');
SELECT is(public.recover_work_reassignment('49000000-0000-4000-8000-000000000100')#>>'{request,requestId}',
 '49000000-0000-4000-8000-000000000902','old terminal cannot consume a newer pending request');
SELECT is(public.finish_work_reassignment_request('49000000-0000-4000-8000-000000000902',NULL,true)->>'state','cancelled','unapplied request can be cancelled');
SELECT throws_ok($q$SELECT pg_temp.apply(902,100,4,1,1)$q$,'55000','This reassignment request was cancelled','late apply after cancellation cannot move work');
SELECT is(pg_temp.request(902,100,4,1,1)->>'state','cancelled','cancelled preparation replay cannot reactivate it');
SELECT is(public.finish_work_reassignment_request('49000000-0000-4000-8000-000000000902',NULL,true)->>'state','cancelled','cancellation is idempotent');
SELECT is(pg_temp.request(903,101)->>'state','prepared','prepare a request whose target will lose access');
RESET ROLE;
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id='49000000-0000-4000-8000-000000000004' AND patient_id='49000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT is(public.recover_work_reassignment('49000000-0000-4000-8000-000000000101')->>'state','prepared','target ineligibility does not hide an old preparation');
SELECT throws_ok($q$SELECT pg_temp.apply(903,101)$q$,'42501','Work ownership operation not authorized','ineligible target cannot receive prepared work');
SELECT is(public.finish_work_reassignment_request('49000000-0000-4000-8000-000000000903',NULL,true)->>'state','cancelled','target ineligibility does not prevent technical cancellation');
RESET ROLE;
UPDATE public.provider_patient_links SET status='active' WHERE provider_id='49000000-0000-4000-8000-000000000004' AND patient_id='49000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.request(904,102)->>'state','prepared','prepare before closure');
UPDATE public.work_items SET status='closed',outcome='Synthetic documented closure',outcome_code='no_action_needed' WHERE id='49000000-0000-4000-8000-000000000102';
SELECT is(public.recover_work_reassignment('49000000-0000-4000-8000-000000000102')->>'state','prepared','closed work keeps its unapplied preparation');
SELECT is(public.finish_work_reassignment_request('49000000-0000-4000-8000-000000000904',NULL,true)->>'state','cancelled','closed work does not prevent cancellation');
SELECT is(pg_temp.request(905,103)->>'state','prepared','prepare before caller monitor revocation');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=now() WHERE membership_id IN(
 SELECT id FROM public.organization_memberships WHERE user_id='49000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT is(jsonb_array_length(public.get_my_work_reassignment_requests()->'items'),0,'revoked caller gets no request details');
SELECT is(public.get_my_work_reassignment_requests()->>'inaccessible_count','1','own inaccessible request count has no identifiers');
SELECT throws_ok($q$SELECT public.recover_work_reassignment('49000000-0000-4000-8000-000000000103')$q$,'42501','Work ownership operation not authorized','direct recovery checks current access');
SELECT throws_ok($q$SELECT public.finish_work_reassignment_request('49000000-0000-4000-8000-000000000905',NULL,true)$q$,'42501','Work ownership operation not authorized','cancel checks current caller access');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE membership_id IN(
 SELECT id FROM public.organization_memberships WHERE user_id='49000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT pg_temp.apply(905,103)$q$,'restored caller explicitly applies original prepared request');
SELECT is(pg_temp.request(906,104)->>'state','prepared','prepare later closed receipt');
INSERT INTO request_results VALUES('closed-receipt',pg_temp.apply(906,104));
UPDATE public.work_items SET status='closed',outcome='Synthetic documented closure',outcome_code='no_action_needed' WHERE id='49000000-0000-4000-8000-000000000104';
SELECT is(public.recover_work_reassignment('49000000-0000-4000-8000-000000000104')->>'state','applied','closed reassigned item remains independently recoverable');
SELECT is(public.finish_work_reassignment_request('49000000-0000-4000-8000-000000000906',
 (SELECT (result->>'event_id')::uuid FROM request_results WHERE label='closed-receipt'),false)->>'state','seen','closed item receipt can be acknowledged without reopening');
SELECT pg_temp.request(1000+n,n) FROM generate_series(106,131) n;
INSERT INTO request_results VALUES('page1',public.get_my_work_reassignment_requests());
INSERT INTO request_results VALUES('page2',public.get_my_work_reassignment_requests((SELECT (result->>'next_cursor')::uuid FROM request_results WHERE label='page1')));
SELECT is((SELECT jsonb_array_length(result->'items') FROM request_results WHERE label='page1'),25,'own-request projection bounded before tail');
SELECT is((SELECT jsonb_array_length(result->'items') FROM request_results WHERE label='page2'),2,'own-request projection retains tail');
SELECT is((SELECT result->'next_cursor' FROM request_results WHERE label='page2'),'null'::jsonb,'last request page terminates');
-- More than a full page may become inaccessible; filter authority before LIMIT.
RESET ROLE;
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 ('49000000-0000-4000-8000-000000000001','49000000-0000-4000-8000-000000000012','active',now()),
 ('49000000-0000-4000-8000-000000000004','49000000-0000-4000-8000-000000000012','active',now());
INSERT INTO public.work_items(id,patient_id,provider_id,assigned_to,organization_id,source_type,title,reason,priority,severity,accountability_source)
 VALUES('49000000-0000-4000-8000-000000000132','49000000-0000-4000-8000-000000000012',
 '49000000-0000-4000-8000-000000000003','49000000-0000-4000-8000-000000000003','49000000-0000-4000-8000-0000000000aa',
 'manual','Synthetic second patient item','Synthetic reason','today','warning','designated');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.request(1132,132)->>'state','prepared','second patient request prepared independently');
RESET ROLE;
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id='49000000-0000-4000-8000-000000000001'
 AND patient_id='49000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
INSERT INTO request_results VALUES('filtered-page',public.get_my_work_reassignment_requests(NULL,1));
SELECT is((SELECT result->>'inaccessible_count' FROM request_results WHERE label='filtered-page'),'27','more than one inaccessible page reported without identifiers');
SELECT is((SELECT jsonb_array_length(result->'items') FROM request_results WHERE label='filtered-page'),1,'inaccessible rows do not consume authorized page');
SELECT is((SELECT result#>>'{items,0,request,patientId}' FROM request_results WHERE label='filtered-page'),
 '49000000-0000-4000-8000-000000000012','only currently authorized patient returned');
SELECT is((SELECT result->'next_cursor' FROM request_results WHERE label='filtered-page'),'null'::jsonb,'inaccessible rows do not create a misleading tail cursor');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000005","aal":"aal2"}',true);
SELECT is(jsonb_array_length(public.get_my_work_reassignment_requests()->'items'),0,'another actor cannot read or infer the first actor requests');
SELECT is(public.get_my_work_reassignment_requests()->>'inaccessible_count','0','another actor sees only their own totals');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($q$SELECT public.get_my_work_reassignment_requests()$q$,'42501','Work ownership operation not authorized','own-request projection still requires AAL2');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$INSERT INTO public.work_item_events(work_item_id,actor_id,event_type,from_status,to_status)
 VALUES('49000000-0000-4000-8000-000000000100','49000000-0000-4000-8000-000000000001','reassignment_requested','new','new')$q$,
 '23514',NULL,'legacy service fields cannot forge a prepared request');
SELECT throws_ok($q$INSERT INTO public.work_item_events(work_item_id,actor_id,event_type,from_status,to_status)
 VALUES('49000000-0000-4000-8000-000000000100','49000000-0000-4000-8000-000000000001','reassignment_seen','new','new')$q$,
 '23514',NULL,'legacy service fields cannot forge acknowledgement');
SELECT throws_ok($q$INSERT INTO public.work_item_events(work_item_id,actor_id,event_type,from_status,to_status)
 VALUES('49000000-0000-4000-8000-000000000100','49000000-0000-4000-8000-000000000001','reassignment_cancelled','new','new')$q$,
 '23514',NULL,'legacy service fields cannot forge cancellation');
SELECT * FROM finish();
ROLLBACK;
