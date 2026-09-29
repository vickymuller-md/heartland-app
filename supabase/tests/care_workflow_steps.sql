-- Isolated synthetic transactions; never hosted patient/member fixtures.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
-- BEGIN STEP FIXTURES
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
-- END STEP FIXTURES
-- BEGIN STEP HELPERS
CREATE FUNCTION pg_temp.cs_instant(p_time timestamptz) RETURNS text LANGUAGE sql AS $$
 SELECT to_char(p_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
CREATE FUNCTION pg_temp.cs_new(n integer,p_kind text DEFAULT 'laboratory_order',p_accept boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM public.prepare_care_workflow_request(pg_temp.cs(n+1000),pg_temp.cs(n),pg_temp.cs(90),pg_temp.cs(11),
  jsonb_build_object('kind',p_kind,'source','external_documented','purpose','Synthetic documented follow-up',
   'evidence','Synthetic source only','occurred_at',pg_temp.cs_instant(now()-interval '1 hour'),
   'next_review_at',pg_temp.cs_instant(now()+interval '1 day'),'analytes',
   CASE WHEN p_kind='laboratory_order' THEN '["potassium"]'::jsonb ELSE '[]'::jsonb END));
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
-- END STEP HELPERS
CREATE TEMP TABLE step_receipts(label text PRIMARY KEY,value jsonb);
GRANT ALL ON step_receipts TO authenticated;

SELECT ok(NOT has_table_privilege('authenticated','public.care_step_requests','SELECT'),'step requests private');
SELECT ok(NOT has_table_privilege('service_role','public.care_step_requests','INSERT'),'service cannot forge human request');
SELECT ok(NOT has_table_privilege('authenticated','public.care_workflow_exceptions','UPDATE'),'exceptions cannot be overwritten by API');
SELECT ok(NOT has_function_privilege('service_role','public.apply_care_step(uuid)','EXECUTE'),'service cannot attest a step');
SELECT ok(NOT has_function_privilege('anon','public.get_care_workflow_steps(uuid)','EXECUTE'),'anonymous detail denied');
SELECT ok(NOT has_function_privilege('authenticated','public.care_step_request_state(uuid)','EXECUTE'),'unscoped step reader private');
SELECT ok(NOT has_function_privilege('authenticated','public.require_care_step_owner(public.work_items,public.care_workflows,bigint,bigint)','EXECUTE'),'owner helper private');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cs(1),'role','authenticated','aal','aal2')::text,true);
SELECT pg_temp.cs_new(100); SELECT pg_temp.cs_new(101,'referral'); SELECT pg_temp.cs_new(102,'medication_access');
SELECT pg_temp.cs_new(103,'laboratory_order',false);
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(203,103,'record_collection')$q$,'42501','Current accepted owner without pending transfer required','unaccepted work cannot advance');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_attendance')$q$,'22023','Care step is not allowed at the current stage','laboratory cannot attest referral attendance');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(201,101,'record_attendance')$q$,'22023','Care step is not allowed at the current stage','referral cannot skip destination and schedule');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(202,102,'record_obtained','{"source":"patient_report"}')$q$,'22023','Care step is not allowed at the current stage','access cannot skip response evidence');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_collection','{"forged":true}')$q$,'22023','Invalid care step details','extra detail fields refused');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_collection','{}','{"actor_id":"forged"}')$q$,'22023','Invalid care step payload','forged payload identity refused');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_collection','{}','{"evidence":"   "}')$q$,'22023','Invalid care step payload','meaningful evidence required');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_collection','{}','{"next_action":"  "}')$q$,'22023','Invalid care step payload','next action required');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_collection','{}','{"occurred_at":"9999-01-01T01:00:00Z"}')$q$,'22023','Verify step occurrence and next review','future occurrence refused');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_collection','{}','{"next_review_at":"2000-01-01T01:00:00Z"}')$q$,'22023','Verify step occurrence and next review','past new deadline refused');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_collection','{}','{"occurred_at":"2026-01-01T01:00:00"}')$q$,'22023','Invalid care step timestamp','timezone required');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_collection','{}','{"occurred_at":"2026-02-30T01:00:00Z"}')$q$,'22023','Invalid care step timestamp','impossible date refused');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_collection','{}','{"occurred_at":"2026-01-01T24:00:00Z"}')$q$,'22023','Invalid care step timestamp','normalized next day refused');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_schedule','{"appointment_date":"2026-02-30","appointment_at":null,"appointment_timezone":null}')$q$,'22023','Invalid appointment date','civil date checked');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_schedule','{"appointment_date":"2026-11-01","appointment_at":"2026-11-01T01:30:00-03:00","appointment_timezone":"America/New_York"}')$q$,'22023','Appointment date, wall time and offset must agree with timezone','DST offset must match named timezone');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_schedule','{"appointment_date":"2026-03-08","appointment_at":"2026-03-08T02:30:00-05:00","appointment_timezone":"America/New_York"}')$q$,'22023','Appointment date, wall time and offset must agree with timezone','DST nonexistent wall time refused');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_schedule','{"appointment_date":"2026-11-01","appointment_at":"2026-11-01T01:30:00-04:00","appointment_timezone":null}')$q$,'22023','Appointment instant and timezone must be supplied together','partial appointment instant context refused');

