-- Durable submission recovery, independent from alert processing and clinical review.
-- No browser-persisted clinical payload, no historical acknowledgement/backfill.

CREATE TABLE public.lab_submission_attempts (
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  closed_status text CHECK (closed_status IN ('acknowledged', 'cancelled')),
  closed_at timestamptz CHECK (closed_at IS NULL OR isfinite(closed_at)),
  acknowledged_lab_result_id uuid REFERENCES public.lab_results(id) ON DELETE RESTRICT,
  PRIMARY KEY (actor_id, patient_id, request_id),
  CHECK ((closed_status IS NULL) = (closed_at IS NULL)),
  CHECK ((closed_status IS NOT DISTINCT FROM 'acknowledged') = (acknowledged_lab_result_id IS NOT NULL))
);
CREATE UNIQUE INDEX lab_submission_attempts_one_active ON public.lab_submission_attempts (actor_id, patient_id)
  WHERE closed_at IS NULL;
ALTER TABLE public.lab_submission_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "providers_read_own_lab_attempts" ON public.lab_submission_attempts
  FOR SELECT TO authenticated USING (actor_id = (SELECT auth.uid()) AND public.provider_has_patient(patient_id));
REVOKE ALL ON public.lab_submission_attempts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lab_submission_attempts TO authenticated, service_role;

