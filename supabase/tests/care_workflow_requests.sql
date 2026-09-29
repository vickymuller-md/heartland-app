-- Disposable synthetic fixtures only; all changes roll back. No hosted clinical approvals.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
-- BEGIN CARE FIXTURES
CREATE FUNCTION pg_temp.cw(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('59000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.cw(n),'care-fixture-'||n||'@example.invalid','{"consent_accepted":true}'
 FROM unnest(ARRAY[1,2,3,11,12]) n;
UPDATE public.profiles SET role='provider' WHERE id=ANY(ARRAY[pg_temp.cw(1),pg_temp.cw(2),pg_temp.cw(3)]);
INSERT INTO public.organizations(id,name,created_by) VALUES
 (pg_temp.cw(90),'Synthetic care organization A',pg_temp.cw(1)),
 (pg_temp.cw(91),'Synthetic care organization B',pg_temp.cw(3));
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 SELECT pg_temp.cw(90),pg_temp.cw(n),CASE WHEN n=1 THEN 'owner' ELSE 'clinician' END,'active',now(),pg_temp.cw(1)
 FROM generate_series(1,2) n;
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES(pg_temp.cw(91),pg_temp.cw(3),'owner','active',now(),pg_temp.cw(3));
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',created_by FROM public.organization_memberships WHERE organization_id=ANY(ARRAY[pg_temp.cw(90),pg_temp.cw(91)]);
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by) VALUES
 (pg_temp.cw(90),pg_temp.cw(11),pg_temp.cw(1)),(pg_temp.cw(91),pg_temp.cw(12),pg_temp.cw(3));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 (pg_temp.cw(1),pg_temp.cw(11),'active',now()),(pg_temp.cw(2),pg_temp.cw(11),'active',now()),
 (pg_temp.cw(3),pg_temp.cw(12),'active',now());
-- END CARE FIXTURES
-- BEGIN CARE HELPERS
CREATE FUNCTION pg_temp.cw_payload() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('kind','laboratory_order','source','external_documented',
  'purpose','Synthetic documented examination request','evidence','Synthetic source document, example only',
  'occurred_at',to_char(now()-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'next_review_at',to_char(now()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'analytes',jsonb_build_array('potassium','creatinine','egfr'))
$$;
CREATE FUNCTION pg_temp.cw_prepare(n integer,p_payload jsonb DEFAULT pg_temp.cw_payload()) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_care_workflow_request(pg_temp.cw(n),pg_temp.cw(n+1000),pg_temp.cw(90),pg_temp.cw(11),p_payload)
$$;
-- END CARE HELPERS
CREATE TEMP TABLE care_receipts(label text PRIMARY KEY,value jsonb);
GRANT ALL ON care_receipts TO authenticated;

SELECT ok(NOT has_table_privilege('authenticated','public.care_workflow_requests','SELECT'),'raw request payload is private');
SELECT ok(NOT has_table_privilege('service_role','public.care_workflow_requests','INSERT'),'service cannot forge request');
SELECT ok(NOT has_table_privilege('authenticated','public.care_workflows','UPDATE'),'API cannot advance stage directly');
SELECT ok(NOT has_table_privilege('service_role','public.care_workflow_events','TRUNCATE'),'events protected from API truncation');
SELECT ok(NOT has_function_privilege('authenticated','public.care_request_state(uuid)','EXECUTE'),'unscoped helper is private');
SELECT ok(NOT has_function_privilege('service_role','public.apply_care_workflow_request(uuid)','EXECUTE'),'service cannot attest a human request');
SELECT ok(NOT has_function_privilege('anon','public.prepare_care_workflow_request(uuid,uuid,uuid,uuid,jsonb)','EXECUTE'),'anonymous preparation denied');
SELECT ok(NOT has_table_privilege('authenticated','public.care_workflow_write_context','INSERT'),'private transaction scope cannot be minted');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cw(1),'aal','aal1')::text,true);
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100)$q$,'42501','Work ownership operation not authorized','AAL1 denied');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cw(1),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100,pg_temp.cw_payload()||'{"source":"professional_decision"}')$q$,
 '42501','Current clinical disposition authority required','manager and monitor are not clinical authority');
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100,pg_temp.cw_payload()||'{"actor_id":"forged"}')$q$,
 '22023','Invalid care request','additional identity fields rejected');
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100,pg_temp.cw_payload()||'{"analytes":["potassium","potassium"]}')$q$,
 '22023','Invalid requested analytes','duplicate analytes rejected');
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100,pg_temp.cw_payload()||'{"analytes":[]}')$q$,
 '22023','Invalid requested analytes','lab request needs a named analyte');
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100,pg_temp.cw_payload()||'{"analytes":[null]}')$q$,
 '22023','Invalid requested analytes','null analyte rejected');
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100,pg_temp.cw_payload()||'{"kind":"referral"}')$q$,
 '22023','Invalid requested analytes','referral cannot borrow laboratory fields');
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100,pg_temp.cw_payload()||'{"occurred_at":"2026-09-01T12:00:00"}')$q$,
 '22023','Care request timestamps require explicit offsets','civil wall time is not an instant');
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100,pg_temp.cw_payload()||'{"occurred_at":"2026-02-30T12:00:00Z"}')$q$,
 '22023','Invalid care request timestamps','impossible dates rejected');
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100,pg_temp.cw_payload()||'{"occurred_at":"2026-09-01T24:00:00Z"}')$q$,
 '22023','Care request timestamps require explicit offsets','PostgreSQL normalization of 24h does not create an unreadable receipt');
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100,pg_temp.cw_payload()||'{"occurred_at":"2026-09-01T23:59:60Z"}')$q$,
 '22023','Care request timestamps require explicit offsets','leap-second normalization does not create an unreadable receipt');
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100,pg_temp.cw_payload()||'{"occurred_at":"9999-01-01T12:00:00Z"}')$q$,
 '22023','Verify occurred time and next review time','future occurrence rejected');
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100,pg_temp.cw_payload()||'{"next_review_at":"2000-01-01T12:00:00Z"}')$q$,
 '22023','Verify occurred time and next review time','fresh request needs explicit future review');
