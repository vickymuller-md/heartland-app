-- Synthetic, transactional, read-only projection and real authenticated RLS checks.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
SELECT ok(has_function_privilege('authenticated','public.get_operational_exceptions(uuid,text,integer)','EXECUTE'),'authenticated RPC exists');
SELECT ok(NOT has_function_privilege('anon','public.get_operational_exceptions(uuid,text,integer)','EXECUTE'),'anonymous RPC denied');
SELECT ok(NOT has_function_privilege('service_role','public.get_operational_exceptions(uuid,text,integer)','EXECUTE'),'no service bypass RPC');
SELECT ok(NOT has_function_privilege('authenticated','public.operational_exception_rows(uuid)','EXECUTE'),'projection helper private');
SELECT ok(NOT has_function_privilege('authenticated','public.operational_exception_detail_allowed(uuid,uuid)','EXECUTE'),'scope helper private');
SELECT ok(NOT has_function_privilege('service_role','public.operational_patient_current(uuid)','EXECUTE'),'patient helper private');
SELECT ok((SELECT bool_and(prosecdef AND 'search_path=""'=ANY(proconfig)) FROM pg_proc
  WHERE pronamespace='public'::regnamespace AND proname IN ('operational_patient_current','operational_exception_detail_allowed',
  'operational_exception_rows','get_operational_exceptions','get_unowned_work')),'all definer paths have empty search path');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND permissive='RESTRICTIVE'
  AND policyname IN('work_items_current_patient_read','work_items_current_patient_update','work_events_current_patient_read','accountability_current_patient_read')),4,'restrictive scopes compose with permissive policies');

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

