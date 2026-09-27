-- Atomic observation capture and durable client receipt recovery, not alert evaluation.
-- No legacy writer cutover, clinical threshold change, backfill or notification transport.

CREATE TABLE public.vitals_submission_attempts (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  closed_status text CHECK (closed_status IN ('acknowledged', 'cancelled')),
  closed_at timestamptz CHECK (closed_at IS NULL OR isfinite(closed_at)),
  CHECK ((closed_status IS NULL) = (closed_at IS NULL))
);
CREATE UNIQUE INDEX vitals_submission_one_active
  ON public.vitals_submission_attempts(actor_id, patient_id) WHERE closed_at IS NULL;
CREATE INDEX vitals_submission_patient_idx ON public.vitals_submission_attempts(patient_id);

CREATE TABLE public.vitals_submission_receipts (
  request_id uuid PRIMARY KEY REFERENCES public.vitals_submission_attempts(request_id) ON DELETE RESTRICT,
  vitals_id uuid NOT NULL UNIQUE REFERENCES public.vitals(id) ON DELETE RESTRICT,
  symptoms_id uuid NOT NULL UNIQUE REFERENCES public.symptoms(id) ON DELETE RESTRICT,
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  observation jsonb NOT NULL CHECK (jsonb_typeof(observation) = 'object'),
  captured_at timestamptz NOT NULL CHECK (isfinite(captured_at)),
  context_version smallint NOT NULL DEFAULT 1 CHECK (context_version = 1),
  history jsonb NOT NULL CHECK (jsonb_typeof(history) = 'array' AND jsonb_array_length(history) <= 1000)
);
ALTER TABLE public.vitals_submission_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vitals_submission_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vitals_submission_attempts, public.vitals_submission_receipts
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.vitals_submission_attempts, public.vitals_submission_receipts
  TO authenticated, service_role;

-- Explicit real profile checks avoid get_user_role's historical missing-profile default.
CREATE FUNCTION public.can_access_vitals_submission(p_patient_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.role()) = 'authenticated' AND (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.patients AS patient
      JOIN public.profiles AS target ON target.id = patient.id
      WHERE patient.id = p_patient_id AND target.role = 'patient')
    AND EXISTS (SELECT 1 FROM public.profiles AS actor WHERE actor.id = (SELECT auth.uid())
      AND ((actor.role = 'patient' AND actor.id = p_patient_id AND public.has_registration_consent())
        OR (actor.role = 'provider' AND public.provider_has_patient(p_patient_id))))
$$;
REVOKE ALL ON FUNCTION public.can_access_vitals_submission(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_vitals_submission(uuid) TO authenticated;

CREATE POLICY vitals_attempt_actor_read ON public.vitals_submission_attempts
  FOR SELECT TO authenticated USING (actor_id = (SELECT auth.uid()) AND public.can_access_vitals_submission(patient_id));
CREATE POLICY vitals_receipt_actor_read ON public.vitals_submission_receipts
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.vitals_submission_attempts AS attempt
    WHERE attempt.request_id = vitals_submission_receipts.request_id
      AND attempt.actor_id = (SELECT auth.uid()) AND public.can_access_vitals_submission(attempt.patient_id)));

