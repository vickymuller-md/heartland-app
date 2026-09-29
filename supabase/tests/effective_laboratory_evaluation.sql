-- Synthetic immediate-source evaluation proof. No production data or transport.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL timezone='UTC';
SELECT no_plan();
-- BEGIN EFFECTIVE EVALUATION FIXTURES
CREATE FUNCTION pg_temp.ee(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('65000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.ee(n),'effective-evaluation-'||n||'@example.invalid','{"consent_accepted":true}' FROM unnest(ARRAY[1,2,3]||ARRAY(SELECT generate_series(11,35))) n;
UPDATE public.profiles SET role='provider' WHERE id IN(pg_temp.ee(1),pg_temp.ee(2),pg_temp.ee(3));
INSERT INTO public.organizations(id,name,created_by) VALUES
 (pg_temp.ee(90),'Synthetic scan source organization',pg_temp.ee(1)),(pg_temp.ee(91),'Synthetic scan second organization',pg_temp.ee(2));
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES(pg_temp.ee(90),pg_temp.ee(1),'owner','active',now(),pg_temp.ee(1)),
 (pg_temp.ee(91),pg_temp.ee(2),'owner','active',now(),pg_temp.ee(2));
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,c,user_id FROM public.organization_memberships CROSS JOIN unnest(ARRAY['monitor','clinical_disposition']) c
 WHERE organization_id IN(pg_temp.ee(90),pg_temp.ee(91));
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT pg_temp.ee(provider),pg_temp.ee(patient),'active',now() FROM unnest(ARRAY[1,2]) provider CROSS JOIN generate_series(11,35) patient;
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by)
 SELECT pg_temp.ee(org),pg_temp.ee(patient),pg_temp.ee(CASE WHEN org=90 THEN 1 ELSE 2 END)
 FROM unnest(ARRAY[90,91]) org CROSS JOIN generate_series(11,35) patient ON CONFLICT DO NOTHING;
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium,egfr,sodium)
 SELECT pg_temp.ee(100+n),pg_temp.ee(n),now()-interval '1 day',
 CASE WHEN n=16 THEN NULL WHEN n=17 THEN 5.5 ELSE 6.2 END,
 CASE WHEN n IN(13,15,20,21,22) THEN NULL WHEN n=17 THEN 15 WHEN n=16 THEN NULL ELSE 10 END,
 CASE WHEN n=16 THEN 140 ELSE NULL END FROM generate_series(11,35) n;
