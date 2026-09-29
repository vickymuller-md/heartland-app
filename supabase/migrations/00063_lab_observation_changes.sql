-- Local amendment foundation. Integrated release also requires version-aware scan/evaluation
-- and atomic per-work invalidations with versioned associations. No work is touched here.
ALTER TABLE public.lab_observation_requests DROP CONSTRAINT lab_observation_requests_command_check;
ALTER TABLE public.lab_observation_requests DROP CONSTRAINT lab_observation_requests_expected_revision_check;
ALTER TABLE public.lab_observation_requests ADD CONSTRAINT observation_command_revision CHECK(
 (command='register_source' AND expected_revision=0) OR
 (command IN('correct_source','cancel_source') AND expected_revision BETWEEN 1 AND 9223372036854775806));
ALTER TABLE public.lab_observation_versions DROP CONSTRAINT lab_observation_versions_revision_check;
ALTER TABLE public.lab_observation_versions DROP CONSTRAINT lab_observation_versions_predecessor_id_check;
ALTER TABLE public.lab_observation_versions DROP CONSTRAINT lab_observation_versions_status_check;
ALTER TABLE public.lab_observation_versions ALTER COLUMN lab_result_id DROP NOT NULL;
ALTER TABLE public.lab_observation_versions ADD CONSTRAINT observation_version_shape CHECK(
 (status='original' AND revision=1 AND predecessor_id IS NULL AND lab_result_id IS NOT NULL) OR
 (status='corrected' AND revision>1 AND predecessor_id IS NOT NULL AND lab_result_id IS NOT NULL) OR
 (status='cancelled' AND revision>1 AND predecessor_id IS NOT NULL AND lab_result_id IS NULL));
CREATE UNIQUE INDEX observation_predecessor_once ON public.lab_observation_versions(predecessor_id) WHERE predecessor_id IS NOT NULL;
CREATE UNIQUE INDEX observation_amendment_once ON public.lab_observation_versions(lab_result_id) WHERE status='corrected';