-- All callers first take this actor scope. Profile/consent/link locks keep revocation
-- from committing between authorization and capture. Target profile locks also fence
-- an expired tester's erasure. No clinical patient/alert lock is acquired by this helper.
CREATE FUNCTION public.lock_vitals_submission_scope(p_patient_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE v_actor uuid := (SELECT auth.uid());
BEGIN
  IF NOT COALESCE(public.can_access_vitals_submission(p_patient_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Vitals operation not authorized';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'heartland:vitals-submission:' || v_actor::text || ':' || p_patient_id::text, 0));
  PERFORM profile.id FROM public.profiles AS profile
    WHERE profile.id IN (v_actor, p_patient_id) ORDER BY profile.id FOR SHARE;
  PERFORM 1 FROM public.consents AS consent WHERE consent.user_id = v_actor
    AND consent.consent_type = 'registration' AND consent.consent_version = 'v1.0'
    AND consent.accepted = true FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Vitals operation not authorized';
  END IF;
  PERFORM 1 FROM public.patients AS patient WHERE patient.id = p_patient_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Vitals operation not authorized';
  END IF;
  IF v_actor <> p_patient_id THEN
    PERFORM 1 FROM public.provider_patient_links AS link
      WHERE link.provider_id = v_actor AND link.patient_id = p_patient_id AND link.status = 'active' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Vitals operation not authorized';
    END IF;
  END IF;
  IF NOT COALESCE(public.can_access_vitals_submission(p_patient_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Vitals operation not authorized';
  END IF;
  RETURN v_actor;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_vitals_submission_scope(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.vitals_submission_snapshot(p_actor uuid, p_patient_id uuid, p_request_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $$
  SELECT jsonb_build_object(
    'request_id', attempt.request_id,
    'submission_status', COALESCE(attempt.closed_status, CASE WHEN receipt.request_id IS NULL THEN 'prepared' ELSE 'committed' END),
    'vitals_id', receipt.vitals_id, 'symptoms_id', receipt.symptoms_id,
    'evaluation_status', CASE WHEN receipt.request_id IS NOT NULL THEN 'pending' END,
    'observation', receipt.observation, 'captured_at', receipt.captured_at)
  FROM public.vitals_submission_attempts AS attempt
  LEFT JOIN public.vitals_submission_receipts AS receipt USING (request_id)
  WHERE attempt.actor_id = p_actor AND attempt.patient_id = p_patient_id AND attempt.request_id = p_request_id
$$;
REVOKE ALL ON FUNCTION public.vitals_submission_snapshot(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.enforce_vitals_submission_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.lab_provenance_erasure_active(OLD.actor_id) OR public.lab_provenance_erasure_active(OLD.patient_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Vitals submission history is immutable';
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Vitals submission history is immutable';
  END IF;
  IF (SELECT auth.uid()) IS DISTINCT FROM OLD.actor_id
    OR NOT COALESCE(public.can_access_vitals_submission(OLD.patient_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Vitals operation not authorized';
  END IF;
  IF NEW.closed_status = 'acknowledged' THEN
    IF NOT EXISTS (SELECT 1 FROM public.vitals_submission_receipts WHERE request_id = OLD.request_id) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Vitals receipt does not match';
    END IF;
  ELSIF NEW.closed_status = 'cancelled' THEN
    IF EXISTS (SELECT 1 FROM public.vitals_submission_receipts WHERE request_id = OLD.request_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Vitals submission is committed';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid vitals submission transition';
  END IF;
  NEW.closed_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_vitals_submission_transition BEFORE UPDATE OR DELETE ON public.vitals_submission_attempts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vitals_submission_transition();
REVOKE ALL ON FUNCTION public.enforce_vitals_submission_transition() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reject_vitals_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.vitals_submission_attempts AS attempt WHERE attempt.request_id = OLD.request_id
      AND (public.lab_provenance_erasure_active(attempt.actor_id) OR public.lab_provenance_erasure_active(attempt.patient_id))
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Vitals receipts are append-only';
END;
$$;
CREATE TRIGGER reject_vitals_receipt_mutation BEFORE UPDATE OR DELETE ON public.vitals_submission_receipts
  FOR EACH ROW EXECUTE FUNCTION public.reject_vitals_receipt_mutation();
REVOKE ALL ON FUNCTION public.reject_vitals_receipt_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.prepare_vitals_submission(p_patient_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE v_actor uuid; v_request uuid;
BEGIN
  v_actor := public.lock_vitals_submission_scope(p_patient_id);
  SELECT attempt.request_id INTO v_request FROM public.vitals_submission_attempts AS attempt
    WHERE attempt.actor_id = v_actor AND attempt.patient_id = p_patient_id AND attempt.closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.vitals_submission_attempts(actor_id, patient_id) VALUES (v_actor, p_patient_id)
      RETURNING request_id INTO v_request;
  END IF;
  RETURN public.vitals_submission_snapshot(v_actor, p_patient_id, v_request);
END;
$$;

CREATE FUNCTION public.get_vitals_submission(p_patient_id uuid, p_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE v_actor uuid; v_request uuid := p_request_id;
BEGIN
  v_actor := public.lock_vitals_submission_scope(p_patient_id);
  IF v_request IS NULL THEN
    SELECT attempt.request_id INTO v_request FROM public.vitals_submission_attempts AS attempt
      WHERE attempt.actor_id = v_actor AND attempt.patient_id = p_patient_id AND attempt.closed_at IS NULL;
  END IF;
  RETURN public.vitals_submission_snapshot(v_actor, p_patient_id, v_request);
END;
$$;

CREATE FUNCTION public.submit_vitals_submission(p_patient_id uuid, p_request_id uuid,
  p_weight numeric, p_weight_unit text, p_sbp integer, p_dbp integer, p_heart_rate integer, p_spo2 integer,
  p_dyspnea integer, p_edema integer, p_orthopnea boolean, p_fatigue integer, p_recorded_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' SET lock_timeout = '5s' AS $$
DECLARE
  v_actor uuid; v_attempt public.vitals_submission_attempts%ROWTYPE;
  v_input jsonb; v_existing jsonb; v_captured_at timestamptz; v_recorded_at timestamptz;
  v_vitals public.vitals%ROWTYPE; v_symptoms public.symptoms%ROWTYPE; v_history jsonb;
BEGIN
  v_actor := public.lock_vitals_submission_scope(p_patient_id);
  IF p_request_id IS NULL OR p_weight IS NULL OR NOT (p_weight BETWEEN 50 AND 700)
    OR p_weight_unit IS NULL OR p_weight_unit NOT IN ('lbs', 'kg')
    OR p_sbp IS NULL OR p_sbp NOT BETWEEN 60 AND 260
    OR p_dbp IS NULL OR p_dbp NOT BETWEEN 30 AND 160
    OR p_heart_rate IS NULL OR p_heart_rate NOT BETWEEN 30 AND 220
    OR (p_spo2 IS NOT NULL AND p_spo2 NOT BETWEEN 50 AND 100)
    OR p_dyspnea IS NULL OR p_dyspnea NOT BETWEEN 0 AND 3
    OR p_edema IS NULL OR p_edema NOT BETWEEN 0 AND 3
    OR p_orthopnea IS NULL OR p_fatigue IS NULL OR p_fatigue NOT BETWEEN 0 AND 3
    OR (p_recorded_at IS NOT NULL AND (NOT isfinite(p_recorded_at) OR v_actor = p_patient_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid vitals submission';
  END IF;
  -- Numeric epoch makes explicit instants canonical across session time zones.
  -- NULL means a server-chosen instant fixed on first commit, never regenerated on replay.
  v_input := jsonb_build_object('weight', p_weight, 'weight_unit', p_weight_unit,
    'sbp', p_sbp, 'dbp', p_dbp, 'heart_rate', p_heart_rate, 'spo2', p_spo2,
    'dyspnea', p_dyspnea, 'edema', p_edema, 'orthopnea', p_orthopnea, 'fatigue', p_fatigue,
    'recorded_at_epoch', extract(epoch FROM p_recorded_at));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'heartland:vitals-capture:patient:' || p_patient_id::text, 0));
  SELECT attempt.* INTO v_attempt FROM public.vitals_submission_attempts AS attempt
    WHERE attempt.request_id = p_request_id AND attempt.actor_id = v_actor AND attempt.patient_id = p_patient_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Vitals submission is not prepared';
  END IF;
  IF v_attempt.closed_status = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Vitals submission is closed';
  END IF;
  SELECT receipt.input INTO v_existing FROM public.vitals_submission_receipts AS receipt WHERE receipt.request_id = p_request_id;
  IF FOUND THEN
    IF v_existing IS DISTINCT FROM v_input THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Vitals submission payload differs';
    END IF;
    RETURN public.vitals_submission_snapshot(v_actor, p_patient_id, p_request_id);
  END IF;
  IF v_attempt.closed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Vitals submission is closed';
  END IF;

  v_captured_at := clock_timestamp();
  v_recorded_at := COALESCE(p_recorded_at, v_captured_at);
  INSERT INTO public.vitals(patient_id, recorded_at, weight_lbs, sbp, dbp, heart_rate, spo2, source)
    VALUES (p_patient_id, v_recorded_at,
      CASE WHEN p_weight_unit = 'kg' THEN round(p_weight * 2.20462, 1) ELSE p_weight END,
      p_sbp, p_dbp, p_heart_rate, p_spo2, CASE WHEN v_actor = p_patient_id THEN 'patient_app' ELSE 'provider_entry' END)
    RETURNING * INTO v_vitals;
  INSERT INTO public.symptoms(patient_id, recorded_at, dyspnea, edema, orthopnea, fatigue, red_flag)
    VALUES (p_patient_id, v_recorded_at, p_dyspnea, p_edema, p_orthopnea, p_fatigue, NULL)
    RETURNING * INTO v_symptoms;
  -- Raw prior inputs, not a claim that the clinical engine has run. LIMIT 1001
  -- detects overflow without silently dropping rows from an accepted snapshot.
  SELECT COALESCE(jsonb_agg(to_jsonb(prior) ORDER BY prior.recorded_at DESC, prior.id DESC), '[]'::jsonb)
    INTO v_history FROM (
      SELECT id, recorded_at, weight_lbs FROM public.vitals
      WHERE patient_id = p_patient_id AND id <> v_vitals.id
        AND recorded_at >= v_captured_at - interval '336 hours'
      ORDER BY recorded_at DESC, id DESC LIMIT 1001
    ) AS prior;
  IF jsonb_array_length(v_history) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'Vitals capture history limit exceeded';
  END IF;
  INSERT INTO public.vitals_submission_receipts(request_id, vitals_id, symptoms_id, input, observation, captured_at, history)
    VALUES (p_request_id, v_vitals.id, v_symptoms.id, v_input,
      jsonb_build_object('vitals', to_jsonb(v_vitals), 'symptoms', to_jsonb(v_symptoms)), v_captured_at, v_history);
  RETURN public.vitals_submission_snapshot(v_actor, p_patient_id, p_request_id);
END;
$$;

CREATE FUNCTION public.acknowledge_vitals_submission(p_patient_id uuid, p_request_id uuid, p_vitals_id uuid, p_symptoms_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE v_actor uuid; v_snapshot jsonb;
BEGIN
  v_actor := public.lock_vitals_submission_scope(p_patient_id);
  v_snapshot := public.vitals_submission_snapshot(v_actor, p_patient_id, p_request_id);
  IF v_snapshot IS NULL OR p_vitals_id IS NULL OR p_symptoms_id IS NULL
    OR (v_snapshot->>'vitals_id')::uuid IS DISTINCT FROM p_vitals_id
    OR (v_snapshot->>'symptoms_id')::uuid IS DISTINCT FROM p_symptoms_id
    OR v_snapshot->>'submission_status' = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Vitals receipt does not match';
  END IF;
  UPDATE public.vitals_submission_attempts SET closed_status = 'acknowledged', closed_at = clock_timestamp()
    WHERE request_id = p_request_id AND actor_id = v_actor AND patient_id = p_patient_id AND closed_at IS NULL;
  RETURN public.vitals_submission_snapshot(v_actor, p_patient_id, p_request_id);
END;
$$;

CREATE FUNCTION public.cancel_vitals_submission(p_patient_id uuid, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE v_actor uuid; v_snapshot jsonb;
BEGIN
  v_actor := public.lock_vitals_submission_scope(p_patient_id);
  v_snapshot := public.vitals_submission_snapshot(v_actor, p_patient_id, p_request_id);
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid vitals submission';
  END IF;
  IF v_snapshot->>'submission_status' = 'prepared' THEN
    UPDATE public.vitals_submission_attempts SET closed_status = 'cancelled', closed_at = clock_timestamp()
      WHERE request_id = p_request_id AND actor_id = v_actor AND patient_id = p_patient_id AND closed_at IS NULL;
  END IF;
  RETURN public.vitals_submission_snapshot(v_actor, p_patient_id, p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_vitals_submission(uuid), public.get_vitals_submission(uuid, uuid),
  public.submit_vitals_submission(uuid, uuid, numeric, text, integer, integer, integer, integer, integer, integer, boolean, integer, timestamptz),
  public.acknowledge_vitals_submission(uuid, uuid, uuid, uuid), public.cancel_vitals_submission(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_vitals_submission(uuid), public.get_vitals_submission(uuid, uuid),
  public.submit_vitals_submission(uuid, uuid, numeric, text, integer, integer, integer, integer, integer, integer, boolean, integer, timestamptz),
  public.acknowledge_vitals_submission(uuid, uuid, uuid, uuid), public.cancel_vitals_submission(uuid, uuid)
  TO authenticated;

-- Preserve the existing cleanup caller/return signature and laboratory counters.
-- These separate audit columns expose the new erasure scope without pretending it is a lab.
ALTER TABLE public.lab_provenance_erasures
  ADD COLUMN vitals_receipts_deleted integer CHECK (vitals_receipts_deleted IS NULL OR vitals_receipts_deleted >= 0),
  ADD COLUMN vitals_attempts_deleted integer CHECK (vitals_attempts_deleted IS NULL OR vitals_attempts_deleted >= 0);

CREATE OR REPLACE FUNCTION public.purge_expired_tester_provenance(p_actor_id uuid)
RETURNS TABLE (receipts_deleted int, attempts_deleted int, evaluations_detached int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text; v_expires_at timestamptz; v_receipts int; v_attempts int; v_evaluations int;
  v_vitals_receipts int; v_vitals_attempts int; v_erasure_id uuid;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' OR (SELECT auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Laboratory erasure not authorized';
  END IF;
  SELECT profile.role, profile.sandbox_expires_at INTO v_role, v_expires_at
    FROM public.profiles AS profile WHERE profile.id = p_actor_id FOR UPDATE;
  IF v_role IS DISTINCT FROM 'tester' OR v_expires_at IS NULL OR v_expires_at > pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Laboratory erasure is limited to expired tester accounts';
  END IF;
  INSERT INTO public.lab_provenance_erasures(actor_id, xact_id) VALUES (p_actor_id, pg_catalog.pg_current_xact_id())
    RETURNING id INTO v_erasure_id;
  DELETE FROM public.vitals_submission_receipts AS receipt USING public.vitals_submission_attempts AS attempt
    WHERE receipt.request_id = attempt.request_id AND (attempt.actor_id = p_actor_id OR attempt.patient_id = p_actor_id);
  GET DIAGNOSTICS v_vitals_receipts = ROW_COUNT;
  DELETE FROM public.vitals_submission_attempts WHERE actor_id = p_actor_id OR patient_id = p_actor_id;
  GET DIAGNOSTICS v_vitals_attempts = ROW_COUNT;

  DELETE FROM public.lab_submission_attempts AS attempt WHERE attempt.actor_id = p_actor_id;
  GET DIAGNOSTICS v_attempts = ROW_COUNT;
  DELETE FROM public.lab_submission_receipts AS receipt WHERE receipt.actor_id = p_actor_id;
  GET DIAGNOSTICS v_receipts = ROW_COUNT;
  UPDATE public.lab_alert_evaluations AS evaluation SET recorded_by = NULL WHERE evaluation.recorded_by = p_actor_id;
  GET DIAGNOSTICS v_evaluations = ROW_COUNT;
  UPDATE public.lab_provenance_erasures AS erasure
    SET receipts_deleted = v_receipts, attempts_deleted = v_attempts, evaluations_detached = v_evaluations,
      vitals_receipts_deleted = v_vitals_receipts, vitals_attempts_deleted = v_vitals_attempts
    WHERE erasure.id = v_erasure_id;
  RETURN QUERY SELECT v_receipts, v_attempts, v_evaluations;
END;
$$;

COMMENT ON TABLE public.vitals_submission_attempts IS
  'Actor-scoped durable capture identity. Acknowledgement means client receipt only; not clinical review or communication.';
COMMENT ON TABLE public.vitals_submission_receipts IS
  'Immutable atomic vitals/symptoms capture with pending evaluation and frozen raw inputs. No alert evaluation or delivery evidence.';
COMMENT ON FUNCTION public.purge_expired_tester_provenance(uuid) IS
  'Audited expired-tester erasure: original lab actor provenance plus vitals actor/target-patient provenance. Three lab result counters retained; vitals counts are separate audit columns.';
