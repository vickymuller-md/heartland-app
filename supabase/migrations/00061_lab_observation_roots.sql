-- Source registration only. No amended/cancelled observations or effective-value changes.
-- Correction must ship later together with every current-value consumer.
CREATE TABLE public.lab_observation_requests (
 id uuid PRIMARY KEY, root_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
 original_lab_result_id uuid NOT NULL REFERENCES public.lab_results(id) ON DELETE RESTRICT,
 analyte text NOT NULL CHECK(analyte IN('potassium','creatinine','egfr','bun','bnp','nt_probnp','hba1c','glucose','sodium','hemoglobin','ferritin','tsat','ldl')),
 command text NOT NULL DEFAULT 'register_source' CHECK(command='register_source'),
 expected_revision bigint NOT NULL DEFAULT 0 CHECK(expected_revision=0),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object'),
 source_fingerprint text NOT NULL CHECK(source_fingerprint ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','applied','cancelled')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), applied_at timestamptz, cancelled_at timestamptz,
 acknowledged_at timestamptz, receipt jsonb,
 CHECK((state='prepared' AND num_nonnulls(applied_at,cancelled_at,acknowledged_at,receipt)=0)
  OR(state='applied' AND applied_at IS NOT NULL AND cancelled_at IS NULL AND receipt IS NOT NULL)
  OR(state='cancelled' AND cancelled_at IS NOT NULL AND num_nonnulls(applied_at,acknowledged_at,receipt)=0))
);
CREATE UNIQUE INDEX lab_observation_one_prepared ON public.lab_observation_requests(actor_id,original_lab_result_id,analyte) WHERE state='prepared';
CREATE INDEX lab_observation_recovery ON public.lab_observation_requests(actor_id,organization_id,patient_id,id);
CREATE TABLE public.lab_observation_roots (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL UNIQUE REFERENCES public.lab_observation_requests(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 original_lab_result_id uuid NOT NULL REFERENCES public.lab_results(id) ON DELETE RESTRICT,
 analyte text NOT NULL CHECK(analyte IN('potassium','creatinine','egfr','bun','bnp','nt_probnp','hba1c','glucose','sodium','hemoglobin','ferritin','tsat','ldl')),
 registered_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(original_lab_result_id,analyte)
);
CREATE TABLE public.lab_observation_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 root_id uuid NOT NULL REFERENCES public.lab_observation_roots(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE REFERENCES public.lab_observation_requests(id) ON DELETE RESTRICT,
 revision bigint NOT NULL CHECK(revision=1),
 predecessor_id uuid REFERENCES public.lab_observation_versions(id) ON DELETE RESTRICT CHECK(predecessor_id IS NULL),
 lab_result_id uuid NOT NULL REFERENCES public.lab_results(id) ON DELETE RESTRICT,
 status text NOT NULL CHECK(status='original'),
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(root_id,revision)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['lab_observation_requests','lab_observation_roots','lab_observation_versions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;

CREATE FUNCTION public.guard_lab_observation_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='lab_observation_requests'
  AND (to_jsonb(NEW)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt'])
   IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt']) THEN
  IF OLD.state='prepared' AND NEW.state IN('applied','cancelled') THEN RETURN NEW; END IF;
  IF OLD.state='applied' AND NEW.state='applied' AND OLD.acknowledged_at IS NULL AND NEW.acknowledged_at IS NOT NULL
   AND ROW(OLD.applied_at,OLD.cancelled_at,OLD.receipt) IS NOT DISTINCT FROM ROW(NEW.applied_at,NEW.cancelled_at,NEW.receipt) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation history is immutable';
END $$;
CREATE TRIGGER guard_observation_request BEFORE UPDATE OR DELETE ON public.lab_observation_requests
 FOR EACH ROW EXECUTE FUNCTION public.guard_lab_observation_history();
CREATE TRIGGER guard_observation_root BEFORE UPDATE OR DELETE ON public.lab_observation_roots
 FOR EACH ROW EXECUTE FUNCTION public.guard_lab_observation_history();
CREATE TRIGGER guard_observation_version BEFORE UPDATE OR DELETE ON public.lab_observation_versions
 FOR EACH ROW EXECUTE FUNCTION public.guard_lab_observation_history();

CREATE FUNCTION public.guard_registered_lab_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Do not test root visibility first: an old RR snapshot can miss a concurrent registration.
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Laboratory source writes require READ COMMITTED';
 END IF;
 IF EXISTS(SELECT 1 FROM public.lab_observation_roots WHERE original_lab_result_id=OLD.id)
  AND (TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Registered source panels are immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_guard_registered_lab_source BEFORE UPDATE OR DELETE ON public.lab_results
 FOR EACH ROW EXECUTE FUNCTION public.guard_registered_lab_source();

CREATE FUNCTION public.lab_source_fingerprint(p_lab public.lab_results) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(((to_jsonb(p_lab)-ARRAY['collected_at','created_at'])||jsonb_build_object(
  'collected_at_epoch',extract(epoch FROM p_lab.collected_at),'created_at_epoch',extract(epoch FROM p_lab.created_at)))::text,'UTF8')),'hex')
$$;
CREATE FUNCTION public.validate_observation_registration(p_payload jsonb) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR NOT(p_payload ?& ARRAY['evidence','occurred_at']) OR p_payload-ARRAY['evidence','occurred_at']<>'{}'::jsonb
  OR NOT public.care_step_text(p_payload->'evidence',1000) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid observation source evidence';
 END IF;
 IF public.care_step_instant(p_payload->'occurred_at')>clock_timestamp() THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Source registration occurrence cannot be future';
 END IF;
END $$;
CREATE FUNCTION public.observation_source_snapshot(p_lab public.lab_results,p_analyte text) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE value text;
BEGIN
 IF p_analyte IS NULL OR p_analyte NOT IN('potassium','creatinine','egfr','bun','bnp','nt_probnp','hba1c','glucose','sodium','hemoglobin','ferritin','tsat','ldl') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid observation analyte';
 END IF;
 value:=to_jsonb(p_lab)->>p_analyte;
 IF value IS NULL OR value !~ '^\d+(\.\d+)?$' OR p_lab.collected_at IS NULL
  OR NOT isfinite(p_lab.collected_at) OR p_lab.collected_at>clock_timestamp() THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Verify the recorded source value and collection';
 END IF;
 RETURN jsonb_build_object('value',value,'collected_at',p_lab.collected_at);
END $$;
CREATE FUNCTION public.lab_observation_request_state(p_request uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('request_id',id,'root_id',root_id,'actor_id',actor_id,'organization_id',organization_id,
  'patient_id',patient_id,'original_lab_result_id',original_lab_result_id,'analyte',analyte,'command',command,
  'expected_revision',expected_revision::text,'payload',payload,'source_snapshot',source_snapshot,'state',state,
  'recorded_at',recorded_at,'acknowledged_at',acknowledged_at,'receipt',receipt)
 FROM public.lab_observation_requests WHERE id=p_request
$$;

CREATE FUNCTION public.prepare_lab_observation(p_request_id uuid,p_root_id uuid,p_organization_id uuid,p_patient_id uuid,
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
 PERFORM id FROM public.lab_observation_roots WHERE original_lab_result_id=lab.id AND analyte=p_analyte ORDER BY id FOR UPDATE;
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id FOR UPDATE;
 IF FOUND THEN
  PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
  IF saved.actor_id<>actor OR saved.root_id<>p_root_id OR saved.organization_id<>p_organization_id OR saved.patient_id<>p_patient_id
   OR saved.original_lab_result_id<>p_original_lab_result_id OR saved.analyte<>p_analyte OR saved.payload IS DISTINCT FROM p_payload THEN
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

CREATE FUNCTION public.apply_lab_observation(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.lab_observation_requests%ROWTYPE; lab public.lab_results%ROWTYPE; version_id uuid; recorded timestamptz; v_receipt jsonb;
BEGIN
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 SELECT * INTO lab FROM public.lab_results WHERE id=saved.original_lab_result_id FOR UPDATE;
 IF NOT FOUND OR lab.patient_id<>saved.patient_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation source not authorized'; END IF;
 PERFORM id FROM public.lab_observation_roots WHERE original_lab_result_id=lab.id AND analyte=saved.analyte ORDER BY id FOR UPDATE;
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id FOR UPDATE;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 IF saved.state='applied' THEN RETURN public.lab_observation_request_state(saved.id); END IF;
 IF saved.state='cancelled' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Source registration preparation is cancelled'; END IF;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,true);
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
 UPDATE public.lab_observation_requests SET state='applied',applied_at=recorded,receipt=v_receipt WHERE id=saved.id;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,true);
 RETURN public.lab_observation_request_state(saved.id);
END $$;

CREATE FUNCTION public.get_lab_observation_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.lab_observation_requests%ROWTYPE;
BEGIN
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 PERFORM id FROM public.lab_observation_requests WHERE id=p_request_id FOR SHARE;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 RETURN public.lab_observation_request_state(p_request_id);
END $$;
CREATE FUNCTION public.list_pending_lab_observations(p_organization_id uuid,p_patient_id uuid,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.lock_care_workflow_scope(p_organization_id,p_patient_id,false);
 WITH page AS(SELECT id FROM public.lab_observation_requests WHERE actor_id=(SELECT auth.uid()) AND organization_id=p_organization_id
  AND patient_id=p_patient_id AND(state='prepared' OR(state='applied' AND acknowledged_at IS NULL))
  AND(p_after IS NULL OR id>p_after) ORDER BY id LIMIT 26), visible AS(SELECT id FROM page ORDER BY id LIMIT 25)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.lab_observation_request_state(id) ORDER BY id) FROM visible),'[]'::jsonb),
  'next_cursor',CASE WHEN(SELECT count(*) FROM page)>25 THEN(SELECT id::text FROM visible ORDER BY id DESC LIMIT 1) ELSE NULL END) INTO result;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
 RETURN result;
END $$;
CREATE FUNCTION public.cancel_lab_observation(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.lab_observation_requests%ROWTYPE;
BEGIN
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id FOR UPDATE;
 IF saved.state='prepared' THEN UPDATE public.lab_observation_requests SET state='cancelled',cancelled_at=clock_timestamp() WHERE id=saved.id; END IF;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 RETURN public.lab_observation_request_state(saved.id);
END $$;
CREATE FUNCTION public.acknowledge_lab_observation(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.lab_observation_requests%ROWTYPE;
BEGIN
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id FOR UPDATE;
 IF saved.state<>'applied' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Only an applied source receipt can be acknowledged'; END IF;
 IF saved.acknowledged_at IS NULL THEN UPDATE public.lab_observation_requests SET acknowledged_at=clock_timestamp() WHERE id=saved.id; END IF;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 RETURN public.lab_observation_request_state(saved.id);
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'guard_lab_observation_history','guard_registered_lab_source','lab_source_fingerprint','validate_observation_registration',
  'observation_source_snapshot','lab_observation_request_state','prepare_lab_observation','apply_lab_observation',
  'get_lab_observation_request','list_pending_lab_observations','cancel_lab_observation','acknowledge_lab_observation') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.prepare_lab_observation(uuid,uuid,uuid,uuid,uuid,text,jsonb),public.apply_lab_observation(uuid),
 public.get_lab_observation_request(uuid),public.list_pending_lab_observations(uuid,uuid,uuid),public.cancel_lab_observation(uuid),
 public.acknowledge_lab_observation(uuid) TO authenticated;