-- END EFFECTIVE EVALUATION FIXTURES
-- BEGIN EFFECTIVE EVALUATION HELPERS
CREATE FUNCTION pg_temp.ee_service() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims','{"role":"service_role"}',true)::text;
$$;
CREATE FUNCTION pg_temp.ee_register(n integer,a text DEFAULT 'potassium') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ee(1),'aal','aal2')::text,true);
 PERFORM public.prepare_lab_observation(pg_temp.ee(1000+n),pg_temp.ee(2000+n),pg_temp.ee(90),pg_temp.ee(n),pg_temp.ee(100+n),a,
  jsonb_build_object('evidence','Synthetic source register','occurred_at',to_char(now()-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 result:=public.apply_lab_observation(pg_temp.ee(1000+n)); PERFORM pg_temp.ee_service(); RETURN result;
END $$;
CREATE FUNCTION pg_temp.ee_change(n integer,c text DEFAULT 'correct_source',value text DEFAULT '4.2') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; payload jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ee(1),'aal','aal2')::text,true);
 payload:=jsonb_build_object('reason','Synthetic amended value','evidence','Synthetic revised report',
  'occurred_at',to_char(now()-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 IF c='correct_source' THEN payload:=payload||jsonb_build_object('value',value,
  'collected_at',to_char(now()-interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')); END IF;
 PERFORM public.prepare_lab_observation_change(pg_temp.ee(3000+n),pg_temp.ee(2000+n),pg_temp.ee(90),pg_temp.ee(n),1,c,payload);
 result:=public.apply_lab_observation(pg_temp.ee(3000+n)); PERFORM pg_temp.ee_service(); RETURN result;
END $$;
CREATE FUNCTION pg_temp.ee_process(n integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE s text; BEGIN PERFORM pg_temp.ee_service();
 SELECT status INTO STRICT s FROM public.process_lab_alert_event(pg_temp.ee(100+n)); RETURN s; END $$;
CREATE FUNCTION pg_temp.ee_assessment(n integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT source_assessment FROM public.lab_alert_evaluations WHERE lab_result_id=pg_temp.ee(100+n)
$$;
-- END EFFECTIVE EVALUATION HELPERS
CREATE TEMP TABLE eval_evidence(label text PRIMARY KEY,data jsonb);
SELECT pg_temp.ee_register(11); SELECT pg_temp.ee_change(11);
SELECT is(pg_temp.ee_process(11),'recorded','partial panel keeps effective original renal source');
SELECT is(pg_temp.ee_assessment(11)#>>'{analytes,potassium,reason}','replaced','original K explicitly excluded');
SELECT is(pg_temp.ee_assessment(11)#>>'{analytes,egfr,reason}','effective','original GFR remains eligible');
SELECT is((SELECT array_agg(flag) FROM public.lab_alert_sources WHERE patient_id=pg_temp.ee(11)),ARRAY['low_egfr'],'only effective renal signal recorded');
SELECT is(pg_temp.ee_assessment(11)#>>'{analytes,potassium,event_source,value}','6.2','event value is not replaced by new head value');
SELECT is(pg_temp.ee_assessment(11)#>>'{analytes,potassium,observed_head,value}','4.2','historical observed head distinct');
SELECT pg_temp.ee_register(12); SELECT pg_temp.ee_change(12);
SELECT is((SELECT status FROM public.process_lab_alert_event((SELECT lab_result_id FROM public.lab_observation_versions WHERE root_id=pg_temp.ee(2012) AND revision=2))),'not_required','K-only amendment does not inherit renal source');
SELECT is((SELECT source_assessment#>>'{analytes,egfr,reason}' FROM public.lab_alert_evaluations WHERE lab_result_id=(SELECT lab_result_id FROM public.lab_observation_versions WHERE root_id=pg_temp.ee(2012) AND revision=2)),'not_recorded','amendment has no renal candidate');
SELECT is((SELECT count(*) FROM public.alerts WHERE patient_id=pg_temp.ee(12)),0::bigint,'no spurious renal amendment alert');
SELECT pg_temp.ee_register(13); SELECT pg_temp.ee_change(13,'cancel_source');
SELECT is(pg_temp.ee_process(13),'invalidated','cancelled only candidate terminates explicitly');
SELECT is(pg_temp.ee_assessment(13)#>>'{analytes,potassium,reason}','cancelled','cancel reason retained');
SELECT is((SELECT count(*) FROM public.alerts WHERE patient_id=pg_temp.ee(13)),0::bigint,'no cancelled-source effects');
SELECT pg_temp.ee_register(14); SELECT is(pg_temp.ee_process(14),'recorded','effective two-flag event recorded');
INSERT INTO eval_evidence VALUES('before-change',pg_temp.ee_assessment(14));
SELECT pg_temp.ee_change(14);
UPDATE public.provider_patient_links SET status='revoked' WHERE patient_id=pg_temp.ee(14);
SELECT is(pg_temp.ee_process(14),'recorded','terminal replay remains after source and scope changes');
SELECT is(pg_temp.ee_assessment(14),(SELECT data FROM eval_evidence WHERE label='before-change'),'historical assessment never recomputed');
SELECT is((SELECT count(*) FROM public.lab_alert_sources WHERE patient_id=pg_temp.ee(14)),2::bigint,'two historical signal sources retained');
SELECT pg_temp.ee_register(15); SELECT pg_temp.ee_change(15,'correct_source','6.1');
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ee(1),'aal','aal2')::text,true);
SELECT public.prepare_lab_observation_change(pg_temp.ee(4015),pg_temp.ee(2015),pg_temp.ee(90),pg_temp.ee(15),2,'correct_source',
 jsonb_build_object('reason','Second synthetic correction','evidence','Synthetic report','occurred_at',to_char(now()-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'value','4.2','collected_at',to_char(now()-interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
SELECT public.apply_lab_observation(pg_temp.ee(4015)); SELECT pg_temp.ee_service();
SELECT is((SELECT status FROM public.process_lab_alert_event((SELECT lab_result_id FROM public.lab_observation_versions WHERE root_id=pg_temp.ee(2015) AND revision=2))),'invalidated','intermediate amendment excluded by later version');
SELECT is((SELECT source_assessment#>>'{analytes,potassium,event_source,revision}' FROM public.lab_alert_evaluations WHERE lab_result_id=(SELECT lab_result_id FROM public.lab_observation_versions WHERE root_id=pg_temp.ee(2015) AND revision=2)),'2','event amendment revision retained');
SELECT is(pg_temp.ee_process(16),'not_required','sodium-only event does not invent K or GFR');
SELECT is(pg_temp.ee_assessment(16)#>>'{analytes,potassium,reason}','not_recorded','missing K remains explicitly absent');
SELECT is(pg_temp.ee_process(17),'not_required','K5.5 and GFR15 boundaries unchanged');
-- Force failure after the first source and all its N2 effects have been written.
CREATE FUNCTION pg_temp.reject_second_eval_flag() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.patient_id=pg_temp.ee(18) AND NEW.flag='low_egfr' THEN RAISE EXCEPTION 'Synthetic second flag failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_eval_failure BEFORE INSERT ON public.lab_alert_sources FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_second_eval_flag();
SELECT is(pg_temp.ee_process(18),'pending','second-flag failure stays retryable');
SELECT ok(pg_temp.ee_assessment(18) IS NULL,'failed attempt leaves no terminal proof');
SELECT is((SELECT count(*) FROM public.alerts WHERE patient_id=pg_temp.ee(18)),0::bigint,'all alerts roll back');
SELECT is((SELECT count(*) FROM public.work_items WHERE patient_id=pg_temp.ee(18)),0::bigint,'all work rolls back');
SELECT is((SELECT count(*) FROM public.notification_intents WHERE patient_id=pg_temp.ee(18)),0::bigint,'all intents roll back');
SELECT is((SELECT count(*) FROM public.lab_alert_sources WHERE patient_id=pg_temp.ee(18)),0::bigint,'first source rolls back');
SELECT is((SELECT attempt_count FROM public.lab_alert_evaluations WHERE patient_id=pg_temp.ee(18)),1,'failed attempt counted once');
SELECT is((SELECT count(*) FROM public.alert_effect_scope_context),0::bigint,'failed scope context rolls back');
DROP TRIGGER synthetic_eval_failure ON public.lab_alert_sources;
SELECT is(pg_temp.ee_process(18),'recorded','retry completes same persisted event');
SELECT is((SELECT attempt_count FROM public.lab_alert_evaluations WHERE patient_id=pg_temp.ee(18)),2,'retry counted once');
UPDATE public.provider_patient_links SET status='revoked' WHERE patient_id=pg_temp.ee(19);
SELECT is(pg_temp.ee_process(19),'pending','scope refusal not mislabelled as invalidation');
SELECT ok(pg_temp.ee_assessment(19) IS NULL,'scope refusal no assessment');
UPDATE public.provider_patient_links SET status='active' WHERE patient_id=pg_temp.ee(19);
SELECT is(pg_temp.ee_process(19),'recorded','restored scope retries normally');
-- Privileged corrupt legacy fixture only, never an allowed UI operation.
-- Current clinical_ranges already rejects these inserts. Simulate older damaged
-- state inside this rolled-back suite to test the additional evaluation fence.
ALTER TABLE public.lab_results DROP CONSTRAINT lab_results_clinical_ranges;
ALTER TABLE public.lab_results DISABLE TRIGGER USER;
UPDATE public.lab_results SET potassium=-1 WHERE id=pg_temp.ee(120);
UPDATE public.lab_results SET potassium='NaN'::numeric WHERE id=pg_temp.ee(121);
UPDATE public.lab_results SET collected_at=now()+interval '1 day' WHERE id=pg_temp.ee(122);
ALTER TABLE public.lab_results ENABLE TRIGGER USER;
SELECT is(pg_temp.ee_process(20),'pending','negative eligible value does not become not_required');
SELECT is(pg_temp.ee_process(21),'pending','NaN eligible value does not become not_required');
SELECT is(pg_temp.ee_process(22),'pending','future eligible collection fails safely');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.lab_alert_evaluations WHERE patient_id IN(pg_temp.ee(20),pg_temp.ee(21),pg_temp.ee(22))
 AND(source_assessment IS NOT NULL OR last_error_code IS DISTINCT FROM 'evaluation_failed')),'corrupt sources retain failed-pending state without proof');
-- Old terminal records remain distinguishable, without fabricated backfill.
UPDATE public.lab_alert_evaluations SET status='not_required',completed_at=now() WHERE patient_id=pg_temp.ee(23);
SELECT is(pg_temp.ee_process(23),'not_required','legacy terminal replay retained');
SELECT ok(pg_temp.ee_assessment(23) IS NULL,'legacy NULL assessment not backfilled');
SELECT is((SELECT count(*) FROM public.alert_effect_scope_context),0::bigint,'no scope context leaks');
SELECT ok(NOT has_table_privilege('service_role','public.lab_alert_evaluations','UPDATE'),'service cannot forge assessment');
SELECT * FROM finish();
ROLLBACK;
