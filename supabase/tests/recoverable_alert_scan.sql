BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.alert_scan_runs'::regclass,'public.alert_scan_patients'::regclass,
 'public.alert_scan_evaluations'::regclass,'public.alert_scan_drain_state'::regclass)),'all scan tables have RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.alert_scan_patients','SELECT'),'no browser clinical scope added');
SELECT ok(NOT has_table_privilege('service_role','public.alert_scan_patients','INSERT'),'service cannot insert arbitrary snapshots');
SELECT ok(NOT has_table_privilege('service_role','public.alert_scan_evaluations','UPDATE'),'service cannot bypass finalizer');
SELECT ok(NOT has_function_privilege('authenticated','public.prepare_alert_scan(text)','EXECUTE'),'browser cannot prepare scan');
SELECT ok(NOT has_function_privilege('anon','public.finalize_alert_scan_rule(uuid,text,jsonb)','EXECUTE'),'anonymous cannot finalize scan');
SELECT ok(NOT has_function_privilege('service_role','public.lock_alert_scan_scope(uuid)','EXECUTE'),'scope helper is private');
SELECT ok(NOT has_function_privilege('service_role','public.erase_audited_tester_scan()','EXECUTE'),'erasure helper is private');
SELECT ok((SELECT bool_and(prosecdef AND 'search_path=""'=ANY(proconfig)) FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN ('prepare_alert_scan','capture_alert_scan_patient','finalize_alert_scan_rule','next_alert_scan_page','alert_scan_status')),'exposed scan RPCs pin definer search path');
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('48000000-0000-4000-8000-000000000001','scan-owner@example.invalid','{"consent_accepted":true}'),
 ('48000000-0000-4000-8000-000000000011','scan-one@example.invalid','{"consent_accepted":true}'),
 ('48000000-0000-4000-8000-000000000012','scan-two@example.invalid','{"consent_accepted":true}'),
 ('48000000-0000-4000-8000-000000000013','scan-unlinked@example.invalid','{"consent_accepted":true}');
UPDATE public.profiles SET role='provider' WHERE id='48000000-0000-4000-8000-000000000001';
UPDATE public.patients SET created_at=now()-interval '30 days' WHERE id IN ('48000000-0000-4000-8000-000000000011','48000000-0000-4000-8000-000000000012');
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 ('48000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000011','active',now()),
 ('48000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000012','active',now());
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by)
 SELECT public.primary_organization_for_provider('48000000-0000-4000-8000-000000000001'),
 '48000000-0000-4000-8000-000000000011','48000000-0000-4000-8000-000000000001' ON CONFLICT DO NOTHING;
-- Rolled-back monitoring grant for the explicit human acceptance below.
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',user_id FROM public.organization_memberships
 WHERE user_id='48000000-0000-4000-8000-000000000001' AND status='active';
INSERT INTO public.alert_preferences(provider_id,patient_id,alert_type,muted) VALUES
 ('48000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000011','no_checkin',true);
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium,egfr) VALUES
 ('48000000-0000-4000-8000-000000000301','48000000-0000-4000-8000-000000000011',now(),6.2,29);
INSERT INTO public.scheduled_followups(id,patient_id,provider_id,scheduled_at,type) VALUES
 ('48000000-0000-4000-8000-000000000401','48000000-0000-4000-8000-000000000011','48000000-0000-4000-8000-000000000001',now()+interval '12 hours','Synthetic due follow-up'),
 ('48000000-0000-4000-8000-000000000402','48000000-0000-4000-8000-000000000011','48000000-0000-4000-8000-000000000001',now()-interval '4 days','Synthetic overdue follow-up');