CREATE TEMP TABLE exception_results(label text PRIMARY KEY,result jsonb);
GRANT ALL ON exception_results TO authenticated,service_role;
CREATE FUNCTION pg_temp.exception_page(p_after text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.get_operational_exceptions('49000000-0000-4000-8000-0000000000aa',p_after,25)
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($q$SELECT pg_temp.exception_page()$q$,'42501','Operational exceptions not authorized','AAL1 denied');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000011","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT pg_temp.exception_page()$q$,'42501','Operational exceptions not authorized','patient denied');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000006","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT pg_temp.exception_page()$q$,'42501','Operational exceptions not authorized','tester denied');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000005","aal":"aal2"}',true);
SELECT throws_ok($q$SELECT pg_temp.exception_page()$q$,'42501','Operational exceptions not authorized','other organization denied');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
INSERT INTO exception_results VALUES('page1',pg_temp.exception_page());
INSERT INTO exception_results VALUES('page2',pg_temp.exception_page((SELECT result->>'next_cursor' FROM exception_results WHERE label='page1')));
SELECT is((SELECT jsonb_array_length(result->'items') FROM exception_results WHERE label='page1'),25,'bounded first page');
SELECT is((SELECT jsonb_array_length(result->'items') FROM exception_results WHERE label='page2'),7,'tail beyond first page retained');
SELECT is((SELECT result->'next_cursor' FROM exception_results WHERE label='page2'),'null'::jsonb,'final page has no cursor');
SELECT is((SELECT count(DISTINCT row->>'key')::int FROM exception_results,jsonb_array_elements(result->'items') row),32,'no duplicate stable keys across pages');
SELECT is((SELECT result#>>'{counts,ownership}' FROM exception_results WHERE label='page1'),'34','manager totals retain inaccessible work without identifiers');
SELECT is((SELECT count(*)::int FROM jsonb_each((SELECT result->'counts' FROM exception_results WHERE label='page1'))),8,'aggregate schema has exactly eight category counts');
SELECT ok((SELECT bool_and(jsonb_typeof(value)='number') FROM jsonb_each((SELECT result->'counts' FROM exception_results WHERE label='page1'))),'all aggregate values are numbers');
SELECT ok((SELECT result::text NOT LIKE '%Private synthetic%' AND result::text NOT LIKE '%Hidden title%'
 AND result::text NOT LIKE '%49000000-0000-4000-8000-000000000012%' AND result::text NOT LIKE '%49000000-0000-4000-8000-000000000013%'
 FROM exception_results WHERE label='page1'),'projection exposes no clinical strings or unauthorized patient identifiers');
SELECT is((SELECT reason_code FROM public.get_unowned_work('49000000-0000-4000-8000-0000000000aa')
 WHERE work_item_id='49000000-0000-4000-8000-000000000100'),'no_active_link','accepted owner with revoked link now appears');
SELECT is((SELECT count(*)::int FROM public.get_unowned_work('49000000-0000-4000-8000-0000000000aa')),32,'old RPC observes full patient detail scope');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE patient_id='49000000-0000-4000-8000-000000000012'),0,'manager direct work SELECT cannot bypass missing link');
SELECT is((SELECT count(*)::int FROM public.patient_accountability WHERE patient_id='49000000-0000-4000-8000-000000000012'),0,'manager direct accountability SELECT cannot bypass missing link');
SELECT is((SELECT count(*)::int FROM public.work_item_events WHERE work_item_id NOT IN(SELECT id FROM public.work_items)),0,'events never reveal work outside current scope');
WITH changed AS(UPDATE public.work_items SET status='reviewed' WHERE patient_id='49000000-0000-4000-8000-000000000012' RETURNING id)
SELECT is((SELECT count(*)::int FROM changed),0,'direct UPDATE cannot bypass missing link');
SELECT throws_ok($q$SELECT public.get_operational_exceptions('49000000-0000-4000-8000-0000000000aa',NULL,26)$q$,'22023','Invalid exception page','oversized page denied');
SELECT throws_ok($q$SELECT public.get_operational_exceptions('49000000-0000-4000-8000-0000000000aa','',25)$q$,'22023','Invalid exception page','empty cursor denied');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT is(jsonb_array_length(pg_temp.exception_page()->'items'),0,'unlinked manager gets no details');
SELECT is(pg_temp.exception_page()#>>'{counts,ownership}','34','unlinked manager gets administrative totals');
SELECT is((SELECT count(*)::int FROM public.get_unowned_work('49000000-0000-4000-8000-0000000000aa')),0,'legacy RPC not an unlinked manager escape');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE organization_id='49000000-0000-4000-8000-0000000000aa'),0,'unlinked manager cannot read raw work');
SELECT is((SELECT count(*)::int FROM public.work_item_events),0,'unlinked manager cannot read events');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000004","aal":"aal2"}',true);
SELECT is(pg_temp.exception_page()->'counts','null'::jsonb,'ordinary monitor has no organization aggregates');
SELECT is(jsonb_array_length(pg_temp.exception_page()->'items'),25,'linked monitor can see scoped exceptions');
SELECT is((SELECT count(*)::int FROM public.get_unowned_work('49000000-0000-4000-8000-0000000000aa')),0,'legacy RPC remains manager-only');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
-- An offered item is not an alternate SELECT route after the recipient loses its link.
UPDATE public.work_items SET transfer_pending_to='49000000-0000-4000-8000-000000000004',
 transfer_offered_at=now(),transfer_offered_by='49000000-0000-4000-8000-000000000001'
 WHERE id='49000000-0000-4000-8000-000000000100';
UPDATE public.provider_patient_links SET status='revoked'
 WHERE provider_id='49000000-0000-4000-8000-000000000004' AND patient_id='49000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000004","aal":"aal2"}',true);
SELECT is((SELECT count(*)::int FROM public.work_items WHERE id='49000000-0000-4000-8000-000000000100'),0,'transfer-recipient policy cannot bypass revoked link');
SELECT is((SELECT count(*)::int FROM public.work_item_events WHERE work_item_id='49000000-0000-4000-8000-000000000100'),0,'transfer-recipient event policy cannot bypass revoked link');
SELECT is(jsonb_array_length(pg_temp.exception_page()->'items'),0,'revoked caller link hides exception detail immediately');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT is((SELECT count(*)::int FROM public.work_items WHERE patient_id='49000000-0000-4000-8000-000000000011'),0,'actual assignee also loses direct SELECT when link revoked');
RESET ROLE;
UPDATE public.provider_patient_links SET status='active'
 WHERE provider_id='49000000-0000-4000-8000-000000000004' AND patient_id='49000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000004","aal":"aal2"}',true);