-- Global source-change evidence, NOT a processed queue or per-work invalidation.
CREATE TABLE public.lab_observation_change_events (
 version_id uuid PRIMARY KEY REFERENCES public.lab_observation_versions(id) ON DELETE RESTRICT,
 root_id uuid NOT NULL REFERENCES public.lab_observation_roots(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE REFERENCES public.lab_observation_requests(id) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.lab_observation_change_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_observation_change_events FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_observation_change_event BEFORE UPDATE OR DELETE ON public.lab_observation_change_events
 FOR EACH ROW EXECUTE FUNCTION public.guard_lab_observation_history();

CREATE FUNCTION public.require_original_observation_source(p_lab uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Caller holds the exact source row before testing this disjointness.
 IF EXISTS(SELECT 1 FROM public.lab_observation_versions WHERE lab_result_id=p_lab AND status='corrected') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Amendment rows cannot become original sources';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_registered_lab_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Laboratory source writes require READ COMMITTED';
 END IF;
 IF (EXISTS(SELECT 1 FROM public.lab_observation_roots WHERE original_lab_result_id=OLD.id)
  OR EXISTS(SELECT 1 FROM public.lab_observation_versions WHERE lab_result_id=OLD.id AND status='corrected'))
  AND (TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Registered source panels are immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.validate_observation_change(p_command text,p_payload jsonb,p_analyte text)
RETURNS public.lab_results LANGUAGE plpgsql SET search_path='' AS $$
DECLARE typed public.lab_results; allowed text[]; exact_value numeric;
BEGIN
 IF p_command IS NULL OR p_command NOT IN('correct_source','cancel_source') OR p_analyte IS NULL
  OR p_analyte NOT IN('potassium','creatinine','egfr','bun','bnp','nt_probnp','hba1c','glucose','sodium','hemoglobin','ferritin','tsat','ldl') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid observation change';
 END IF;
 allowed:=ARRAY['reason','evidence','occurred_at'];
 IF p_command='correct_source' THEN allowed:=allowed||ARRAY['value','collected_at']; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR NOT(p_payload ?& allowed)
  OR p_payload-allowed<>'{}'::jsonb OR NOT public.care_step_text(p_payload->'reason',1000)
  OR NOT public.care_step_text(p_payload->'evidence',1000) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid observation change evidence';
 END IF;
 IF public.care_step_instant(p_payload->'occurred_at')>clock_timestamp() THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Observation change occurrence cannot be future';
 END IF;
 IF p_command='correct_source' THEN
  IF jsonb_typeof(p_payload->'value')<>'string' OR char_length(p_payload->>'value')>256
   OR (p_payload->>'value') !~ '^\d+(\.\d+)?$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid exact observation value';
  END IF;
  BEGIN
   exact_value:=(p_payload->>'value')::numeric;
   IF p_analyte='egfr' AND exact_value<>trunc(exact_value) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Observation value cannot be stored exactly';
   END IF;
   SELECT * INTO typed FROM jsonb_populate_record(NULL::public.lab_results,jsonb_build_object(p_analyte,
    CASE WHEN p_analyte='egfr' THEN to_jsonb(exact_value::integer) ELSE p_payload->'value' END));
   IF (to_jsonb(typed)->>p_analyte)::numeric IS DISTINCT FROM (p_payload->>'value')::numeric THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Observation value would lose storage precision';
   END IF;
  EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Observation value cannot be stored exactly';
  END;
  typed.collected_at:=public.care_step_instant(p_payload->'collected_at');
  IF typed.collected_at>clock_timestamp() THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Observation collection cannot be future';
  END IF;
 END IF;
 RETURN typed;
END $$;

CREATE FUNCTION public.lab_observation_head_snapshot(p_root uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE result jsonb;
BEGIN
 SELECT jsonb_build_object('version_id',v.id,'revision',v.revision::text,'status',v.status,
  'effective_lab_result_id',v.lab_result_id,'value',CASE WHEN v.status='cancelled' THEN NULL ELSE to_jsonb(l)->>r.analyte END,
  'collected_at',l.collected_at) INTO result
 FROM public.lab_observation_roots r
 JOIN LATERAL(SELECT * FROM public.lab_observation_versions WHERE root_id=r.id ORDER BY revision DESC LIMIT 1) v ON true
 JOIN LATERAL(SELECT lab_result_id FROM public.lab_observation_versions WHERE root_id=r.id AND lab_result_id IS NOT NULL ORDER BY revision DESC LIMIT 1) anchor ON true
 JOIN public.lab_results l ON l.id=anchor.lab_result_id AND l.patient_id=r.patient_id
 WHERE r.id=p_root;
 IF result IS NULL THEN RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory source history is inconsistent'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.lab_observation_head_fingerprint(p_lab public.lab_results,p_snapshot jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('original',public.lab_source_fingerprint(p_lab),
  'head',(p_snapshot-'collected_at')||jsonb_build_object('collection_epoch',extract(epoch FROM (p_snapshot->>'collected_at')::timestamptz)))::text,'UTF8')),'hex')
$$;

-- This guard also rejects privileged accidental chain corruption. API roles have no raw DML.
CREATE FUNCTION public.validate_observation_version_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE root public.lab_observation_roots; request public.lab_observation_requests;
 source public.lab_results; previous public.lab_observation_versions; current_revision bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Laboratory source writes require READ COMMITTED';
 END IF;
 SELECT * INTO root FROM public.lab_observation_roots WHERE id=NEW.root_id;
 SELECT * INTO source FROM public.lab_results WHERE id=root.original_lab_result_id FOR UPDATE;
 SELECT * INTO root FROM public.lab_observation_roots WHERE id=NEW.root_id FOR UPDATE;
 SELECT * INTO request FROM public.lab_observation_requests WHERE id=NEW.request_id FOR SHARE;
 SELECT max(revision) INTO current_revision FROM public.lab_observation_versions WHERE root_id=NEW.root_id;
 IF root.id IS NULL OR source.id IS NULL OR request.id IS NULL OR request.state<>'prepared'
  OR root.patient_id<>source.patient_id OR request.root_id<>root.id OR request.patient_id<>root.patient_id
  OR request.organization_id<>root.organization_id OR request.original_lab_result_id<>source.id OR request.analyte<>root.analyte
  OR request.actor_id<>NEW.actor_id OR request.expected_revision<>COALESCE(current_revision,0)
  OR NEW.revision<>COALESCE(current_revision,0)+1 OR NEW.occurred_at<>public.care_step_instant(request.payload->'occurred_at') THEN
  RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory source history is inconsistent';
 END IF;
 IF NEW.status='original' THEN
  IF request.command<>'register_source' OR NEW.lab_result_id<>source.id OR NEW.predecessor_id IS NOT NULL
   OR to_jsonb(source)->>root.analyte IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory source history is inconsistent';
  END IF;
  PERFORM public.require_original_observation_source(source.id);
 ELSE
  SELECT * INTO previous FROM public.lab_observation_versions WHERE id=NEW.predecessor_id;
  IF previous.id IS NULL OR previous.root_id<>root.id OR previous.revision<>NEW.revision-1
   OR (NEW.status='corrected' AND request.command<>'correct_source')
   OR (NEW.status='cancelled' AND (request.command<>'cancel_source' OR previous.status='cancelled')) THEN
   RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory source history is inconsistent';
  END IF;
  IF NEW.status='corrected' THEN
   SELECT * INTO source FROM public.lab_results WHERE id=NEW.lab_result_id FOR UPDATE;
   IF source.id IS NULL OR source.patient_id<>root.patient_id OR source.ordered_by IS NOT NULL
    OR source.notes IS NOT NULL OR source.lab_facility IS NOT NULL
    OR source.collected_at<>public.care_step_instant(request.payload->'collected_at')
    OR to_jsonb(source)->>root.analyte IS NULL
    OR (to_jsonb(source)->>root.analyte)::numeric<>(request.payload->>'value')::numeric
    OR num_nonnulls(source.potassium,source.creatinine,source.egfr,source.bun,source.bnp,source.nt_probnp,source.hba1c,
      source.glucose,source.sodium,source.hemoglobin,source.ferritin,source.tsat,source.ldl)<>1
    OR EXISTS(SELECT 1 FROM public.lab_observation_roots WHERE original_lab_result_id=source.id)
    OR EXISTS(SELECT 1 FROM public.lab_observation_versions WHERE lab_result_id=source.id) THEN
    RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory source history is inconsistent';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_observation_version BEFORE INSERT ON public.lab_observation_versions
 FOR EACH ROW EXECUTE FUNCTION public.validate_observation_version_insert();

CREATE OR REPLACE FUNCTION public.prepare_lab_observation(p_request_id uuid,p_root_id uuid,p_organization_id uuid,p_patient_id uuid,
 p_original_lab_result_id uuid,p_analyte text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE actor uuid:=(SELECT auth.uid()); saved public.lab_observation_requests%ROWTYPE; lab public.lab_results%ROWTYPE; snapshot jsonb;
BEGIN
 IF num_nulls(p_request_id,p_root_id,p_organization_id,p_patient_id,p_original_lab_result_id,p_analyte)>0 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid observation request identity';
 END IF;
 PERFORM public.lock_care_workflow_scope(p_organization_id,p_patient_id,false);
 SELECT * INTO lab FROM public.lab_results WHERE id=p_original_lab_result_id FOR UPDATE;
 IF NOT FOUND OR lab.patient_id<>p_patient_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation source not authorized'; END IF;
 PERFORM public.require_original_observation_source(lab.id);
 PERFORM id FROM public.lab_observation_roots WHERE original_lab_result_id=lab.id AND analyte=p_analyte ORDER BY id FOR UPDATE;
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id FOR UPDATE;
 IF FOUND THEN
  PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
  IF saved.actor_id<>actor OR saved.root_id<>p_root_id OR saved.organization_id<>p_organization_id OR saved.patient_id<>p_patient_id
   OR saved.original_lab_result_id<>p_original_lab_result_id OR saved.analyte<>p_analyte OR saved.payload IS DISTINCT FROM p_payload
   OR saved.command<>'register_source' OR saved.expected_revision<>0 THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Observation request identity conflict';
  END IF;
  RETURN public.lab_observation_request_state(saved.id);
 END IF;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,true);
 PERFORM public.validate_observation_registration(p_payload);
 snapshot:=public.observation_source_snapshot(lab,p_analyte);
 IF EXISTS(SELECT 1 FROM public.lab_observation_roots WHERE id=p_root_id OR(original_lab_result_id=lab.id AND analyte=p_analyte)) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Observation source already registered';
 END IF;
 IF EXISTS(SELECT 1 FROM public.lab_observation_requests WHERE actor_id=actor AND original_lab_result_id=lab.id AND analyte=p_analyte AND state='prepared') THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover or cancel the pending source registration first';
 END IF;
 INSERT INTO public.lab_observation_requests(id,root_id,actor_id,organization_id,patient_id,original_lab_result_id,analyte,payload,source_snapshot,source_fingerprint)
 VALUES(p_request_id,p_root_id,actor,p_organization_id,p_patient_id,lab.id,p_analyte,p_payload,snapshot,public.lab_source_fingerprint(lab));
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,true);
 RETURN public.lab_observation_request_state(p_request_id);
