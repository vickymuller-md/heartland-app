-- Synthetic only. Every mutation is rolled back; no hosted memberships or grants.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
SELECT ok(NOT has_column_privilege('authenticated','public.work_items','assigned_to','UPDATE'),'direct ownership mutation denied');
SELECT ok(NOT has_column_privilege('authenticated','public.work_items','ownership_revision','UPDATE'),'revision is server-managed');
SELECT ok(NOT has_column_privilege('service_role','public.work_items','assigned_to','UPDATE'),'service cannot bypass ownership command');
SELECT ok(NOT has_table_privilege('service_role','public.work_item_events','TRUNCATE'),'service cannot truncate receipts');
SELECT ok(NOT has_column_privilege('service_role','public.work_item_events','ownership_request_id','INSERT'),'service cannot mint receipts');
SELECT ok(has_column_privilege('service_role','public.work_item_events','event_type','INSERT'),'legacy service events remain available');
SELECT ok(has_function_privilege('authenticated','public.reassign_work_item_recoverable(uuid,uuid,uuid,bigint,uuid,text)','EXECUTE'),'recoverable authenticated RPC available');
SELECT ok(NOT has_function_privilege('service_role','public.reassign_work_item_recoverable(uuid,uuid,uuid,bigint,uuid,text)','EXECUTE'),'service cannot call user repair');
SELECT ok(NOT has_function_privilege('authenticated','public.work_ownership_member_eligible(uuid,uuid,uuid,timestamptz)','EXECUTE'),'arbitrary-user helper private');
SELECT ok(NOT has_function_privilege('service_role','public.get_work_reassignment_context(uuid,uuid,integer)','EXECUTE'),'service cannot prepare user context');
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


CREATE TEMP TABLE repair_results(label text PRIMARY KEY,result jsonb);
GRANT ALL ON repair_results TO authenticated,service_role;
CREATE FUNCTION pg_temp.prepare_repair(p_reason text DEFAULT 'Synthetic documented handover',
 p_request uuid DEFAULT '49000000-0000-4000-8000-000000000901') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_work_reassignment(p_request,'49000000-0000-4000-8000-000000000100',
 '49000000-0000-4000-8000-000000000003',0,'49000000-0000-4000-8000-000000000004',p_reason)
$$;
CREATE FUNCTION pg_temp.repair(p_reason text DEFAULT 'Synthetic documented handover',
 p_request uuid DEFAULT '49000000-0000-4000-8000-000000000901') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.reassign_work_item_recoverable(p_request,'49000000-0000-4000-8000-000000000100',
 '49000000-0000-4000-8000-000000000003',0,'49000000-0000-4000-8000-000000000004',p_reason)
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($q$SELECT pg_temp.repair()$q$,'42501','Work ownership operation not authorized','AAL1 denied');
SELECT throws_ok($q$SELECT public.get_work_reassignment_context('49000000-0000-4000-8000-000000000100')$q$,'42501','Work ownership operation not authorized','context also requires AAL2');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000011","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT pg_temp.repair()$q$,'42501','Work ownership operation not authorized','patient denied');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000004","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT pg_temp.repair()$q$,'42501','Work ownership operation not authorized','clinician cannot force repair');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
INSERT INTO repair_results VALUES('context-page1',public.get_work_reassignment_context('49000000-0000-4000-8000-000000000100',NULL,1));
INSERT INTO repair_results VALUES('context-page2',public.get_work_reassignment_context('49000000-0000-4000-8000-000000000100',
 (SELECT (result->>'next_cursor')::uuid FROM repair_results WHERE label='context-page1'),1));