SELECT throws_ok($q$SELECT public.prepare_care_workflow_request(pg_temp.cw(100),pg_temp.cw(1100),pg_temp.cw(91),pg_temp.cw(12),pg_temp.cw_payload())$q$,
 '42501','Work ownership operation not authorized','other organization scope denied');

INSERT INTO care_receipts VALUES('prepared',pg_temp.cw_prepare(100));
SELECT is((SELECT value->>'state' FROM care_receipts WHERE label='prepared'),'prepared','request persists before application');
SELECT is(pg_temp.cw_prepare(100),(SELECT value FROM care_receipts WHERE label='prepared'),'identical preparation returns original request');
SELECT is(public.get_care_workflow_request(pg_temp.cw(100)),(SELECT value FROM care_receipts WHERE label='prepared'),'reload recovers exact prepared request');
SELECT is(jsonb_array_length(public.list_pending_care_requests(pg_temp.cw(90),pg_temp.cw(11))->'items'),1,'pending visible without a work item');
SELECT throws_ok($q$SELECT pg_temp.cw_prepare(100,pg_temp.cw_payload()||'{"purpose":"Changed purpose"}')$q$,
 '23505','Care request identity conflict','request identity cannot change payload');
SELECT throws_ok($q$SELECT public.prepare_care_workflow_request(pg_temp.cw(101),pg_temp.cw(1100),pg_temp.cw(90),pg_temp.cw(11),pg_temp.cw_payload())$q$,
 '23505','Care target already exists or has a pending request','second pending command cannot hide first');
SELECT throws_ok($q$SELECT public.acknowledge_care_workflow_request(pg_temp.cw(100))$q$,
 '22023','Only an applied receipt can be acknowledged','prepared is not applied');
