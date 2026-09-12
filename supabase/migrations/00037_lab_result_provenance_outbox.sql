-- Durable laboratory submission and alert-recording provenance.
-- Processing records database signals, not delivery, human review, or current clinical relevance.
-- No historical backfill, new clinical thresholds, or changes to existing alert transitions.

CREATE TABLE public.lab_alert_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_result_id uuid NOT NULL UNIQUE REFERENCES public.lab_results(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'recorded', 'not_required')),
  attempt_count int NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code = 'evaluation_failed'),
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (id, lab_result_id, patient_id),
  CHECK ((status = 'pending' AND completed_at IS NULL)
    OR (status <> 'pending' AND completed_at IS NOT NULL AND last_error_code IS NULL))
);
CREATE INDEX lab_alert_evaluations_patient_idx ON public.lab_alert_evaluations (patient_id, created_at DESC);
CREATE INDEX lab_alert_evaluations_pending_idx ON public.lab_alert_evaluations (created_at, id) WHERE status = 'pending';

CREATE TABLE public.lab_submission_receipts (
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  payload jsonb NOT NULL,
  lab_result_id uuid NOT NULL UNIQUE REFERENCES public.lab_results(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id, patient_id, request_id)
);

CREATE TABLE public.lab_alert_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  lab_result_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  alert_id uuid NOT NULL REFERENCES public.alerts(id) ON DELETE RESTRICT,
  flag text NOT NULL CHECK (flag IN ('hyperkalemia', 'low_egfr')),
  collected_at timestamptz NOT NULL CHECK (isfinite(collected_at)),
  detected_at timestamptz NOT NULL CHECK (isfinite(detected_at)),
  FOREIGN KEY (event_id, lab_result_id, patient_id)
    REFERENCES public.lab_alert_evaluations(id, lab_result_id, patient_id) ON DELETE RESTRICT,
  UNIQUE (event_id, flag)
);
CREATE INDEX lab_alert_sources_patient_idx ON public.lab_alert_sources (patient_id, detected_at DESC);
CREATE INDEX lab_alert_sources_alert_idx ON public.lab_alert_sources (alert_id);

ALTER TABLE public.lab_alert_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_submission_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_alert_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "providers_read_linked_lab_evaluations" ON public.lab_alert_evaluations
  FOR SELECT TO authenticated USING (public.provider_has_patient(patient_id));
CREATE POLICY "providers_read_own_lab_receipts" ON public.lab_submission_receipts
  FOR SELECT TO authenticated USING (actor_id = (SELECT auth.uid()) AND public.provider_has_patient(patient_id));
CREATE POLICY "providers_read_linked_lab_sources" ON public.lab_alert_sources
  FOR SELECT TO authenticated USING (public.provider_has_patient(patient_id));
REVOKE ALL ON public.lab_alert_evaluations, public.lab_submission_receipts, public.lab_alert_sources
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lab_alert_evaluations, public.lab_submission_receipts, public.lab_alert_sources
  TO authenticated, service_role;

CREATE FUNCTION public.reject_lab_provenance_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Laboratory provenance is append-only';
END;
$$;
CREATE TRIGGER immutable_lab_submission_receipts BEFORE UPDATE OR DELETE ON public.lab_submission_receipts
  FOR EACH ROW EXECUTE FUNCTION public.reject_lab_provenance_mutation();
CREATE TRIGGER immutable_lab_alert_sources BEFORE UPDATE OR DELETE ON public.lab_alert_sources
  FOR EACH ROW EXECUTE FUNCTION public.reject_lab_provenance_mutation();
REVOKE ALL ON FUNCTION public.reject_lab_provenance_mutation() FROM PUBLIC, anon, authenticated, service_role;

-- This sees the already typed row. It cannot detect original precision lost by
-- another client before insertion; the controlled submission RPC checks that separately.
CREATE FUNCTION public.validate_lab_collection_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.collected_at IS NULL OR NOT pg_catalog.isfinite(NEW.collected_at)
    OR NEW.collected_at > pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid laboratory collection';
  END IF;
  IF pg_catalog.num_nonnulls(NEW.potassium, NEW.creatinine, NEW.egfr, NEW.bun, NEW.bnp,
    NEW.nt_probnp, NEW.hba1c, NEW.glucose, NEW.sodium, NEW.hemoglobin, NEW.ferritin, NEW.tsat, NEW.ldl) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'At least one laboratory value is required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_lab_collection_insert BEFORE INSERT ON public.lab_results
  FOR EACH ROW EXECUTE FUNCTION public.validate_lab_collection_insert();