RESET ROLE;
-- Revoke individual capability without fabricating a new grant. Reads fail closed immediately.
UPDATE public.member_authorizations SET revoked_at=now() WHERE membership_id IN(SELECT id FROM public.organization_memberships
 WHERE organization_id='49000000-0000-4000-8000-0000000000aa' AND user_id='49000000-0000-4000-8000-000000000004');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.exception_page()->>'detail_authorized','false','revoked capability explicitly disables details');
SELECT is(jsonb_array_length(pg_temp.exception_page()->'items'),0,'revoked capability exposes no rows');
RESET ROLE;
UPDATE public.member_authorizations SET granted_at=now()-interval '2 days',expires_at=now()-interval '1 day'
 WHERE membership_id IN(SELECT id FROM public.organization_memberships WHERE organization_id='49000000-0000-4000-8000-0000000000aa'
 AND user_id='49000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is(pg_temp.exception_page()->>'detail_authorized','false','expired manager monitor grant disables detail');
SELECT is(pg_temp.exception_page()#>>'{counts,ownership}','34','manager aggregates do not require clinical detail grant');
SELECT is((SELECT count(*)::int FROM public.get_unowned_work('49000000-0000-4000-8000-0000000000aa')),0,'old RPC also denies expired monitor grant');
RESET ROLE;
UPDATE public.member_authorizations SET expires_at=NULL WHERE membership_id IN(SELECT id FROM public.organization_memberships
 WHERE organization_id='49000000-0000-4000-8000-0000000000aa' AND user_id='49000000-0000-4000-8000-000000000001');
UPDATE public.consents SET accepted=false WHERE user_id='49000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT is(jsonb_array_length(pg_temp.exception_page()->'items'),0,'patient consent revocation hides detail');
SELECT is((SELECT count(*)::int FROM public.get_unowned_work('49000000-0000-4000-8000-0000000000aa')),0,'old RPC respects patient consent');
RESET ROLE;
UPDATE public.consents SET accepted=true WHERE user_id='49000000-0000-4000-8000-000000000011';
UPDATE public.consents SET accepted=false WHERE user_id='49000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.exception_page()$q$,'42501','Operational exceptions not authorized','caller consent revoked');
RESET ROLE;
UPDATE public.consents SET accepted=true WHERE user_id='49000000-0000-4000-8000-000000000001';
UPDATE public.organizations SET status='suspended' WHERE id='49000000-0000-4000-8000-0000000000aa';
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.exception_page()$q$,'42501','Operational exceptions not authorized','suspended organization denied');
SELECT is((SELECT count(*)::int FROM public.get_unowned_work('49000000-0000-4000-8000-0000000000aa')),0,'old RPC denies suspended organization');
RESET ROLE;
UPDATE public.organizations SET status='active' WHERE id='49000000-0000-4000-8000-0000000000aa';
UPDATE public.organization_memberships SET status='revoked'
 WHERE organization_id='49000000-0000-4000-8000-0000000000aa' AND user_id='49000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.exception_page()$q$,'42501','Operational exceptions not authorized','revoked membership denied');
RESET ROLE;
UPDATE public.organization_memberships SET status='active'
 WHERE organization_id='49000000-0000-4000-8000-0000000000aa' AND user_id='49000000-0000-4000-8000-000000000001';

-- Source categories use real capture/evaluation records; no view-specific shadow queue.
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.patients SET created_at=now()-interval '30 days' WHERE id='49000000-0000-4000-8000-000000000011';
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium)
 VALUES('49000000-0000-4000-8000-000000000501','49000000-0000-4000-8000-000000000011',now(),4.5);