INSERT INTO care_receipts VALUES('applied',public.apply_care_workflow_request(pg_temp.cw(100)));
SELECT is((SELECT value->>'state' FROM care_receipts WHERE label='applied'),'applied','application confirmed by receipt');
SELECT is(public.apply_care_workflow_request(pg_temp.cw(100)),(SELECT value FROM care_receipts WHERE label='applied'),'lost response replay does not create another work item');
SELECT is((SELECT value#>>'{receipt,acceptance_recorded}' FROM care_receipts WHERE label='applied'),'false','creation does not attest acceptance');
SELECT is((SELECT value#>>'{receipt,external_transmission_confirmed}' FROM care_receipts WHERE label='applied'),'false','request recording is not transmission');
SELECT is((SELECT status FROM public.work_items WHERE id=pg_temp.cw(1100)),'new','work stays open');
SELECT is((SELECT accountability_source FROM public.work_items WHERE id=pg_temp.cw(1100)),'self_requested','ownership source is truthful');
SELECT ok((SELECT accepted_at IS NULL FROM public.work_items WHERE id=pg_temp.cw(1100)),'acceptance remains separate');
SELECT is(public.get_care_workflow(pg_temp.cw(1100))->>'stage','requested','scoped workflow read available');
SELECT is(public.cancel_care_workflow_request(pg_temp.cw(100)),(SELECT value FROM care_receipts WHERE label='applied'),'late cancel does not undo application');
SELECT throws_ok($q$UPDATE public.work_items SET status='reviewed' WHERE id=pg_temp.cw(1100)$q$,
 '42501','Advance care through the typed workflow command','generic/bulk review cannot assert workflow review');
SELECT throws_ok($q$UPDATE public.work_items SET status='closed',outcome='Looks done',outcome_code='clinical_action_taken' WHERE id=pg_temp.cw(1100)$q$,
 '42501','Advance care through the typed workflow command','generic close cannot bypass evidence');
SELECT throws_ok($q$UPDATE public.work_items SET due_at=now()+interval '2 days' WHERE id=pg_temp.cw(1100)$q$,
 '42501','Advance care through the typed workflow command','generic due change cannot evade typed trail');
SELECT lives_ok($q$SELECT public.accept_work_item(pg_temp.cw(1100))$q$,'explicit ownership acceptance still works');
SELECT ok((SELECT accepted_by=pg_temp.cw(1) FROM public.work_items WHERE id=pg_temp.cw(1100)),'acceptance attributed to actual actor');
SELECT is(public.get_care_workflow(pg_temp.cw(1100))->>'stage','requested','ownership acceptance does not advance care');
SELECT lives_ok($q$SELECT public.acknowledge_care_workflow_request(pg_temp.cw(100))$q$,'acknowledge receipt');
SELECT is(jsonb_array_length(public.list_pending_care_requests(pg_temp.cw(90),pg_temp.cw(11))->'items'),0,'acknowledgement removes recovery prompt, not receipt');
SELECT is(public.get_care_workflow_request(pg_temp.cw(100))->'receipt',(SELECT value->'receipt' FROM care_receipts WHERE label='applied'),'receipt preserved after acknowledgement');
SELECT lives_ok($q$SELECT public.acknowledge_care_workflow_request(pg_temp.cw(100))$q$,'ack replay idempotent');

SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cw(2),'aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.get_care_workflow_request(pg_temp.cw(100))$q$,'42501','Care request not authorized','other actor cannot recover private command');
SELECT throws_ok($q$SELECT public.apply_care_workflow_request(pg_temp.cw(100))$q$,'42501','Care request not authorized','account switch cannot apply former actor command');
SELECT throws_ok($q$SELECT public.get_care_workflow(pg_temp.cw(1100))$q$,'42501','Care workflow not authorized','monitor alone cannot read peers queue detail');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cw(1),'aal','aal2')::text,true);
SELECT lives_ok($q$SELECT public.offer_work_item_transfer(pg_temp.cw(1100),pg_temp.cw(2),'Synthetic responsibility offer')$q$,'transfer offer still available');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cw(2),'aal','aal2')::text,true);
SELECT lives_ok($q$SELECT public.get_care_workflow(pg_temp.cw(1100))$q$,'pending addressee may inspect scope');
SELECT lives_ok($q$SELECT public.accept_work_item_transfer(pg_temp.cw(1100))$q$,'accepted transfer works without clinical advancement');
SELECT is(public.get_care_workflow(pg_temp.cw(1100))->>'stage','requested','transfer preserves care stage');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cw(1),'aal','aal2')::text,true);

