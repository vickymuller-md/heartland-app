-- Synthetic 00052 read preparation: no ownership mutation; all fixtures roll back.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
CREATE FUNCTION pg_temp.uid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('52000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
CREATE FUNCTION pg_temp.actor(n integer,aal text DEFAULT 'aal2') RETURNS text LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.uid(n),'aal',aal)::text,true)
$$;
CREATE FUNCTION pg_temp.transfer(item integer DEFAULT 7001,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25)
RETURNS jsonb LANGUAGE sql AS $$ SELECT public.get_work_transfer_context(pg_temp.uid(item),after_id,page_size) $$;
CREATE FUNCTION pg_temp.designation(org integer DEFAULT 8001,patient integer DEFAULT 90,after_id uuid DEFAULT NULL,page_size integer DEFAULT 25)
RETURNS jsonb LANGUAGE sql AS $$ SELECT public.get_patient_designation_context(pg_temp.uid(org),pg_temp.uid(patient),after_id,page_size) $$;

SELECT ok(NOT has_function_privilege('anon','public.get_work_transfer_context(uuid,uuid,integer)','EXECUTE'),'anonymous transfer read denied');
SELECT ok(NOT has_function_privilege('service_role','public.get_work_transfer_context(uuid,uuid,integer)','EXECUTE'),'service transfer read denied');
SELECT ok(NOT has_function_privilege('anon','public.get_patient_designation_context(uuid,uuid,uuid,integer)','EXECUTE'),'anonymous designation read denied');
SELECT ok(NOT has_function_privilege('service_role','public.get_patient_designation_context(uuid,uuid,uuid,integer)','EXECUTE'),'service designation read denied');
SELECT ok(NOT has_function_privilege('authenticated','public.work_ownership_target_page(uuid,uuid,uuid,uuid,integer)','EXECUTE'),'arbitrary-patient target helper private');
SELECT ok(NOT has_function_privilege('service_role','public.work_ownership_target_page(uuid,uuid,uuid,uuid,integer)','EXECUTE'),'target helper private to service too');
SELECT ok((SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=""']) FROM pg_proc
 WHERE oid IN('public.get_work_transfer_context(uuid,uuid,integer)'::regprocedure,
 'public.get_patient_designation_context(uuid,uuid,uuid,integer)'::regprocedure)),'reads use definer with empty search path');

INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.uid(n),'selector-'||n||'@example.invalid','{"consent_accepted":true}'
 FROM (SELECT generate_series(1,13) n UNION ALL SELECT generate_series(20,49)
 UNION ALL SELECT generate_series(90,91) UNION ALL SELECT generate_series(100,127)) users;
UPDATE public.profiles SET role='provider',full_name='Synthetic member '||right(id::text,3)
 WHERE id NOT IN(pg_temp.uid(90),pg_temp.uid(91),pg_temp.uid(10));
INSERT INTO public.organizations(id,name,created_by) VALUES
 (pg_temp.uid(8001),'Selector organization A',pg_temp.uid(1)),(pg_temp.uid(8002),'Selector organization B',pg_temp.uid(1));
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 SELECT pg_temp.uid(8001),id,CASE WHEN id IN(pg_temp.uid(1),pg_temp.uid(4)) THEN 'admin' ELSE 'clinician' END,
 CASE WHEN id=pg_temp.uid(9) THEN 'suspended' ELSE 'active' END,now(),pg_temp.uid(1)
 FROM public.profiles WHERE id NOT IN(pg_temp.uid(90),pg_temp.uid(91),pg_temp.uid(11));
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 SELECT pg_temp.uid(8002),pg_temp.uid(n),CASE WHEN n=1 THEN 'owner' ELSE 'clinician' END,'active',now(),pg_temp.uid(1)
 FROM unnest(ARRAY[1,3]) n;
INSERT INTO public.member_authorizations(membership_id,capability,granted_by,granted_at,expires_at,revoked_at)
 SELECT id,'monitor',pg_temp.uid(1),now()-interval '2 hours',CASE WHEN user_id=pg_temp.uid(7) THEN now()-interval '1 hour' END,
 CASE WHEN user_id=pg_temp.uid(8) THEN now() END FROM public.organization_memberships
 WHERE user_id NOT IN(pg_temp.uid(12),pg_temp.uid(13)) AND NOT(user_id BETWEEN pg_temp.uid(20) AND pg_temp.uid(49));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT id,pg_temp.uid(90),CASE WHEN id=pg_temp.uid(6) THEN 'revoked' ELSE 'active' END,now()
 FROM public.profiles WHERE id NOT IN(pg_temp.uid(90),pg_temp.uid(91),pg_temp.uid(4));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 VALUES(pg_temp.uid(1),pg_temp.uid(91),'active',now());
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by)
 VALUES(pg_temp.uid(8001),pg_temp.uid(90),pg_temp.uid(1)),(pg_temp.uid(8002),pg_temp.uid(90),pg_temp.uid(1)),
 (pg_temp.uid(8001),pg_temp.uid(91),pg_temp.uid(1)) ON CONFLICT(organization_id,patient_id) DO NOTHING;
UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.uid(5) AND consent_type='registration';
INSERT INTO public.patient_accountability(organization_id,patient_id,accountable_id,designated_by)
 VALUES(pg_temp.uid(8001),pg_temp.uid(90),pg_temp.uid(12),pg_temp.uid(1)),
 (pg_temp.uid(8002),pg_temp.uid(90),pg_temp.uid(3),pg_temp.uid(1));
INSERT INTO public.work_items(id,organization_id,patient_id,provider_id,assigned_to,source_type,title,reason,priority,severity,
 status,outcome,closed_at,accountability_source,transfer_pending_to,transfer_offered_at,transfer_offered_by)
 SELECT pg_temp.uid(n),pg_temp.uid(8001),pg_temp.uid(90),pg_temp.uid(2),pg_temp.uid(2),'manual',
 'Synthetic selector item','Synthetic selector reason','today','warning',CASE WHEN n=7004 THEN 'closed' ELSE 'new' END,
 CASE WHEN n=7004 THEN 'Synthetic recorded closure' END,CASE WHEN n=7004 THEN now() END,
 CASE WHEN n=7002 THEN NULL WHEN n=7003 THEN 'legacy_fan_out' ELSE 'designated' END,
 CASE WHEN n=7005 THEN pg_temp.uid(3) END,CASE WHEN n=7005 THEN now() END,CASE WHEN n=7005 THEN pg_temp.uid(2) END
 FROM generate_series(7001,7005) n;
CREATE TEMP TABLE read_results(label text PRIMARY KEY,result jsonb);
GRANT ALL ON read_results TO authenticated;
CREATE TEMP TABLE original_rows AS SELECT
 (SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM public.work_items w) AS work,
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.patient_accountability d) AS designations,
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.member_authorizations a) AS grants,
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.provider_patient_links l) AS links,
 (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.work_item_events e) AS events;

SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(1);
INSERT INTO read_results VALUES('transfer1',pg_temp.transfer());
INSERT INTO read_results VALUES('transfer2',pg_temp.transfer(7001,(SELECT (result->>'next_cursor')::uuid FROM read_results WHERE label='transfer1')));
SELECT is((SELECT result->>'current_assignee' FROM read_results WHERE label='transfer1'),pg_temp.uid(2)::text,'manager reads actual owner');
SELECT is((SELECT result->'current_revision' FROM read_results WHERE label='transfer1'),'"0"'::jsonb,'revision returned as a JSON string');
SELECT is((SELECT result->>'patient_id' FROM read_results WHERE label='transfer1'),pg_temp.uid(90)::text,'transfer context bound to actual patient');
SELECT is((SELECT result->>'eligible' FROM read_results WHERE label='transfer1'),'true','eligible manager may prepare offer');
SELECT is((SELECT jsonb_array_length(result->'targets') FROM read_results WHERE label='transfer1'),25,'first eligible transfer page bounded at 25 after filtering');
SELECT is((SELECT jsonb_array_length(result->'targets') FROM read_results WHERE label='transfer2'),5,'transfer tail retained despite over 25 ineligible directory entries');
SELECT is((SELECT result->'next_cursor' FROM read_results WHERE label='transfer2'),'null'::jsonb,'transfer tail has no cursor');
SELECT is((SELECT count(DISTINCT target->>'id')::integer FROM read_results CROSS JOIN LATERAL jsonb_array_elements(result->'targets') target
 WHERE label IN('transfer1','transfer2')),30,'transfer pages cover each eligible recipient once');
SELECT ok(NOT EXISTS(SELECT 1 FROM read_results CROSS JOIN LATERAL jsonb_array_elements(result->'targets') target
 WHERE label IN('transfer1','transfer2') AND (target->>'id')::uuid IN(pg_temp.uid(2),pg_temp.uid(4),pg_temp.uid(5),pg_temp.uid(6),
 pg_temp.uid(7),pg_temp.uid(8),pg_temp.uid(9),pg_temp.uid(10),pg_temp.uid(11),pg_temp.uid(12),pg_temp.uid(13))),
 'exclude current owner, missing link/consent, expired/revoked/missing monitor, inactive membership and non-provider');