SELECT public.coalesce_patient_alert('49000000-0000-4000-8000-000000000011',NULL,'informational',ARRAY['no_checkin']);
UPDATE public.work_items SET status='closed',outcome='Synthetic documented decision',outcome_code='no_action_needed'
 WHERE organization_id='49000000-0000-4000-8000-0000000000aa' AND source_type='alert';
CREATE TEMP TABLE exception_closed AS SELECT to_jsonb(item) AS saved FROM public.work_items item
 WHERE organization_id='49000000-0000-4000-8000-0000000000aa' AND status='closed';
SET LOCAL ROLE service_role;
INSERT INTO exception_results VALUES('scan_run',public.prepare_alert_scan('UTC'));
INSERT INTO exception_results VALUES('scan_capture',public.capture_alert_scan_patient((SELECT id FROM public.alert_scan_patients WHERE patient_id='49000000-0000-4000-8000-000000000011')));
INSERT INTO exception_results
 SELECT 'scan_routing',public.finalize_alert_scan_rule(id,'proactive-frozen-v1',jsonb_build_object(
 'receipt_id',id,'rule','no_checkin','decision','triggered','severity','informational','reason',NULL,'source_ids','[]'::jsonb))
 FROM public.alert_scan_patients WHERE patient_id='49000000-0000-4000-8000-000000000011';
INSERT INTO exception_results
 SELECT 'scan_blocked',public.finalize_alert_scan_rule(id,'proactive-frozen-v1',jsonb_build_object(
 'receipt_id',id,'rule','weight_trend_7d','decision','blocked','severity',NULL,'reason','ambiguous_source','source_ids','[]'::jsonb))
 FROM public.alert_scan_patients WHERE patient_id='49000000-0000-4000-8000-000000000011';
RESET ROLE;
CREATE TEMP TABLE exception_scan_snapshot AS SELECT to_jsonb(row) saved FROM public.alert_scan_patients row;
SELECT is((SELECT result->>'error_code' FROM exception_results WHERE label='scan_routing'),'needs_episode_adjudication','routing fixture is a real recorded closed-item exception');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
INSERT INTO exception_results VALUES('vitals_prepare',public.prepare_vitals_submission('49000000-0000-4000-8000-000000000011'));
INSERT INTO exception_results VALUES('vitals_capture',public.submit_vitals_submission('49000000-0000-4000-8000-000000000011',
 (SELECT (result->>'request_id')::uuid FROM exception_results WHERE label='vitals_prepare'),180,'lbs',120,80,70,NULL,0,0,false,0));
