-- One accountable provider per patient, explicit acceptance and transfer of work, and a
-- structured human outcome at closing (O4 design §3 and §4; decisions P1 b+c, P2 a, P5 b).
--
-- LOCKSTEP DEPLOY, MANDATORY. Unlike 00040, this migration rewrites two triggers the
-- production client already exercises, so the App must ship in the same window:
--   * resolving an alert no longer closes the derived work item (P5 b / D-12): the item stays
--     in the Daily Loop carrying underlying_alert_resolved_at until a human closes it;
--   * closing an item created by the new model requires outcome_code, which the current
--     `transitionWorkItem` does not send;
--   * `assignWorkItem` must stop writing assigned_to directly and call
--     offer_work_item_transfer / reassign_work_item, because a direct UPDATE on a legacy
--     fan-out duplicate is what the new unique index would reject with 23505.
--
-- GRACE PERIOD. An alert firing between `db push` and the App deploy would create an item
-- that the old client cannot close. Until work_item_outcome_grace_until() the closing trigger
-- stamps outcome_code = 'outcome_not_recorded' instead of raising; after it the requirement is
-- strict. The deadline is declared once, in that function, and is monitored for 48 h: a
-- non-zero count of 'outcome_not_recorded' means some closing path still omits the code.
--
-- NO ROW OF work_items IS UPDATED HERE. accountability_source stays NULL on every pre-existing
-- row, and NULL means exactly one thing: "created before 00041", the only state exempt from the
-- outcome-code requirement. Items created after this migration by the last-resort fan-out are
-- labelled 'legacy_fan_out': they are excluded from the unique index (the fan-out inserts
-- several rows per organization+alert) but they do require an outcome code. Without that
-- distinction every fallback item would be silently exempt and invisible to the gap report.
--
-- PHI boundary: every accountable member holds an active provider_patient_links row.
-- designate_patient_accountable creates the link when it is missing, and
-- resolve_accountable_provider only returns a candidate that already has one; otherwise a
-- member would receive an item describing signals whose chart they cannot open.
--
-- PGRST201 rule: no new primary or unique key combines a patients foreign key with a profiles
-- foreign key. patient_accountability's unique index is (organization_id, patient_id) and
-- deliberately excludes accountable_id, so PostgREST never reads the table as a junction.

-- ---------------------------------------------------------------------------
-- 1. Designation and coverage
-- ---------------------------------------------------------------------------
CREATE TABLE public.patient_accountability (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  patient_id       uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  accountable_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  designated_by    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  designated_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  note             text CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 3 AND 500),
  CHECK (revoked_at IS NULL OR revoked_at >= designated_at)
);

CREATE UNIQUE INDEX patient_accountability_active_unique
  ON public.patient_accountability (organization_id, patient_id) WHERE revoked_at IS NULL;
CREATE INDEX patient_accountability_member_idx
  ON public.patient_accountability (accountable_id, revoked_at);

CREATE TABLE public.accountability_coverage (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  member_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  covering_member_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  starts_at           timestamptz NOT NULL CHECK (isfinite(starts_at)),
  ends_at             timestamptz NOT NULL CHECK (isfinite(ends_at)),
  reason              text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  created_by          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (covering_member_id <> member_id)
);

CREATE INDEX accountability_coverage_window_idx
  ON public.accountability_coverage (organization_id, member_id, starts_at, ends_at);

ALTER TABLE public.patient_accountability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accountability_coverage ENABLE ROW LEVEL SECURITY;

-- is_active_org_member (00027) checks membership and the provider role but not the second
-- factor; every provider read policy in this project goes through provider_aal2().
CREATE POLICY "members_read_accountability"
  ON public.patient_accountability FOR SELECT TO authenticated
  USING (
    public.provider_aal2()
    AND public.is_active_org_member(organization_id)
    AND public.org_has_patient(organization_id, patient_id)
  );

CREATE POLICY "members_read_coverage"
  ON public.accountability_coverage FOR SELECT TO authenticated
  USING (public.provider_aal2() AND public.is_active_org_member(organization_id));

REVOKE ALL ON TABLE public.patient_accountability FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.accountability_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.patient_accountability, public.accountability_coverage TO authenticated;
GRANT ALL ON TABLE public.patient_accountability, public.accountability_coverage TO service_role;

-- Overlapping coverage windows are rejected by trigger, not by an exclusion constraint:
-- btree_gist is not enabled on this project.
CREATE OR REPLACE FUNCTION public.enforce_coverage_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- A backwards window has no overlap to compute and tstzrange would raise 22000 before the
  -- table constraint is evaluated; leave it to the declared CHECK, which reports 23514.
  IF NEW.ends_at <= NEW.starts_at THEN
    RETURN NEW;
  END IF;
  -- Serialize the check per member, the way coalesce_patient_alert does per patient (00028).
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.organization_id::text || ':' || NEW.member_id::text, 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.accountability_coverage AS existing
    WHERE existing.organization_id = NEW.organization_id
      AND existing.member_id = NEW.member_id
      AND existing.id <> NEW.id
      AND pg_catalog.tstzrange(existing.starts_at, existing.ends_at, '[)')
          && pg_catalog.tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION 'overlapping coverage window for this member';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_coverage_window
  BEFORE INSERT OR UPDATE ON public.accountability_coverage
  FOR EACH ROW EXECUTE FUNCTION public.enforce_coverage_window();