CREATE TEMP TABLE scan_results(label text PRIMARY KEY,result jsonb);
GRANT ALL ON scan_results TO service_role,authenticated;
CREATE FUNCTION pg_temp.sr(p_patient uuid) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM public.alert_scan_patients WHERE patient_id=p_patient AND run_id=(SELECT (result->>'run_id')::uuid FROM scan_results WHERE label='run')
$$;
CREATE FUNCTION pg_temp.scan_result(p_rule text,p_decision text DEFAULT 'triggered',p_severity text DEFAULT 'informational',p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('receipt_id',pg_temp.sr('48000000-0000-4000-8000-000000000011'),
 'rule',p_rule,'decision',p_decision,'severity',p_severity,'reason',p_reason,'source_ids',
 CASE WHEN p_decision='triggered' AND p_rule IN ('hyperkalemia','low_egfr') THEN '["48000000-0000-4000-8000-000000000301"]'::jsonb
 WHEN p_decision='triggered' AND p_rule='followup_due' THEN '["48000000-0000-4000-8000-000000000401"]'::jsonb
 WHEN p_decision='triggered' AND p_rule='followup_overdue' THEN '["48000000-0000-4000-8000-000000000402"]'::jsonb ELSE '[]'::jsonb END)
$$;
CREATE FUNCTION pg_temp.finalize(p_rule text,p_decision text DEFAULT 'triggered',p_severity text DEFAULT 'informational',p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.finalize_alert_scan_rule(pg_temp.sr('48000000-0000-4000-8000-000000000011'),
 'proactive-frozen-v2',pg_temp.scan_result(p_rule,p_decision,p_severity,p_reason))
$$;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role","sub":"48000000-0000-4000-8000-000000000001"}',true);
SELECT throws_ok($q$SELECT public.prepare_alert_scan('UTC')$q$,'42501','Scan service context required','service with user subject is not trusted cron');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$SELECT public.prepare_alert_scan('Invalid/Timezone')$q$,'22023','Unsupported scan calendar','invalid calendar rejected');
INSERT INTO scan_results VALUES('run',public.prepare_alert_scan('America/New_York'));
SELECT is((SELECT result->>'patients' FROM scan_results WHERE label='run'),'2','prepare saves eligible linked patient set');
SELECT is((SELECT count(*)::int FROM public.alert_scan_evaluations),14,'all seven pending identities per patient prepared together');
SELECT is(public.prepare_alert_scan('UTC'),(SELECT result FROM scan_results WHERE label='run'),'same day replay preserves run and original timezone');
SELECT throws_ok($q$SELECT pg_temp.finalize('no_checkin')$q$,'22023','Scan capture unavailable','evaluation cannot precede capture');
INSERT INTO scan_results VALUES('capture',public.capture_alert_scan_patient(pg_temp.sr('48000000-0000-4000-8000-000000000011')));
SELECT is((SELECT result->>'state' FROM scan_results WHERE label='capture'),'captured','snapshot captured');
SELECT is((SELECT result#>>'{snapshot,calendar_timezone}' FROM scan_results WHERE label='capture'),'America/New_York','frozen calendar provenance');
SELECT is((SELECT jsonb_array_length(result#>'{snapshot,calendar_dates}') FROM scan_results WHERE label='capture'),7,'seven saved calendar dates');
SELECT is((SELECT result#>'{snapshot,sources,weights}' FROM scan_results WHERE label='capture'),'[]'::jsonb,'confirmed empty history is explicit');
SELECT is((SELECT result#>'{snapshot,sources,checkin,latest_vital}' FROM scan_results WHERE label='capture'),'null'::jsonb,'confirmed absent last observation is distinct from failed query');
SELECT throws_ok($q$SELECT public.finalize_alert_scan_rule(pg_temp.sr('48000000-0000-4000-8000-000000000011'),'proactive-frozen-v2',
 jsonb_set(pg_temp.scan_result('hyperkalemia','triggered','critical'),'{source_ids}','[]'))$q$,
 '22023','Scan source identities do not match capture','triggered laboratory result cannot omit source');
SELECT throws_ok($q$SELECT public.finalize_alert_scan_rule(pg_temp.sr('48000000-0000-4000-8000-000000000011'),'proactive-frozen-v2',
 jsonb_set(pg_temp.scan_result('hyperkalemia','triggered','critical'),'{source_ids}','["48000000-0000-4000-8000-000000000401"]'))$q$,
 '22023','Scan source identities do not match capture','follow-up source cannot support laboratory classification');
SELECT throws_ok($q$SELECT public.finalize_alert_scan_rule(pg_temp.sr('48000000-0000-4000-8000-000000000012'),'proactive-frozen-v2',
 pg_temp.scan_result('no_checkin'))$q$,'22023','Invalid scan result','even source-less result cannot be swapped between receipts');
INSERT INTO scan_results VALUES('no_checkin',pg_temp.finalize('no_checkin'));
SELECT is((SELECT result->>'status' FROM scan_results WHERE label='no_checkin'),'complete','informational rule commits');
SELECT is((SELECT severity FROM public.alerts WHERE id=(SELECT (result->>'alert_id')::uuid FROM scan_results WHERE label='no_checkin')),'informational','muting does not suppress or promote detected signal');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id=(SELECT (result->>'alert_id')::uuid FROM scan_results WHERE label='no_checkin')),1,'governed work is committed with alert');
SELECT is(pg_temp.finalize('no_checkin'),(SELECT result FROM scan_results WHERE label='no_checkin'),'lost finalizer response recovers exact receipt');
SELECT is((SELECT occurrence_count FROM public.alerts WHERE id=(SELECT (result->>'alert_id')::uuid FROM scan_results WHERE label='no_checkin')),1,'replay does not call coalescer twice');
SELECT throws_ok($q$SELECT pg_temp.finalize('no_checkin','not_triggered',NULL)$q$,'23505','Scan result differs from frozen evaluation','cannot replace completed clinical result');
SELECT throws_ok($q$SELECT pg_temp.finalize('followup_due','triggered','warning')$q$,'22023','Invalid scan result','cannot promote informational follow-up');
SELECT throws_ok($q$SELECT public.finalize_alert_scan_rule(pg_temp.sr('48000000-0000-4000-8000-000000000011'),'unknown',pg_temp.scan_result('followup_due'))$q$,
 '22023','Invalid scan result','unknown recipe rejected');
SELECT throws_ok($q$SELECT public.finalize_alert_scan_rule(pg_temp.sr('48000000-0000-4000-8000-000000000011'),'proactive-frozen-v2',pg_temp.scan_result('unknown'))$q$,
 '22023','Invalid scan result','unknown rule rejected');
SELECT throws_ok($q$UPDATE public.alert_scan_patients SET snapshot='{}'$q$,'42501',NULL,'service direct snapshot edit denied');
SELECT is(pg_temp.finalize('weight_trend_7d','blocked',NULL,'ambiguous_source')->>'status','blocked','ambiguity is explicit and not no-trigger');
SELECT is(pg_temp.finalize('hyperkalemia','triggered','critical')->>'status','complete','independent critical rule completes despite blocked weight rule');
SELECT is(pg_temp.finalize('low_adherence','not_applicable',NULL)->>'status','complete','confirmed no scheduled medication rule can complete without alert');
SELECT is((SELECT count(*)::int FROM public.alerts),2,'non-trigger/blocked rules do not create alerts');

RESET ROLE;
INSERT INTO public.vitals(patient_id,weight_lbs,recorded_at) VALUES('48000000-0000-4000-8000-000000000011',185,now());
SET LOCAL ROLE service_role;
SELECT is(public.capture_alert_scan_patient(pg_temp.sr('48000000-0000-4000-8000-000000000011')),
 (SELECT result FROM scan_results WHERE label='capture'),'snapshot replay never reads new live measurements');
RESET ROLE;
SELECT throws_ok($q$UPDATE public.alert_scan_patients SET snapshot='{}' WHERE patient_id='48000000-0000-4000-8000-000000000011'$q$,
 'P0001','Scan provenance is immutable','even privileged fixtures cannot rewrite captured context');
CREATE FUNCTION pg_temp.fail_scan_alert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic persistence failure'; END $$;
CREATE TRIGGER fail_scan_alert AFTER INSERT OR UPDATE ON public.alerts FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_scan_alert();
SET LOCAL ROLE service_role;
SELECT is(pg_temp.finalize('low_egfr','triggered','critical')->>'status','failed','persistence failure leaves retryable rule');
SELECT is((SELECT count(*)::int FROM public.alerts),2,'failed transaction adds no orphan alert');
SELECT is((SELECT error_code FROM public.alert_scan_evaluations WHERE receipt_id=pg_temp.sr('48000000-0000-4000-8000-000000000011') AND rule='low_egfr'),
 'P0001','only safe SQLSTATE persisted');
SELECT is(pg_temp.finalize('no_checkin'),(SELECT result FROM scan_results WHERE label='no_checkin'),'other completed rules unaffected by failure');
RESET ROLE;
DROP TRIGGER fail_scan_alert ON public.alerts;
SET LOCAL ROLE service_role;
SELECT is(pg_temp.finalize('low_egfr','triggered','critical')->>'status','complete','same frozen evaluation succeeds on retry');
SELECT is((SELECT attempts FROM public.alert_scan_evaluations WHERE receipt_id=pg_temp.sr('48000000-0000-4000-8000-000000000011') AND rule='low_egfr'),2,'failed and successful attempts recorded');

RESET ROLE;
UPDATE public.provider_patient_links SET status='revoked' WHERE patient_id='48000000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
SELECT is(public.capture_alert_scan_patient(pg_temp.sr('48000000-0000-4000-8000-000000000011'))->>'state','blocked_scope','revoked access is explicit after capture');
SELECT is((SELECT count(*)::int FROM public.alert_scan_evaluations WHERE receipt_id=pg_temp.sr('48000000-0000-4000-8000-000000000011') AND status='complete'),4,'revocation preserves completed outcomes');
SELECT is((SELECT snapshot FROM public.alert_scan_patients WHERE id=pg_temp.sr('48000000-0000-4000-8000-000000000011')),
 (SELECT result->'snapshot' FROM scan_results WHERE label='capture'),'revocation never erases or recaptures source');
SELECT is(pg_temp.finalize('followup_due')->>'error_code','blocked_scope','direct privileged retry still checks current authority');
RESET ROLE;
UPDATE public.provider_patient_links SET status='active' WHERE patient_id='48000000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
SELECT is(pg_temp.finalize('followup_due')->>'status','complete','explicit retry after restored scope uses original capture');

-- An independently closed work item must not be silently reopened or refreshed.
RESET ROLE;
SELECT * FROM public.coalesce_patient_alert('48000000-0000-4000-8000-000000000011',NULL,'warning',ARRAY['followup_overdue']);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT public.accept_work_item((SELECT id FROM public.work_items WHERE source_type='alert' AND source_id IN(SELECT id FROM public.alerts WHERE flags=ARRAY['followup_overdue'])));
RESET ROLE;
UPDATE public.work_items SET status='closed',outcome='Synthetic documented follow-up',outcome_code='followup_completed'
 WHERE source_type='alert' AND source_id IN(SELECT id FROM public.alerts WHERE flags=ARRAY['followup_overdue']);
CREATE TEMP TABLE scan_closed AS SELECT to_jsonb(item) AS row FROM public.work_items AS item WHERE status='closed';
GRANT SELECT ON scan_closed TO service_role;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(pg_temp.finalize('followup_overdue','triggered','warning')->>'error_code','needs_episode_adjudication','closed work requires explicit episode adjudication');
SELECT is((SELECT to_jsonb(item) FROM public.work_items AS item WHERE status='closed'),(SELECT row FROM scan_closed),'closed human outcome remains byte-identical');
SELECT is((SELECT occurrence_count FROM public.alerts WHERE flags=ARRAY['followup_overdue']),2,'new frozen signal persists once despite closed-item routing exception');
SELECT is(pg_temp.finalize('followup_overdue','triggered','warning')->>'status','complete','routing exception is distinct from persisted detection');
SELECT is((SELECT occurrence_count FROM public.alerts WHERE flags=ARRAY['followup_overdue']),2,'exception replay never coalesces detection twice');
SELECT is(public.alert_scan_status()->>'routing_exceptions','1','routing exception counted separately from completed detection');

-- A second organization receives the same alert but owns its own open task.
RESET ROLE;
INSERT INTO public.organizations(id,name,created_by) VALUES
 ('48000000-0000-4000-8000-000000000501','Synthetic second scan organization','48000000-0000-4000-8000-000000000001');
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,is_default,joined_at,created_by) VALUES
 ('48000000-0000-4000-8000-000000000501','48000000-0000-4000-8000-000000000001','owner','active',false,now(),'48000000-0000-4000-8000-000000000001');
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by) VALUES
 ('48000000-0000-4000-8000-000000000501','48000000-0000-4000-8000-000000000011','48000000-0000-4000-8000-000000000001');
INSERT INTO public.work_items(organization_id,patient_id,provider_id,assigned_to,source_type,source_id,title,reason,priority,severity,accountability_source)
 SELECT '48000000-0000-4000-8000-000000000501','48000000-0000-4000-8000-000000000011',
 '48000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000001','alert',id,
 'Review patient alert','Synthetic pending second organization','today','warning','designated' FROM public.alerts WHERE flags=ARRAY['followup_overdue'];
INSERT INTO public.alert_scan_runs(id,slot,calendar_timezone) VALUES
 ('48000000-0000-4000-8000-000000000102',(clock_timestamp() AT TIME ZONE 'UTC')::date-2,'America/New_York');
INSERT INTO public.alert_scan_patients(id,run_id,patient_id,capture_status,snapshot)
 SELECT '48000000-0000-4000-8000-000000000202','48000000-0000-4000-8000-000000000102','48000000-0000-4000-8000-000000000011','captured',
 jsonb_set(result->'snapshot','{receipt_id}','"48000000-0000-4000-8000-000000000202"') FROM scan_results WHERE label='capture';
INSERT INTO public.alert_scan_evaluations(receipt_id,rule) VALUES('48000000-0000-4000-8000-000000000202','followup_overdue');
SET LOCAL ROLE service_role;
SELECT is(public.capture_alert_scan_patient('48000000-0000-4000-8000-000000000202')->>'state','captured','existing frozen capture replays after its slot ended');
INSERT INTO scan_results VALUES('mixed',public.finalize_alert_scan_rule('48000000-0000-4000-8000-000000000202','proactive-frozen-v2',
 jsonb_set(pg_temp.scan_result('followup_overdue','triggered','critical'),'{receipt_id}','"48000000-0000-4000-8000-000000000202"')));
SELECT is((SELECT result->>'status' FROM scan_results WHERE label='mixed'),'complete','mixed organization state does not block detection');
SELECT is((SELECT severity FROM public.work_items WHERE organization_id='48000000-0000-4000-8000-000000000501' AND source_type='alert'),'critical','open organization receives critical signal refresh');
SELECT is((SELECT to_jsonb(item) FROM public.work_items AS item WHERE status='closed'),(SELECT row FROM scan_closed),'other organization closed item is still byte-identical');
SELECT is((SELECT jsonb_array_length(result->'prior_item_ids') FROM scan_results WHERE label='mixed'),1,'only closed item is listed for adjudication');
SELECT is(public.finalize_alert_scan_rule('48000000-0000-4000-8000-000000000202','proactive-frozen-v2',
 jsonb_set(pg_temp.scan_result('followup_overdue','triggered','critical'),'{receipt_id}','"48000000-0000-4000-8000-000000000202"')),
 (SELECT result FROM scan_results WHERE label='mixed'),'mixed disposition replay is idempotent');
SELECT is((SELECT occurrence_count FROM public.alerts WHERE flags=ARRAY['followup_overdue']),3,'only one extra occurrence from new mixed-organization receipt');

-- Distinct past/future run fixtures prove clock behavior without altering immutable live rows.
RESET ROLE;
INSERT INTO public.alert_scan_runs(id,slot,calendar_timezone) VALUES
 ('48000000-0000-4000-8000-000000000101',(clock_timestamp() AT TIME ZONE 'UTC')::date-1,'UTC');
INSERT INTO public.alert_scan_patients(id,run_id,patient_id) VALUES
 ('48000000-0000-4000-8000-000000000201','48000000-0000-4000-8000-000000000101','48000000-0000-4000-8000-000000000011');
INSERT INTO public.alert_scan_evaluations(receipt_id,rule) SELECT '48000000-0000-4000-8000-000000000201',unnest(ARRAY['no_checkin','low_adherence','weight_trend_7d','hyperkalemia','low_egfr','followup_due','followup_overdue']);
SET LOCAL ROLE service_role;
SELECT is(public.capture_alert_scan_patient('48000000-0000-4000-8000-000000000201')->>'state','missed_capture_window','missed slot does not capture present inputs as yesterday');
SELECT is((SELECT snapshot FROM public.alert_scan_patients WHERE id='48000000-0000-4000-8000-000000000201'),NULL::jsonb,'missed slot has no invented snapshot');
SELECT is(public.alert_scan_status()->>'capture_blocked','1','missed slot remains in unresolved count');
SELECT throws_ok($q$SELECT public.next_alert_scan_page(0)$q$,'22023','Invalid scan page size','page size bounded');
INSERT INTO scan_results VALUES('page',public.next_alert_scan_page(1));
SELECT is((SELECT jsonb_array_length(result->'receipts') FROM scan_results WHERE label='page'),1,'processable receipt paged');
SELECT is((SELECT result#>>'{receipts,0,receipt_id}' FROM scan_results WHERE label='page'),pg_temp.sr('48000000-0000-4000-8000-000000000012')::text,'terminal blocked work does not monopolize automatic processing');

RESET ROLE;
UPDATE public.profiles SET role='tester',sandbox_expires_at=now()-interval '1 hour' WHERE id='48000000-0000-4000-8000-000000000012';
SET LOCAL ROLE service_role;
SELECT is(public.capture_alert_scan_patient(pg_temp.sr('48000000-0000-4000-8000-000000000012'))->>'state','blocked_scope','tester conversion prevents capture');
SELECT lives_ok($q$SELECT public.purge_expired_tester_provenance('48000000-0000-4000-8000-000000000012')$q$,'audited erasure includes scan provenance');
SELECT is((SELECT count(*)::int FROM public.alert_scan_patients WHERE patient_id='48000000-0000-4000-8000-000000000012'),0,'tester target snapshot identity removed');
SELECT is((SELECT scan_evaluations_deleted FROM public.lab_provenance_erasures WHERE actor_id='48000000-0000-4000-8000-000000000012'),7,'separate scan evaluation audit counter');
SELECT is((SELECT scan_patients_deleted FROM public.lab_provenance_erasures WHERE actor_id='48000000-0000-4000-8000-000000000012'),1,'separate scan patient audit counter');
SELECT is((SELECT receipts_deleted FROM public.lab_provenance_erasures WHERE actor_id='48000000-0000-4000-8000-000000000012'),0,'laboratory audit counter preserved');
SELECT is(public.prepare_alert_scan('UTC')->>'patients','1','same-day prepare never recreates erased participant');
SELECT throws_ok($q$SELECT public.capture_alert_scan_patient('48000000-0000-4000-8000-000000000299')$q$,'22023','Scan receipt unavailable','missing/purged identity is not recreated on late capture');
RESET ROLE;

-- More than two pages, including failed entries, with a deliberately lost page response.
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT ('48000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'scan-page-'||n||'@example.invalid','{"consent_accepted":true}'::jsonb
 FROM generate_series(1001,1051) AS n;
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT '48000000-0000-4000-8000-000000000001',('48000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()
 FROM generate_series(1001,1051) AS n;
INSERT INTO public.alert_scan_patients(id,run_id,patient_id,capture_status,error_code)
 SELECT ('48000000-0000-4000-8000-'||lpad((n+1000)::text,12,'0'))::uuid,(SELECT (result->>'run_id')::uuid FROM scan_results WHERE label='run'),
 ('48000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'failed','P0001' FROM generate_series(1001,1051) AS n;
INSERT INTO public.alert_scan_evaluations(receipt_id,rule)
 SELECT ('48000000-0000-4000-8000-'||lpad((n+1000)::text,12,'0'))::uuid,rule
 FROM generate_series(1001,1051) AS n CROSS JOIN unnest(ARRAY['no_checkin','low_adherence','weight_trend_7d','hyperkalemia','low_egfr','followup_due','followup_overdue']) AS rule;
UPDATE public.alert_scan_drain_state SET after_id=NULL;
SET LOCAL ROLE service_role;
INSERT INTO scan_results VALUES('page1',public.next_alert_scan_page(20));
INSERT INTO scan_results VALUES('page2',public.next_alert_scan_page(20));
INSERT INTO scan_results VALUES('page3',public.next_alert_scan_page(20));
SELECT is((SELECT count(DISTINCT row->>'receipt_id')::int FROM scan_results CROSS JOIN LATERAL jsonb_array_elements(result->'receipts') AS row WHERE label IN ('page1','page2','page3')),
 51,'persisted sweep visits all51 unresolved entries despite first page failures');
SELECT is(jsonb_array_length(public.next_alert_scan_page(20)->'receipts'),20,'sweep wraps without deleting pending receipts');
SELECT is((SELECT count(*)::int FROM public.alert_scan_patients WHERE capture_status='failed'),51,'a lost page response does not acknowledge or erase work');
SELECT is(public.alert_scan_status()->>'capture_pending','51','aggregate count includes all pages');
RESET ROLE;

-- Query failure is not an empty source; overflow is never silently truncated.
ALTER TABLE public.vitals RENAME COLUMN weight_lbs TO scan_hidden_weight_lbs;
SET LOCAL ROLE service_role;
SELECT is(public.capture_alert_scan_patient('48000000-0000-4000-8000-000000002001')->>'state','failed','source query failure stays retryable');
SELECT is((SELECT snapshot FROM public.alert_scan_patients WHERE id='48000000-0000-4000-8000-000000002001'),NULL::jsonb,'failed source query never becomes empty frozen history');
SELECT is((SELECT error_code FROM public.alert_scan_patients WHERE id='48000000-0000-4000-8000-000000002001'),'42703','source failure stores only safe code');
RESET ROLE;
ALTER TABLE public.vitals RENAME COLUMN scan_hidden_weight_lbs TO weight_lbs;
INSERT INTO public.vitals(patient_id,weight_lbs,recorded_at)
 SELECT '48000000-0000-4000-8000-000000001001',180,now() FROM generate_series(1,1001);
SET LOCAL ROLE service_role;
SELECT is(public.capture_alert_scan_patient('48000000-0000-4000-8000-000000002001')->>'error_code','54000','1001 weights fail visibly rather than truncate');
SELECT is((SELECT snapshot FROM public.alert_scan_patients WHERE id='48000000-0000-4000-8000-000000002001'),NULL::jsonb,'overflow commits no partial snapshot');
RESET ROLE;
DELETE FROM public.vitals WHERE id=(SELECT id FROM public.vitals WHERE patient_id='48000000-0000-4000-8000-000000001001' ORDER BY id LIMIT 1);
SET LOCAL ROLE service_role;
SELECT is(public.capture_alert_scan_patient('48000000-0000-4000-8000-000000002001')->>'state','captured','same pending receipt captures after technical failure is corrected');
SELECT is((SELECT jsonb_array_length(snapshot#>'{sources,weights}') FROM public.alert_scan_patients WHERE id='48000000-0000-4000-8000-000000002001'),1000,'1000-source boundary preserved exactly');
SELECT is((SELECT attempts FROM public.alert_scan_patients WHERE id='48000000-0000-4000-8000-000000002001'),3,'failure overflow and success attempts remain visible');
RESET ROLE;

-- The scheduler rotates rules even if a selected call is lost before finalization.
UPDATE public.alert_scan_patients SET capture_status='blocked_scope',error_code='42501'
 WHERE capture_status='failed';
UPDATE public.alert_scan_drain_state SET after_id=NULL;
SET LOCAL ROLE service_role;
INSERT INTO scan_results SELECT 'rule-rotation-'||n,public.next_alert_scan_page(1) FROM generate_series(1,7) AS n;
SELECT is((SELECT count(DISTINCT result#>>'{receipts,0,rule}')::int FROM scan_results WHERE label LIKE 'rule-rotation-%'),7,'all seven pending rules rotate despite no finalization');
SELECT is((SELECT count(DISTINCT result#>>'{receipts,0,receipt_id}')::int FROM scan_results WHERE label LIKE 'rule-rotation-%'),1,'rotation uses the one remaining processable capture');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
