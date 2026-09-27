-- N2p1: refresh actual signal changes, including multiple coalescences in one
-- transaction where now() is constant. No outbox, backfill, clinical thresholds,
-- ownership, priority/due policy, ACK, acceptance or outcome changes.
-- CREATE OR REPLACE preserves the existing function ACLs and trigger bindings.
-- The existing alert trigger already listens to all four relevant columns.
--
-- A row's closed status must be checked both by the refresh caller and by the
-- transition enforcer. Under READ COMMITTED, an UPDATE waiting on a concurrent
-- row change rechecks its WHERE condition against the updated row. This is the
-- concurrency rationale, not evidence of a two-session race test. The regression
-- suite proves sequential closure; committed concurrency remains a release gate.
-- https://www.postgresql.org/docs/17/transaction-iso.html#XACT-READ-COMMITTED

CREATE OR REPLACE FUNCTION public.refresh_coalesced_alert_work_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.flags IS DISTINCT FROM OLD.flags
    OR NEW.severity IS DISTINCT FROM OLD.severity
    OR NEW.occurrence_count IS DISTINCT FROM OLD.occurrence_count
    OR NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at THEN
    UPDATE public.work_items
    SET reason = 'Triggered signals: ' || array_to_string(NEW.flags, ', ')
          || ' · observed ' || NEW.occurrence_count || ' times',
        severity = NEW.severity,
        freshness_at = NEW.last_seen_at,
        updated_at = now()
    WHERE source_type = 'alert' AND source_id = NEW.id
      AND status <> 'closed';
  END IF;
  RETURN NEW;
END;
$$;