END $$;

CREATE FUNCTION public.prepare_lab_observation_change(p_request_id uuid,p_root_id uuid,p_organization_id uuid,
 p_patient_id uuid,p_expected_revision bigint,p_command text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE root public.lab_observation_roots; lab public.lab_results; saved public.lab_observation_requests; snapshot jsonb;
BEGIN
 IF num_nulls(p_request_id,p_root_id,p_organization_id,p_patient_id,p_expected_revision,p_command)>0 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid observation change identity';
 END IF;
 PERFORM public.lock_care_workflow_scope(p_organization_id,p_patient_id,false);
 SELECT * INTO root FROM public.lab_observation_roots WHERE id=p_root_id;
 IF NOT FOUND OR root.organization_id<>p_organization_id OR root.patient_id<>p_patient_id THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation source authority not authorized';
 END IF;
 SELECT * INTO lab FROM public.lab_results WHERE id=root.original_lab_result_id FOR UPDATE;
 SELECT * INTO root FROM public.lab_observation_roots WHERE id=p_root_id FOR UPDATE;
 IF lab.id IS NULL OR lab.patient_id<>p_patient_id OR root.organization_id<>p_organization_id OR root.patient_id<>p_patient_id THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation source authority not authorized';
 END IF;
 PERFORM public.require_original_observation_source(lab.id);
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id FOR UPDATE;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
 IF saved.id IS NOT NULL THEN
  IF saved.actor_id<>(SELECT auth.uid()) OR saved.root_id<>root.id OR saved.organization_id<>p_organization_id
   OR saved.patient_id<>p_patient_id OR saved.original_lab_result_id<>lab.id OR saved.analyte<>root.analyte
   OR saved.expected_revision<>p_expected_revision OR saved.command<>p_command OR saved.payload IS DISTINCT FROM p_payload THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Observation request identity conflict';
  END IF;
  RETURN public.lab_observation_request_state(saved.id);
 END IF;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,true);
 PERFORM public.validate_observation_change(p_command,p_payload,root.analyte);
 snapshot:=public.lab_observation_head_snapshot(root.id);
 IF p_expected_revision NOT BETWEEN 1 AND 9223372036854775806 OR (snapshot->>'revision')::bigint<>p_expected_revision THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Observation revision changed';
 END IF;
 IF p_command='cancel_source' AND snapshot->>'status'='cancelled' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Observation is already cancelled';
 END IF;
 IF EXISTS(SELECT 1 FROM public.lab_observation_requests WHERE actor_id=(SELECT auth.uid()) AND original_lab_result_id=lab.id
  AND analyte=root.analyte AND state='prepared') THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover or cancel the pending observation change first';
 END IF;
 INSERT INTO public.lab_observation_requests(id,root_id,actor_id,organization_id,patient_id,original_lab_result_id,analyte,
  command,expected_revision,payload,source_snapshot,source_fingerprint)
 VALUES(p_request_id,root.id,(SELECT auth.uid()),p_organization_id,p_patient_id,lab.id,root.analyte,p_command,
  p_expected_revision,p_payload,snapshot,public.lab_observation_head_fingerprint(lab,snapshot));
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,true);
 RETURN public.lab_observation_request_state(p_request_id);
