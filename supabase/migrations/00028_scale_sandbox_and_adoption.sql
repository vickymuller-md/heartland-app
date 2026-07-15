-- Product scale, self-service synthetic sandbox, timezone correctness, and
-- adoption telemetry. Tester identities are deliberately distinct from
-- providers and patients: they can authenticate and emit product events, but
-- no clinical table policy grants the tester role access.

-- ---------------------------------------------------------------------------
-- 1. Self-service tester identity (synthetic sandbox only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('provider', 'patient', 'tester'));

ALTER TABLE public.profiles
  ADD COLUMN sandbox_expires_at timestamptz;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_sandbox_expiry_check CHECK (
    (role = 'tester' AND sandbox_expires_at IS NOT NULL)
    OR (role <> 'tester' AND sandbox_expires_at IS NULL)
  );

CREATE INDEX profiles_sandbox_expiry_idx
  ON public.profiles (sandbox_expires_at)
  WHERE role = 'tester';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  assigned_role text := CASE
    WHEN COALESCE(NEW.raw_user_meta_data ->> 'signup_intent', '') = 'sandbox'
      THEN 'tester'
    ELSE 'patient'
  END;
BEGIN
  INSERT INTO public.profiles (
    id, role, full_name, email, sandbox_expires_at
  ) VALUES (
    NEW.id,
    assigned_role,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.email,
    CASE WHEN assigned_role = 'tester' THEN now() + interval '30 days' END
  )
  ON CONFLICT (id) DO NOTHING;

  IF assigned_role = 'patient' THEN
    INSERT INTO public.patients (id)
    VALUES (NEW.id)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF COALESCE(NEW.raw_user_meta_data ->> 'consent_accepted', '') = 'true' THEN
    INSERT INTO public.consents (
      user_id, consent_version, consent_type, accepted, accepted_at
    ) VALUES (
      NEW.id, 'v1.0', 'registration', true, now()
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN auth.jwt() ->> 'user_role' IN ('provider', 'patient', 'tester')
      THEN auth.jwt() ->> 'user_role'
    ELSE 'unknown'
  END
$$;

-- Sandbox expiry is managed only by the server cleanup job.
REVOKE UPDATE (sandbox_expires_at) ON public.profiles FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_patient_timezone()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT organization.timezone
    FROM public.provider_patient_links AS link
    JOIN public.organization_memberships AS membership
      ON membership.user_id = link.provider_id
     AND membership.status = 'active'
     AND membership.is_default
    JOIN public.organizations AS organization
      ON organization.id = membership.organization_id
     AND organization.status = 'active'
    WHERE link.patient_id = (SELECT auth.uid())
      AND link.status = 'active'
    ORDER BY link.linked_at DESC NULLS LAST, link.created_at DESC
    LIMIT 1
  ), 'America/New_York')
$$;

REVOKE ALL ON FUNCTION public.get_patient_timezone() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_patient_timezone() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Privacy-safe adoption telemetry for the synthetic sandbox
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_events
  DROP CONSTRAINT product_events_actor_id_fkey,
  ALTER COLUMN actor_id DROP NOT NULL,
  ADD CONSTRAINT product_events_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  DROP CONSTRAINT product_events_actor_role_check,
  ADD CONSTRAINT product_events_actor_role_check CHECK (
    actor_role IN ('provider', 'patient', 'tester')
  ),
  DROP CONSTRAINT product_events_event_name_check,
  ADD CONSTRAINT product_events_event_name_check CHECK (event_name IN (
    'workspace_view', 'daily_loop_view', 'work_item_reviewed',
    'work_item_actioned', 'work_item_awaiting', 'work_item_closed',
    'work_item_reassigned', 'saved_view_created', 'patient_brief_view',
    'patient_today_view', 'access_review', 'sandbox_view',
    'sandbox_first_action', 'sandbox_task_completed', 'sandbox_returned',
    'queue_page_view', 'fhir_export_created', 'offline_draft_saved'
  )),
  DROP CONSTRAINT product_events_area_check,
  ADD CONSTRAINT product_events_area_check CHECK (area IN (
    'provider_home', 'patient_workspace', 'patient_today', 'patient_plan',
    'privacy', 'inbox', 'reports', 'team', 'sandbox', 'interoperability'
  ));

