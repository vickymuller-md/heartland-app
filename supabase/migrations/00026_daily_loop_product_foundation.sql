-- HEARTLAND Daily Loop product foundation.
-- Canonical operational work, closed-loop transitions, privacy-safe product
-- telemetry, access visibility, and synchronization from existing sources.

-- ---------------------------------------------------------------------------
-- 1. Canonical provider work items
-- ---------------------------------------------------------------------------
CREATE TABLE public.work_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  provider_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_to     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  source_type     text NOT NULL CHECK (source_type IN (
    'alert', 'scheduled_followup', 'discharge_followup', 'manual', 'titration', 'data_quality'
  )),
  source_id       uuid,
  title           text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  reason          text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  change_summary  text CHECK (change_summary IS NULL OR char_length(change_summary) <= 1000),
  priority        text NOT NULL CHECK (priority IN ('now', 'today', 'week', 'watching')),
  severity        text NOT NULL CHECK (severity IN ('critical', 'warning', 'informational')),
  status          text NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'reviewed', 'actioned', 'awaiting', 'due', 'closed'
  )),
  due_at          timestamptz,
  freshness_at    timestamptz,
  data_quality    text NOT NULL DEFAULT 'unknown' CHECK (data_quality IN (
    'verified', 'partial', 'stale', 'unknown'
  )),
  snooze_reason   text CHECK (snooze_reason IS NULL OR char_length(snooze_reason) <= 500),
  outcome         text CHECK (outcome IS NULL OR char_length(outcome) <= 1000),
  reviewed_at     timestamptz,
  actioned_at     timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX work_items_source_unique
  ON public.work_items (provider_id, source_type, source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX work_items_provider_queue_idx
  ON public.work_items (provider_id, status, priority, due_at);
CREATE INDEX work_items_patient_timeline_idx
  ON public.work_items (patient_id, created_at DESC);

ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "providers_read_own_work_items"
  ON public.work_items FOR SELECT TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND assigned_to = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );

CREATE POLICY "providers_insert_own_work_items"
  ON public.work_items FOR INSERT TO authenticated
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND assigned_to = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
    AND source_type IN ('manual', 'titration', 'data_quality')
  );

CREATE POLICY "providers_update_own_work_items"
  ON public.work_items FOR UPDATE TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND assigned_to = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  )
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND assigned_to = (SELECT auth.uid())
    AND public.provider_has_patient(patient_id)
  );

REVOKE ALL ON TABLE public.work_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.work_items TO authenticated;
GRANT INSERT (
  patient_id, provider_id, assigned_to, source_type, title, reason,
  change_summary, priority, severity, due_at, freshness_at, data_quality
) ON public.work_items TO authenticated;
GRANT UPDATE (
  status, due_at, snooze_reason, outcome, assigned_to
) ON public.work_items TO authenticated;
GRANT ALL ON TABLE public.work_items TO service_role;

-- Fail-closed transition and ownership rules. Source identity and clinical
-- context are immutable after creation; only workflow state may change.
CREATE OR REPLACE FUNCTION public.enforce_work_item_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to <> NEW.provider_id THEN
      RAISE EXCEPTION 'cross-provider assignment requires a governed team';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.patient_id <> OLD.patient_id
    OR NEW.provider_id <> OLD.provider_id
    OR NEW.source_type <> OLD.source_type
    OR NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.title <> OLD.title
    OR NEW.reason <> OLD.reason
    OR NEW.severity <> OLD.severity
    OR NEW.priority <> OLD.priority
    OR NEW.freshness_at IS DISTINCT FROM OLD.freshness_at
    OR NEW.data_quality <> OLD.data_quality THEN
    RAISE EXCEPTION 'work item source and context are immutable';
  END IF;

  IF NEW.assigned_to <> OLD.assigned_to OR NEW.assigned_to <> NEW.provider_id THEN
    RAISE EXCEPTION 'cross-provider assignment requires a governed team';
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

CREATE TRIGGER enforce_work_item_transition
  BEFORE INSERT OR UPDATE ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_work_item_transition();