REVOKE ALL ON FUNCTION public.validate_lab_collection_insert() FROM PUBLIC, anon, authenticated, service_role;

-- A receipt/status must never describe a different payload after a privileged
-- update. Apply only to new evaluated rows; legacy rows are not reclassified or
-- backfilled. A versioned correction workflow is a separate, explicit contract.
CREATE FUNCTION public.protect_evaluated_lab_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD AND EXISTS (
    SELECT 1 FROM public.lab_alert_evaluations AS evaluation WHERE evaluation.lab_result_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Evaluated laboratory records are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_evaluated_lab_update BEFORE UPDATE ON public.lab_results
  FOR EACH ROW EXECUTE FUNCTION public.protect_evaluated_lab_update();
REVOKE ALL ON FUNCTION public.protect_evaluated_lab_update() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_lab_alert_evaluation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.lab_alert_evaluations (lab_result_id, patient_id, recorded_by)
  VALUES (NEW.id, NEW.patient_id, (SELECT auth.uid()));
  RETURN NEW;
END;
$$;
CREATE TRIGGER create_lab_alert_evaluation AFTER INSERT ON public.lab_results
  FOR EACH ROW EXECUTE FUNCTION public.create_lab_alert_evaluation();
REVOKE ALL ON FUNCTION public.create_lab_alert_evaluation() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.submit_lab_result(
  p_request_id uuid,
  p_patient_id uuid,
  p_collected_at timestamptz,
  p_potassium numeric DEFAULT NULL,
  p_egfr numeric DEFAULT NULL,
  p_creatinine numeric DEFAULT NULL,
  p_sodium numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS TABLE (lab_result_id uuid, event_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_payload jsonb;
  v_receipt public.lab_submission_receipts%ROWTYPE;
  v_lab_result_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT COALESCE(public.provider_has_patient(p_patient_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Laboratory operation not authorized';
  END IF;
  IF p_request_id IS NULL OR p_patient_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid laboratory submission';
  END IF;
  -- Existing form ranges, with storage-compatible precision rather than silent rounding.
  IF (p_potassium IS NOT NULL AND (p_potassium NOT BETWEEN 1 AND 10 OR p_potassium <> round(p_potassium, 1)))
    OR (p_egfr IS NOT NULL AND (p_egfr NOT BETWEEN 1 AND 200 OR p_egfr <> trunc(p_egfr)))
    OR (p_creatinine IS NOT NULL AND (p_creatinine NOT BETWEEN 0.1 AND 20 OR p_creatinine <> round(p_creatinine, 2)))
    OR (p_sodium IS NOT NULL AND (p_sodium NOT BETWEEN 100 AND 170 OR p_sodium <> round(p_sodium, 1)))
    OR char_length(p_notes) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid laboratory values';
  END IF;
  -- Epoch normalizes equivalent timestamptz offsets independently of session timezone.
  v_payload := jsonb_build_object('collected_at_epoch', extract(epoch FROM p_collected_at),
    'potassium', p_potassium, 'egfr', p_egfr, 'creatinine', p_creatinine, 'sodium', p_sodium, 'notes', p_notes);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'heartland:lab-submit:' || v_actor::text || ':' || p_patient_id::text || ':' || p_request_id::text, 0));
  -- Recheck after a possibly contended lock, and hold the link against revocation until commit.
  PERFORM 1 FROM public.provider_patient_links AS link
  WHERE link.provider_id = v_actor AND link.patient_id = p_patient_id AND link.status = 'active' FOR SHARE;
  IF NOT FOUND OR NOT COALESCE(public.provider_has_patient(p_patient_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Laboratory operation not authorized';
  END IF;
  SELECT receipt.* INTO v_receipt FROM public.lab_submission_receipts AS receipt
  WHERE receipt.actor_id = v_actor AND receipt.patient_id = p_patient_id AND receipt.request_id = p_request_id;
  IF FOUND THEN
    IF v_receipt.payload IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Laboratory submission conflict';
    END IF;
    v_lab_result_id := v_receipt.lab_result_id;
  ELSE
    -- ordered_by is deliberately NULL; recorder identity belongs to the evaluation/receipt.
    INSERT INTO public.lab_results (patient_id, collected_at, potassium, egfr, creatinine, sodium, notes, ordered_by)
    VALUES (p_patient_id, p_collected_at, p_potassium, p_egfr, p_creatinine, p_sodium, p_notes, NULL)
    RETURNING id INTO v_lab_result_id;
    INSERT INTO public.lab_submission_receipts (actor_id, patient_id, request_id, payload, lab_result_id)
    VALUES (v_actor, p_patient_id, p_request_id, v_payload, v_lab_result_id);
  END IF;
  RETURN QUERY SELECT evaluation.lab_result_id, evaluation.id, evaluation.status
  FROM public.lab_alert_evaluations AS evaluation WHERE evaluation.lab_result_id = v_lab_result_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_lab_result(uuid, uuid, timestamptz, numeric, numeric, numeric, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_lab_result(uuid, uuid, timestamptz, numeric, numeric, numeric, numeric, text)
  TO authenticated;

CREATE FUNCTION public.process_lab_alert_event(p_lab_result_id uuid)
RETURNS TABLE (lab_result_id uuid, event_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.lab_alert_evaluations%ROWTYPE;
  v_lab public.lab_results%ROWTYPE;
  v_flags text[] := ARRAY[]::text[];
  v_flag text;
  v_alert_id uuid;
  v_detected_at timestamptz;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' OR (SELECT auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Laboratory operation not authorized';
  END IF;
  SELECT evaluation.* INTO v_event FROM public.lab_alert_evaluations AS evaluation
  WHERE evaluation.lab_result_id = p_lab_result_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid laboratory event';
  END IF;
  IF v_event.status <> 'pending' THEN
    RETURN QUERY SELECT v_event.lab_result_id, v_event.id, v_event.status;
    RETURN;
  END IF;
  UPDATE public.lab_alert_evaluations AS evaluation
  SET attempt_count = evaluation.attempt_count + 1, last_error_code = NULL WHERE evaluation.id = v_event.id;
  -- The nested exception block is a subtransaction: all alert/work-item/source
  -- effects roll back together while the outer evaluation remains retryable.
  BEGIN
    SELECT lab.* INTO STRICT v_lab FROM public.lab_results AS lab WHERE lab.id = p_lab_result_id FOR SHARE;
    v_detected_at := clock_timestamp();
    IF v_lab.potassium > 5.5 THEN v_flags := array_append(v_flags, 'hyperkalemia'); END IF;
    IF v_lab.egfr < 15 THEN v_flags := array_append(v_flags, 'low_egfr'); END IF;
    FOREACH v_flag IN ARRAY v_flags LOOP
      SELECT result.alert_id INTO STRICT v_alert_id
      FROM public.coalesce_patient_alert(v_lab.patient_id, NULL, 'critical', ARRAY[v_flag]) AS result;
      INSERT INTO public.lab_alert_sources (event_id, lab_result_id, patient_id, alert_id, flag, collected_at, detected_at)
      VALUES (v_event.id, v_lab.id, v_lab.patient_id, v_alert_id, v_flag, v_lab.collected_at, v_detected_at);
    END LOOP;
    UPDATE public.lab_alert_evaluations AS evaluation
    SET status = CASE WHEN cardinality(v_flags) = 0 THEN 'not_required' ELSE 'recorded' END,
      completed_at = clock_timestamp(), last_error_code = NULL WHERE evaluation.id = v_event.id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.lab_alert_evaluations AS evaluation
    SET last_error_code = 'evaluation_failed' WHERE evaluation.id = v_event.id;
  END;
  RETURN QUERY SELECT evaluation.lab_result_id, evaluation.id, evaluation.status
  FROM public.lab_alert_evaluations AS evaluation WHERE evaluation.id = v_event.id;
END;
$$;
REVOKE ALL ON FUNCTION public.process_lab_alert_event(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_lab_alert_event(uuid) TO service_role;

COMMENT ON TABLE public.lab_alert_evaluations IS
  'Durable laboratory signal-recording state. Recorded/not_required are not delivery, review, or clinical-currentness claims.';
COMMENT ON TABLE public.lab_alert_sources IS
  'Immutable observation provenance; historical collection and detection are separate. No recency-based clinical routing is inferred.';