SELECT is((SELECT result#>>'{targets,0,id}' FROM repair_results WHERE label='context-page1'),'49000000-0000-4000-8000-000000000001','first eligible recipient is ordered');
SELECT is((SELECT result#>>'{targets,0,id}' FROM repair_results WHERE label='context-page2'),'49000000-0000-4000-8000-000000000004','next eligible recipient excludes unlinked admin and stale owner');
SELECT is((SELECT result->>'current_revision' FROM repair_results WHERE label='context-page1'),'0','preparation reports observed revision');
SELECT is((SELECT result->'next_cursor' FROM repair_results WHERE label='context-page2'),'null'::jsonb,'last candidate page terminates');
SELECT throws_ok($q$SELECT public.get_work_reassignment_context('49000000-0000-4000-8000-000000000100',NULL,26)$q$,'22023','Invalid ownership page','candidate pagination is bounded');
SELECT lives_ok($q$SELECT pg_temp.prepare_repair()$q$,'reviewed reassignment is durably prepared before application');
INSERT INTO repair_results VALUES('original',pg_temp.repair());
SELECT is((SELECT assigned_to FROM public.work_items WHERE id='49000000-0000-4000-8000-000000000100'),'49000000-0000-4000-8000-000000000004'::uuid,'eligible target replaces drifted owner');
SELECT is((SELECT ownership_revision FROM public.work_items WHERE id='49000000-0000-4000-8000-000000000100'),1::bigint,'exactly one ownership revision');
SELECT ok((SELECT accepted_at IS NULL AND accepted_by IS NULL AND accountability_source='manager_reassigned'
 FROM public.work_items WHERE id='49000000-0000-4000-8000-000000000100'),'repair does not infer acceptance');
SELECT is((SELECT ownership_reason FROM public.work_item_events WHERE ownership_request_id='49000000-0000-4000-8000-000000000901' AND event_type='assigned'),'Synthetic documented handover','reason retained in append-only receipt');
SELECT is(pg_temp.repair(),(SELECT result FROM repair_results WHERE label='original'),'lost-response retry returns identical transition');
RESET ROLE;
UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '100 milliseconds'
 WHERE membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='49000000-0000-4000-8000-000000000001');
SELECT pg_sleep(0.15);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.work_item_events WHERE ownership_request_id IS NOT NULL),0,'receipt SELECT checks expiry after transaction began');
SELECT throws_ok($q$SELECT pg_temp.repair()$q$,'42501','Work ownership operation not authorized','replay checks expiry after transaction began');
SELECT throws_ok($q$SELECT public.get_work_reassignment_context('49000000-0000-4000-8000-000000000100')$q$,'42501','Work ownership operation not authorized','preparation checks current expiry too');
RESET ROLE;
UPDATE public.member_authorizations SET expires_at=NULL
 WHERE membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='49000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.work_item_events WHERE ownership_request_id='49000000-0000-4000-8000-000000000901' AND event_type='assigned'),1,'retry cannot duplicate receipt');
SELECT throws_ok($q$SELECT pg_temp.repair('Changed reason')$q$,'23505','Reassignment request conflict','same identity with different payload rejected');
-- Release the applied request's slot explicitly before testing a fresh stale command.
SELECT lives_ok($q$SELECT public.finish_work_reassignment_request('49000000-0000-4000-8000-000000000901',
 (SELECT (result->>'event_id')::uuid FROM repair_results WHERE label='original'),false)$q$,
 'the recorded receipt is explicitly acknowledged before a new attempt');
SELECT throws_ok($q$SELECT pg_temp.prepare_repair('Synthetic documented handover','49000000-0000-4000-8000-000000000902')$q$,
 '40001','Work ownership changed; refresh before retrying','new attempt cannot overwrite newer ownership');
SELECT throws_ok($q$SELECT public.reassign_work_item('49000000-0000-4000-8000-000000000100','49000000-0000-4000-8000-000000000001','Old route')$q$,
 '0A000','Reassignment requires a recoverable request and current ownership revision','nonrecoverable forced route blocked');
SELECT throws_ok($q$UPDATE public.work_items SET assigned_to='49000000-0000-4000-8000-000000000001' WHERE id='49000000-0000-4000-8000-000000000100'$q$,
 '42501','permission denied for table work_items','direct reassignment denied');
RESET ROLE;
UPDATE public.provider_patient_links SET status='revoked'
 WHERE provider_id='49000000-0000-4000-8000-000000000004' AND patient_id='49000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.repair(),(SELECT result FROM repair_results WHERE label='original'),'historical retry does not require target still eligible');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=now() WHERE membership_id IN(
 SELECT id FROM public.organization_memberships WHERE user_id='49000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.repair()$q$,'42501','Work ownership operation not authorized','current caller monitor required even for retry');
SELECT is((SELECT count(*)::int FROM public.work_item_events WHERE ownership_request_id IS NOT NULL),0,'revoked monitor cannot read raw receipt');
SELECT ok((SELECT count(*)>0 FROM public.work_item_events WHERE ownership_request_id IS NULL),'old event visibility not broadened or erased');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL WHERE membership_id IN(
 SELECT id FROM public.organization_memberships WHERE user_id='49000000-0000-4000-8000-000000000001');
UPDATE public.consents SET accepted=false WHERE user_id='49000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.work_item_events WHERE ownership_request_id IS NOT NULL),0,'withdrawn patient consent hides raw receipt');
SELECT throws_ok($q$SELECT pg_temp.repair()$q$,'42501','Work ownership operation not authorized','withdrawn patient consent blocks retry');
RESET ROLE;
UPDATE public.consents SET accepted=true WHERE user_id='49000000-0000-4000-8000-000000000011';
UPDATE public.provider_patient_links SET status='active'
 WHERE provider_id='49000000-0000-4000-8000-000000000004' AND patient_id='49000000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$UPDATE public.work_items SET assigned_to='49000000-0000-4000-8000-000000000001'
 WHERE id='49000000-0000-4000-8000-000000000100'$q$,'42501','permission denied for table work_items','actual service cannot reassign without receipt');