REVOKE ALL ON FUNCTION public.enforce_work_item_transition()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Immutable workflow event trail
-- ---------------------------------------------------------------------------
CREATE TABLE public.work_item_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id  uuid NOT NULL REFERENCES public.work_items(id) ON DELETE RESTRICT,
  actor_id      uuid,
  event_type    text NOT NULL CHECK (event_type IN (
    'created', 'reviewed', 'actioned', 'awaiting', 'due', 'closed', 'updated'
  )),
  from_status   text,
  to_status     text NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_item_events_item_idx
  ON public.work_item_events (work_item_id, occurred_at DESC);
ALTER TABLE public.work_item_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "providers_read_own_work_item_events"
  ON public.work_item_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.work_items AS item
      WHERE item.id = work_item_events.work_item_id
        AND item.provider_id = (SELECT auth.uid())
        AND item.assigned_to = (SELECT auth.uid())
        AND public.provider_has_patient(item.patient_id)
    )
  );

REVOKE ALL ON TABLE public.work_item_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.work_item_events TO authenticated;
GRANT ALL ON TABLE public.work_item_events TO service_role;

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
    OR NEW.outcome IS DISTINCT FROM OLD.outcome THEN
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

CREATE TRIGGER write_work_item_event
  AFTER INSERT OR UPDATE ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.write_work_item_event();

REVOKE ALL ON FUNCTION public.write_work_item_event()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reject_work_item_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'work item events are append-only';
END;
$$;

CREATE TRIGGER reject_work_item_event_mutation
  BEFORE UPDATE OR DELETE ON public.work_item_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_item_event_mutation();

REVOKE ALL ON FUNCTION public.reject_work_item_event_mutation()
  FROM PUBLIC, anon, authenticated;

-- Add work_items to the metadata-only audit ledger.
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();

-- ---------------------------------------------------------------------------
-- 3. Existing source synchronization
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_alert_work_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  linked_provider uuid;
  mapped_status text;
  mapped_priority text;
  mapped_due timestamptz;
BEGIN
  mapped_status := CASE NEW.status
    WHEN 'acknowledged' THEN 'reviewed'
    WHEN 'resolved' THEN 'closed'
    ELSE 'new'
  END;
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

  FOR linked_provider IN
    SELECT link.provider_id
    FROM public.provider_patient_links AS link
    WHERE link.patient_id = NEW.patient_id
      AND link.status = 'active'
  LOOP
    INSERT INTO public.work_items (
      patient_id, provider_id, assigned_to, source_type, source_id,
      title, reason, priority, severity, status, due_at, freshness_at,
      data_quality, outcome, reviewed_at, closed_at
    ) VALUES (
      NEW.patient_id,
      linked_provider,
      linked_provider,
      'alert',
      NEW.id,
      'Review patient alert',
      'Triggered signals: ' || array_to_string(NEW.flags, ', '),
      mapped_priority,
      NEW.severity,
      mapped_status,
      mapped_due,
      NEW.created_at,
      CASE WHEN NEW.vitals_id IS NULL THEN 'partial' ELSE 'verified' END,
      CASE WHEN NEW.status = 'resolved' THEN 'Alert resolved in the operational inbox' ELSE NULL END,
      CASE WHEN NEW.status IN ('acknowledged', 'resolved') THEN COALESCE(NEW.acknowledged_at, now()) ELSE NULL END,
      CASE WHEN NEW.status = 'resolved' THEN COALESCE(NEW.resolved_at, now()) ELSE NULL END
    )
    ON CONFLICT (provider_id, source_type, source_id)
      WHERE source_id IS NOT NULL
    DO UPDATE SET
      status = EXCLUDED.status,
      due_at = EXCLUDED.due_at,
      outcome = EXCLUDED.outcome,
      reviewed_at = COALESCE(public.work_items.reviewed_at, EXCLUDED.reviewed_at),
      closed_at = COALESCE(public.work_items.closed_at, EXCLUDED.closed_at),
      updated_at = now();
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_alert_work_items
  AFTER INSERT OR UPDATE OF status ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.sync_alert_work_items();

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
    data_quality, outcome, closed_at
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
    CASE WHEN NEW.completed THEN now() ELSE NULL END
  )
  ON CONFLICT (provider_id, source_type, source_id)
    WHERE source_id IS NOT NULL
  DO UPDATE SET
    status = EXCLUDED.status,
    due_at = EXCLUDED.due_at,
    outcome = EXCLUDED.outcome,
    closed_at = EXCLUDED.closed_at,
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_scheduled_followup_work_item
  AFTER INSERT OR UPDATE OF completed, scheduled_at ON public.scheduled_followups
  FOR EACH ROW EXECUTE FUNCTION public.sync_scheduled_followup_work_item();

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
    data_quality, outcome, closed_at
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
    CASE WHEN NEW.status IN ('completed', 'skipped') THEN COALESCE(NEW.completed_at, now()) ELSE NULL END
  )
  ON CONFLICT (provider_id, source_type, source_id)
    WHERE source_id IS NOT NULL
  DO UPDATE SET
    status = EXCLUDED.status,
    due_at = EXCLUDED.due_at,
    outcome = EXCLUDED.outcome,
    closed_at = EXCLUDED.closed_at,
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_discharge_followup_work_item
  AFTER INSERT OR UPDATE OF status, due_at ON public.discharge_followups
  FOR EACH ROW EXECUTE FUNCTION public.sync_discharge_followup_work_item();