CREATE POLICY "users_update_own_product_event_duration"
  ON public.product_events FOR UPDATE TO authenticated
  USING (actor_id = (SELECT auth.uid()))
  WITH CHECK (actor_id = (SELECT auth.uid()));
GRANT INSERT (id) ON public.product_events TO authenticated;
GRANT UPDATE (duration_ms) ON public.product_events TO authenticated;

CREATE OR REPLACE FUNCTION public.get_adoption_summary(p_since timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'active_sandbox_accounts', (
      SELECT count(*) FROM public.profiles
      WHERE role = 'tester' AND sandbox_expires_at > now()
    ),
    'unique_sandbox_testers', (
      SELECT count(DISTINCT actor_id) FROM public.product_events
      WHERE actor_role = 'tester' AND occurred_at >= p_since AND actor_id IS NOT NULL
    ),
    'sandbox_views', (
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND event_name = 'sandbox_view'
        AND occurred_at >= p_since
    ),
    'sandbox_first_actions', (
      SELECT count(DISTINCT actor_id) FROM public.product_events
      WHERE actor_role = 'tester' AND event_name = 'sandbox_first_action'
        AND occurred_at >= p_since AND actor_id IS NOT NULL
    ),
    'sandbox_task_completions', (
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND event_name = 'sandbox_task_completed'
        AND occurred_at >= p_since
    ),
    'median_session_duration_ms', COALESCE((
      SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_ms)
      FROM public.product_events
      WHERE actor_role = 'tester' AND event_name = 'sandbox_view'
        AND occurred_at >= p_since AND duration_ms IS NOT NULL
    ), 0)
  )
$$;

REVOKE ALL ON FUNCTION public.get_adoption_summary(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_adoption_summary(timestamptz)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Active-signal coalescence support
-- ---------------------------------------------------------------------------
ALTER TABLE public.alerts
  ADD COLUMN occurrence_count int NOT NULL DEFAULT 1
    CHECK (occurrence_count BETWEEN 1 AND 1000000),
  ADD COLUMN first_seen_at timestamptz,
  ADD COLUMN last_seen_at timestamptz,
  ADD COLUMN resolution_note text
    CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000);

GRANT UPDATE (resolution_note) ON public.alerts TO authenticated;

CREATE TABLE public.alert_consolidation_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duplicate_alert_id uuid NOT NULL UNIQUE
    REFERENCES public.alerts(id) ON DELETE RESTRICT,
  keeper_alert_id    uuid NOT NULL
    REFERENCES public.alerts(id) ON DELETE RESTRICT,
  consolidated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (duplicate_alert_id <> keeper_alert_id)
);

CREATE INDEX alert_consolidation_keeper_idx
  ON public.alert_consolidation_events (keeper_alert_id, consolidated_at DESC);
ALTER TABLE public.alert_consolidation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.alert_consolidation_events
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.alert_consolidation_events TO service_role;

CREATE OR REPLACE FUNCTION public.reject_alert_consolidation_event_mutation()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$ BEGIN RAISE EXCEPTION 'alert consolidation events are append-only'; END $$;
CREATE TRIGGER reject_alert_consolidation_event_mutation
  BEFORE UPDATE OR DELETE ON public.alert_consolidation_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_alert_consolidation_event_mutation();
REVOKE ALL ON FUNCTION public.reject_alert_consolidation_event_mutation()
  FROM PUBLIC, anon, authenticated;