INSERT INTO exception_results VALUES('sources_page',pg_temp.exception_page('ownership:zzzz'));
SELECT is((SELECT result#>>'{counts,vitals}' FROM exception_results WHERE label='sources_page'),'1','pending vitals evaluation is visible');
SELECT is((SELECT result#>>'{counts,laboratory}' FROM exception_results WHERE label='sources_page'),'1','pending laboratory evaluation is visible');
SELECT is((SELECT result#>>'{counts,scan_capture}' FROM exception_results WHERE label='sources_page'),'1','capture aggregate includes currently assigned uncaptured patient only');
SELECT is((SELECT result#>>'{counts,scan_rule}' FROM exception_results WHERE label='sources_page'),'6','rule count excludes complete and avoids double counting uncaptured rules');
SELECT is((SELECT result#>>'{counts,scan_routing}' FROM exception_results WHERE label='sources_page'),'1','routing count stays distinct from completed detection');
SELECT is((SELECT count(*)::int FROM exception_results,jsonb_array_elements(result->'items') row
 WHERE label='sources_page' AND row->>'category'='scan_capture'),0,'unlinked capture patient not exposed as a detail');
SELECT is((SELECT count(*)::int FROM exception_results,jsonb_array_elements(result->'items') row
 WHERE label='sources_page' AND row->>'state'='blocked'),1,'blocked rule distinguished from pending');
SELECT ok((SELECT result::text NOT LIKE '%potassium%' AND result::text NOT LIKE '%snapshot%' AND result::text NOT LIKE '%ambiguous_source%'
 AND result::text NOT LIKE '%source_ids%' FROM exception_results WHERE label='sources_page'),'frozen values and raw reason are not serialized');
-- Read the laboratory category separately: stable keys sort it before ownership.
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(pg_temp.exception_page()->'items') row WHERE row->>'category'='laboratory'),1,'laboratory row is reachable through first page');
RESET ROLE;
SELECT is((SELECT to_jsonb(item) FROM public.work_items item WHERE organization_id='49000000-0000-4000-8000-0000000000aa' AND status='closed'),
 (SELECT saved FROM exception_closed),'visibility never rewrites human closed outcome');
SELECT is((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM public.alert_scan_patients row),
 (SELECT jsonb_agg(saved ORDER BY saved->>'id') FROM exception_scan_snapshot),'visibility never changes snapshots or scan state');
UPDATE public.lab_alert_evaluations SET last_error_code='evaluation_failed',attempt_count=1 WHERE lab_result_id='49000000-0000-4000-8000-000000000501';
UPDATE public.vitals_submission_evaluations SET status='failed',last_error_code='private synthetic error'
 WHERE request_id=(SELECT (result->>'request_id')::uuid FROM exception_results WHERE label='vitals_prepare');
SET LOCAL ROLE authenticated;
SELECT is((SELECT row->>'state' FROM jsonb_array_elements(pg_temp.exception_page()->'items') row WHERE row->>'category'='laboratory'),'failed','lab failure not pending success');
SELECT is((SELECT row->>'state' FROM jsonb_array_elements(pg_temp.exception_page('ownership:zzzz')->'items') row WHERE row->>'category'='vitals'),'failed','vitals failure explicit');
SELECT ok(pg_temp.exception_page('ownership:zzzz')::text NOT LIKE '%private synthetic error%','raw processing error never leaves the projection');
RESET ROLE;
-- Synthetic historic missed window: pending rule identities must not inflate capture counts.
INSERT INTO public.alert_scan_runs(id,slot,calendar_timezone) VALUES('49000000-0000-4000-8000-000000000601',current_date-2,'UTC');
INSERT INTO public.alert_scan_patients(id,run_id,patient_id,capture_status,error_code) VALUES(
 '49000000-0000-4000-8000-000000000602','49000000-0000-4000-8000-000000000601',
 '49000000-0000-4000-8000-000000000011','missed_capture_window','missed_capture_window');
INSERT INTO public.alert_scan_evaluations(receipt_id,rule) VALUES('49000000-0000-4000-8000-000000000602','no_checkin');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.exception_page()#>>'{counts,scan_capture}','2','historic missed window remains visible alongside current pending capture');
SELECT is(pg_temp.exception_page()#>>'{counts,scan_rule}','6','uncaptured historic rule does not duplicate its capture exception');
SELECT is((SELECT row->>'state' FROM jsonb_array_elements(pg_temp.exception_page('ownership:zzzz')->'items') row WHERE row->>'category'='scan_capture'),'blocked','missed window has explicit blocked state');
SELECT is((SELECT row->'reasons' FROM jsonb_array_elements(pg_temp.exception_page('ownership:zzzz')->'items') row WHERE row->>'category'='scan_capture'),
 '["missed_capture_window"]'::jsonb,'missed window is not presented as normal or automatically retryable');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.vitals_submission_evaluations),1,'read path created no duplicate evaluation');
SELECT is((SELECT count(*)::int FROM public.lab_results),1,'read path created no duplicate laboratory result');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.work_items(patient_id,provider_id,assigned_to,organization_id,source_type,title,reason,priority,severity,status,due_at,data_quality)
 VALUES('49000000-0000-4000-8000-000000000011','49000000-0000-4000-8000-000000000001',
 '49000000-0000-4000-8000-000000000001','49000000-0000-4000-8000-0000000000aa',
 'manual','Synthetic legacy item','Synthetic legacy gap','today','warning','new',now(),'verified');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"49000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is((SELECT count(*)::int FROM public.get_unowned_work('49000000-0000-4000-8000-0000000000aa')
 WHERE reason_code='legacy_fan_out'),1,'linked legacy work remains visible with compatible reason code');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