REVOKE ALL ON FUNCTION public.sync_alert_work_items()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_scheduled_followup_work_item()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_discharge_followup_work_item()
  FROM PUBLIC, anon, authenticated;

-- Backfill the current operational state. Trigger-enforced values mirror the
-- same mapping used for future records.
INSERT INTO public.work_items (
  patient_id, provider_id, assigned_to, source_type, source_id,
  title, reason, priority, severity, status, due_at, freshness_at,
  data_quality, outcome, reviewed_at, closed_at
)
SELECT
  alert.patient_id,
  link.provider_id,
  link.provider_id,
  'alert',
  alert.id,
  'Review patient alert',
  'Triggered signals: ' || array_to_string(alert.flags, ', '),
  CASE alert.severity WHEN 'critical' THEN 'now' WHEN 'warning' THEN 'today' ELSE 'watching' END,
  alert.severity,
  CASE alert.status WHEN 'acknowledged' THEN 'reviewed' WHEN 'resolved' THEN 'closed' ELSE 'new' END,
  CASE alert.severity
    WHEN 'critical' THEN alert.created_at
    WHEN 'warning' THEN alert.created_at + interval '24 hours'
    ELSE alert.created_at + interval '7 days'
  END,
  alert.created_at,
  CASE WHEN alert.vitals_id IS NULL THEN 'partial' ELSE 'verified' END,
  CASE WHEN alert.status = 'resolved' THEN 'Alert resolved in the operational inbox' ELSE NULL END,
  alert.acknowledged_at,
  alert.resolved_at
FROM public.alerts AS alert
JOIN public.provider_patient_links AS link
  ON link.patient_id = alert.patient_id AND link.status = 'active'
ON CONFLICT (provider_id, source_type, source_id)
  WHERE source_id IS NOT NULL DO NOTHING;

INSERT INTO public.work_items (
  patient_id, provider_id, assigned_to, source_type, source_id,
  title, reason, priority, severity, status, due_at, freshness_at,
  data_quality, outcome, closed_at
)
SELECT
  followup.patient_id,
  followup.provider_id,
  followup.provider_id,
  'scheduled_followup',
  followup.id,
  'Follow-up: ' || left(followup.type, 120),
  COALESCE(NULLIF(left(followup.notes, 1000), ''), 'Scheduled patient follow-up'),
  CASE
    WHEN followup.scheduled_at <= now() THEN 'now'
    WHEN followup.scheduled_at < date_trunc('day', now()) + interval '1 day' THEN 'today'
    WHEN followup.scheduled_at < now() + interval '7 days' THEN 'week'
    ELSE 'watching'
  END,
  CASE WHEN followup.scheduled_at <= now() THEN 'warning' ELSE 'informational' END,
  CASE WHEN followup.completed THEN 'closed' WHEN followup.scheduled_at <= now() THEN 'due' ELSE 'new' END,
  followup.scheduled_at,
  followup.created_at,
  'verified',
  CASE WHEN followup.completed THEN 'Follow-up marked complete' ELSE NULL END,
  CASE WHEN followup.completed THEN now() ELSE NULL END
