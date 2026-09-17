-- Restricted erasure of laboratory provenance for expired tester accounts.
-- 00037/00038 made receipts and attempts append-only and bound them to the acting
-- profile with ON DELETE RESTRICT, so an expired tester who submitted a lab could no
-- longer be deleted by the sandbox cleanup. This migration adds one audited path:
-- a service-role function that erases only the actor-bound rows of an expired
-- tester, inside one transaction whose identity the immutability triggers can verify.
-- Patients, lab results, evaluations, alerts and alert sources are preserved.
-- No historical backfill, no clinical threshold, no change to submission behaviour.

CREATE TABLE public.lab_provenance_erasures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  xact_id xid8 NOT NULL,
  receipts_deleted int CHECK (receipts_deleted IS NULL OR receipts_deleted >= 0),
  attempts_deleted int CHECK (attempts_deleted IS NULL OR attempts_deleted >= 0),
  evaluations_detached int CHECK (evaluations_detached IS NULL OR evaluations_detached >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX lab_provenance_erasures_actor_idx ON public.lab_provenance_erasures (actor_id, xact_id);
ALTER TABLE public.lab_provenance_erasures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_provenance_erasures FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lab_provenance_erasures TO service_role;

-- True only inside the transaction that recorded an erasure for this actor.
CREATE FUNCTION public.lab_provenance_erasure_active(p_actor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lab_provenance_erasures AS erasure
    WHERE erasure.actor_id = p_actor_id AND erasure.xact_id = pg_catalog.pg_current_xact_id()
  );
$$;
REVOKE ALL ON FUNCTION public.lab_provenance_erasure_active(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Receipts and alert sources stay append-only; a receipt may only disappear under an
-- active erasure of its own actor. Alert sources carry no actor and never change.
CREATE OR REPLACE FUNCTION public.reject_lab_provenance_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Nested so that OLD.actor_id is only resolved for receipts; alert sources have no actor.
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'lab_submission_receipts' THEN
    IF public.lab_provenance_erasure_active(OLD.actor_id) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'Laboratory provenance is append-only';
END;
$$;

-- Attempts keep their transition rules; deletion is allowed only under an active erasure.
CREATE OR REPLACE FUNCTION public.enforce_lab_submission_attempt_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.lab_provenance_erasure_active(OLD.actor_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Laboratory submission history is immutable';
  END IF;
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

-- Service-role only. Erases the actor-bound provenance of one expired tester and
-- records the erasure. Never touches patients, lab results, alerts or alert sources.
CREATE FUNCTION public.purge_expired_tester_provenance(p_actor_id uuid)
RETURNS TABLE (receipts_deleted int, attempts_deleted int, evaluations_detached int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text;
  v_expires_at timestamptz;
  v_receipts int;
  v_attempts int;
  v_evaluations int;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' OR (SELECT auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Laboratory erasure not authorized';
  END IF;
  SELECT profile.role, profile.sandbox_expires_at INTO v_role, v_expires_at
  FROM public.profiles AS profile WHERE profile.id = p_actor_id FOR UPDATE;
  IF v_role IS DISTINCT FROM 'tester' OR v_expires_at IS NULL OR v_expires_at > pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Laboratory erasure is limited to expired tester accounts';
  END IF;

  INSERT INTO public.lab_provenance_erasures (actor_id, xact_id)
  VALUES (p_actor_id, pg_catalog.pg_current_xact_id());

  DELETE FROM public.lab_submission_attempts AS attempt WHERE attempt.actor_id = p_actor_id;
  GET DIAGNOSTICS v_attempts = ROW_COUNT;
  DELETE FROM public.lab_submission_receipts AS receipt WHERE receipt.actor_id = p_actor_id;
  GET DIAGNOSTICS v_receipts = ROW_COUNT;
  UPDATE public.lab_alert_evaluations AS evaluation SET recorded_by = NULL
  WHERE evaluation.recorded_by = p_actor_id;
  GET DIAGNOSTICS v_evaluations = ROW_COUNT;

  UPDATE public.lab_provenance_erasures AS erasure
  SET receipts_deleted = v_receipts, attempts_deleted = v_attempts, evaluations_detached = v_evaluations
  WHERE erasure.actor_id = p_actor_id AND erasure.xact_id = pg_catalog.pg_current_xact_id();

  RETURN QUERY SELECT v_receipts, v_attempts, v_evaluations;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_expired_tester_provenance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_tester_provenance(uuid) TO service_role;

COMMENT ON FUNCTION public.purge_expired_tester_provenance(uuid) IS
  'Erases receipts and attempts of one expired tester inside an audited transaction; preserves patients, results, evaluations and alert sources.';
COMMENT ON TABLE public.lab_provenance_erasures IS
  'Audit trail of provenance erasures for expired tester accounts; one row per erasure transaction.';