SELECT lives_ok($q$SELECT pg_temp.cw_prepare(102)$q$,'second independent target prepared');
SELECT is(public.cancel_care_workflow_request(pg_temp.cw(102))->>'state','cancelled','cancel before apply');
SELECT is(public.cancel_care_workflow_request(pg_temp.cw(102))->>'state','cancelled','cancel replay');
SELECT throws_ok($q$SELECT public.apply_care_workflow_request(pg_temp.cw(102))$q$,'22023','Care request was cancelled','cancelled request cannot apply');
SELECT lives_ok($q$SELECT pg_temp.cw_prepare(103,pg_temp.cw_payload()||'{"kind":"referral","analytes":[]}')$q$,'referral request supported');
SELECT lives_ok($q$SELECT public.apply_care_workflow_request(pg_temp.cw(103))$q$,'referral added to same queue');
SELECT lives_ok($q$SELECT pg_temp.cw_prepare(104,pg_temp.cw_payload()||'{"kind":"medication_access","analytes":[]}')$q$,'medication access request supported');
SELECT lives_ok($q$SELECT public.apply_care_workflow_request(pg_temp.cw(104))$q$,'access request remains request, not medication obtained');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.care_workflows),3,'one workflow per successful application');
SELECT is((SELECT count(*)::int FROM public.care_workflow_events),3,'one event per successful application');
SELECT is((SELECT count(*)::int FROM public.notification_intents),0,'typed request does not enter critical-alert transport');
SELECT is((SELECT count(*)::int FROM public.care_workflow_write_context),0,'private transaction scope removed before return');
SELECT throws_ok($q$UPDATE public.care_workflow_events SET occurred_at=now()$q$,'42501','Care workflow history is immutable','history cannot be rewritten');
SELECT throws_ok($q$DELETE FROM public.care_workflows WHERE work_item_id=pg_temp.cw(1100)$q$,'42501','Care workflow history is immutable','typed workflow evidence protected');
SELECT throws_ok($q$DELETE FROM public.work_items WHERE id=pg_temp.cw(1100)$q$,'42501','Care workflow history is protected','typed work cannot disappear');
SELECT set_config('heartland.care_workflow_authorized','true',true);
SELECT throws_ok($q$UPDATE public.work_items SET status='reviewed' WHERE id=pg_temp.cw(1100)$q$,
 '42501','Advance care through the typed workflow command','caller-set GUC does not authorize write');
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.cw(1) AND patient_id=pg_temp.cw(11);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_care_workflow_request(pg_temp.cw(100))$q$,'42501','Work ownership operation not authorized','revocation hides even an old receipt');
SELECT throws_ok($q$SELECT public.list_pending_care_requests(pg_temp.cw(90),pg_temp.cw(11))$q$,'42501','Work ownership operation not authorized','revoked scope cannot list saved payloads');
RESET ROLE;
UPDATE public.provider_patient_links SET status='active' WHERE provider_id=pg_temp.cw(1) AND patient_id=pg_temp.cw(11);
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'clinical_disposition',pg_temp.cw(1) FROM public.organization_memberships WHERE organization_id=pg_temp.cw(90) AND user_id=pg_temp.cw(1);
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT pg_temp.cw_prepare(105,pg_temp.cw_payload()||'{"source":"professional_decision"}')$q$,'synthetic authorized clinical request can prepare');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=now() WHERE capability='clinical_disposition';
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.apply_care_workflow_request(pg_temp.cw(105))$q$,'42501','Current clinical disposition authority required','clinical grant rechecked at apply');
SELECT is(public.get_care_workflow_request(pg_temp.cw(105))->>'state','prepared','failed application leaves recoverable preparation intact');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.work_items WHERE id=pg_temp.cw(1105)),0,'failed clinical application creates no orphan work');
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT pg_temp.cw_prepare(106,pg_temp.cw_payload()||'{"purpose":"  Exact source text  ","evidence":"  Synthetic evidence  "}')$q$,'source whitespace accepted');
SELECT is(public.get_care_workflow_request(pg_temp.cw(106))#>>'{payload,purpose}','  Exact source text  ','recovery retains the exact frozen payload');
SELECT lives_ok($q$SELECT public.prepare_care_workflow_request(pg_temp.cw(106),pg_temp.cw(1106),pg_temp.cw(90),pg_temp.cw(11),public.get_care_workflow_request(pg_temp.cw(106))->'payload')$q$,'recovered payload replays without normalization conflict');
RESET ROLE;
CREATE FUNCTION pg_temp.fail_care_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected synthetic event failure'; END $$;
CREATE TRIGGER synthetic_care_failure BEFORE INSERT ON public.care_workflow_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_care_event();
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT pg_temp.cw_prepare(107)$q$,'prepare before injected failure');
SELECT throws_ok($q$SELECT public.apply_care_workflow_request(pg_temp.cw(107))$q$,'P0001','Injected synthetic event failure','failure after work insertion rolls back entire application');
SELECT is(public.get_care_workflow_request(pg_temp.cw(107))->>'state','prepared','preparation survives failed transaction');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.work_items WHERE id=pg_temp.cw(1107)),0,'no partial work after injected failure');
SELECT is((SELECT count(*)::int FROM public.care_workflow_write_context),0,'no leaked private context after rollback');
DROP TRIGGER synthetic_care_failure ON public.care_workflow_events;
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT public.apply_care_workflow_request(pg_temp.cw(107))$q$,'same request recovers after transient failure');
SELECT lives_ok($q$SELECT pg_temp.cw_prepare(n) FROM generate_series(200,225) n$q$,'multiple independent requests for cursor test');
SELECT is(jsonb_array_length(public.list_pending_care_requests(pg_temp.cw(90),pg_temp.cw(11))->'items'),25,'pending page is bounded');
SELECT ok(public.list_pending_care_requests(pg_temp.cw(90),pg_temp.cw(11))->>'next_cursor' IS NOT NULL,'tail cursor supplied');
SELECT ok(jsonb_array_length(public.list_pending_care_requests(pg_temp.cw(90),pg_temp.cw(11),
 (public.list_pending_care_requests(pg_temp.cw(90),pg_temp.cw(11))->>'next_cursor')::uuid)->'items')>0,'tail remains recoverable');