REVOKE ALL ON FUNCTION public.enforce_coverage_window() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Resolving the accountable member
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_accountable_provider(
  p_organization_id uuid,
  p_patient_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE (accountable_id uuid, accountability_source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  designated uuid;
  covering uuid;
  candidate uuid;
BEGIN
  SELECT designation.accountable_id INTO designated
  FROM public.patient_accountability AS designation
  WHERE designation.organization_id = p_organization_id
    AND designation.patient_id = p_patient_id
    AND designation.revoked_at IS NULL
  LIMIT 1;

  -- Besides the organizational membership, the patient link is required: an accountable
  -- member without it would receive an item whose chart they cannot open.
  IF designated IS NOT NULL
    AND NOT (
      public.is_active_org_member(p_organization_id, designated)
      AND EXISTS (
        SELECT 1 FROM public.provider_patient_links AS link
        WHERE link.provider_id = designated
          AND link.patient_id = p_patient_id
          AND link.status = 'active'
      )
    ) THEN
    designated := NULL;   -- a suspended or unlinked member does not answer for the patient
  END IF;

  IF designated IS NOT NULL THEN
    SELECT coverage.covering_member_id INTO covering
    FROM public.accountability_coverage AS coverage
    WHERE coverage.organization_id = p_organization_id
      AND coverage.member_id = designated
      AND p_at >= coverage.starts_at
      AND p_at < coverage.ends_at
    ORDER BY coverage.starts_at DESC
    LIMIT 1;

    IF covering IS NOT NULL
      AND public.is_active_org_member(p_organization_id, covering)
      AND EXISTS (
        SELECT 1 FROM public.provider_patient_links AS link
        WHERE link.provider_id = covering
          AND link.patient_id = p_patient_id
          AND link.status = 'active'
      ) THEN
      RETURN QUERY SELECT covering, 'coverage'::text;
      RETURN;
    END IF;

    RETURN QUERY SELECT designated, 'designated'::text;
    RETURN;
  END IF;

  -- No designation: the single active member linked to this patient. The count has to be
  -- over the set of distinct members — an aggregate count(*) would count links per member,
  -- and a window function is not allowed in HAVING at all (42803).
  SELECT sole.user_id INTO candidate
  FROM (
    SELECT candidates.user_id, count(*) OVER () AS member_count
    FROM (
      SELECT DISTINCT membership.user_id
      FROM public.organization_memberships AS membership
      JOIN public.provider_patient_links AS link
        ON link.provider_id = membership.user_id
       AND link.patient_id = p_patient_id
       AND link.status = 'active'
      WHERE membership.organization_id = p_organization_id
        AND membership.status = 'active'
    ) AS candidates
  ) AS sole
  WHERE sole.member_count = 1;

  IF candidate IS NOT NULL THEN
    RETURN QUERY SELECT candidate, 'sole_member'::text;
    RETURN;
  END IF;

  -- Last named step: the organization owner, and only with an active link.
  SELECT membership.user_id INTO candidate
  FROM public.organization_memberships AS membership
  JOIN public.provider_patient_links AS link
    ON link.provider_id = membership.user_id
   AND link.patient_id = p_patient_id
   AND link.status = 'active'
  WHERE membership.organization_id = p_organization_id
    AND membership.role = 'owner'
    AND membership.status = 'active'
  ORDER BY membership.created_at ASC
  LIMIT 1;

  IF candidate IS NOT NULL THEN
    RETURN QUERY SELECT candidate, 'org_owner'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT NULL::uuid, NULL::text;   -- the caller falls back to the labelled fan-out
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_accountable_provider(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_accountable_provider(uuid, uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. New work_items columns (D-08 option a: no new status)
-- ---------------------------------------------------------------------------
ALTER TABLE public.work_items
  ADD COLUMN accepted_at                  timestamptz,
  ADD COLUMN accepted_by                  uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN transfer_pending_to          uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN transfer_offered_at          timestamptz,
  ADD COLUMN transfer_offered_by          uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN declined_at                  timestamptz,
  ADD COLUMN declined_reason              text,
  ADD COLUMN accountability_source        text,
  ADD COLUMN underlying_alert_resolved_at timestamptz,
  ADD COLUMN outcome_code                 text;

-- NOT VALID first, then VALIDATE: avoids holding ACCESS EXCLUSIVE through a full scan.
ALTER TABLE public.work_items
  ADD CONSTRAINT work_items_acceptance_pair
    CHECK ((accepted_at IS NULL) = (accepted_by IS NULL)) NOT VALID,
  ADD CONSTRAINT work_items_transfer_pair
    CHECK ((transfer_pending_to IS NULL) = (transfer_offered_at IS NULL)) NOT VALID,
  ADD CONSTRAINT work_items_transfer_not_self
    CHECK (transfer_pending_to IS NULL OR transfer_pending_to <> assigned_to) NOT VALID,
  ADD CONSTRAINT work_items_decline_pair
    CHECK ((declined_at IS NULL) = (declined_reason IS NULL)) NOT VALID,
  ADD CONSTRAINT work_items_decline_reason_length
    CHECK (declined_reason IS NULL OR char_length(btrim(declined_reason)) BETWEEN 3 AND 500) NOT VALID,
  ADD CONSTRAINT work_items_accountability_source
    CHECK (accountability_source IS NULL OR accountability_source IN (
      'designated', 'coverage', 'sole_member', 'org_owner', 'accepted_transfer',
      'manager_reassigned', 'legacy_fan_out'
    )) NOT VALID,
  ADD CONSTRAINT work_items_outcome_code
    CHECK (outcome_code IS NULL OR outcome_code IN (
      'clinical_action_taken', 'no_action_needed', 'patient_unreachable',
      'care_not_delivered', 'transferred_to_other_team', 'duplicate_or_superseded',
      'administrative_close', 'followup_completed', 'followup_skipped',
      'outcome_not_recorded'
    )) NOT VALID;

ALTER TABLE public.work_items
  VALIDATE CONSTRAINT work_items_acceptance_pair,
  VALIDATE CONSTRAINT work_items_transfer_pair,
  VALIDATE CONSTRAINT work_items_transfer_not_self,
  VALIDATE CONSTRAINT work_items_decline_pair,
  VALIDATE CONSTRAINT work_items_decline_reason_length,
  VALIDATE CONSTRAINT work_items_accountability_source,
  VALIDATE CONSTRAINT work_items_outcome_code;

-- One alert item per organization, in the single-accountable model only. The predicate lists
-- the six single-accountable values instead of testing accountability_source IS NOT NULL: the
-- last-resort fan-out labels its rows 'legacy_fan_out' and inserts several per
-- (organization, alert), so those rows have to stay outside the index. The list is immutable,
-- so the index is built without touching any existing row (all of them have NULL here).
CREATE UNIQUE INDEX work_items_one_accountable_per_alert
  ON public.work_items (organization_id, source_id)
  WHERE source_type = 'alert' AND source_id IS NOT NULL
    AND accountability_source IN (
      'designated', 'coverage', 'sole_member', 'org_owner',
      'accepted_transfer', 'manager_reassigned'
    );

CREATE INDEX work_items_transfer_pending_idx
  ON public.work_items (transfer_pending_to, organization_id)
  WHERE transfer_pending_to IS NOT NULL;
CREATE INDEX work_items_unaccepted_idx
  ON public.work_items (organization_id, assigned_to)
  WHERE accepted_at IS NULL AND status <> 'closed';

-- Only outcome_code joins the App's direct UPDATE path. Acceptance and transfer belong to the
-- SECURITY DEFINER RPCs below; the pre-existing assigned_to grant stays as it is (00026) and
-- the App stops using it in the same window.
GRANT UPDATE (outcome_code) ON public.work_items TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Event vocabulary
-- ---------------------------------------------------------------------------
-- work_item_events stays append-only (00026); the RPCs below insert into it directly because
-- they are SECURITY DEFINER and the guard trigger only blocks UPDATE and DELETE. to_status
-- carries the current status whenever the event is not a transition.
ALTER TABLE public.work_item_events
  DROP CONSTRAINT work_item_events_event_type_check,
  ADD CONSTRAINT work_item_events_event_type_check CHECK (event_type IN (
    'created', 'reviewed', 'actioned', 'awaiting', 'due', 'closed', 'updated',
    'assigned', 'transfer_offered', 'accepted', 'declined',
    'coverage_applied', 'accountable_unavailable',
    'underlying_alert_resolved', 'administratively_closed'
  )) NOT VALID;
ALTER TABLE public.work_item_events VALIDATE CONSTRAINT work_item_events_event_type_check;

-- ---------------------------------------------------------------------------
-- 5. enforce_work_item_transition, fourth version
-- ---------------------------------------------------------------------------
-- The grace deadline of §3.5 (C) lives here, declared exactly once. No role can execute or
-- replace this function, so it is a constant for every client; it is a function rather than an
-- inline literal only so the pgTAP suite can exercise both branches of the closing rule inside
-- its own rolled-back transaction.
CREATE OR REPLACE FUNCTION public.work_item_outcome_grace_until()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT timestamptz '2026-09-24 00:00:00+00'
$$;

REVOKE ALL ON FUNCTION public.work_item_outcome_grace_until()
  FROM PUBLIC, anon, authenticated, service_role;

-- Only three blocks change against 00028: (A) assignment, (B) acceptance, (C) closing.
-- Context immutability, trusted_alert_refresh, the transition table, `awaiting` and the
-- timestamps are preserved verbatim.
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

-- ---------------------------------------------------------------------------
-- 6. Acceptance, transfer, designation, coverage and gap visibility
-- ---------------------------------------------------------------------------
-- Initial acceptance by the accountable member itself.
CREATE OR REPLACE FUNCTION public.accept_work_item(p_work_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  item record;
BEGIN
  SELECT * INTO item FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF item.id IS NULL OR actor IS NULL OR item.assigned_to <> actor
    OR NOT public.provider_aal2()
    OR NOT public.is_active_org_member(item.organization_id, actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Work item acceptance not authorized';
  END IF;
  IF item.status = 'closed' THEN
    RAISE EXCEPTION 'closed work items cannot be accepted';
  END IF;
  IF item.accepted_at IS NOT NULL THEN
    RETURN;   -- idempotent
  END IF;

  UPDATE public.work_items
  SET accepted_at = now(), accepted_by = actor
  WHERE id = p_work_item_id;

  INSERT INTO public.work_item_events (
    work_item_id, actor_id, event_type, from_status, to_status
  ) VALUES (p_work_item_id, actor, 'accepted', item.status, item.status);
END;
$$;

-- A transfer offer does NOT move assigned_to: the current owner keeps answering for the item.
CREATE OR REPLACE FUNCTION public.offer_work_item_transfer(
  p_work_item_id uuid,
  p_to uuid,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  item record;
  note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  SELECT * INTO item FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF item.id IS NULL OR actor IS NULL OR NOT public.provider_aal2()
    OR NOT (item.assigned_to = actor OR public.is_org_manager(item.organization_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Transfer not authorized';
  END IF;
  IF item.status = 'closed' THEN
    RAISE EXCEPTION 'closed work items cannot be transferred';
  END IF;
  IF p_to = item.assigned_to THEN
    RAISE EXCEPTION 'the item is already assigned to this member';
  END IF;
  IF NOT public.is_active_org_member(item.organization_id, p_to) THEN
    RAISE EXCEPTION 'transfer target must be an active team member';
  END IF;
  IF item.transfer_pending_to IS NOT NULL AND item.transfer_pending_to <> p_to THEN
    RAISE EXCEPTION 'another transfer is already pending on this item';
  END IF;
  IF note IS NOT NULL AND char_length(note) < 3 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A transfer note must be documented';
  END IF;

  UPDATE public.work_items
  SET transfer_pending_to = p_to,
      transfer_offered_at = now(),
      transfer_offered_by = actor,
      declined_at = NULL,
      declined_reason = NULL
  WHERE id = p_work_item_id;

  INSERT INTO public.work_item_events (
    work_item_id, actor_id, event_type, from_status, to_status
  ) VALUES (p_work_item_id, actor, 'transfer_offered', item.status, item.status);
END;
$$;

-- Accepting a transfer: the recipient only.
CREATE OR REPLACE FUNCTION public.accept_work_item_transfer(p_work_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  item record;
BEGIN
  SELECT * INTO item FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF item.id IS NULL OR actor IS NULL OR item.transfer_pending_to IS DISTINCT FROM actor
    OR NOT public.provider_aal2()
    OR NOT public.is_active_org_member(item.organization_id, actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Transfer acceptance not authorized';
  END IF;
  IF item.status = 'closed' THEN
    RAISE EXCEPTION 'closed work items cannot be transferred';
  END IF;

  -- The trigger clears transfer_* and marks accountability_source = 'accepted_transfer'.
  UPDATE public.work_items
  SET assigned_to = actor, accepted_by = actor, accepted_at = now()
  WHERE id = p_work_item_id;

  INSERT INTO public.work_item_events (
    work_item_id, actor_id, event_type, from_status, to_status
  ) VALUES (p_work_item_id, actor, 'accepted', item.status, item.status);
END;
$$;

-- Declining: the item returns to the previous owner, with a documented reason.
CREATE OR REPLACE FUNCTION public.decline_work_item_transfer(
  p_work_item_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  item record;
BEGIN
  SELECT * INTO item FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  -- The other three RPCs require AAL2 and an active membership; so does this one.
  IF item.id IS NULL OR actor IS NULL OR item.transfer_pending_to IS DISTINCT FROM actor
    OR NOT public.provider_aal2()
    OR NOT public.is_active_org_member(item.organization_id, actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Transfer decline not authorized';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Declining a transfer requires a reason';
  END IF;

  UPDATE public.work_items
  SET transfer_pending_to = NULL,
      transfer_offered_at = NULL,
      transfer_offered_by = NULL,
      declined_at = now(),
      declined_reason = btrim(p_reason)
  WHERE id = p_work_item_id;

  INSERT INTO public.work_item_events (
    work_item_id, actor_id, event_type, from_status, to_status
  ) VALUES (p_work_item_id, actor, 'declined', item.status, item.status);
END;
$$;

-- Designation by a manager of the organization. Besides recording the designation it creates
-- the designated member's provider_patient_links row when it is missing: without the link the
-- accountable member would receive an item whose signals they cannot open in the chart.
-- With p_offer_open_items the open items of that patient become transfer OFFERS, never
-- possession: nothing is reassigned and no acceptance is invented.
CREATE OR REPLACE FUNCTION public.designate_patient_accountable(
  p_organization_id uuid,
  p_patient_id uuid,
  p_accountable_id uuid,
  p_note text DEFAULT NULL,
  p_offer_open_items boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  designation_id uuid;
  open_item record;
BEGIN
  IF actor IS NULL OR NOT public.provider_aal2()
    OR NOT public.is_org_manager(p_organization_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Accountability designation not authorized';
  END IF;
  IF NOT public.org_has_patient(p_organization_id, p_patient_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The patient is not assigned to this organization';
  END IF;
  IF NOT public.is_active_org_member(p_organization_id, p_accountable_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The accountable member must be active in this organization';
  END IF;
  IF note IS NOT NULL AND char_length(note) < 3 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A designation note must be documented';
  END IF;

  -- PHI boundary: the accountable member must be able to open the chart.
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_patient_links AS link
    WHERE link.provider_id = p_accountable_id
      AND link.patient_id = p_patient_id
      AND link.status = 'active'
  ) THEN
    UPDATE public.provider_patient_links AS link
    SET status = 'active', linked_at = COALESCE(link.linked_at, now())
    WHERE link.provider_id = p_accountable_id
      AND link.patient_id = p_patient_id;
    IF NOT FOUND THEN
      INSERT INTO public.provider_patient_links (provider_id, patient_id, status, linked_at)
      VALUES (p_accountable_id, p_patient_id, 'active', now());
    END IF;
  END IF;

  -- One active designation per (organization, patient); the previous one keeps its history.
  UPDATE public.patient_accountability AS designation
  SET revoked_at = now()
  WHERE designation.organization_id = p_organization_id
    AND designation.patient_id = p_patient_id
    AND designation.revoked_at IS NULL
    AND designation.accountable_id <> p_accountable_id;

  SELECT designation.id INTO designation_id
  FROM public.patient_accountability AS designation
  WHERE designation.organization_id = p_organization_id
    AND designation.patient_id = p_patient_id
    AND designation.revoked_at IS NULL;

  IF designation_id IS NULL THEN
    INSERT INTO public.patient_accountability (
      organization_id, patient_id, accountable_id, designated_by, note
    ) VALUES (p_organization_id, p_patient_id, p_accountable_id, actor, note)
    RETURNING id INTO designation_id;
  END IF;

  IF p_offer_open_items THEN
    FOR open_item IN
      SELECT item.id
      FROM public.work_items AS item
      WHERE item.organization_id = p_organization_id
        AND item.patient_id = p_patient_id
        AND item.status <> 'closed'
        AND item.assigned_to <> p_accountable_id
        AND (item.transfer_pending_to IS NULL OR item.transfer_pending_to = p_accountable_id)
    LOOP
      PERFORM public.offer_work_item_transfer(open_item.id, p_accountable_id, note);
    END LOOP;
  END IF;

  RETURN designation_id;
END;
$$;

-- Forced reassignment by a manager, separate from acceptance and labelled as such. It replaces
-- the direct UPDATE of assigned_to that assignWorkItem used to issue: on the old path the
-- unique index raises 23505 over fan-out duplicates of the same alert. The reason is required
-- as a deliberation record; §3.3 adds no column for it, so it is validated, not stored.
CREATE OR REPLACE FUNCTION public.reassign_work_item(
  p_work_item_id uuid,
  p_to uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  item record;
BEGIN
  SELECT * INTO item FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF item.id IS NULL OR actor IS NULL OR NOT public.provider_aal2()
    OR NOT public.is_org_manager(item.organization_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Work reassignment not authorized';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Reassigning work requires a reason';
  END IF;
  IF item.status = 'closed' THEN
    RAISE EXCEPTION 'closed work items cannot be reassigned';
  END IF;
  IF p_to = item.assigned_to THEN
    RAISE EXCEPTION 'the item is already assigned to this member';
  END IF;
  IF NOT public.is_active_org_member(item.organization_id, p_to) THEN
    RAISE EXCEPTION 'assignee must be an active team member';
  END IF;

  -- The trigger clears the acceptance and marks 'manager_reassigned' when the row already
  -- belongs to the single-accountable model.
  UPDATE public.work_items
  SET assigned_to = p_to
  WHERE id = p_work_item_id;

  INSERT INTO public.work_item_events (
    work_item_id, actor_id, event_type, from_status, to_status
  ) VALUES (p_work_item_id, actor, 'assigned', item.status, item.status);
END;
$$;

-- Coverage schedule (D-07 option c). Coverage applies to NEW work only: items already open do
-- not change owner by themselves (Q8).
CREATE OR REPLACE FUNCTION public.schedule_accountability_coverage(
  p_organization_id uuid,
  p_member_id uuid,
  p_covering_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  coverage_id uuid;
BEGIN
  IF actor IS NULL OR NOT public.provider_aal2()
    OR NOT public.is_org_manager(p_organization_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Coverage scheduling not authorized';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Scheduling coverage requires a reason';
  END IF;
  IF p_starts_at IS NULL OR p_ends_at IS NULL
    OR NOT pg_catalog.isfinite(p_starts_at) OR NOT pg_catalog.isfinite(p_ends_at)
    OR p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid coverage window';
  END IF;
  IF p_covering_member_id = p_member_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A member cannot cover itself';
  END IF;
  IF NOT public.is_active_org_member(p_organization_id, p_member_id)
    OR NOT public.is_active_org_member(p_organization_id, p_covering_member_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Both members must be active in this organization';
  END IF;

  INSERT INTO public.accountability_coverage (
    organization_id, member_id, covering_member_id, starts_at, ends_at, reason, created_by
  ) VALUES (
    p_organization_id, p_member_id, p_covering_member_id, p_starts_at, p_ends_at,
    btrim(p_reason), actor
  ) RETURNING id INTO coverage_id;

  RETURN coverage_id;
END;
$$;

-- Gap visibility for a manager: items with no owner in the new model, legacy fan-out items
-- still open, items nobody accepted, and items whose patient left the organization. The
-- function is SECURITY DEFINER and therefore sees the rows that RLS has already hidden from
-- the team screens (org_has_patient stops being true when the assignment is revoked).
CREATE OR REPLACE FUNCTION public.get_unowned_work(p_organization_id uuid)
RETURNS TABLE (
  work_item_id uuid,
  patient_id uuid,
  reason_code text,
  status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    item.id,
    item.patient_id,
    CASE
      WHEN NOT public.org_has_patient(item.organization_id, item.patient_id)
        THEN 'patient_unassigned'
      WHEN item.accountability_source IS NULL
        OR item.accountability_source = 'legacy_fan_out' THEN 'legacy_fan_out'
      ELSE 'unaccepted'
    END,
    item.status,
    item.created_at
  FROM public.work_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.status <> 'closed'
    AND public.is_org_manager(p_organization_id)
    AND (
      NOT public.org_has_patient(item.organization_id, item.patient_id)
      OR item.accountability_source IS NULL
      OR item.accountability_source = 'legacy_fan_out'
      OR item.accepted_at IS NULL
    )
  ORDER BY item.created_at DESC, item.id
$$;

REVOKE ALL ON FUNCTION public.accept_work_item(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.offer_work_item_transfer(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_work_item_transfer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_work_item_transfer(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.designate_patient_accountable(uuid, uuid, uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reassign_work_item(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_accountability_coverage(uuid, uuid, uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_unowned_work(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_work_item(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offer_work_item_transfer(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_work_item_transfer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_work_item_transfer(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.designate_patient_accountable(uuid, uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_work_item(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_accountability_coverage(uuid, uuid, uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unowned_work(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. RLS: the recipient has to see the offer
-- ---------------------------------------------------------------------------
-- team_read_work_items (00027) requires assigned_to = auth.uid() or a manager role, so without
-- these policies a non-manager recipient could not see the item offered to them. No UPDATE
-- grant follows: the recipient's only write path is a definer RPC.
CREATE POLICY "transfer_recipients_read_work_items"
  ON public.work_items FOR SELECT TO authenticated
  USING (
    public.provider_aal2()
    AND transfer_pending_to = (SELECT auth.uid())
    AND public.is_active_org_member(organization_id)
    AND public.org_has_patient(organization_id, patient_id)
  );

CREATE POLICY "transfer_recipients_read_work_item_events"
  ON public.work_item_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.work_items AS item
      WHERE item.id = work_item_events.work_item_id
        AND item.transfer_pending_to = (SELECT auth.uid())
        AND public.provider_aal2()
        AND public.is_active_org_member(item.organization_id)
        AND public.org_has_patient(item.organization_id, item.patient_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 8. Absence, revoked membership and reassignment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_membership_deactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('suspended', 'revoked') AND OLD.status = 'active' THEN
    -- 1. The member's designations stop being valid, without erasing their history.
    UPDATE public.patient_accountability AS designation
    SET revoked_at = now()
    WHERE designation.accountable_id = NEW.user_id
      AND designation.organization_id = NEW.organization_id
      AND designation.revoked_at IS NULL;

    -- 2. Offers pending for them are cancelled: nobody accepts on their behalf.
    UPDATE public.work_items AS item
    SET transfer_pending_to = NULL,
        transfer_offered_at = NULL,
        transfer_offered_by = NULL
    WHERE item.transfer_pending_to = NEW.user_id
      AND item.organization_id = NEW.organization_id;

    -- 3. Open items lose the acceptance and get an event; assigned_to does NOT change:
    --    moving the owner here would invent an acceptance nobody gave.
    INSERT INTO public.work_item_events (
      work_item_id, actor_id, event_type, from_status, to_status
    )
    SELECT item.id, (SELECT auth.uid()), 'accountable_unavailable', item.status, item.status
    FROM public.work_items AS item
    WHERE item.assigned_to = NEW.user_id
      AND item.organization_id = NEW.organization_id
      AND item.status <> 'closed';

    UPDATE public.work_items AS item
    SET accepted_at = NULL, accepted_by = NULL
    WHERE item.assigned_to = NEW.user_id
      AND item.organization_id = NEW.organization_id
      AND item.status <> 'closed'
      AND item.accepted_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS handle_membership_deactivation ON public.organization_memberships;
CREATE TRIGGER handle_membership_deactivation
  AFTER UPDATE OF status ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.handle_membership_deactivation();
REVOKE ALL ON FUNCTION public.handle_membership_deactivation() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. sync_alert_work_items: one accountable item per organization; resolving never closes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_alert_work_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  assignment record;
  owner_id uuid;
  owner_source text;
  linked_provider uuid;
  mapped_priority text;
  mapped_due timestamptz;
  new_item_id uuid;
BEGIN
  mapped_priority := CASE NEW.severity
    WHEN 'critical' THEN 'now'
    WHEN 'warning' THEN 'today'
    ELSE 'watching'
  END;
  mapped_due := CASE NEW.severity
    WHEN 'critical' THEN NEW.created_at
    WHEN 'warning' THEN NEW.created_at + interval '24 hours'
    ELSE NEW.created_at + interval '7 days'
  END;

  IF TG_OP = 'INSERT' THEN
    FOR assignment IN
      SELECT opa.organization_id
      FROM public.organization_patient_assignments AS opa
      JOIN public.organizations AS org
        ON org.id = opa.organization_id AND org.status = 'active'
      WHERE opa.patient_id = NEW.patient_id AND opa.status = 'active'
    LOOP
      SELECT resolved.accountable_id, resolved.accountability_source
      INTO owner_id, owner_source
      FROM public.resolve_accountable_provider(
        assignment.organization_id, NEW.patient_id, now()
      ) AS resolved;

      IF owner_id IS NOT NULL THEN
        INSERT INTO public.work_items (
          patient_id, provider_id, assigned_to, organization_id, source_type, source_id,
          title, reason, priority, severity, status, due_at, freshness_at, data_quality,
          accountability_source
        ) VALUES (
          NEW.patient_id, owner_id, owner_id, assignment.organization_id, 'alert', NEW.id,
          'Review patient alert',
          'Triggered signals: ' || array_to_string(NEW.flags, ', '),
          mapped_priority, NEW.severity, 'new', mapped_due, NEW.created_at,
          CASE WHEN NEW.vitals_id IS NULL THEN 'partial' ELSE 'verified' END,
          owner_source
        )
        ON CONFLICT (provider_id, source_type, source_id)
          WHERE source_id IS NOT NULL
        DO NOTHING
        RETURNING id INTO new_item_id;

        IF new_item_id IS NOT NULL AND owner_source = 'coverage' THEN
          INSERT INTO public.work_item_events (
            work_item_id, actor_id, event_type, from_status, to_status
          ) VALUES (new_item_id, (SELECT auth.uid()), 'coverage_applied', NULL, 'new');
        END IF;
      ELSE
        -- Last resort: the legacy fan-out, explicitly labelled. The label is
        -- 'legacy_fan_out', never NULL: NULL means exclusively "created before 00041", and
        -- with NULL here every item born on this path would be exempt from the outcome-code
        -- requirement and absent from any gap count. The insert is otherwise identical to
        -- 00026 (no organization_id, so the trigger derives the provider's primary
        -- organization) and writes no outcome.
        FOR linked_provider IN
          SELECT link.provider_id
          FROM public.provider_patient_links AS link
          WHERE link.patient_id = NEW.patient_id AND link.status = 'active'
        LOOP
          INSERT INTO public.work_items (
            patient_id, provider_id, assigned_to, source_type, source_id,
            title, reason, priority, severity, status, due_at, freshness_at,
            data_quality, accountability_source
          ) VALUES (
            NEW.patient_id, linked_provider, linked_provider, 'alert', NEW.id,
            'Review patient alert',
            'Triggered signals: ' || array_to_string(NEW.flags, ', '),
            mapped_priority, NEW.severity, 'new', mapped_due, NEW.created_at,
            CASE WHEN NEW.vitals_id IS NULL THEN 'partial' ELSE 'verified' END,
            'legacy_fan_out'
          )
          ON CONFLICT (provider_id, source_type, source_id)
            WHERE source_id IS NOT NULL
          DO NOTHING;
        END LOOP;
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  -- Status updates never create an item, never close one and never write an outcome.
  IF NEW.status = 'acknowledged' AND OLD.status = 'open' THEN
    UPDATE public.work_items AS item
    SET status = 'reviewed',
        reviewed_at = COALESCE(item.reviewed_at, NEW.acknowledged_at, now())
    WHERE item.source_type = 'alert' AND item.source_id = NEW.id AND item.status = 'new';
  END IF;

  IF NEW.status = 'resolved' AND OLD.status <> 'resolved' THEN
    -- The signal stopped; that is all this records. Moving the item to 'reviewed' would
    -- assert that somebody reviewed it, and 'new' -> 'due' is not an allowed transition.
    UPDATE public.work_items AS item
    SET underlying_alert_resolved_at =
          COALESCE(item.underlying_alert_resolved_at, NEW.resolved_at, now())
    WHERE item.source_type = 'alert' AND item.source_id = NEW.id AND item.status <> 'closed';

    INSERT INTO public.work_item_events (
      work_item_id, actor_id, event_type, from_status, to_status
    )
    SELECT item.id, (SELECT auth.uid()), 'underlying_alert_resolved', item.status, item.status
    FROM public.work_items AS item
    WHERE item.source_type = 'alert' AND item.source_id = NEW.id AND item.status <> 'closed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_alert_work_items ON public.alerts;
CREATE TRIGGER sync_alert_work_items
  AFTER INSERT OR UPDATE OF status ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.sync_alert_work_items();

-- The two follow-up triggers now carry outcome_code alongside the literal outcome they already
-- write (§4.2): a consequence of rule (C), not new scope. COALESCE keeps the first code
-- recorded, so a later status change on the source never rewrites a closed item's outcome.
CREATE OR REPLACE FUNCTION public.sync_scheduled_followup_work_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  mapped_status text;
  mapped_priority text;
BEGIN
  mapped_status := CASE
    WHEN NEW.completed THEN 'closed'
    WHEN NEW.scheduled_at <= now() THEN 'due'
    ELSE 'new'
  END;
  mapped_priority := CASE
    WHEN NEW.scheduled_at <= now() THEN 'now'
    WHEN NEW.scheduled_at < date_trunc('day', now()) + interval '1 day' THEN 'today'
    WHEN NEW.scheduled_at < now() + interval '7 days' THEN 'week'
    ELSE 'watching'
  END;

  INSERT INTO public.work_items (
    patient_id, provider_id, assigned_to, source_type, source_id,
    title, reason, priority, severity, status, due_at, freshness_at,
    data_quality, outcome, outcome_code, closed_at
  ) VALUES (
    NEW.patient_id, NEW.provider_id, NEW.provider_id,
    'scheduled_followup', NEW.id,
    'Follow-up: ' || left(NEW.type, 120),
    COALESCE(NULLIF(left(NEW.notes, 1000), ''), 'Scheduled patient follow-up'),
    mapped_priority,
    CASE WHEN NEW.scheduled_at <= now() THEN 'warning' ELSE 'informational' END,
    mapped_status,
    NEW.scheduled_at,
    NEW.created_at,
    'verified',
    CASE WHEN NEW.completed THEN 'Follow-up marked complete' ELSE NULL END,
    CASE WHEN NEW.completed THEN 'followup_completed' ELSE NULL END,
    CASE WHEN NEW.completed THEN now() ELSE NULL END
  )
  ON CONFLICT (provider_id, source_type, source_id)
    WHERE source_id IS NOT NULL
  DO UPDATE SET
    status = EXCLUDED.status,
    due_at = EXCLUDED.due_at,
    outcome = EXCLUDED.outcome,
    outcome_code = COALESCE(work_items.outcome_code, EXCLUDED.outcome_code),
    closed_at = EXCLUDED.closed_at,
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_discharge_followup_work_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  mapped_status text;
  mapped_priority text;
BEGIN
  mapped_status := CASE
    WHEN NEW.status IN ('completed', 'skipped') THEN 'closed'
    WHEN NEW.due_at <= now() THEN 'due'
    ELSE 'new'
  END;
  mapped_priority := CASE
    WHEN NEW.due_at <= now() THEN 'now'
    WHEN NEW.due_at < date_trunc('day', now()) + interval '1 day' THEN 'today'
    WHEN NEW.due_at < now() + interval '7 days' THEN 'week'
    ELSE 'watching'
  END;

  INSERT INTO public.work_items (
    patient_id, provider_id, assigned_to, source_type, source_id,
    title, reason, priority, severity, status, due_at, freshness_at,
    data_quality, outcome, outcome_code, closed_at
  ) VALUES (
    NEW.patient_id, NEW.provider_id, NEW.provider_id,
    'discharge_followup', NEW.id,
    left(NEW.label, 160),
    COALESCE(NULLIF(left(NEW.purpose, 1000), ''), 'Post-discharge follow-up'),
    mapped_priority,
    CASE WHEN NEW.due_at <= now() THEN 'warning' ELSE 'informational' END,
    mapped_status,
    NEW.due_at,
    NEW.created_at,
    'verified',
    CASE
      WHEN NEW.status = 'completed' THEN COALESCE(NULLIF(left(NEW.contact_notes, 1000), ''), 'Follow-up completed')
      WHEN NEW.status = 'skipped' THEN 'Follow-up skipped'
      ELSE NULL
    END,
    CASE
      WHEN NEW.status = 'completed' THEN 'followup_completed'
      WHEN NEW.status = 'skipped' THEN 'followup_skipped'
      ELSE NULL
    END,
    CASE WHEN NEW.status IN ('completed', 'skipped') THEN COALESCE(NEW.completed_at, now()) ELSE NULL END
  )
  ON CONFLICT (provider_id, source_type, source_id)
    WHERE source_id IS NOT NULL
  DO UPDATE SET
    status = EXCLUDED.status,
    due_at = EXCLUDED.due_at,
    outcome = EXCLUDED.outcome,
    outcome_code = COALESCE(work_items.outcome_code, EXCLUDED.outcome_code),
    closed_at = EXCLUDED.closed_at,
    updated_at = now();

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Legacy diagnostics: nothing is rewritten, the gap is only measured
-- ---------------------------------------------------------------------------
-- The pre-existing fan-out already holds several rows per (organization_id, source_id) for one
-- alert whenever two colleagues share a patient. They stay exactly as they are, with
-- accountability_source NULL, which is what keeps them out of the new unique index and lets
-- them close with the old text-only rule. Closing them by script would be the clerical closing
-- D-12 forbids, so this block only reports how many groups exist, for the deploy receipt.
DO $$
DECLARE
  duplicate_groups int;
  duplicate_rows int;
BEGIN
  SELECT count(*)::int, COALESCE(sum(group_rows), 0)::int
  INTO duplicate_groups, duplicate_rows
  FROM (
    SELECT count(*)::int AS group_rows
    FROM public.work_items AS item
    WHERE item.source_type = 'alert' AND item.source_id IS NOT NULL
    GROUP BY item.organization_id, item.source_id
    HAVING count(*) > 1
  ) AS duplicates;

  RAISE NOTICE '00041: % legacy (organization_id, source_id) alert groups hold % rows; all keep accountability_source NULL and stay outside work_items_one_accountable_per_alert',
    duplicate_groups, duplicate_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Comments
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.patient_accountability IS
  'One active accountable provider per (organization, patient), designated by a manager; revoked rows are kept as history and the unique index deliberately excludes accountable_id.';
COMMENT ON TABLE public.accountability_coverage IS
  'Coverage windows standing in for an accountable member; applies to new work only, never reassigning items already open.';
COMMENT ON COLUMN public.work_items.accountability_source IS
  'NULL means created before 00041 (legacy fan-out, exempt from outcome_code); legacy_fan_out means created after it with no resolvable owner; the other six values are the single-accountable model.';
COMMENT ON COLUMN public.work_items.outcome_code IS
  'Structured human outcome required to close an item of the new model; outcome_not_recorded is written only by the grace period of the closing trigger and administrative_close only by a manager.';
COMMENT ON COLUMN public.work_items.underlying_alert_resolved_at IS
  'When the source alert was resolved. Resolving an alert no longer closes the item: it records that the signal stopped, without asserting review or action.';
COMMENT ON FUNCTION public.resolve_accountable_provider(uuid, uuid, timestamptz) IS
  'Accountable member for one organization and patient: designation, coverage, sole linked member or organization owner, each requiring an active patient link; NULL sends the caller to the labelled fan-out.';
COMMENT ON FUNCTION public.work_item_outcome_grace_until() IS
  'Deadline of the outcome_code grace period of the closing trigger; ungranted, so no client can read or change it.';
COMMENT ON FUNCTION public.accept_work_item(uuid) IS
  'Records that the accountable member took the item; idempotent and never usable on behalf of another member.';
COMMENT ON FUNCTION public.offer_work_item_transfer(uuid, uuid, text) IS
  'Offers the item to another active member without moving assigned_to; the current owner keeps answering until the offer is accepted.';
COMMENT ON FUNCTION public.accept_work_item_transfer(uuid) IS
  'Accepts a pending offer; only the recipient, and the loser of a concurrent race gets 42501 because the offer is already cleared.';
COMMENT ON FUNCTION public.decline_work_item_transfer(uuid, text) IS
  'Declines a pending offer with a documented reason, returning the item to the previous owner.';
COMMENT ON FUNCTION public.designate_patient_accountable(uuid, uuid, uuid, text, boolean) IS
  'Designates the accountable member for a patient in one organization, creating the provider-patient link when it is missing; open items become transfer offers, never possession.';
COMMENT ON FUNCTION public.reassign_work_item(uuid, uuid, text) IS
  'Forced reassignment by a manager, labelled manager_reassigned and clearing any acceptance; replaces the direct UPDATE of assigned_to.';
COMMENT ON FUNCTION public.schedule_accountability_coverage(uuid, uuid, uuid, timestamptz, timestamptz, text) IS
  'Schedules a non-overlapping coverage window for a member of the organization.';
COMMENT ON FUNCTION public.get_unowned_work(uuid) IS
  'Manager view of the accountability gap: legacy items, unaccepted items and items whose patient left the organization.';