SELECT is(jsonb_array_length(pg_temp.transfer(7001,pg_temp.uid(9999))->'targets'),0,'past-end transfer cursor returns empty page');
SELECT is(jsonb_array_length(pg_temp.transfer(7001,NULL,1)->'targets'),1,'explicit smaller page honored');
SELECT throws_ok($q$SELECT pg_temp.transfer(7001,NULL,26)$q$,'22023','Invalid ownership page','oversize transfer page rejected');
SELECT throws_ok($q$SELECT pg_temp.transfer(7001,NULL,0)$q$,'22023','Invalid ownership page','zero transfer page rejected');
SELECT throws_ok($q$SELECT pg_temp.transfer(7001,NULL,NULL)$q$,'22023','Invalid ownership page','null transfer page rejected');

INSERT INTO read_results VALUES('designation1',pg_temp.designation());
INSERT INTO read_results VALUES('designation2',pg_temp.designation(8001,90,(SELECT (result->>'next_cursor')::uuid FROM read_results WHERE label='designation1')));
SELECT is((SELECT result#>>'{current,id}' FROM read_results WHERE label='designation1'),pg_temp.uid(12)::text,'ineligible current designation retained as context');
SELECT is((SELECT result#>>'{current,name}' FROM read_results WHERE label='designation1'),'Synthetic member 012','current designation has scoped identity');
SELECT is((SELECT jsonb_array_length(result->'targets') FROM read_results WHERE label='designation1'),25,'designation first page bounded');
SELECT is((SELECT jsonb_array_length(result->'targets') FROM read_results WHERE label='designation2'),6,'designation includes current item owner when eligible');
SELECT is((SELECT result->'next_cursor' FROM read_results WHERE label='designation2'),'null'::jsonb,'designation pagination terminates');
SELECT ok(NOT EXISTS(SELECT 1 FROM read_results CROSS JOIN LATERAL jsonb_array_elements(result->'targets') target
 WHERE label IN('designation1','designation2') AND target->>'id'=pg_temp.uid(12)::text),'historical designation not falsely selectable');
SELECT is(pg_temp.designation(8002)#>>'{current,id}',pg_temp.uid(3)::text,'same patient second organization has its own current designation');
SELECT is(jsonb_array_length(pg_temp.designation(8002)->'targets'),2,'second organization does not inherit first directory');
SELECT is(pg_temp.designation(8001,91)->'current','null'::jsonb,'authorized patient with no designation returns explicit null');
SELECT throws_ok($q$SELECT pg_temp.designation(8001,90,NULL,26)$q$,'22023','Invalid ownership page','oversize designation page rejected');
SELECT throws_ok($q$SELECT pg_temp.designation(8001,90,NULL,NULL)$q$,'22023','Invalid ownership page','null designation page rejected');
SELECT is(pg_temp.transfer(7004)->>'eligible','false','closed item not available for offering');
SELECT is(jsonb_array_length(pg_temp.transfer(7004)->'targets'),0,'closed item returns no recipients');
SELECT is(pg_temp.transfer(7005)->>'pending_recipient',pg_temp.uid(3)::text,'pending recipient retained as context');
SELECT is(pg_temp.transfer(7005)->>'eligible','false','pending offer cannot be resubmitted by selector');
SELECT is(jsonb_array_length(pg_temp.transfer(7005)->'targets'),0,'pending offer has no selectable candidates');
SELECT is(pg_temp.transfer(7005)->'next_cursor','null'::jsonb,'pending offer has no pagination');
SELECT is(pg_temp.transfer(7002)->>'eligible','true','null-source legacy item may prepare individual offer');
SELECT is(pg_temp.transfer(7003)->>'eligible','true','legacy-fan-out item may prepare individual offer without adoption');

SELECT pg_temp.actor(2);
SELECT lives_ok($q$SELECT pg_temp.transfer()$q$,'actual assignee need not be manager');
SELECT throws_ok($q$SELECT pg_temp.designation()$q$,'42501','Work ownership operation not authorized','assignee cannot designate without manager authority');
SELECT pg_temp.actor(3);
SELECT throws_ok($q$SELECT pg_temp.transfer()$q$,'42501','Work ownership operation not authorized','unrelated eligible clinician cannot prepare another owner offer');
SELECT pg_temp.actor(4);
SELECT throws_ok($q$SELECT pg_temp.transfer()$q$,'42501','Work ownership operation not authorized','manager without direct patient link cannot prepare offer');
SELECT throws_ok($q$SELECT pg_temp.designation()$q$,'42501','Work ownership operation not authorized','manager without direct patient link cannot read designation');
SELECT pg_temp.actor(1,'aal1');
SELECT throws_ok($q$SELECT pg_temp.transfer()$q$,'42501','Work ownership operation not authorized','AAL1 transfer denied');
SELECT throws_ok($q$SELECT pg_temp.designation()$q$,'42501','Work ownership operation not authorized','AAL1 designation denied');
SELECT pg_temp.actor(10);
SELECT throws_ok($q$SELECT pg_temp.transfer()$q$,'42501','Work ownership operation not authorized','non-provider transfer denied');
SELECT throws_ok($q$SELECT pg_temp.designation()$q$,'42501','Work ownership operation not authorized','non-provider designation denied');
SELECT pg_temp.actor(1);
SELECT throws_ok($q$SELECT pg_temp.transfer(9999)$q$,'42501','Work ownership operation not authorized','unknown work identity returns generic denial');
SELECT throws_ok($q$SELECT pg_temp.designation(9999)$q$,'42501','Work ownership operation not authorized','unknown organization does not grant scope');
SELECT throws_ok($q$SELECT pg_temp.designation(8002,91)$q$,'42501','Work ownership operation not authorized','patient outside selected organization denied');

RESET ROLE;
SAVEPOINT caller_revocation;
UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE membership_id IN
 (SELECT id FROM public.organization_memberships WHERE organization_id=pg_temp.uid(8001) AND user_id=pg_temp.uid(1));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.transfer()$q$,'42501','Work ownership operation not authorized','caller monitor revocation denies transfer read');
SELECT throws_ok($q$SELECT pg_temp.designation()$q$,'42501','Work ownership operation not authorized','caller monitor revocation denies designation read');
RESET ROLE;
ROLLBACK TO caller_revocation;
SAVEPOINT caller_expiry;
UPDATE public.member_authorizations SET expires_at=clock_timestamp()-interval '1 microsecond' WHERE membership_id IN
 (SELECT id FROM public.organization_memberships WHERE organization_id=pg_temp.uid(8001) AND user_id=pg_temp.uid(1));
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.transfer()$q$,'42501','Work ownership operation not authorized','expired caller monitor denies transfer read');
SELECT throws_ok($q$SELECT pg_temp.designation()$q$,'42501','Work ownership operation not authorized','expired caller monitor denies designation read');
RESET ROLE;
ROLLBACK TO caller_expiry;
SAVEPOINT caller_link;
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.uid(1) AND patient_id=pg_temp.uid(90);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.transfer()$q$,'42501','Work ownership operation not authorized','revoked caller link denies transfer read');
SELECT throws_ok($q$SELECT pg_temp.designation()$q$,'42501','Work ownership operation not authorized','revoked caller link denies designation read');
RESET ROLE;
ROLLBACK TO caller_link;
SAVEPOINT caller_consent;
UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.uid(1) AND consent_type='registration';
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.transfer()$q$,'42501','Work ownership operation not authorized','withdrawn caller consent denies transfer read');
SELECT throws_ok($q$SELECT pg_temp.designation()$q$,'42501','Work ownership operation not authorized','withdrawn caller consent denies designation read');
RESET ROLE;
ROLLBACK TO caller_consent;
SAVEPOINT patient_consent;
UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.uid(90) AND consent_type='registration';
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT pg_temp.transfer()$q$,'42501','Work ownership operation not authorized','withdrawn patient consent denies transfer read');
SELECT throws_ok($q$SELECT pg_temp.designation()$q$,'42501','Work ownership operation not authorized','withdrawn patient consent denies designation read');
RESET ROLE;
ROLLBACK TO patient_consent;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($q$SELECT pg_temp.transfer()$q$,'42501',NULL,'actual service invocation cannot use human transfer read');
SELECT throws_ok($q$SELECT pg_temp.designation()$q$,'42501',NULL,'actual service invocation cannot use human designation read');
RESET ROLE;
SELECT is((SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM public.work_items w),(SELECT work FROM original_rows),'reads preserve all work rows including legacy source, pending dates and ownership revision');
SELECT is((SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.patient_accountability d),(SELECT designations FROM original_rows),'reads preserve all designation history');
SELECT is((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.member_authorizations a),(SELECT grants FROM original_rows),'reads create or change no authorizations');
SELECT is((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.provider_patient_links l),(SELECT links FROM original_rows),'reads create or change no direct links');
SELECT is((SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.work_item_events e),(SELECT events FROM original_rows),'read preparation preserves events byte-for-byte and emits no command or clinical event');
SELECT * FROM finish();
ROLLBACK;