SELECT lives_ok($q$SELECT public.prepare_care_workflow_request('00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000002',pg_temp.cw(90),pg_temp.cw(11),pg_temp.cw_payload())$q$,
 'PostgreSQL GUID domain accepted, with unchanged scope checks');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='monitor'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cw(1));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.get_care_workflow(pg_temp.cw(1103))$q$,'42501','Work ownership operation not authorized','revoked monitor loses workflow RPC read');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_type='care_workflow'),0,'revoked monitor loses raw queue projection');
SELECT is((SELECT count(*)::int FROM public.work_item_events WHERE work_item_id=pg_temp.cw(1103)),0,'revoked monitor loses raw event projection');
SELECT is((SELECT count(*)::int FROM public.notification_deliveries WHERE work_item_id=pg_temp.cw(1103)),0,'revoked monitor loses in-app evidence projection');
RESET ROLE;
UPDATE public.member_authorizations SET revoked_at=NULL,granted_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second'
 WHERE capability='monitor' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cw(1));
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_type='care_workflow'),0,'expired monitor also loses raw queue projection');
SELECT is((SELECT count(*)::int FROM public.work_item_events WHERE work_item_id=pg_temp.cw(1103)),0,'expired monitor also loses raw event projection');
SELECT is((SELECT count(*)::int FROM public.notification_deliveries WHERE work_item_id=pg_temp.cw(1103)),0,'expired monitor also loses in-app evidence projection');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