END $$;

CREATE OR REPLACE FUNCTION public.apply_lab_observation(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.lab_observation_requests; lab public.lab_results; root public.lab_observation_roots;
 typed public.lab_results; snapshot jsonb; version_id uuid; recorded timestamptz; v_receipt jsonb;
 new_lab uuid; source_status text; stored_snapshot jsonb;
BEGIN
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 SELECT * INTO lab FROM public.lab_results WHERE id=saved.original_lab_result_id FOR UPDATE;
 IF NOT FOUND OR lab.patient_id<>saved.patient_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation source not authorized'; END IF;
 PERFORM public.require_original_observation_source(lab.id);
 PERFORM id FROM public.lab_observation_roots WHERE original_lab_result_id=lab.id AND analyte=saved.analyte ORDER BY id FOR UPDATE;
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id FOR UPDATE;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 IF saved.state='applied' THEN RETURN public.lab_observation_request_state(saved.id); END IF;
 IF saved.state='cancelled' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Source registration preparation is cancelled'; END IF;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,true);
 IF saved.command='register_source' THEN
  PERFORM public.validate_observation_registration(saved.payload);
  PERFORM public.observation_source_snapshot(lab,saved.analyte);
  IF saved.source_fingerprint IS DISTINCT FROM public.lab_source_fingerprint(lab) THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Source panel changed after preparation';
  END IF;
  IF EXISTS(SELECT 1 FROM public.lab_observation_roots WHERE id=saved.root_id OR(original_lab_result_id=lab.id AND analyte=saved.analyte)) THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Observation source already registered';
  END IF;
  INSERT INTO public.lab_observation_roots(id,request_id,patient_id,organization_id,original_lab_result_id,analyte,registered_by)
  VALUES(saved.root_id,saved.id,saved.patient_id,saved.organization_id,lab.id,saved.analyte,saved.actor_id);
  INSERT INTO public.lab_observation_versions(root_id,request_id,revision,predecessor_id,lab_result_id,status,actor_id,occurred_at)
  VALUES(saved.root_id,saved.id,1,NULL,lab.id,'original',saved.actor_id,(saved.payload->>'occurred_at')::timestamptz)
  RETURNING id,recorded_at INTO version_id,recorded;
  v_receipt:=jsonb_build_object('request_id',saved.id,'root_id',saved.root_id,'version_id',version_id,'revision','1',
   'original_lab_result_id',lab.id,'analyte',saved.analyte,'recorded_at',recorded,'source_authority_registered',true,
   'order_authorship_confirmed',false,'clinical_review_recorded',false,'care_completed',false);
 ELSE
  SELECT * INTO root FROM public.lab_observation_roots WHERE id=saved.root_id;
  IF root.id IS NULL OR root.organization_id<>saved.organization_id OR root.patient_id<>saved.patient_id
   OR root.original_lab_result_id<>lab.id OR root.analyte<>saved.analyte THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation source authority not authorized';
  END IF;
  typed:=public.validate_observation_change(saved.command,saved.payload,saved.analyte);
  snapshot:=public.lab_observation_head_snapshot(root.id);
  IF (snapshot->>'revision')::bigint<>saved.expected_revision
   OR saved.source_fingerprint IS DISTINCT FROM public.lab_observation_head_fingerprint(lab,snapshot) THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Observation revision changed';
  END IF;
  IF saved.command='cancel_source' AND snapshot->>'status'='cancelled' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Observation is already cancelled';
  END IF;
  IF saved.command='correct_source' THEN
   -- Only the chosen typed field is nonnull. Never copy order authorship or private reason into public notes.
   INSERT INTO public.lab_results(patient_id,collected_at,potassium,creatinine,egfr,bun,bnp,nt_probnp,hba1c,glucose,
    sodium,hemoglobin,ferritin,tsat,ldl,ordered_by,notes,lab_facility)
   VALUES(saved.patient_id,typed.collected_at,typed.potassium,typed.creatinine,typed.egfr,typed.bun,typed.bnp,typed.nt_probnp,
    typed.hba1c,typed.glucose,typed.sodium,typed.hemoglobin,typed.ferritin,typed.tsat,typed.ldl,NULL,NULL,NULL)
   RETURNING id INTO new_lab;
   source_status:='corrected';
   stored_snapshot:=jsonb_build_object('value',to_jsonb(typed)->>saved.analyte,'collected_at',typed.collected_at);
  ELSE
   source_status:='cancelled';
   stored_snapshot:=jsonb_build_object('value',NULL,'collected_at',snapshot->'collected_at');
  END IF;
  INSERT INTO public.lab_observation_versions(root_id,request_id,revision,predecessor_id,lab_result_id,status,actor_id,occurred_at)
  VALUES(saved.root_id,saved.id,saved.expected_revision+1,(snapshot->>'version_id')::uuid,new_lab,source_status,
   saved.actor_id,public.care_step_instant(saved.payload->'occurred_at'))
  RETURNING id,recorded_at INTO version_id,recorded;
  INSERT INTO public.lab_observation_change_events(version_id,root_id,request_id) VALUES(version_id,root.id,saved.id);
  v_receipt:=jsonb_build_object('request_id',saved.id,'root_id',root.id,'version_id',version_id,
   'revision',(saved.expected_revision+1)::text,'previous_version_id',snapshot->>'version_id','original_lab_result_id',lab.id,
   'analyte',saved.analyte,'status',source_status,'effective_lab_result_id',new_lab,'stored_source',stored_snapshot,
   'evaluation_status',CASE WHEN new_lab IS NOT NULL THEN 'pending' ELSE NULL END,
   'recorded_at',recorded,'source_change_recorded',true,'work_invalidation_recorded',false,
   'order_authorship_confirmed',false,'clinical_review_recorded',false,'care_completed',false);
 END IF;
 UPDATE public.lab_observation_requests SET state='applied',applied_at=recorded,receipt=v_receipt WHERE id=saved.id;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,true);
 RETURN public.lab_observation_request_state(saved.id);
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'require_original_observation_source','validate_observation_change','lab_observation_head_snapshot',
  'lab_observation_head_fingerprint','validate_observation_version_insert','prepare_lab_observation_change') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.prepare_lab_observation_change(uuid,uuid,uuid,uuid,bigint,text,jsonb) TO authenticated;
COMMENT ON TABLE public.lab_observation_change_events IS
 'Immutable global source-change evidence, not per-work invalidation or completed processing. No work lock or work FK. Integrated fan-out is required before release.';