INSERT INTO step_receipts VALUES('prepared',pg_temp.cs_prepare(200,100,'record_schedule','{"appointment_date":"2026-11-01","appointment_at":null,"appointment_timezone":null}'));
SELECT is((SELECT value->>'state' FROM step_receipts WHERE label='prepared'),'prepared','preparation durable before stage change');
SELECT is(public.get_care_workflow(pg_temp.cs(100))->>'stage','requested','preparation does not advance work');
SELECT is(public.get_care_step_request(pg_temp.cs(200)),(SELECT value FROM step_receipts WHERE label='prepared'),'reload retrieves original prepared identity');
SELECT is(pg_temp.cs_prepare(200,100,'record_schedule','{"appointment_date":"2026-11-01","appointment_at":null,"appointment_timezone":null}'),
 (SELECT value FROM step_receipts WHERE label='prepared'),'identical preparation replay');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(200,100,'record_schedule','{"appointment_date":"2026-11-02","appointment_at":null,"appointment_timezone":null}')$q$,
 '23505','Care step request identity conflict','changed payload replay conflicts');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(204,100,'record_collection')$q$,'23505','Recover or cancel the pending care step first','new request cannot hide pending one');
INSERT INTO step_receipts VALUES('applied',public.apply_care_step(pg_temp.cs(200)));
SELECT is(public.apply_care_step(pg_temp.cs(200)),(SELECT value FROM step_receipts WHERE label='applied'),'apply replay returns original receipt');
SELECT is(public.cancel_care_step(pg_temp.cs(200)),(SELECT value FROM step_receipts WHERE label='applied'),'cancel cannot undo applied event');
SELECT is(public.get_care_workflow(pg_temp.cs(100))->>'stage','scheduled','lab scheduled after explicit confirmation');
SELECT is(public.get_care_workflow(pg_temp.cs(100))->>'revision','2','one revision per applied step');
SELECT is(public.get_care_workflow_steps(pg_temp.cs(100))->>'accepted_by',pg_temp.cs(1)::text,'detail exposes actual acceptance actor');
SELECT is(public.get_care_workflow_steps(pg_temp.cs(100))->>'work_status','awaiting','detail exposes current queue state');
SELECT is((SELECT status FROM public.work_items WHERE id=pg_temp.cs(100)),'awaiting','first step uses legacy new to awaiting');
SELECT is((SELECT due_at FROM public.work_items WHERE id=pg_temp.cs(100)),now()+interval '2 days','civil appointment does not set queue due date');
SELECT ok((SELECT reviewed_at IS NULL AND actioned_at IS NULL AND closed_at IS NULL FROM public.work_items WHERE id=pg_temp.cs(100)),'operational event does not claim review/action/closure');
SELECT is((SELECT value#>>'{receipt,care_completed}' FROM step_receipts WHERE label='applied'),'false','receipt does not claim completed care');
SELECT is((SELECT value#>>'{receipt,clinical_review_recorded}' FROM step_receipts WHERE label='applied'),'false','receipt does not claim clinical review');
SELECT is(jsonb_array_length(public.list_pending_care_steps(pg_temp.cs(90),pg_temp.cs(11))->'items'),1,'unacknowledged applied receipt stays recoverable');
SELECT lives_ok($q$SELECT public.acknowledge_care_step(pg_temp.cs(200))$q$,'acknowledgement explicit');
SELECT is(jsonb_array_length(public.list_pending_care_steps(pg_temp.cs(90),pg_temp.cs(11))->'items'),0,'ACK removes prompt not immutable event');
SELECT is(pg_temp.cs_step(205,100,'record_collection')#>>'{receipt,stage}','collected','actual collection can follow scheduling');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(206,100,'record_collection')$q$,'22023','Care step is not allowed at the current stage','duplicate collection not a new revision');
SELECT lives_ok($q$SELECT public.accept_work_item(pg_temp.cs(103))$q$,'explicit acceptance separate');
SELECT is(pg_temp.cs_step(207,103,'record_collection')#>>'{receipt,stage}','collected','collection may lack documented scheduling');
SELECT throws_ok($q$UPDATE public.work_items SET status='reviewed' WHERE id=pg_temp.cs(100)$q$,'42501','Advance care through the typed workflow command','generic review still refused');
SELECT throws_ok($q$UPDATE public.work_items SET status='closed',outcome='Synthetic done',outcome_code='clinical_action_taken' WHERE id=pg_temp.cs(100)$q$,'42501','Advance care through the typed workflow command','generic close still refused');

SELECT is(pg_temp.cs_step(210,101,'record_destination_acceptance','{"destination":"Synthetic specialty clinic"}')#>>'{receipt,stage}','accepted','destination acceptance not attendance');
SELECT is(pg_temp.cs_step(211,101,'record_schedule','{"appointment_date":"2026-11-01","appointment_at":"2026-11-01T01:30:00-04:00","appointment_timezone":"America/New_York"}')#>>'{receipt,stage}','scheduled','first DST overlap offset accepted explicitly');
SELECT throws_ok($q$SELECT pg_temp.cs_prepare(212,101,'record_report','{"report_reference":"Synthetic report"}')$q$,'22023','Care step is not allowed at the current stage','report cannot skip attendance');
SELECT is(pg_temp.cs_step(212,101,'record_attendance')#>>'{receipt,stage}','attended','attendance has separate evidence');
SELECT is(pg_temp.cs_step(213,101,'record_report','{"report_reference":"Synthetic report A"}')#>>'{receipt,stage}','report_received','report received is not reviewed');

SELECT is(pg_temp.cs_step(220,102,'record_assistance_request','{"assistance_program":"Synthetic program","request_reference":"Synthetic form A"}')#>>'{receipt,stage}','assistance_requested','assistance submission not obtained');
SELECT is(pg_temp.cs_step(221,102,'record_assistance_response','{"outcome":"pending","response_reference":"Synthetic reply A"}')#>>'{receipt,stage}','response_received','pending response recorded');
SELECT is(pg_temp.cs_step(222,102,'record_assistance_response','{"outcome":"denied","response_reference":"Synthetic reply B"}')#>>'{receipt,stage}','response_received','subsequent denial can follow pending response');
SELECT is(jsonb_array_length(public.get_care_workflow_steps(pg_temp.cs(102))->'exceptions'),1,'denial creates durable exception atomically');
SELECT is(public.get_care_workflow_steps(pg_temp.cs(102))#>>'{exceptions,0,code}','assistance_denied','denial stays distinct from approval');
SELECT is(pg_temp.cs_step(223,102,'record_assistance_response','{"outcome":"approved","response_reference":"Synthetic reply C"}')#>>'{receipt,stage}','response_received','approval is not obtained');
SELECT is(jsonb_array_length(public.get_care_workflow_steps(pg_temp.cs(102))->'exceptions'),1,'approval does not erase earlier denial barrier');
SELECT is(pg_temp.cs_step(224,102,'record_obtained','{"source":"patient_report"}')#>>'{receipt,stage}','obtained','actual acquisition has separately declared evidence source');
SELECT is(public.get_care_workflow_steps(pg_temp.cs(102))#>>'{steps,4,payload,details,source}','patient_report','self report not promoted to professional verification');
SELECT is((SELECT status FROM public.work_items WHERE id=pg_temp.cs(102)),'awaiting','obtained alone never closes work');

SELECT pg_temp.cs_new(104);
SELECT pg_temp.cs_step(230,104,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(800),'code','no_answer','reason','Synthetic contact failed'),
 jsonb_build_object('next_review_at',pg_temp.cs_instant(clock_timestamp()+interval '0.3 seconds'),'next_action','Retry synthetic contact'));
SELECT pg_sleep(0.35);
SELECT is(pg_temp.cs_step(231,104,'record_collection')#>>'{receipt,stage}','collected','later event can record collection with earlier overdue barrier');
SELECT is((SELECT status FROM public.work_items WHERE id=pg_temp.cs(104)),'due','earlier overdue barrier stays due');
SELECT ok((SELECT due_at<clock_timestamp() FROM public.work_items WHERE id=pg_temp.cs(104)),'later review does not move older exception deadline');
SELECT is((SELECT snooze_reason FROM public.work_items WHERE id=pg_temp.cs(104)),'Exception: no_answer — Retry synthetic contact','queue points at controlling exception action');
SELECT pg_temp.cs_step(232,104,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(801),'code','report_missing','reason','Synthetic evidence missing'));
SELECT is(jsonb_array_length(public.get_care_workflow_steps(pg_temp.cs(104))->'exceptions'),2,'two simultaneous barriers coexist');
SELECT is((SELECT status FROM public.work_items WHERE id=pg_temp.cs(104)),'due','adding another barrier does not hide overdue one');
SELECT pg_temp.cs_new(106);
SELECT lives_ok($q$SELECT pg_temp.cs_step(260,106,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(803),
 'code','other','reason','Synthetic long instruction'),jsonb_build_object('next_action',repeat('a',500)))$q$,'maximum-length exception action fits queue summary');
SELECT is(char_length((SELECT snooze_reason FROM public.work_items WHERE id=pg_temp.cs(106))),500,'queue summary respects existing limit');
SELECT is(char_length(public.get_care_workflow_steps(pg_temp.cs(106))#>>'{exceptions,0,next_action}'),500,'complete original instruction retained in evidence');
INSERT INTO step_receipts VALUES('uppercase',pg_temp.cs_step(261,106,'record_exception',
 '{"exception_id":"ABCDEFAB-CDEF-ABCD-EFAB-ABCDEFABCDEF","code":"other","reason":"Synthetic uppercase identity"}'));
SELECT is((SELECT value#>>'{payload,details,exception_id}' FROM step_receipts WHERE label='uppercase'),
 'ABCDEFAB-CDEF-ABCD-EFAB-ABCDEFABCDEF','payload GUID casing preserved');
SELECT is((SELECT value#>>'{receipt,exception_id}' FROM step_receipts WHERE label='uppercase'),
 'abcdefab-cdef-abcd-efab-abcdefabcdef','receipt uses canonical database GUID identity');
SELECT pg_temp.cs_prepare(233,104,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(801),'code','other','reason','Conflicting exception reuse'));
SELECT throws_ok($q$SELECT public.apply_care_step(pg_temp.cs(233))$q$,'23505',NULL,'exception identity cannot be overwritten');
SELECT is(public.get_care_step_request(pg_temp.cs(233))->>'state','prepared','failed insertion rolls back application');
SELECT is(public.get_care_workflow(pg_temp.cs(104))->>'revision','4','failed insertion does not consume revision');
SELECT lives_ok($q$SELECT public.cancel_care_step(pg_temp.cs(233))$q$,'failed prepared command can be cancelled');

SELECT pg_temp.cs_prepare(240,103,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(802),'code','other','reason','Synthetic wait'),
 jsonb_build_object('next_review_at',pg_temp.cs_instant(clock_timestamp()+interval '0.1 seconds')));
SELECT pg_sleep(0.15);
SELECT throws_ok($q$SELECT public.apply_care_step(pg_temp.cs(240))$q$,'22023','Verify step occurrence and next review','expired prepared deadline never fabricated anew');
SELECT is(public.get_care_step_request(pg_temp.cs(240))->>'state','prepared','expiry preserves request for recovery or cancellation');
SELECT lives_ok($q$SELECT public.cancel_care_step(pg_temp.cs(240))$q$,'expired step can be cancelled');
SELECT throws_ok($q$SELECT public.apply_care_step(pg_temp.cs(240))$q$,'22023','Care step was cancelled','cancelled command never applied');

SELECT pg_temp.cs_new(105);
SELECT pg_temp.cs_prepare(250,105,'record_collection');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cs(2),'role','authenticated','aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.prepare_care_step(pg_temp.cs(251),pg_temp.cs(105),1,1,'record_collection',pg_temp.cs_payload())$q$,
 '42501','Current accepted owner without pending transfer required','linked peer cannot advance owner work');
SELECT throws_ok($q$SELECT public.get_care_step_request(pg_temp.cs(250))$q$,'42501','Care step not authorized','peer cannot recover another principal request');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cs(1),'role','authenticated','aal','aal1')::text,true);
SELECT throws_ok($q$SELECT public.apply_care_step(pg_temp.cs(250))$q$,'42501','Work ownership operation not authorized','AAL1 apply refused');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cs(1),'role','authenticated','aal','aal2')::text,true);
SELECT public.offer_work_item_transfer(pg_temp.cs(105),pg_temp.cs(2));
SELECT is(public.get_care_workflow_steps(pg_temp.cs(105))->>'transfer_pending_to',pg_temp.cs(2)::text,'detail exposes pending transfer without implying acceptance');
SELECT throws_ok($q$SELECT public.apply_care_step(pg_temp.cs(250))$q$,'42501','Current accepted owner without pending transfer required','pending transfer blocks stale operation');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cs(2),'role','authenticated','aal','aal2')::text,true);
SELECT public.accept_work_item_transfer(pg_temp.cs(105));
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cs(1),'role','authenticated','aal','aal2')::text,true);
SELECT is(public.get_care_step_request(pg_temp.cs(250))->>'state','prepared','former owner may recover own receipt under current monitoring scope');
SELECT lives_ok($q$SELECT public.cancel_care_step(pg_temp.cs(250))$q$,'former owner may cancel unapplied own request');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cs(2),'role','authenticated','aal','aal2')::text,true);
SELECT throws_ok($q$SELECT public.prepare_care_step(pg_temp.cs(251),pg_temp.cs(105),1,1,'record_collection',pg_temp.cs_payload())$q$,
 '40001','Care or ownership revision changed','new owner must use actual ownership revision');
SELECT is(pg_temp.cs_step(251,105,'record_collection')#>>'{receipt,stage}','collected','accepted transfer recipient can record fresh step');

SELECT public.acknowledge_care_step(pg_temp.cs(251));
DO $$ BEGIN FOR n IN 500..529 LOOP
 PERFORM pg_temp.cs_new(n); PERFORM pg_temp.cs_prepare(n+2000,n,'record_collection');
END LOOP; END $$;
INSERT INTO step_receipts VALUES('page',public.list_pending_care_steps(pg_temp.cs(90),pg_temp.cs(11)));
SELECT is(jsonb_array_length((SELECT value->'items' FROM step_receipts WHERE label='page')),25,'first recovery page contains 25 durable steps');
SELECT is((SELECT value->>'next_cursor' FROM step_receipts WHERE label='page'),pg_temp.cs(2524)::text,'cursor identifies exact final request on page');
SELECT is(jsonb_array_length(public.list_pending_care_steps(pg_temp.cs(90),pg_temp.cs(11),pg_temp.cs(2524))->'items'),5,'remaining recovery tail stays reachable');
SELECT ok(public.list_pending_care_steps(pg_temp.cs(90),pg_temp.cs(11),pg_temp.cs(2524))->>'next_cursor' IS NULL,'terminal recovery tail ends explicitly');

SELECT pg_temp.cs_new(107); SELECT pg_temp.cs_prepare(270,107,'record_collection');
SELECT pg_temp.cs_new(108); SELECT pg_temp.cs_prepare(271,108,'record_exception',jsonb_build_object('exception_id',pg_temp.cs(809),'code','other','reason','Synthetic rollback barrier'));
RESET ROLE;
CREATE FUNCTION pg_temp.cs_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Injected step write failure'; END $$;
CREATE FUNCTION pg_temp.cs_assert_rollback(p_table text,p_request integer,p_work integer) RETURNS SETOF text LANGUAGE plpgsql AS $$
BEGIN
 IF p_table NOT IN('care_step_events','care_workflows','work_items','care_step_requests','care_workflow_exceptions') THEN RAISE EXCEPTION 'Invalid test target'; END IF;
 EXECUTE format('CREATE TRIGGER injected_step_write AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION pg_temp.cs_fail()',p_table);
 SET LOCAL ROLE authenticated;
 RETURN NEXT throws_ok(format('SELECT public.apply_care_step(%L)',pg_temp.cs(p_request)),'P0001','Injected step write failure','failure after '||p_table||' write observed');
 RESET ROLE;
 EXECUTE format('DROP TRIGGER injected_step_write ON public.%I',p_table);
 RETURN NEXT is((SELECT state FROM public.care_step_requests WHERE id=pg_temp.cs(p_request)),'prepared',p_table||' failure preserves preparation');
 RETURN NEXT is((SELECT revision::text FROM public.care_workflows WHERE work_item_id=pg_temp.cs(p_work)),'1',p_table||' failure rolls back workflow revision');
 RETURN NEXT is((SELECT status FROM public.work_items WHERE id=pg_temp.cs(p_work)),'new',p_table||' failure rolls back queue projection');
 RETURN NEXT is((SELECT count(*)::integer FROM public.care_step_events WHERE work_item_id=pg_temp.cs(p_work)),0,p_table||' failure leaves no applied event');
 RETURN NEXT is((SELECT count(*)::integer FROM public.care_workflow_exceptions WHERE work_item_id=pg_temp.cs(p_work)),0,p_table||' failure leaves no orphan exception');
 RETURN NEXT is((SELECT count(*)::integer FROM public.care_workflow_write_context),0,p_table||' failure leaves no authority context');
END $$;
SELECT pg_temp.cs_assert_rollback('care_step_events',270,107);
SELECT pg_temp.cs_assert_rollback('care_workflows',270,107);
SELECT pg_temp.cs_assert_rollback('work_items',270,107);
SELECT pg_temp.cs_assert_rollback('care_step_requests',270,107);
SELECT pg_temp.cs_assert_rollback('care_workflow_exceptions',271,108);
SELECT throws_ok($q$UPDATE public.care_workflows SET kind='referral' WHERE work_item_id=pg_temp.cs(105)$q$,'42501','Care workflow history is immutable','workflow identity protected beyond raw privileges');
SELECT throws_ok($q$UPDATE public.care_step_events SET to_stage='obtained' WHERE work_item_id=pg_temp.cs(105)$q$,'42501','Care workflow history is immutable','step history immutable');
SELECT throws_ok($q$DELETE FROM public.care_workflow_exceptions WHERE work_item_id=pg_temp.cs(104)$q$,'42501','Care workflow history is immutable','barriers not erased');
SELECT is((SELECT count(*)::integer FROM public.care_workflow_write_context),0,'no leaked transaction authority after rollback or success');

SELECT * FROM finish();
ROLLBACK;