-- Preserve 00041's transition function verbatim except for the closed-state
-- restriction on the service-context signal refresh exception.
CREATE OR REPLACE FUNCTION public.enforce_work_item_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  trusted_alert_refresh boolean := false;
  accepted_transfer boolean := false;
  actor uuid := (SELECT auth.uid());
  alert_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.organization_id IS NULL THEN
      NEW.organization_id := public.primary_organization_for_provider(NEW.provider_id);
    END IF;
    IF NEW.organization_id IS NULL
      OR NOT public.is_active_org_member(NEW.organization_id, NEW.provider_id)
      OR NOT public.is_active_org_member(NEW.organization_id, NEW.assigned_to)
      OR NOT public.org_has_patient(NEW.organization_id, NEW.patient_id) THEN
      RAISE EXCEPTION 'invalid governed work assignment';
    END IF;
    IF NEW.assigned_to <> NEW.provider_id
      AND actor IS NOT NULL
      AND NOT public.is_org_manager(NEW.organization_id) THEN
      RAISE EXCEPTION 'only a team manager can assign work to another member';
    END IF;
    -- Acceptance is never asserted on behalf of somebody else, creation included.
    IF NEW.accepted_at IS NOT NULL AND NEW.accepted_by IS DISTINCT FROM NEW.assigned_to THEN
      RAISE EXCEPTION 'acceptance must be recorded by the accountable member';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  trusted_alert_refresh := actor IS NULL
    AND OLD.status <> 'closed'
    AND OLD.source_type = 'alert'
    AND NEW.source_type = 'alert'
    AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id;

  IF NEW.patient_id <> OLD.patient_id
    OR NEW.provider_id <> OLD.provider_id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.source_type <> OLD.source_type
    OR NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.title <> OLD.title
    OR NEW.priority <> OLD.priority
    OR NEW.data_quality <> OLD.data_quality
    OR ((NEW.reason <> OLD.reason
      OR NEW.severity <> OLD.severity
      OR NEW.freshness_at IS DISTINCT FROM OLD.freshness_at)
      AND NOT trusted_alert_refresh) THEN
    RAISE EXCEPTION 'work item source and context are immutable';
  END IF;

  -- (A) Transfer acceptance: the recipient may take the item without being a manager.
  IF NEW.assigned_to <> OLD.assigned_to THEN
    IF NOT public.is_active_org_member(NEW.organization_id, NEW.assigned_to) THEN
      RAISE EXCEPTION 'assignee must be an active team member';
    END IF;
    accepted_transfer :=
      OLD.transfer_pending_to IS NOT NULL
      AND NEW.assigned_to = OLD.transfer_pending_to
      AND NEW.accepted_at IS NOT NULL
      AND NEW.accepted_by = NEW.assigned_to
      AND actor = NEW.assigned_to;
    IF actor IS NOT NULL AND NOT accepted_transfer
      AND NOT public.is_org_manager(NEW.organization_id) THEN
      RAISE EXCEPTION 'only a team manager can reassign work';
    END IF;
    -- A forced reassignment never inherits the previous acceptance.
    IF NOT accepted_transfer THEN
      NEW.accepted_at := NULL;
      NEW.accepted_by := NULL;
    END IF;
    -- Only a row already in the single-accountable model is promoted. The 00026 fan-out
    -- inserts one item per provider_patient_links row with organization_id coming from
    -- primary_organization_for_provider, so two colleagues on one patient already produce two
    -- rows with the same (organization_id, source_id) today. Stamping any of the six values on
    -- those rows would put them in the unique index and the second UPDATE would raise 23505.
    IF OLD.accountability_source IS NOT NULL
      AND OLD.accountability_source <> 'legacy_fan_out' THEN
      NEW.accountability_source :=
        CASE WHEN accepted_transfer THEN 'accepted_transfer' ELSE 'manager_reassigned' END;
    END IF;
    NEW.transfer_pending_to := NULL;
    NEW.transfer_offered_at := NULL;
    NEW.transfer_offered_by := NULL;
  END IF;

  -- (B) Acceptance is never inferred: accepted_by can only be the accountable member.
  IF NEW.accepted_at IS NOT NULL
    AND (NEW.accepted_by IS DISTINCT FROM NEW.assigned_to) THEN
    RAISE EXCEPTION 'acceptance must be recorded by the accountable member';
  END IF;

  IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    RAISE EXCEPTION 'closed work items cannot be reopened';
  END IF;

  IF OLD.status <> NEW.status AND NOT (
    (OLD.status = 'new' AND NEW.status IN ('reviewed', 'actioned', 'awaiting', 'closed'))
    OR (OLD.status = 'reviewed' AND NEW.status IN ('actioned', 'awaiting', 'due', 'closed'))
    OR (OLD.status = 'actioned' AND NEW.status IN ('awaiting', 'due', 'closed'))
    OR (OLD.status = 'awaiting' AND NEW.status IN ('due', 'actioned', 'closed'))
    OR (OLD.status = 'due' AND NEW.status IN ('reviewed', 'actioned', 'awaiting', 'closed'))
  ) THEN
    RAISE EXCEPTION 'invalid work item transition';
  END IF;

  IF NEW.status = 'awaiting' THEN
    IF NEW.snooze_reason IS NULL OR char_length(btrim(NEW.snooze_reason)) < 3 THEN
      RAISE EXCEPTION 'awaiting status requires a reason';
    END IF;
    IF NEW.due_at IS NULL OR NEW.due_at <= now() THEN
      RAISE EXCEPTION 'awaiting status requires a future due date';
    END IF;
  END IF;

  IF NEW.status = 'closed'
    AND (NEW.outcome IS NULL OR char_length(btrim(NEW.outcome)) < 3) THEN
    RAISE EXCEPTION 'closing requires an outcome';
  END IF;

  -- (C) Closing: a structured outcome is mandatory in the new model (P5 / D-12).
  IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
    IF OLD.accountability_source IS NOT NULL AND NEW.outcome_code IS NULL THEN
      IF pg_catalog.clock_timestamp() < public.work_item_outcome_grace_until() THEN
        NEW.outcome_code := 'outcome_not_recorded';
      ELSE
        RAISE EXCEPTION 'closing requires a documented outcome code';
      END IF;
    END IF;
    IF NEW.outcome_code = 'administrative_close' THEN
      IF actor IS NULL OR NOT public.is_org_manager(NEW.organization_id) THEN
        RAISE EXCEPTION 'an administrative close requires a team manager';
      END IF;
      IF NEW.source_type = 'alert' AND NEW.source_id IS NOT NULL THEN
        SELECT alert.status INTO alert_status
        FROM public.alerts AS alert
        WHERE alert.id = NEW.source_id;
        IF alert_status IN ('open', 'acknowledged') THEN
          RAISE EXCEPTION 'an administrative close cannot dismiss an unresolved alert';
        END IF;
      END IF;
      INSERT INTO public.work_item_events (
        work_item_id, actor_id, event_type, from_status, to_status
      ) VALUES (NEW.id, actor, 'administratively_closed', OLD.status, NEW.status);
    END IF;
  END IF;

  -- outcome_code is immutable once the item is closed.
  IF OLD.status = 'closed' AND NEW.outcome_code IS DISTINCT FROM OLD.outcome_code THEN
    RAISE EXCEPTION 'closed work items cannot be reopened';
  END IF;

  IF NEW.status = 'reviewed' AND OLD.status <> 'reviewed' THEN
    NEW.reviewed_at := now();
  ELSIF NEW.status = 'actioned' AND OLD.status <> 'actioned' THEN
    NEW.actioned_at := now();
  ELSIF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
    NEW.closed_at := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
