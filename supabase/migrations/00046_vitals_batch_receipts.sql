-- Durable seven-position provider capture. No clinical threshold/delivery policy.
CREATE TABLE public.vitals_submission_batches (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  input jsonb CHECK (input IS NULL OR (jsonb_typeof(input)='array' AND jsonb_array_length(input)=7)),
  captured_at timestamptz CHECK (captured_at IS NULL OR isfinite(captured_at)),
  closed_status text CHECK (closed_status IN ('acknowledged','cancelled')),
  closed_at timestamptz,
  CHECK ((closed_at IS NULL) = (closed_status IS NULL)),
  CHECK ((input IS NULL) = (captured_at IS NULL))
);
CREATE UNIQUE INDEX vitals_batch_one_active ON public.vitals_submission_batches(actor_id,patient_id) WHERE closed_at IS NULL;
CREATE INDEX vitals_batch_patient_idx ON public.vitals_submission_batches(patient_id);
CREATE TABLE public.vitals_submission_batch_rows (
  batch_id uuid NOT NULL REFERENCES public.vitals_submission_batches(batch_id) ON DELETE RESTRICT,
  row_index smallint NOT NULL CHECK (row_index BETWEEN 0 AND 6),
  request_id uuid NOT NULL UNIQUE REFERENCES public.vitals_submission_receipts(request_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  history jsonb NOT NULL CHECK (jsonb_typeof(history)='array' AND jsonb_array_length(history)<=1006),
  PRIMARY KEY(batch_id,row_index)
);
ALTER TABLE public.vitals_submission_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vitals_submission_batch_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vitals_submission_batches,public.vitals_submission_batch_rows FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.vitals_submission_batches,public.vitals_submission_batch_rows TO authenticated,service_role;
CREATE POLICY vitals_batch_actor_read ON public.vitals_submission_batches FOR SELECT TO authenticated
  USING (actor_id=(SELECT auth.uid()) AND public.can_access_vitals_submission(patient_id));
CREATE POLICY vitals_batch_row_actor_read ON public.vitals_submission_batch_rows FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.vitals_submission_batches AS batch WHERE batch.batch_id=vitals_submission_batch_rows.batch_id
    AND batch.actor_id=(SELECT auth.uid()) AND public.can_access_vitals_submission(batch.patient_id)));