-- Human state transitions require an authenticated provider and a documented
-- resolution. Server-only signal refreshes may change only evolving signal
-- fields; legacy consolidation is allowed only when its immutable map exists.
CREATE OR REPLACE FUNCTION public.enforce_alert_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
BEGIN
  IF actor IS NULL THEN
    IF NEW.status = OLD.status THEN
      IF NEW.id <> OLD.id
        OR NEW.patient_id <> OLD.patient_id
        OR NEW.status <> OLD.status
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by
        OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
        OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by
        OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
        OR NEW.resolution_note IS DISTINCT FROM OLD.resolution_note THEN
        RAISE EXCEPTION 'invalid server alert refresh';
      END IF;
      RETURN NEW;
    END IF;

    IF OLD.status IN ('open', 'acknowledged')
      AND NEW.status = 'resolved'
      AND EXISTS (
        SELECT 1
        FROM public.alert_consolidation_events AS event
        WHERE event.duplicate_alert_id = OLD.id
          AND NEW.resolution_note LIKE
            '%' || event.keeper_alert_id::text || '%'
      ) THEN
      NEW.resolved_by := NULL;
      NEW.resolved_at := COALESCE(NEW.resolved_at, now());
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'an authenticated actor is required';
  END IF;

  IF OLD.status = 'open' AND NEW.status = 'acknowledged' THEN
    IF NEW.resolution_note IS DISTINCT FROM OLD.resolution_note THEN
      RAISE EXCEPTION 'acknowledgement cannot set a resolution outcome';
    END IF;
    NEW.acknowledged_by := actor;
    NEW.acknowledged_at := now();
  ELSIF OLD.status IN ('open', 'acknowledged') AND NEW.status = 'resolved' THEN
    IF NEW.resolution_note IS NULL
      OR char_length(btrim(NEW.resolution_note)) < 3 THEN
      RAISE EXCEPTION 'resolving an alert requires an outcome';
    END IF;
    NEW.resolved_by := actor;
    NEW.resolved_at := now();
  ELSE
    RAISE EXCEPTION 'invalid alert status transition';
  END IF;

  RETURN NEW;
END;
$$;

UPDATE public.alerts
SET first_seen_at = created_at,
    last_seen_at = created_at
WHERE first_seen_at IS NULL OR last_seen_at IS NULL;

ALTER TABLE public.alerts
  ALTER COLUMN first_seen_at SET NOT NULL,
  ALTER COLUMN last_seen_at SET NOT NULL;

CREATE INDEX alerts_active_patient_flags_idx
  ON public.alerts (patient_id, status, last_seen_at DESC)
  WHERE status IN ('open', 'acknowledged');

-- Coalesce an incoming signal into an existing active patient+flag alert.
-- The function is server-only because alert creation is a trusted cron path.
CREATE OR REPLACE FUNCTION public.coalesce_patient_alert(
  p_patient_id uuid,
  p_vitals_id uuid,
  p_severity text,
  p_flags text[]
)
RETURNS TABLE (alert_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  existing_alert_id uuid;
  normalized_flags text[];
BEGIN
  IF p_severity NOT IN ('critical', 'warning') THEN
    RAISE EXCEPTION 'invalid alert severity';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT flag
    FROM unnest(p_flags) AS flag
    WHERE flag IS NOT NULL AND btrim(flag) <> ''
    ORDER BY flag
  ) INTO normalized_flags;

  IF cardinality(normalized_flags) = 0 THEN
    RAISE EXCEPTION 'at least one alert flag is required';
  END IF;

  -- Serialize active-signal matching for one patient. Without this lock, two
  -- simultaneous first observations could both miss an uncommitted row.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_patient_id::text, 0)
  );

  SELECT alert.id
  INTO existing_alert_id
  FROM public.alerts AS alert
  WHERE alert.patient_id = p_patient_id
    AND alert.status IN ('open', 'acknowledged')
    AND alert.flags && normalized_flags
  ORDER BY alert.last_seen_at DESC, alert.id
  FOR UPDATE
  LIMIT 1;

  IF existing_alert_id IS NOT NULL THEN
    UPDATE public.alerts
    SET flags = ARRAY(
          SELECT DISTINCT flag
          FROM unnest(public.alerts.flags || normalized_flags) AS flag
          ORDER BY flag
        ),
        severity = CASE
          WHEN public.alerts.severity = 'critical' OR p_severity = 'critical'
            THEN 'critical'
          WHEN public.alerts.severity = 'warning' OR p_severity = 'warning'
            THEN 'warning'
          ELSE 'informational'
        END,
        vitals_id = COALESCE(p_vitals_id, public.alerts.vitals_id),
        occurrence_count = public.alerts.occurrence_count + 1,
        last_seen_at = now()
    WHERE id = existing_alert_id;

    RETURN QUERY SELECT existing_alert_id, false;
    RETURN;
  END IF;

  INSERT INTO public.alerts (
    patient_id, vitals_id, severity, flags, status,
    occurrence_count, first_seen_at, last_seen_at
  ) VALUES (
    p_patient_id, p_vitals_id, p_severity, normalized_flags, 'open',
    1, now(), now()
  ) RETURNING id INTO existing_alert_id;

  RETURN QUERY SELECT existing_alert_id, true;