SELECT throws_ok($q$TRUNCATE public.work_item_events$q$,'42501','permission denied for table work_item_events','real service truncate denied');
SELECT throws_ok($q$INSERT INTO public.work_item_events(work_item_id,event_type,ownership_request_id)
 VALUES('49000000-0000-4000-8000-000000000100','assigned','49000000-0000-4000-8000-000000000999')$q$,
 '42501','permission denied for table work_item_events','service receipt forgery denied');
SELECT throws_ok($q$UPDATE public.work_item_events SET ownership_reason='Changed receipt' WHERE ownership_request_id IS NOT NULL$q$,
 'P0001',NULL,'receipt updates denied by append-only trigger');
SELECT throws_ok($q$DELETE FROM public.work_item_events WHERE ownership_request_id IS NOT NULL$q$,
 'P0001',NULL,'receipt deletes denied by append-only trigger');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok($q$INSERT INTO public.work_item_events(work_item_id,event_type)
 VALUES('49000000-0000-4000-8000-000000000100','assigned')$q$,'42501','permission denied for table work_item_events','user event forgery denied');
SELECT throws_ok($q$TRUNCATE public.work_item_events$q$,'42501','permission denied for table work_item_events','user truncate denied');
SELECT lives_ok($q$SELECT public.offer_work_item_transfer('49000000-0000-4000-8000-000000000101',
 '49000000-0000-4000-8000-000000000004','Synthetic transfer offer')$q$,'manager with current scope offers a transfer');
UPDATE public.work_items SET status='closed',outcome='Synthetic reviewed closure',outcome_code='no_action_needed'
 WHERE id='49000000-0000-4000-8000-000000000101';
INSERT INTO repair_results SELECT 'closed',to_jsonb(item) FROM public.work_items AS item WHERE id='49000000-0000-4000-8000-000000000101';
RESET ROLE;
SELECT lives_ok($q$UPDATE public.organization_memberships SET status='revoked'
 WHERE user_id='49000000-0000-4000-8000-000000000004'$q$,'closed pending offer does not block membership revocation');
SELECT is((SELECT to_jsonb(item) FROM public.work_items AS item WHERE id='49000000-0000-4000-8000-000000000101'),
 (SELECT result FROM repair_results WHERE label='closed'),'closed item remains byte-for-byte unchanged');
SELECT throws_ok($q$UPDATE public.work_items SET transfer_pending_to=NULL WHERE id='49000000-0000-4000-8000-000000000101'$q$,
 'P0001','Closed work ownership is immutable','even privileged caller cannot rewrite closed ownership');
UPDATE public.organization_memberships SET status='active' WHERE user_id='49000000-0000-4000-8000-000000000004';
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.work_items(id,patient_id,provider_id,assigned_to,organization_id,source_type,title,reason,priority,severity,
 status,due_at,snooze_reason,data_quality,accountability_source)
 VALUES('49000000-0000-4000-8000-000000000777','49000000-0000-4000-8000-000000000011',
 '49000000-0000-4000-8000-000000000003','49000000-0000-4000-8000-000000000003','49000000-0000-4000-8000-0000000000aa',
 'manual','Historical synthetic item','Synthetic reason','today','warning','awaiting',now()-interval '1 day','Existing waiting reason','verified','designated');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT lives_ok($q$SELECT public.prepare_work_reassignment('49000000-0000-4000-8000-000000000903',
 '49000000-0000-4000-8000-000000000777','49000000-0000-4000-8000-000000000003',0,
 '49000000-0000-4000-8000-000000000004','Repair historical overdue item')$q$,'elapsed deadline does not block repair preparation');
SELECT lives_ok($q$SELECT public.reassign_work_item_recoverable('49000000-0000-4000-8000-000000000903',
 '49000000-0000-4000-8000-000000000777','49000000-0000-4000-8000-000000000003',0,
 '49000000-0000-4000-8000-000000000004','Repair historical overdue item')$q$,'elapsed deadline does not block ownership repair');
SELECT throws_ok($q$UPDATE public.work_items SET due_at=now()-interval '2 days' WHERE id='49000000-0000-4000-8000-000000000777'$q$,
 'P0001','awaiting status requires a future due date','new past deadline remains forbidden');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000004","aal":"aal2"}',true);
SELECT lives_ok($q$SELECT public.accept_work_item('49000000-0000-4000-8000-000000000777')$q$,'eligible recipient explicitly accepts overdue item');
RESET ROLE;
SELECT lives_ok($q$UPDATE public.organization_memberships SET status='revoked'
 WHERE user_id='49000000-0000-4000-8000-000000000004'$q$,'elapsed deadline does not block membership revocation');
SELECT ok((SELECT due_at=now()-interval '1 day' AND status='awaiting' AND accepted_at IS NULL AND ownership_revision=3
 FROM public.work_items WHERE id='49000000-0000-4000-8000-000000000777'),'ownership repair and revocation preserve historical deadline');
SELECT * FROM finish();
ROLLBACK;