FROM public.scheduled_followups AS followup
ON CONFLICT (provider_id, source_type, source_id)
  WHERE source_id IS NOT NULL DO NOTHING;

INSERT INTO public.work_items (
  patient_id, provider_id, assigned_to, source_type, source_id,
  title, reason, priority, severity, status, due_at, freshness_at,
  data_quality, outcome, closed_at
)
SELECT
  followup.patient_id,
  followup.provider_id,
  followup.provider_id,
  'discharge_followup',
  followup.id,
  left(followup.label, 160),
  COALESCE(NULLIF(left(followup.purpose, 1000), ''), 'Post-discharge follow-up'),
  CASE
    WHEN followup.due_at <= now() THEN 'now'
    WHEN followup.due_at < date_trunc('day', now()) + interval '1 day' THEN 'today'
    WHEN followup.due_at < now() + interval '7 days' THEN 'week'
    ELSE 'watching'
  END,
  CASE WHEN followup.due_at <= now() THEN 'warning' ELSE 'informational' END,
  CASE WHEN followup.status IN ('completed', 'skipped') THEN 'closed' WHEN followup.due_at <= now() THEN 'due' ELSE 'new' END,
  followup.due_at,
  followup.created_at,
  'verified',
  CASE
    WHEN followup.status = 'completed' THEN COALESCE(NULLIF(left(followup.contact_notes, 1000), ''), 'Follow-up completed')
    WHEN followup.status = 'skipped' THEN 'Follow-up skipped'
    ELSE NULL
  END,
  CASE WHEN followup.status IN ('completed', 'skipped') THEN COALESCE(followup.completed_at, now()) ELSE NULL END
FROM public.discharge_followups AS followup
ON CONFLICT (provider_id, source_type, source_id)
  WHERE source_id IS NOT NULL DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Privacy-safe product telemetry (no patient/resource identifiers)
-- ---------------------------------------------------------------------------
CREATE TABLE public.product_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  actor_role    text NOT NULL CHECK (actor_role IN ('provider', 'patient')),
  event_name    text NOT NULL CHECK (event_name IN (
    'workspace_view', 'daily_loop_view', 'work_item_reviewed',
    'work_item_actioned', 'work_item_awaiting', 'work_item_closed',
    'patient_brief_view', 'patient_today_view', 'access_review'
  )),
  area          text NOT NULL CHECK (area IN (
    'provider_home', 'patient_workspace', 'patient_today', 'patient_plan',
    'privacy', 'inbox', 'reports'
  )),
  device_class  text CHECK (device_class IS NULL OR device_class IN ('mobile', 'tablet', 'desktop')),
  duration_ms   int CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 3600000),
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_events_actor_time_idx
  ON public.product_events (actor_id, occurred_at DESC);
CREATE INDEX product_events_aggregate_idx
  ON public.product_events (event_name, area, occurred_at DESC);
ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_insert_own_product_events"
  ON public.product_events FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = (SELECT auth.uid())
    AND actor_role = public.get_user_role()
    AND public.has_registration_consent()
  );

CREATE POLICY "users_read_own_product_events"
  ON public.product_events FOR SELECT TO authenticated
  USING (actor_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.product_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_events TO authenticated;
GRANT INSERT (actor_id, actor_role, event_name, area, device_class, duration_ms)
  ON public.product_events TO authenticated;
GRANT ALL ON TABLE public.product_events TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Patient-visible access relationships
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_patient_access_history()
RETURNS TABLE (
  link_id uuid,
  provider_id uuid,
  provider_name text,
  provider_phone text,
  status text,
  linked_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    link.id,
    link.provider_id,
    profile.full_name,
    profile.phone,
    link.status,
    link.linked_at,
    link.created_at
  FROM public.provider_patient_links AS link
  JOIN public.profiles AS profile ON profile.id = link.provider_id
  WHERE public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND link.patient_id = (SELECT auth.uid())
  ORDER BY COALESCE(link.linked_at, link.created_at) DESC
$$;

REVOKE ALL ON FUNCTION public.get_patient_access_history()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_patient_access_history()
  TO authenticated;