END;
$$;

REVOKE ALL ON FUNCTION public.coalesce_patient_alert(uuid, uuid, text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coalesce_patient_alert(uuid, uuid, text, text[])
  TO service_role;

-- Trusted alert coalescence may refresh only the evolving signal fields on its
-- canonical work item. Human/provider mutations keep the original immutable
-- source-context boundary.
CREATE OR REPLACE FUNCTION public.enforce_work_item_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  trusted_alert_refresh boolean := false;
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
      AND (SELECT auth.uid()) IS NOT NULL
      AND NOT public.is_org_manager(NEW.organization_id) THEN
      RAISE EXCEPTION 'only a team manager can assign work to another member';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  trusted_alert_refresh := (SELECT auth.uid()) IS NULL
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

  IF NEW.assigned_to <> OLD.assigned_to THEN
    IF NOT public.is_active_org_member(NEW.organization_id, NEW.assigned_to) THEN
      RAISE EXCEPTION 'assignee must be an active team member';
    END IF;
    IF (SELECT auth.uid()) IS NOT NULL AND NOT public.is_org_manager(NEW.organization_id) THEN
      RAISE EXCEPTION 'only a team manager can reassign work';
    END IF;
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

CREATE OR REPLACE FUNCTION public.write_work_item_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  event_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'created';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    event_name := NEW.status;
  ELSE
    event_name := 'updated';
  END IF;

  IF TG_OP = 'INSERT'
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.due_at IS DISTINCT FROM OLD.due_at
    OR NEW.outcome IS DISTINCT FROM OLD.outcome
    OR NEW.freshness_at IS DISTINCT FROM OLD.freshness_at
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.severity IS DISTINCT FROM OLD.severity THEN
    INSERT INTO public.work_item_events (
      work_item_id, actor_id, event_type, from_status, to_status
    ) VALUES (
      NEW.id,
      (SELECT auth.uid()),
      event_name,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
      NEW.status
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Preserve the latest source/freshness on an existing work item when its alert
-- is coalesced. Alert status changes still use the original trigger path.
CREATE OR REPLACE FUNCTION public.refresh_coalesced_alert_work_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at THEN
    UPDATE public.work_items
    SET reason = 'Triggered signals: ' || array_to_string(NEW.flags, ', ')
          || ' · observed ' || NEW.occurrence_count || ' times',
        severity = NEW.severity,
        freshness_at = NEW.last_seen_at,
        updated_at = now()
    WHERE source_type = 'alert' AND source_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER refresh_coalesced_alert_work_item
  AFTER UPDATE OF last_seen_at, occurrence_count, flags, severity
  ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.refresh_coalesced_alert_work_item();

REVOKE ALL ON FUNCTION public.refresh_coalesced_alert_work_item()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Audited FHIR R4 export foundation (read-only, no EHR writeback)
-- ---------------------------------------------------------------------------
CREATE TABLE public.data_export_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  patient_id    uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  format        text NOT NULL CHECK (format IN ('fhir-r4-json')),
  resource_count int NOT NULL CHECK (resource_count BETWEEN 1 AND 10000),
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX data_export_events_provider_time_idx
  ON public.data_export_events (provider_id, occurred_at DESC);
ALTER TABLE public.data_export_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "providers_insert_audited_exports"
  ON public.data_export_events FOR INSERT TO authenticated
  WITH CHECK (
    public.provider_aal2()
    AND provider_id = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );
CREATE POLICY "providers_read_own_export_audit"
  ON public.data_export_events FOR SELECT TO authenticated
  USING (public.provider_aal2() AND provider_id = (SELECT auth.uid()));
REVOKE ALL ON TABLE public.data_export_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.data_export_events TO authenticated;
GRANT INSERT (provider_id, patient_id, format, resource_count)
  ON public.data_export_events TO authenticated;
GRANT ALL ON TABLE public.data_export_events TO service_role;

CREATE OR REPLACE FUNCTION public.reject_data_export_event_mutation()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$ BEGIN RAISE EXCEPTION 'data export events are append-only'; END $$;
CREATE TRIGGER reject_data_export_event_mutation
  BEFORE UPDATE OR DELETE ON public.data_export_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_data_export_event_mutation();
REVOKE ALL ON FUNCTION public.reject_data_export_event_mutation()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Audit-preserving consolidation of legacy active duplicates
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    alert.id,
    first_value(alert.id) OVER (
      PARTITION BY alert.patient_id, alert.flags
      ORDER BY alert.last_seen_at DESC, alert.created_at DESC, alert.id
    ) AS keeper_id,
    row_number() OVER (
      PARTITION BY alert.patient_id, alert.flags
      ORDER BY alert.last_seen_at DESC, alert.created_at DESC, alert.id
    ) AS duplicate_rank
  FROM public.alerts AS alert
  WHERE alert.status IN ('open', 'acknowledged')
)
INSERT INTO public.alert_consolidation_events (
  duplicate_alert_id, keeper_alert_id
)
SELECT ranked.id, ranked.keeper_id
FROM ranked
WHERE ranked.duplicate_rank > 1
ON CONFLICT (duplicate_alert_id) DO NOTHING;

WITH ranked AS (
  SELECT
    alert.id,
    first_value(alert.id) OVER (
      PARTITION BY alert.patient_id, alert.flags
      ORDER BY alert.last_seen_at DESC, alert.created_at DESC, alert.id
    ) AS keeper_id,
    row_number() OVER (
      PARTITION BY alert.patient_id, alert.flags
      ORDER BY alert.last_seen_at DESC, alert.created_at DESC, alert.id
    ) AS duplicate_rank,
    count(*) OVER (PARTITION BY alert.patient_id, alert.flags) AS group_count
  FROM public.alerts AS alert
  WHERE alert.status IN ('open', 'acknowledged')
), aggregate_counts AS (
  SELECT keeper_id, max(group_count)::int AS group_count
  FROM ranked
  GROUP BY keeper_id
)
UPDATE public.alerts AS keeper
SET occurrence_count = GREATEST(keeper.occurrence_count, aggregate_counts.group_count),
    first_seen_at = LEAST(
      keeper.first_seen_at,
      (SELECT min(duplicate.first_seen_at)
       FROM public.alerts AS duplicate
       JOIN ranked ON ranked.id = duplicate.id
       WHERE ranked.keeper_id = keeper.id)
    )
FROM aggregate_counts
WHERE keeper.id = aggregate_counts.keeper_id
  AND aggregate_counts.group_count > 1;

WITH ranked AS (
  SELECT
    alert.id,
    first_value(alert.id) OVER (
      PARTITION BY alert.patient_id, alert.flags
      ORDER BY alert.last_seen_at DESC, alert.created_at DESC, alert.id
    ) AS keeper_id,
    row_number() OVER (
      PARTITION BY alert.patient_id, alert.flags
      ORDER BY alert.last_seen_at DESC, alert.created_at DESC, alert.id
    ) AS duplicate_rank
  FROM public.alerts AS alert
  WHERE alert.status IN ('open', 'acknowledged')
)
UPDATE public.alerts AS duplicate
SET status = 'resolved',
    resolved_at = COALESCE(duplicate.resolved_at, now()),
    resolution_note = left(
      COALESCE(duplicate.resolution_note || ' · ', '')
      || 'Consolidated into active alert ' || ranked.keeper_id::text,
      1000
    )
FROM ranked
WHERE duplicate.id = ranked.id
  AND ranked.duplicate_rank > 1;