CREATE FUNCTION public.enforce_lab_submission_attempt_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Laboratory submission history is immutable'; END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
    OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Laboratory submission history is immutable';
  END IF;
  IF (SELECT auth.uid()) IS DISTINCT FROM OLD.actor_id
    OR NOT COALESCE(public.provider_has_patient(OLD.patient_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Laboratory operation not authorized';
  END IF;
  IF NEW.closed_status = 'acknowledged' THEN
    IF NOT EXISTS (SELECT 1 FROM public.lab_submission_receipts AS receipt
      WHERE receipt.actor_id = OLD.actor_id AND receipt.patient_id = OLD.patient_id
        AND receipt.request_id = OLD.request_id AND receipt.lab_result_id = NEW.acknowledged_lab_result_id) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Laboratory receipt does not match';
    END IF;
  ELSIF NEW.closed_status = 'cancelled' THEN
    IF EXISTS (SELECT 1 FROM public.lab_submission_receipts AS receipt
      WHERE receipt.actor_id = OLD.actor_id AND receipt.patient_id = OLD.patient_id AND receipt.request_id = OLD.request_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Laboratory submission is committed';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid laboratory submission transition';
  END IF;
  NEW.closed_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_lab_submission_attempt_transition BEFORE UPDATE OR DELETE ON public.lab_submission_attempts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_lab_submission_attempt_transition();
REVOKE ALL ON FUNCTION public.enforce_lab_submission_attempt_transition() FROM PUBLIC, anon, authenticated, service_role;

-- One lock order for every entry point: actor/patient, then the exact 00037 request key.
-- Authentication is checked again after waits; timeout propagates, never becomes an empty result.
CREATE FUNCTION public.lock_lab_submission_scope(p_patient_id uuid, p_request_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := (SELECT auth.uid());
BEGIN
  IF v_actor IS NULL OR (SELECT auth.role()) IS DISTINCT FROM 'authenticated'
    OR NOT COALESCE(public.provider_has_patient(p_patient_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Laboratory operation not authorized';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'heartland:lab-submission:' || v_actor::text || ':' || p_patient_id::text, 0));
  IF p_request_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'heartland:lab-submit:' || v_actor::text || ':' || p_patient_id::text || ':' || p_request_id::text, 0));
  END IF;
  PERFORM 1 FROM public.provider_patient_links AS link
  WHERE link.provider_id = v_actor AND link.patient_id = p_patient_id AND link.status = 'active' FOR SHARE;
  IF NOT FOUND OR NOT COALESCE(public.provider_has_patient(p_patient_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Laboratory operation not authorized';
  END IF;
  RETURN v_actor;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_lab_submission_scope(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Only called after the scoped locks/auth checks. An explicit legacy receipt can
-- be returned without inventing an attempt or treating it as acknowledged.
CREATE FUNCTION public.lab_submission_snapshot(p_actor uuid, p_patient_id uuid, p_request_id uuid, p_is_new boolean DEFAULT false)
RETURNS TABLE (request_id uuid, submission_status text, lab_result_id uuid, event_id uuid, alert_status text,
  collected_at timestamptz, potassium numeric, egfr numeric, creatinine numeric, sodium numeric, notes text, is_new boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_request_id,
    CASE WHEN attempt.closed_status IS NOT NULL THEN attempt.closed_status
      WHEN receipt.lab_result_id IS NOT NULL THEN 'committed' ELSE 'prepared' END,
    receipt.lab_result_id, evaluation.id, evaluation.status, lab.collected_at,
    lab.potassium, lab.egfr::numeric, lab.creatinine, lab.sodium, lab.notes, p_is_new
  FROM (SELECT 1) AS seed
  LEFT JOIN public.lab_submission_attempts AS attempt ON attempt.actor_id = p_actor
    AND attempt.patient_id = p_patient_id AND attempt.request_id = p_request_id
  LEFT JOIN public.lab_submission_receipts AS receipt ON receipt.actor_id = p_actor
    AND receipt.patient_id = p_patient_id AND receipt.request_id = p_request_id
  LEFT JOIN public.lab_results AS lab ON lab.id = receipt.lab_result_id
  LEFT JOIN public.lab_alert_evaluations AS evaluation ON evaluation.lab_result_id = receipt.lab_result_id
  WHERE attempt.request_id IS NOT NULL OR receipt.request_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.lab_submission_snapshot(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.prepare_lab_submission(p_patient_id uuid)
RETURNS TABLE (request_id uuid, submission_status text, lab_result_id uuid, event_id uuid, alert_status text,
  collected_at timestamptz, potassium numeric, egfr numeric, creatinine numeric, sodium numeric, notes text, is_new boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid; v_request uuid; v_is_new boolean := false;
BEGIN
  v_actor := public.lock_lab_submission_scope(p_patient_id);
  SELECT attempt.request_id INTO v_request FROM public.lab_submission_attempts AS attempt
  WHERE attempt.actor_id = v_actor AND attempt.patient_id = p_patient_id AND attempt.closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.lab_submission_attempts(actor_id, patient_id) VALUES (v_actor, p_patient_id)
    RETURNING lab_submission_attempts.request_id INTO v_request;
    v_is_new := true;
  END IF;
  PERFORM public.lock_lab_submission_scope(p_patient_id, v_request);
  RETURN QUERY SELECT * FROM public.lab_submission_snapshot(v_actor, p_patient_id, v_request, v_is_new);
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_lab_submission(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_lab_submission(uuid) TO authenticated;

CREATE FUNCTION public.get_lab_submission(p_patient_id uuid, p_request_id uuid DEFAULT NULL)
RETURNS TABLE (request_id uuid, submission_status text, lab_result_id uuid, event_id uuid, alert_status text,
  collected_at timestamptz, potassium numeric, egfr numeric, creatinine numeric, sodium numeric, notes text, is_new boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid; v_request uuid := p_request_id;
BEGIN
  v_actor := public.lock_lab_submission_scope(p_patient_id, p_request_id);
  IF v_request IS NULL THEN
    SELECT attempt.request_id INTO v_request FROM public.lab_submission_attempts AS attempt
    WHERE attempt.actor_id = v_actor AND attempt.patient_id = p_patient_id AND attempt.closed_at IS NULL;
    IF NOT FOUND THEN RETURN; END IF;
    PERFORM public.lock_lab_submission_scope(p_patient_id, v_request);
  END IF;
  RETURN QUERY SELECT * FROM public.lab_submission_snapshot(v_actor, p_patient_id, v_request);
END;
$$;
REVOKE ALL ON FUNCTION public.get_lab_submission(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_lab_submission(uuid, uuid) TO authenticated;

CREATE FUNCTION public.acknowledge_lab_submission(p_patient_id uuid, p_request_id uuid, p_lab_result_id uuid)
RETURNS TABLE (request_id uuid, submission_status text, lab_result_id uuid, event_id uuid, alert_status text,
  collected_at timestamptz, potassium numeric, egfr numeric, creatinine numeric, sodium numeric, notes text, is_new boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid; v_snapshot record;
BEGIN
  v_actor := public.lock_lab_submission_scope(p_patient_id, p_request_id);
  IF p_request_id IS NULL OR p_lab_result_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid laboratory submission';
  END IF;
  SELECT * INTO v_snapshot FROM public.lab_submission_snapshot(v_actor, p_patient_id, p_request_id);
  IF NOT FOUND OR v_snapshot.lab_result_id IS DISTINCT FROM p_lab_result_id OR v_snapshot.submission_status = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Laboratory receipt does not match';
  END IF;
  IF v_snapshot.submission_status <> 'acknowledged' THEN
    UPDATE public.lab_submission_attempts AS attempt
    SET closed_status = 'acknowledged', closed_at = clock_timestamp(), acknowledged_lab_result_id = p_lab_result_id
    WHERE attempt.actor_id = v_actor AND attempt.patient_id = p_patient_id AND attempt.request_id = p_request_id;
    IF NOT FOUND THEN
      -- Explicit acknowledgement of a known 00037 receipt; no automatic historical import.
      INSERT INTO public.lab_submission_attempts(actor_id, patient_id, request_id, closed_status, closed_at, acknowledged_lab_result_id)
      VALUES (v_actor, p_patient_id, p_request_id, 'acknowledged', clock_timestamp(), p_lab_result_id);
    END IF;
  END IF;
  RETURN QUERY SELECT * FROM public.lab_submission_snapshot(v_actor, p_patient_id, p_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.acknowledge_lab_submission(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.acknowledge_lab_submission(uuid, uuid, uuid) TO authenticated;

CREATE FUNCTION public.cancel_lab_submission(p_patient_id uuid, p_request_id uuid)
RETURNS TABLE (request_id uuid, submission_status text, lab_result_id uuid, event_id uuid, alert_status text,
  collected_at timestamptz, potassium numeric, egfr numeric, creatinine numeric, sodium numeric, notes text, is_new boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid; v_snapshot record;
BEGIN
  v_actor := public.lock_lab_submission_scope(p_patient_id, p_request_id);
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid laboratory submission';
  END IF;
  SELECT * INTO v_snapshot FROM public.lab_submission_snapshot(v_actor, p_patient_id, p_request_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid laboratory submission';
  END IF;
  IF v_snapshot.submission_status = 'prepared' THEN
    UPDATE public.lab_submission_attempts AS attempt SET closed_status = 'cancelled', closed_at = clock_timestamp()
    WHERE attempt.actor_id = v_actor AND attempt.patient_id = p_patient_id AND attempt.request_id = p_request_id;
  END IF;
  -- A committed receipt wins; cancellation never converts an existing exam into absence.
  RETURN QUERY SELECT * FROM public.lab_submission_snapshot(v_actor, p_patient_id, p_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_lab_submission(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_lab_submission(uuid, uuid) TO authenticated;

-- Keep 00037's validated storage/idempotence implementation, but remove its public execution path.
ALTER FUNCTION public.submit_lab_result(uuid, uuid, timestamptz, numeric, numeric, numeric, numeric, text)
  RENAME TO submit_lab_result_v37_internal;
REVOKE ALL ON FUNCTION public.submit_lab_result_v37_internal(uuid, uuid, timestamptz, numeric, numeric, numeric, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.submit_lab_result(p_request_id uuid, p_patient_id uuid, p_collected_at timestamptz,
  p_potassium numeric DEFAULT NULL, p_egfr numeric DEFAULT NULL, p_creatinine numeric DEFAULT NULL,
  p_sodium numeric DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS TABLE (lab_result_id uuid, event_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid; v_attempt public.lab_submission_attempts%ROWTYPE; v_has_receipt boolean;
BEGIN
  v_actor := public.lock_lab_submission_scope(p_patient_id, p_request_id);
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid laboratory submission';
  END IF;
  SELECT attempt.* INTO v_attempt FROM public.lab_submission_attempts AS attempt
  WHERE attempt.actor_id = v_actor AND attempt.patient_id = p_patient_id AND attempt.request_id = p_request_id FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM public.lab_submission_receipts AS receipt
    WHERE receipt.actor_id = v_actor AND receipt.patient_id = p_patient_id AND receipt.request_id = p_request_id) INTO v_has_receipt;
  IF v_attempt.closed_status = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Laboratory submission is closed';
  END IF;
  IF NOT v_has_receipt AND (v_attempt.request_id IS NULL OR v_attempt.closed_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Laboratory submission is not prepared';
  END IF;
  RETURN QUERY SELECT * FROM public.submit_lab_result_v37_internal(p_request_id, p_patient_id, p_collected_at,
    p_potassium, p_egfr, p_creatinine, p_sodium, p_notes);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_lab_result(uuid, uuid, timestamptz, numeric, numeric, numeric, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_lab_result(uuid, uuid, timestamptz, numeric, numeric, numeric, numeric, text)
  TO authenticated;

-- Table-level REVOKE does not remove earlier column-level grants (00025).
-- Trusted service ingestion retains its existing INSERT path and outbox trigger.
REVOKE INSERT ON public.lab_results FROM PUBLIC, anon, authenticated;
REVOKE INSERT (patient_id, collected_at, potassium, creatinine, egfr, bun, bnp, nt_probnp,
  hba1c, glucose, sodium, hemoglobin, ferritin, tsat, ldl, ordered_by, lab_facility, notes)
  ON public.lab_results FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.lab_submission_attempts IS
  'Durable submission identity and explicit receipt acknowledgement, not clinical review. Prepared/committed derive from immutable receipts; cancellation fences late submissions.';