CREATE FUNCTION public.guard_individual_vitals_mode(p_actor uuid,p_patient uuid,p_request uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.vitals_submission_batches WHERE actor_id=p_actor AND patient_id=p_patient AND closed_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.vitals_submission_batch_rows WHERE request_id=p_request) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover the batch before continuing individual entry';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_individual_vitals_mode(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Immutable mapping selects the evaluator; neither a browser flag nor a GUC does.
CREATE OR REPLACE FUNCTION public.vitals_evaluation_rule_version(p_request_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN EXISTS(SELECT 1 FROM public.vitals_submission_batch_rows WHERE request_id=p_request_id)
    THEN 'vitals-frozen-batch-v1' ELSE 'vitals-frozen-individual-v1' END
$$;

ALTER TABLE public.vitals_submission_attempts DROP CONSTRAINT vitals_submission_attempts_closed_status_check;
ALTER TABLE public.vitals_submission_attempts ADD CONSTRAINT vitals_submission_attempts_closed_status_check
  CHECK (closed_status IN ('acknowledged','cancelled','batched'));
CREATE OR REPLACE FUNCTION public.enforce_vitals_submission_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF public.lab_provenance_erasure_active(OLD.actor_id) OR public.lab_provenance_erasure_active(OLD.patient_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Vitals submission history is immutable';
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Vitals submission history is immutable';
  END IF;
  IF (SELECT auth.uid()) IS DISTINCT FROM OLD.actor_id OR NOT COALESCE(public.can_access_vitals_submission(OLD.patient_id),false) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Vitals operation not authorized';
  END IF;
  IF NEW.closed_status='batched' THEN
    IF NOT EXISTS(SELECT 1 FROM public.vitals_submission_batch_rows AS mapping
      JOIN public.vitals_submission_batches AS batch USING(batch_id)
      JOIN public.vitals_submission_receipts AS receipt USING(request_id)
      WHERE mapping.request_id=OLD.request_id AND batch.actor_id=OLD.actor_id AND batch.patient_id=OLD.patient_id
        AND batch.closed_at IS NULL AND batch.captured_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid batch row';
    END IF;
  ELSIF NEW.closed_status='acknowledged' THEN
    PERFORM public.guard_individual_vitals_mode(OLD.actor_id,OLD.patient_id,OLD.request_id);
    IF NOT EXISTS(SELECT 1 FROM public.vitals_submission_receipts WHERE request_id=OLD.request_id) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Vitals receipt does not match';
    END IF;
  ELSIF NEW.closed_status='cancelled' THEN
    PERFORM public.guard_individual_vitals_mode(OLD.actor_id,OLD.patient_id,OLD.request_id);
    IF EXISTS(SELECT 1 FROM public.vitals_submission_receipts WHERE request_id=OLD.request_id) THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Vitals submission is committed';
    END IF;
  ELSE RAISE EXCEPTION 'Invalid vitals submission transition'; END IF;
  NEW.closed_at:=clock_timestamp(); RETURN NEW;
END;
$$;

CREATE FUNCTION public.protect_vitals_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_patient uuid;
BEGIN
  IF TG_TABLE_NAME='vitals_submission_batch_rows' THEN
    SELECT actor_id,patient_id INTO v_actor,v_patient FROM public.vitals_submission_batches WHERE batch_id=OLD.batch_id;
  ELSE v_actor:=OLD.actor_id; v_patient:=OLD.patient_id; END IF;
  IF TG_OP='DELETE' AND (public.lab_provenance_erasure_active(v_actor) OR public.lab_provenance_erasure_active(v_patient)) THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME='vitals_submission_batch_rows' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Batch provenance is immutable'; END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.closed_at IS NOT NULL OR (OLD.captured_at IS NOT NULL AND
      (NEW.input IS DISTINCT FROM OLD.input OR NEW.captured_at IS DISTINCT FROM OLD.captured_at)) THEN
    RAISE EXCEPTION 'Batch provenance is immutable';
  END IF;
  IF (SELECT auth.uid()) IS DISTINCT FROM OLD.actor_id OR NOT COALESCE(public.can_access_vitals_submission(OLD.patient_id),false) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Vitals operation not authorized';
  END IF;
  IF NEW.closed_status='cancelled' AND NEW.captured_at IS NOT NULL
    OR NEW.closed_status='acknowledged' AND NEW.captured_at IS NULL THEN RAISE EXCEPTION 'Invalid batch transition'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_vitals_batch() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_vitals_batch BEFORE UPDATE OR DELETE ON public.vitals_submission_batches
  FOR EACH ROW EXECUTE FUNCTION public.protect_vitals_batch();
CREATE TRIGGER protect_vitals_batch_row BEFORE UPDATE OR DELETE ON public.vitals_submission_batch_rows
  FOR EACH ROW EXECUTE FUNCTION public.protect_vitals_batch();

-- Private shared capture kernel; only typed public wrappers choose the input.
-- Optional history/clock are passed ONLY by the server-owned batch function.
CREATE FUNCTION public.capture_vitals_submission_kernel(p_patient uuid,p_request uuid,
  p_weight numeric,p_unit text,p_sbp integer,p_dbp integer,p_hr integer,p_spo2 integer,
  p_dyspnea integer,p_edema integer,p_orthopnea boolean,p_fatigue integer,p_recorded timestamptz,
  p_clock timestamptz DEFAULT NULL,p_base jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid; v_attempt public.vitals_submission_attempts%ROWTYPE; v_input jsonb; v_existing jsonb;
  v_clock timestamptz; v_vitals public.vitals%ROWTYPE; v_symptoms public.symptoms%ROWTYPE; v_history jsonb;
BEGIN
  v_actor:=public.lock_vitals_submission_scope(p_patient);
  IF p_request IS NULL OR p_weight IS NULL OR NOT(p_weight BETWEEN 50 AND 700)
    OR p_unit IS NULL OR p_unit NOT IN ('lbs','kg') OR p_sbp IS NULL OR p_sbp NOT BETWEEN 60 AND 260
    OR p_dbp IS NULL OR p_dbp NOT BETWEEN 30 AND 160 OR p_hr IS NULL OR p_hr NOT BETWEEN 30 AND 220
    OR (p_spo2 IS NOT NULL AND p_spo2 NOT BETWEEN 50 AND 100) OR p_dyspnea IS NULL OR p_dyspnea NOT BETWEEN 0 AND 3
    OR p_edema IS NULL OR p_edema NOT BETWEEN 0 AND 3 OR p_orthopnea IS NULL OR p_fatigue IS NULL OR p_fatigue NOT BETWEEN 0 AND 3
    OR (p_recorded IS NOT NULL AND (NOT isfinite(p_recorded) OR v_actor=p_patient)) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid vitals submission';
  END IF;
  IF p_clock IS NULL AND p_base IS NULL THEN
    IF EXISTS(SELECT 1 FROM public.vitals_submission_batch_rows WHERE request_id=p_request) THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover the batch before continuing individual entry';
    END IF;
  ELSIF p_clock IS NULL OR NOT isfinite(p_clock) OR p_base IS NULL OR jsonb_typeof(p_base)<>'array'
    OR jsonb_array_length(p_base)>1000 OR NOT EXISTS(SELECT 1 FROM public.vitals_submission_batch_rows AS mapping
      JOIN public.vitals_submission_batches AS batch USING(batch_id) WHERE mapping.request_id=p_request
        AND batch.actor_id=v_actor AND batch.patient_id=p_patient AND batch.closed_at IS NULL AND batch.captured_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid batch context';
  END IF;
  v_input:=jsonb_build_object('weight',p_weight,'weight_unit',p_unit,'sbp',p_sbp,'dbp',p_dbp,'heart_rate',p_hr,
    'spo2',p_spo2,'dyspnea',p_dyspnea,'edema',p_edema,'orthopnea',p_orthopnea,'fatigue',p_fatigue,
    'recorded_at_epoch',extract(epoch FROM p_recorded));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('heartland:vitals-capture:patient:'||p_patient::text,0));
  SELECT * INTO v_attempt FROM public.vitals_submission_attempts WHERE request_id=p_request AND actor_id=v_actor AND patient_id=p_patient FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Vitals submission is not prepared'; END IF;
  IF v_attempt.closed_status='cancelled' THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Vitals submission is closed'; END IF;
  SELECT input INTO v_existing FROM public.vitals_submission_receipts WHERE request_id=p_request;
  IF FOUND THEN
    IF v_existing IS DISTINCT FROM v_input THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Vitals submission payload differs'; END IF;
    RETURN public.vitals_submission_snapshot(v_actor,p_patient,p_request);
  END IF;
  IF v_attempt.closed_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Vitals submission is closed'; END IF;
  IF p_clock IS NULL THEN PERFORM public.guard_individual_vitals_mode(v_actor,p_patient,p_request); END IF;
  v_clock:=COALESCE(p_clock,clock_timestamp());
  INSERT INTO public.vitals(patient_id,recorded_at,weight_lbs,sbp,dbp,heart_rate,spo2,source)
    VALUES(p_patient,COALESCE(p_recorded,v_clock),CASE WHEN p_unit='kg' THEN round(p_weight*2.20462,1) ELSE p_weight END,
      p_sbp,p_dbp,p_hr,p_spo2,CASE WHEN v_actor=p_patient THEN 'patient_app' ELSE 'provider_entry' END) RETURNING * INTO v_vitals;
  INSERT INTO public.symptoms(patient_id,recorded_at,dyspnea,edema,orthopnea,fatigue,red_flag)
    VALUES(p_patient,COALESCE(p_recorded,v_clock),p_dyspnea,p_edema,p_orthopnea,p_fatigue,NULL) RETURNING * INTO v_symptoms;
  IF p_base IS NOT NULL THEN v_history:=p_base;
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(prior) ORDER BY prior.recorded_at DESC,prior.id DESC),'[]'::jsonb) INTO v_history FROM (
      SELECT id,recorded_at,weight_lbs FROM public.vitals WHERE patient_id=p_patient AND id<>v_vitals.id
        AND recorded_at>=v_clock-interval '336 hours' ORDER BY recorded_at DESC,id DESC LIMIT 1001) AS prior;
  END IF;
  IF jsonb_array_length(v_history)>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Vitals capture history limit exceeded'; END IF;
  INSERT INTO public.vitals_submission_receipts(request_id,vitals_id,symptoms_id,input,observation,captured_at,history)
    VALUES(p_request,v_vitals.id,v_symptoms.id,v_input,jsonb_build_object('vitals',to_jsonb(v_vitals),'symptoms',to_jsonb(v_symptoms)),v_clock,v_history);
  RETURN public.vitals_submission_snapshot(v_actor,p_patient,p_request);
END;
$$;
REVOKE ALL ON FUNCTION public.capture_vitals_submission_kernel(uuid,uuid,numeric,text,integer,integer,integer,integer,integer,integer,boolean,integer,timestamptz,timestamptz,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.submit_vitals_submission(p_patient_id uuid,p_request_id uuid,
  p_weight numeric,p_weight_unit text,p_sbp integer,p_dbp integer,p_heart_rate integer,p_spo2 integer,
  p_dyspnea integer,p_edema integer,p_orthopnea boolean,p_fatigue integer,p_recorded_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='5s' AS $$
  SELECT public.capture_vitals_submission_kernel(p_patient_id,p_request_id,p_weight,p_weight_unit,p_sbp,p_dbp,
    p_heart_rate,p_spo2,p_dyspnea,p_edema,p_orthopnea,p_fatigue,p_recorded_at)
$$;

CREATE OR REPLACE FUNCTION public.prepare_vitals_submission(p_patient_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid; v_request uuid;
BEGIN
  v_actor:=public.lock_vitals_submission_scope(p_patient_id);
  PERFORM public.guard_individual_vitals_mode(v_actor,p_patient_id);
  SELECT request_id INTO v_request FROM public.vitals_submission_attempts WHERE actor_id=v_actor AND patient_id=p_patient_id AND closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN INSERT INTO public.vitals_submission_attempts(actor_id,patient_id) VALUES(v_actor,p_patient_id) RETURNING request_id INTO v_request; END IF;
  RETURN public.vitals_submission_snapshot(v_actor,p_patient_id,v_request);
END;
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_vitals_submission(p_patient_id uuid,p_request_id uuid,p_vitals_id uuid,p_symptoms_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid; v_snapshot jsonb;
BEGIN
  v_actor:=public.lock_vitals_submission_scope(p_patient_id);
  v_snapshot:=public.vitals_submission_snapshot(v_actor,p_patient_id,p_request_id);
  IF v_snapshot IS NULL OR p_vitals_id IS NULL OR p_symptoms_id IS NULL
    OR (v_snapshot->>'vitals_id')::uuid IS DISTINCT FROM p_vitals_id OR (v_snapshot->>'symptoms_id')::uuid IS DISTINCT FROM p_symptoms_id
    OR v_snapshot->>'submission_status'='cancelled' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Vitals receipt does not match'; END IF;
  IF v_snapshot->>'submission_status'='acknowledged' THEN RETURN v_snapshot; END IF;
  PERFORM public.guard_individual_vitals_mode(v_actor,p_patient_id,p_request_id);
  UPDATE public.vitals_submission_attempts SET closed_status='acknowledged',closed_at=clock_timestamp()
    WHERE request_id=p_request_id AND actor_id=v_actor AND patient_id=p_patient_id AND closed_at IS NULL;
  RETURN public.vitals_submission_snapshot(v_actor,p_patient_id,p_request_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.cancel_vitals_submission(p_patient_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid; v_snapshot jsonb;
BEGIN
  v_actor:=public.lock_vitals_submission_scope(p_patient_id);
  v_snapshot:=public.vitals_submission_snapshot(v_actor,p_patient_id,p_request_id);
  IF v_snapshot IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid vitals submission'; END IF;
  IF v_snapshot->>'submission_status' IN ('cancelled','acknowledged') THEN RETURN v_snapshot; END IF;
  PERFORM public.guard_individual_vitals_mode(v_actor,p_patient_id,p_request_id);
  IF v_snapshot->>'submission_status'='prepared' THEN
    UPDATE public.vitals_submission_attempts SET closed_status='cancelled',closed_at=clock_timestamp()
      WHERE request_id=p_request_id AND actor_id=v_actor AND patient_id=p_patient_id AND closed_at IS NULL;
  END IF;
  RETURN public.vitals_submission_snapshot(v_actor,p_patient_id,p_request_id);
END;
$$;

CREATE FUNCTION public.vitals_batch_snapshot(p_actor uuid,p_patient uuid,p_batch uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
  SELECT jsonb_build_object('mode','batch','batch_id',batch.batch_id,'submission_status',COALESCE(batch.closed_status,
    CASE WHEN batch.captured_at IS NULL THEN 'prepared' ELSE 'committed' END),'captured_at',batch.captured_at,
    'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('row_index',mapping.row_index,
      'receipt',public.vitals_submission_snapshot(p_actor,p_patient,mapping.request_id)) ORDER BY mapping.row_index)
      FROM public.vitals_submission_batch_rows AS mapping WHERE mapping.batch_id=batch.batch_id),'[]'::jsonb))
    FROM public.vitals_submission_batches AS batch WHERE batch.batch_id=p_batch AND batch.actor_id=p_actor AND batch.patient_id=p_patient
$$;
REVOKE ALL ON FUNCTION public.vitals_batch_snapshot(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.lock_vitals_batch_scope(p_patient uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor:=public.lock_vitals_submission_scope(p_patient);
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_actor AND role='provider') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Batch operation not authorized';
  END IF;
  RETURN v_actor;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_vitals_batch_scope(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_vitals_submission(p_patient_id uuid,p_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid; v_request uuid:=p_request_id; v_batch uuid;
BEGIN
  v_actor:=public.lock_vitals_submission_scope(p_patient_id);
  IF v_request IS NULL THEN
    SELECT batch_id INTO v_batch FROM public.vitals_submission_batches WHERE actor_id=v_actor AND patient_id=p_patient_id AND closed_at IS NULL;
    IF FOUND THEN RETURN public.vitals_batch_snapshot(v_actor,p_patient_id,v_batch); END IF;
    SELECT request_id INTO v_request FROM public.vitals_submission_attempts WHERE actor_id=v_actor AND patient_id=p_patient_id AND closed_at IS NULL;
  END IF;
  RETURN public.vitals_submission_snapshot(v_actor,p_patient_id,v_request);
END;
$$;

-- Both screens can discover the other active mode without treating it as empty.
CREATE FUNCTION public.get_active_vitals_capture(p_patient_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid; v_request uuid; v_batch uuid;
BEGIN
  v_actor:=public.lock_vitals_submission_scope(p_patient_id);
  SELECT batch_id INTO v_batch FROM public.vitals_submission_batches WHERE actor_id=v_actor AND patient_id=p_patient_id AND closed_at IS NULL;
  IF FOUND THEN RETURN public.vitals_batch_snapshot(v_actor,p_patient_id,v_batch); END IF;
  SELECT request_id INTO v_request FROM public.vitals_submission_attempts WHERE actor_id=v_actor AND patient_id=p_patient_id AND closed_at IS NULL;
  IF FOUND THEN RETURN jsonb_build_object('mode','individual','receipt',public.vitals_submission_snapshot(v_actor,p_patient_id,v_request)); END IF;
  RETURN NULL;
END;
$$;
CREATE FUNCTION public.prepare_vitals_batch(p_patient_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid; v_batch uuid;
BEGIN
  v_actor:=public.lock_vitals_batch_scope(p_patient_id);
  IF EXISTS(SELECT 1 FROM public.vitals_submission_attempts WHERE actor_id=v_actor AND patient_id=p_patient_id AND closed_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover the individual entry before continuing the batch';
  END IF;
  SELECT batch_id INTO v_batch FROM public.vitals_submission_batches WHERE actor_id=v_actor AND patient_id=p_patient_id AND closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN INSERT INTO public.vitals_submission_batches(actor_id,patient_id) VALUES(v_actor,p_patient_id) RETURNING batch_id INTO v_batch; END IF;
  RETURN public.vitals_batch_snapshot(v_actor,p_patient_id,v_batch);
END;
$$;
CREATE FUNCTION public.get_vitals_batch(p_patient_id uuid,p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid;
BEGIN v_actor:=public.lock_vitals_batch_scope(p_patient_id); RETURN public.vitals_batch_snapshot(v_actor,p_patient_id,p_batch_id); END;
$$;

CREATE FUNCTION public.submit_vitals_batch(p_patient_id uuid,p_batch_id uuid,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid; v_batch public.vitals_submission_batches%ROWTYPE; v_clock timestamptz; v_base jsonb;
  v_history jsonb; v_row jsonb; v_rows jsonb:='[]'; v_request uuid; v_result jsonb; v_recorded timestamptz;
BEGIN
  v_actor:=public.lock_vitals_batch_scope(p_patient_id);
  SELECT * INTO v_batch FROM public.vitals_submission_batches WHERE batch_id=p_batch_id AND actor_id=v_actor AND patient_id=p_patient_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Batch is not prepared'; END IF;
  IF v_batch.closed_status='cancelled' THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Batch is closed'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)<>7 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid batch rows';
  END IF;
  -- Normalize and validate the entire submitted set BEFORE any observation insert.
  FOR i IN 0..6 LOOP
    v_row:=p_rows->i;
    IF v_row='null'::jsonb THEN v_rows:=v_rows||jsonb_build_array(NULL); CONTINUE; END IF;
    IF jsonb_typeof(v_row)<>'object' OR (v_row-ARRAY['weight','weight_unit','sbp','dbp','heart_rate','spo2','dyspnea','recorded_at'])<>'{}'::jsonb
      OR NOT COALESCE(jsonb_typeof(v_row->'weight')='number' AND (v_row->>'weight')::numeric BETWEEN 50 AND 700,false)
      OR NOT COALESCE(v_row->>'weight_unit' IN ('lbs','kg'),false)
      OR NOT COALESCE((v_row->>'sbp') ~ '^[0-9]+$' AND (v_row->>'sbp')::numeric BETWEEN 60 AND 260,false)
      OR NOT COALESCE((v_row->>'dbp') ~ '^[0-9]+$' AND (v_row->>'dbp')::numeric BETWEEN 30 AND 160,false)
      OR NOT COALESCE((v_row->>'heart_rate') ~ '^[0-9]+$' AND (v_row->>'heart_rate')::numeric BETWEEN 30 AND 220,false)
      OR NOT COALESCE((v_row->>'dyspnea') ~ '^[0-3]$',false)
      OR (v_row->>'spo2' IS NOT NULL AND NOT COALESCE((v_row->>'spo2') ~ '^[0-9]+$' AND (v_row->>'spo2')::numeric BETWEEN 50 AND 100,false))
      OR v_row->>'recorded_at' IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid batch row'; END IF;
    v_recorded:=(v_row->>'recorded_at')::timestamptz;
    IF NOT isfinite(v_recorded) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid batch date'; END IF;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('weight',(v_row->>'weight')::numeric,
      'weight_unit',v_row->>'weight_unit','sbp',(v_row->>'sbp')::integer,'dbp',(v_row->>'dbp')::integer,
      'heart_rate',(v_row->>'heart_rate')::integer,'spo2',(v_row->>'spo2')::integer,
      'dyspnea',(v_row->>'dyspnea')::integer,'recorded_at',v_recorded));
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) AS entry WHERE entry<>'null'::jsonb) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Batch needs at least one row';
  END IF;
  IF v_batch.captured_at IS NOT NULL THEN
    IF v_batch.input IS DISTINCT FROM v_rows THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Batch payload differs'; END IF;
    RETURN public.vitals_batch_snapshot(v_actor,p_patient_id,p_batch_id);
  END IF;
  IF EXISTS(SELECT 1 FROM public.vitals_submission_attempts WHERE actor_id=v_actor AND patient_id=p_patient_id AND closed_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover the individual entry before continuing the batch';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('heartland:vitals-capture:patient:'||p_patient_id::text,0));
  v_clock:=clock_timestamp();
  SELECT COALESCE(jsonb_agg(to_jsonb(prior) ORDER BY prior.recorded_at DESC,prior.id DESC),'[]'::jsonb) INTO v_base FROM (
    SELECT id,recorded_at,weight_lbs FROM public.vitals WHERE patient_id=p_patient_id AND recorded_at>=v_clock-interval '336 hours'
      ORDER BY recorded_at DESC,id DESC LIMIT 1001) AS prior;
  IF jsonb_array_length(v_base)>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Vitals capture history limit exceeded'; END IF;
  v_history:=v_base;
  FOR i IN 0..6 LOOP
    v_row:=v_rows->i;
    IF v_row='null'::jsonb THEN CONTINUE; END IF;
    INSERT INTO public.vitals_submission_attempts(actor_id,patient_id) VALUES(v_actor,p_patient_id) RETURNING request_id INTO v_request;
    INSERT INTO public.vitals_submission_batch_rows(batch_id,row_index,request_id,history) VALUES(p_batch_id,i,v_request,v_history);
    v_result:=public.capture_vitals_submission_kernel(p_patient_id,v_request,(v_row->>'weight')::numeric,v_row->>'weight_unit',
      (v_row->>'sbp')::integer,(v_row->>'dbp')::integer,(v_row->>'heart_rate')::integer,(v_row->>'spo2')::integer,
      (v_row->>'dyspnea')::integer,0,false,0,(v_row->>'recorded_at')::timestamptz,v_clock,v_base);
    UPDATE public.vitals_submission_attempts SET closed_status='batched',closed_at=clock_timestamp() WHERE request_id=v_request;
    v_history:=jsonb_build_array(jsonb_build_object('id',v_result->>'vitals_id',
      'recorded_at',v_result#>>'{observation,vitals,recorded_at}','weight_lbs',v_result#>'{observation,vitals,weight_lbs}'))||v_history;
  END LOOP;
  UPDATE public.vitals_submission_batches SET input=v_rows,captured_at=v_clock WHERE batch_id=p_batch_id;
  RETURN public.vitals_batch_snapshot(v_actor,p_patient_id,p_batch_id);
END;
$$;

CREATE FUNCTION public.acknowledge_vitals_batch(p_patient_id uuid,p_batch_id uuid,p_request_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid; v_batch public.vitals_submission_batches%ROWTYPE; v_expected uuid[]; v_actual uuid[];
BEGIN
  v_actor:=public.lock_vitals_batch_scope(p_patient_id);
  SELECT * INTO v_batch FROM public.vitals_submission_batches WHERE batch_id=p_batch_id AND actor_id=v_actor AND patient_id=p_patient_id FOR UPDATE;
  IF NOT FOUND OR v_batch.captured_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Batch receipt does not match'; END IF;
  SELECT array_agg(request_id ORDER BY request_id) INTO v_expected FROM public.vitals_submission_batch_rows WHERE batch_id=p_batch_id;
  SELECT array_agg(id ORDER BY id) INTO v_actual FROM unnest(p_request_ids) AS id;
  IF v_expected IS NULL OR v_expected IS DISTINCT FROM v_actual THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Batch receipt does not match'; END IF;
  UPDATE public.vitals_submission_batches SET closed_status='acknowledged',closed_at=clock_timestamp() WHERE batch_id=p_batch_id AND closed_at IS NULL;
  RETURN public.vitals_batch_snapshot(v_actor,p_patient_id,p_batch_id);
END;
$$;
CREATE FUNCTION public.cancel_vitals_batch(p_patient_id uuid,p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid; v_batch public.vitals_submission_batches%ROWTYPE;
BEGIN
  v_actor:=public.lock_vitals_batch_scope(p_patient_id);
  SELECT * INTO v_batch FROM public.vitals_submission_batches WHERE batch_id=p_batch_id AND actor_id=v_actor AND patient_id=p_patient_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid batch'; END IF;
  IF v_batch.captured_at IS NULL AND v_batch.closed_at IS NULL THEN
    UPDATE public.vitals_submission_batches SET closed_status='cancelled',closed_at=clock_timestamp() WHERE batch_id=p_batch_id;
  END IF;
  RETURN public.vitals_batch_snapshot(v_actor,p_patient_id,p_batch_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_active_vitals_capture(uuid),public.prepare_vitals_batch(uuid),public.get_vitals_batch(uuid,uuid),
  public.submit_vitals_batch(uuid,uuid,jsonb),public.acknowledge_vitals_batch(uuid,uuid,uuid[]),public.cancel_vitals_batch(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_active_vitals_capture(uuid),public.prepare_vitals_batch(uuid),public.get_vitals_batch(uuid,uuid),
  public.submit_vitals_batch(uuid,uuid,jsonb),public.acknowledge_vitals_batch(uuid,uuid,uuid[]),public.cancel_vitals_batch(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_pending_vitals_submissions(p_patient_id uuid,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid; v_total integer; v_rows jsonb;
BEGIN
  v_actor:=public.lock_vitals_submission_scope(p_patient_id);
  IF p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid pending page'; END IF;
  SELECT count(*) INTO v_total FROM public.vitals_submission_attempts AS attempt
    JOIN public.vitals_submission_evaluations AS evaluation USING(request_id)
    LEFT JOIN public.vitals_submission_batch_rows AS mapping USING(request_id)
    LEFT JOIN public.vitals_submission_batches AS batch USING(batch_id)
    WHERE attempt.actor_id=v_actor AND attempt.patient_id=p_patient_id AND evaluation.status<>'complete'
      AND (attempt.closed_status='acknowledged' OR (attempt.closed_status='batched' AND batch.closed_status='acknowledged'));
  SELECT COALESCE(jsonb_agg(public.vitals_submission_snapshot(v_actor,p_patient_id,pending.request_id)
    ORDER BY pending.created_at,pending.request_id),'[]'::jsonb) INTO v_rows FROM (
      SELECT attempt.request_id,attempt.created_at FROM public.vitals_submission_attempts AS attempt
      JOIN public.vitals_submission_evaluations AS evaluation USING(request_id)
      LEFT JOIN public.vitals_submission_batch_rows AS mapping USING(request_id)
      LEFT JOIN public.vitals_submission_batches AS batch USING(batch_id)
      WHERE attempt.actor_id=v_actor AND attempt.patient_id=p_patient_id AND evaluation.status<>'complete'
        AND (attempt.closed_status='acknowledged' OR (attempt.closed_status='batched' AND batch.closed_status='acknowledged'))
      ORDER BY attempt.created_at,attempt.request_id LIMIT 20 OFFSET p_offset) AS pending;
  RETURN jsonb_build_object('total',v_total,'receipts',v_rows);
END;
$$;

ALTER TABLE public.lab_provenance_erasures
  ADD COLUMN vitals_batches_deleted integer CHECK(vitals_batches_deleted IS NULL OR vitals_batches_deleted>=0),
  ADD COLUMN vitals_batch_rows_deleted integer CHECK(vitals_batch_rows_deleted IS NULL OR vitals_batch_rows_deleted>=0);
CREATE OR REPLACE FUNCTION public.purge_expired_tester_provenance(p_actor_id uuid)
RETURNS TABLE(receipts_deleted int,attempts_deleted int,evaluations_detached int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text; v_expires_at timestamptz; v_receipts int; v_attempts int; v_evaluations int;
  v_vitals_receipts int; v_vitals_attempts int; v_batches int; v_rows int; v_erasure_id uuid;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' OR (SELECT auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory erasure not authorized';
  END IF;
  SELECT role,sandbox_expires_at INTO v_role,v_expires_at FROM public.profiles WHERE id=p_actor_id FOR UPDATE;
  IF v_role IS DISTINCT FROM 'tester' OR v_expires_at IS NULL OR v_expires_at>pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory erasure is limited to expired tester accounts';
  END IF;
  INSERT INTO public.lab_provenance_erasures(actor_id,xact_id) VALUES(p_actor_id,pg_catalog.pg_current_xact_id()) RETURNING id INTO v_erasure_id;
  DELETE FROM public.vitals_submission_batch_rows AS mapping USING public.vitals_submission_batches AS batch
    WHERE mapping.batch_id=batch.batch_id AND (batch.actor_id=p_actor_id OR batch.patient_id=p_actor_id);
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  DELETE FROM public.vitals_submission_batches WHERE actor_id=p_actor_id OR patient_id=p_actor_id;
  GET DIAGNOSTICS v_batches=ROW_COUNT;
  DELETE FROM public.vitals_submission_receipts AS receipt USING public.vitals_submission_attempts AS attempt
    WHERE receipt.request_id=attempt.request_id AND (attempt.actor_id=p_actor_id OR attempt.patient_id=p_actor_id);
  GET DIAGNOSTICS v_vitals_receipts=ROW_COUNT;
  DELETE FROM public.vitals_submission_attempts WHERE actor_id=p_actor_id OR patient_id=p_actor_id;
  GET DIAGNOSTICS v_vitals_attempts=ROW_COUNT;
  DELETE FROM public.lab_submission_attempts WHERE actor_id=p_actor_id;
  GET DIAGNOSTICS v_attempts=ROW_COUNT;
  DELETE FROM public.lab_submission_receipts WHERE actor_id=p_actor_id;
  GET DIAGNOSTICS v_receipts=ROW_COUNT;
  UPDATE public.lab_alert_evaluations SET recorded_by=NULL WHERE recorded_by=p_actor_id;
  GET DIAGNOSTICS v_evaluations=ROW_COUNT;
  UPDATE public.lab_provenance_erasures SET receipts_deleted=v_receipts,attempts_deleted=v_attempts,evaluations_detached=v_evaluations,
    vitals_receipts_deleted=v_vitals_receipts,vitals_attempts_deleted=v_vitals_attempts,vitals_batches_deleted=v_batches,vitals_batch_rows_deleted=v_rows
    WHERE id=v_erasure_id;
  RETURN QUERY SELECT v_receipts,v_attempts,v_evaluations;
END;
$$;
