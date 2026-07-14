-- Governed care teams, mandatory provider AAL2, operational delivery evidence,
-- saved queue views, access review, and server-only public intake throttling.

-- ---------------------------------------------------------------------------
-- 1. Provider MFA assurance helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_aal2()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.get_user_role() = 'provider'
    AND public.has_registration_consent()
    AND COALESCE((SELECT auth.jwt() ->> 'aal'), '') = 'aal2'
$$;

REVOKE ALL ON FUNCTION public.provider_aal2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_aal2() TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_has_patient(p_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.provider_aal2()
    AND EXISTS (
      SELECT 1
      FROM public.provider_patient_links AS link
      WHERE link.provider_id = (SELECT auth.uid())
        AND link.patient_id = p_patient_id
        AND link.status = 'active'
    )
$$;

-- Provider linkage and provider-owned metrics did not use provider_has_patient,
-- so enforce the same AAL2 boundary explicitly.
DROP POLICY IF EXISTS "providers_select_own_links" ON public.provider_patient_links;
DROP POLICY IF EXISTS "providers_insert_invites" ON public.provider_patient_links;
DROP POLICY IF EXISTS "providers_review_pending_links" ON public.provider_patient_links;
DROP POLICY IF EXISTS "providers_revoke_active_links" ON public.provider_patient_links;

CREATE POLICY "providers_select_own_links"
  ON public.provider_patient_links FOR SELECT TO authenticated
  USING (public.provider_aal2() AND provider_id = (SELECT auth.uid()));

CREATE POLICY "providers_insert_invites"
  ON public.provider_patient_links FOR INSERT TO authenticated
  WITH CHECK (
    public.provider_aal2()
    AND provider_id = (SELECT auth.uid())
    AND patient_id IS NULL
    AND status = 'invited'
    AND invite_email IS NOT NULL
    AND linked_at IS NULL
  );

CREATE POLICY "providers_review_pending_links"
  ON public.provider_patient_links FOR UPDATE TO authenticated
  USING (
    public.provider_aal2()
    AND provider_id = (SELECT auth.uid())
    AND patient_id IS NOT NULL
    AND status = 'pending'
  )
  WITH CHECK (
    public.provider_aal2()
    AND provider_id = (SELECT auth.uid())
    AND patient_id IS NOT NULL
    AND (
      (status = 'active' AND linked_at IS NOT NULL)
      OR (status = 'rejected' AND linked_at IS NULL)
    )
  );

CREATE POLICY "providers_revoke_active_links"
  ON public.provider_patient_links FOR UPDATE TO authenticated
  USING (
    public.provider_aal2()
    AND provider_id = (SELECT auth.uid())
    AND status = 'active'
  )
  WITH CHECK (
    public.provider_aal2()
    AND provider_id = (SELECT auth.uid())
    AND status = 'revoked'
  );

DROP POLICY IF EXISTS "providers_select_own_metrics" ON public.quality_metric_records;
DROP POLICY IF EXISTS "providers_insert_own_metrics" ON public.quality_metric_records;
DROP POLICY IF EXISTS "providers_update_own_metrics" ON public.quality_metric_records;

CREATE POLICY "providers_select_own_metrics"
  ON public.quality_metric_records FOR SELECT TO authenticated
  USING (public.provider_aal2() AND provider_id = (SELECT auth.uid()));
CREATE POLICY "providers_insert_own_metrics"
  ON public.quality_metric_records FOR INSERT TO authenticated
  WITH CHECK (public.provider_aal2() AND provider_id = (SELECT auth.uid()));
CREATE POLICY "providers_update_own_metrics"
  ON public.quality_metric_records FOR UPDATE TO authenticated
  USING (public.provider_aal2() AND provider_id = (SELECT auth.uid()))
  WITH CHECK (public.provider_aal2() AND provider_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Governed organizations and care-team membership
-- ---------------------------------------------------------------------------
CREATE TABLE public.organizations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 160),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  timezone              text NOT NULL DEFAULT 'America/New_York' CHECK (char_length(timezone) BETWEEN 3 AND 80),
  alert_sla_minutes     int NOT NULL DEFAULT 60 CHECK (alert_sla_minutes BETWEEN 5 AND 1440),
  downtime_contact      text CHECK (downtime_contact IS NULL OR char_length(downtime_contact) <= 160),
  is_personal           boolean NOT NULL DEFAULT false,
  created_by            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX organizations_personal_owner_unique
  ON public.organizations (created_by) WHERE is_personal;

CREATE TABLE public.organization_memberships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role              text NOT NULL CHECK (role IN ('owner', 'admin', 'clinician', 'coordinator')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  is_default        boolean NOT NULL DEFAULT false,
  joined_at         timestamptz,
  created_by        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id),
  CHECK ((status = 'active' AND joined_at IS NOT NULL) OR status <> 'active')
);

CREATE UNIQUE INDEX organization_memberships_default_unique
  ON public.organization_memberships (user_id)
  WHERE is_default AND status = 'active';
CREATE INDEX organization_memberships_org_status_idx
  ON public.organization_memberships (organization_id, status, role);

CREATE TABLE public.organization_patient_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  patient_id        uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  assigned_by       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  UNIQUE (organization_id, patient_id),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX organization_patient_assignments_patient_idx
  ON public.organization_patient_assignments (patient_id, status);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_patient_assignments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_active_org_member(
  p_organization_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    JOIN public.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN public.profiles AS profile
      ON profile.id = membership.user_id
    WHERE membership.organization_id = p_organization_id
      AND membership.user_id = COALESCE(p_user_id, (SELECT auth.uid()))
      AND membership.status = 'active'
      AND organization.status = 'active'
      AND profile.role = 'provider'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_manager(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.provider_aal2()
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.user_id = (SELECT auth.uid())
        AND membership.status = 'active'
        AND membership.role IN ('owner', 'admin')
    )
$$;

CREATE OR REPLACE FUNCTION public.org_has_patient(
  p_organization_id uuid,
  p_patient_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_patient_assignments AS assignment
    WHERE assignment.organization_id = p_organization_id
      AND assignment.patient_id = p_patient_id
      AND assignment.status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION public.primary_organization_for_provider(p_provider_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT membership.organization_id
  FROM public.organization_memberships AS membership
  JOIN public.organizations AS organization ON organization.id = membership.organization_id
  WHERE membership.user_id = p_provider_id
    AND membership.status = 'active'
    AND organization.status = 'active'
  ORDER BY membership.is_default DESC, membership.created_at ASC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.is_active_org_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_org_manager(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_has_patient(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primary_organization_for_provider(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_org_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_has_patient(uuid, uuid) TO authenticated;

-- Every current provider receives a governed personal organization. Providers
-- are never grouped by free-text facility name.
INSERT INTO public.organizations (name, is_personal, created_by)
SELECT
  left(
    COALESCE(NULLIF(btrim(profile.full_name), ''), 'Provider')
      || ' workspace',
    160
  ),
  true,
  profile.id
FROM public.profiles AS profile
WHERE profile.role = 'provider'
ON CONFLICT (created_by) WHERE is_personal DO NOTHING;

INSERT INTO public.organization_memberships (
  organization_id, user_id, role, status, is_default, joined_at, created_by
)
SELECT organization.id, organization.created_by, 'owner', 'active', true, now(), organization.created_by
FROM public.organizations AS organization
WHERE organization.is_personal
ON CONFLICT (organization_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.provision_provider_personal_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  personal_org uuid;
BEGIN
  IF NEW.role <> 'provider' OR (TG_OP = 'UPDATE' AND OLD.role = 'provider') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.organizations (name, is_personal, created_by)
  VALUES (
    left(
      COALESCE(NULLIF(btrim(NEW.full_name), ''), 'Provider')
        || ' workspace',
      160
    ),
    true,
    NEW.id
  )
  ON CONFLICT (created_by) WHERE is_personal DO UPDATE SET
    updated_at = public.organizations.updated_at
  RETURNING id INTO personal_org;

  INSERT INTO public.organization_memberships (
    organization_id, user_id, role, status, is_default, joined_at, created_by
  ) VALUES (personal_org, NEW.id, 'owner', 'active', true, now(), NEW.id)
  ON CONFLICT (organization_id, user_id) DO UPDATE SET
    status = 'active', role = 'owner', is_default = true,
    joined_at = COALESCE(public.organization_memberships.joined_at, now()),
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER provision_provider_personal_org
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.provision_provider_personal_org();
REVOKE ALL ON FUNCTION public.provision_provider_personal_org()
  FROM PUBLIC, anon, authenticated;

INSERT INTO public.organization_patient_assignments (
  organization_id, patient_id, status, assigned_by
)
SELECT
  membership.organization_id,
  link.patient_id,
  'active',
  link.provider_id
FROM public.provider_patient_links AS link
JOIN public.organization_memberships AS membership
  ON membership.user_id = link.provider_id
 AND membership.is_default
 AND membership.status = 'active'
WHERE link.status = 'active'
  AND link.patient_id IS NOT NULL
ON CONFLICT (organization_id, patient_id) DO UPDATE SET
  status = 'active',
  revoked_at = NULL;

CREATE POLICY "members_read_organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (public.provider_aal2() AND public.is_active_org_member(id));
CREATE POLICY "managers_update_organizations"
  ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_org_manager(id))
  WITH CHECK (public.is_org_manager(id) AND status = 'active');

CREATE POLICY "members_read_memberships"
  ON public.organization_memberships FOR SELECT TO authenticated
  USING (
    public.provider_aal2()
    AND public.is_active_org_member(organization_id)
  );

CREATE POLICY "members_read_patient_assignments"
  ON public.organization_patient_assignments FOR SELECT TO authenticated
  USING (
    public.provider_aal2()
    AND public.is_active_org_member(organization_id)
  );

REVOKE ALL ON TABLE public.organizations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.organization_memberships FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.organization_patient_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.organizations TO authenticated;
GRANT UPDATE (name, timezone, alert_sla_minutes, downtime_contact, updated_at)
  ON public.organizations TO authenticated;
GRANT SELECT ON TABLE public.organization_memberships TO authenticated;
GRANT SELECT ON TABLE public.organization_patient_assignments TO authenticated;
GRANT ALL ON TABLE public.organizations TO service_role;
GRANT ALL ON TABLE public.organization_memberships TO service_role;
GRANT ALL ON TABLE public.organization_patient_assignments TO service_role;

-- Keep personal organization patient scope synchronized with governed links.
CREATE OR REPLACE FUNCTION public.sync_default_org_patient_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  default_org uuid;
BEGIN
  IF NEW.provider_id IS NULL OR NEW.patient_id IS NULL THEN
    RETURN NEW;
  END IF;

  default_org := public.primary_organization_for_provider(NEW.provider_id);
  IF default_org IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'active' THEN
    INSERT INTO public.organization_patient_assignments (
      organization_id, patient_id, status, assigned_by
    ) VALUES (default_org, NEW.patient_id, 'active', NEW.provider_id)
    ON CONFLICT (organization_id, patient_id) DO UPDATE SET
      status = 'active',
      revoked_at = NULL;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status <> 'active' THEN
    UPDATE public.organization_patient_assignments AS assignment
    SET status = 'revoked', revoked_at = now()
    WHERE assignment.organization_id = default_org
      AND assignment.patient_id = NEW.patient_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.provider_patient_links AS other_link
        JOIN public.organization_memberships AS other_member
          ON other_member.user_id = other_link.provider_id
         AND other_member.organization_id = default_org
         AND other_member.status = 'active'
        WHERE other_link.patient_id = NEW.patient_id
          AND other_link.status = 'active'
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_default_org_patient_assignment ON public.provider_patient_links;
CREATE TRIGGER sync_default_org_patient_assignment
  AFTER INSERT OR UPDATE OF status, patient_id ON public.provider_patient_links
  FOR EACH ROW EXECUTE FUNCTION public.sync_default_org_patient_assignment();
REVOKE ALL ON FUNCTION public.sync_default_org_patient_assignment()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Team-aware operational queue and governed delegation
-- ---------------------------------------------------------------------------
ALTER TABLE public.work_items
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;

UPDATE public.work_items AS item
SET organization_id = public.primary_organization_for_provider(item.provider_id)
WHERE item.organization_id IS NULL;

ALTER TABLE public.work_items ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX work_items_org_workload_idx
  ON public.work_items (organization_id, assigned_to, status, due_at);

DROP POLICY IF EXISTS "providers_read_own_work_items" ON public.work_items;
DROP POLICY IF EXISTS "providers_insert_own_work_items" ON public.work_items;
DROP POLICY IF EXISTS "providers_update_own_work_items" ON public.work_items;

CREATE POLICY "team_read_work_items"
  ON public.work_items FOR SELECT TO authenticated
  USING (
    public.provider_aal2()
    AND public.is_active_org_member(organization_id)
    AND public.org_has_patient(organization_id, patient_id)
    AND (
      assigned_to = (SELECT auth.uid())
      OR public.is_org_manager(organization_id)
    )
  );

CREATE POLICY "team_insert_work_items"
  ON public.work_items FOR INSERT TO authenticated
  WITH CHECK (
    public.provider_aal2()
    AND provider_id = (SELECT auth.uid())
    AND public.is_active_org_member(organization_id)
    AND public.is_active_org_member(organization_id, assigned_to)
    AND public.org_has_patient(organization_id, patient_id)
    AND source_type IN ('manual', 'titration', 'data_quality')
  );

CREATE POLICY "team_update_work_items"
  ON public.work_items FOR UPDATE TO authenticated
  USING (
    public.provider_aal2()
    AND public.is_active_org_member(organization_id)
    AND public.org_has_patient(organization_id, patient_id)
    AND (
      assigned_to = (SELECT auth.uid())
      OR public.is_org_manager(organization_id)
    )
  )
  WITH CHECK (
    public.provider_aal2()
    AND public.is_active_org_member(organization_id)
    AND public.is_active_org_member(organization_id, assigned_to)
    AND public.org_has_patient(organization_id, patient_id)
  );

CREATE OR REPLACE FUNCTION public.enforce_work_item_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
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

  IF NEW.patient_id <> OLD.patient_id
    OR NEW.provider_id <> OLD.provider_id
    OR NEW.organization_id <> OLD.organization_id
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

DROP POLICY IF EXISTS "providers_read_own_work_item_events" ON public.work_item_events;
CREATE POLICY "team_read_work_item_events"
  ON public.work_item_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.work_items AS item
      WHERE item.id = work_item_events.work_item_id
        AND public.provider_aal2()
        AND public.is_active_org_member(item.organization_id)
        AND public.org_has_patient(item.organization_id, item.patient_id)
        AND (
          item.assigned_to = (SELECT auth.uid())
          OR public.is_org_manager(item.organization_id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Saved Daily Loop views
-- ---------------------------------------------------------------------------
CREATE TABLE public.provider_saved_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  severity      text CHECK (severity IS NULL OR severity IN ('critical', 'warning', 'informational')),
  priority      text CHECK (priority IS NULL OR priority IN ('now', 'today', 'week', 'watching')),
  source_type   text CHECK (source_type IS NULL OR source_type IN (
    'alert', 'scheduled_followup', 'discharge_followup', 'manual', 'titration', 'data_quality'
  )),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX provider_saved_views_name_unique
  ON public.provider_saved_views (provider_id, lower(name));
ALTER TABLE public.provider_saved_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "providers_manage_saved_views"
  ON public.provider_saved_views FOR ALL TO authenticated
  USING (public.provider_aal2() AND provider_id = (SELECT auth.uid()))
  WITH CHECK (public.provider_aal2() AND provider_id = (SELECT auth.uid()));
REVOKE ALL ON TABLE public.provider_saved_views FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.provider_saved_views TO authenticated;
GRANT INSERT (provider_id, name, severity, priority, source_type)
  ON public.provider_saved_views TO authenticated;
GRANT UPDATE (name, severity, priority, source_type, updated_at)
  ON public.provider_saved_views TO authenticated;
GRANT ALL ON TABLE public.provider_saved_views TO service_role;

ALTER TABLE public.product_events
  DROP CONSTRAINT product_events_event_name_check,
  ADD CONSTRAINT product_events_event_name_check CHECK (event_name IN (
    'workspace_view', 'daily_loop_view', 'work_item_reviewed',
    'work_item_actioned', 'work_item_awaiting', 'work_item_closed',
    'work_item_reassigned', 'saved_view_created', 'patient_brief_view',
    'patient_today_view', 'access_review'
  )),
  DROP CONSTRAINT product_events_area_check,
  ADD CONSTRAINT product_events_area_check CHECK (area IN (
    'provider_home', 'patient_workspace', 'patient_today', 'patient_plan',
    'privacy', 'inbox', 'reports', 'team'
  ));

-- ---------------------------------------------------------------------------
-- 5. Notification availability/read evidence (not a device-delivery claim)
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_deliveries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  recipient_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  work_item_id      uuid REFERENCES public.work_items(id) ON DELETE RESTRICT,
  message_id        uuid REFERENCES public.provider_messages(id) ON DELETE RESTRICT,
  channel           text NOT NULL DEFAULT 'in_app' CHECK (channel = 'in_app'),
  state             text NOT NULL DEFAULT 'available' CHECK (state IN ('available', 'read', 'failed', 'superseded')),
  available_at      timestamptz NOT NULL DEFAULT now(),
  read_at           timestamptz,
  failure_code      text CHECK (failure_code IS NULL OR char_length(failure_code) <= 80),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(work_item_id, message_id) = 1),
  CHECK ((state = 'read' AND read_at IS NOT NULL) OR state <> 'read')
);

CREATE UNIQUE INDEX notification_deliveries_work_recipient_unique
  ON public.notification_deliveries (work_item_id, recipient_id)
  WHERE work_item_id IS NOT NULL AND state <> 'superseded';
CREATE UNIQUE INDEX notification_deliveries_message_recipient_unique
  ON public.notification_deliveries (message_id, recipient_id)
  WHERE message_id IS NOT NULL;
CREATE INDEX notification_deliveries_recipient_state_idx
  ON public.notification_deliveries (recipient_id, state, available_at DESC);
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipients_read_delivery_evidence"
  ON public.notification_deliveries FOR SELECT TO authenticated
  USING (
    recipient_id = (SELECT auth.uid())
    OR (
      public.provider_aal2()
      AND (
        EXISTS (
          SELECT 1 FROM public.work_items AS item
          WHERE item.id = notification_deliveries.work_item_id
            AND public.is_active_org_member(item.organization_id)
            AND (
              item.provider_id = (SELECT auth.uid())
              OR public.is_org_manager(item.organization_id)
            )
        )
        OR EXISTS (
          SELECT 1 FROM public.provider_messages AS message
          WHERE message.id = notification_deliveries.message_id
            AND message.provider_id = (SELECT auth.uid())
        )
      )
    )
  );

REVOKE ALL ON TABLE public.notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notification_deliveries TO authenticated;
GRANT ALL ON TABLE public.notification_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.sync_work_item_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    UPDATE public.notification_deliveries
    SET state = 'superseded', failure_code = 'reassigned', updated_at = now()
    WHERE work_item_id = NEW.id
      AND recipient_id = OLD.assigned_to
      AND state <> 'superseded';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    INSERT INTO public.notification_deliveries (
      organization_id, recipient_id, work_item_id, state
    ) VALUES (NEW.organization_id, NEW.assigned_to, NEW.id, 'available')
    ON CONFLICT (work_item_id, recipient_id)
      WHERE work_item_id IS NOT NULL AND state <> 'superseded'
    DO UPDATE SET state = 'available', failure_code = NULL, updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_work_item_delivery
  AFTER INSERT OR UPDATE OF assigned_to ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_work_item_delivery();

CREATE OR REPLACE FUNCTION public.sync_message_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  message_org uuid;
BEGIN
  message_org := public.primary_organization_for_provider(NEW.provider_id);
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notification_deliveries (
      organization_id, recipient_id, message_id, state, read_at
    ) VALUES (
      message_org,
      NEW.patient_id,
      NEW.id,
      CASE WHEN NEW.read_at IS NULL THEN 'available' ELSE 'read' END,
      NEW.read_at
    )
    ON CONFLICT (message_id, recipient_id) WHERE message_id IS NOT NULL
    DO NOTHING;
  ELSIF NEW.read_at IS DISTINCT FROM OLD.read_at AND NEW.read_at IS NOT NULL THEN
    UPDATE public.notification_deliveries
    SET state = 'read', read_at = NEW.read_at, updated_at = now()
    WHERE message_id = NEW.id AND recipient_id = NEW.patient_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_message_delivery
  AFTER INSERT OR UPDATE OF read_at ON public.provider_messages
  FOR EACH ROW EXECUTE FUNCTION public.sync_message_delivery();

REVOKE ALL ON FUNCTION public.sync_work_item_delivery() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_message_delivery() FROM PUBLIC, anon, authenticated;

INSERT INTO public.notification_deliveries (
  organization_id, recipient_id, work_item_id, state, available_at
)
SELECT item.organization_id, item.assigned_to, item.id, 'available', item.created_at
FROM public.work_items AS item
WHERE item.status <> 'closed'
ON CONFLICT DO NOTHING;

INSERT INTO public.notification_deliveries (
  organization_id, recipient_id, message_id, state, available_at, read_at
)
SELECT
  public.primary_organization_for_provider(message.provider_id),
  message.patient_id,
  message.id,
  CASE WHEN message.read_at IS NULL THEN 'available' ELSE 'read' END,
  message.created_at,
  message.read_at
FROM public.provider_messages AS message
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Access review evidence and aggregate team workload
-- ---------------------------------------------------------------------------
CREATE TABLE public.access_reviews (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  review_period               date NOT NULL,
  reviewer_id                 uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  active_members_count        int NOT NULL CHECK (active_members_count >= 0),
  active_patient_count        int NOT NULL CHECK (active_patient_count >= 0),
  open_work_items_count       int NOT NULL CHECK (open_work_items_count >= 0),
  findings                    text NOT NULL CHECK (char_length(findings) BETWEEN 3 AND 1000),
  completed_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, review_period)
);

ALTER TABLE public.access_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_read_access_reviews"
  ON public.access_reviews FOR SELECT TO authenticated
  USING (
    public.provider_aal2()
    AND public.is_active_org_member(organization_id)
  );
REVOKE ALL ON TABLE public.access_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.access_reviews TO authenticated;
GRANT ALL ON TABLE public.access_reviews TO service_role;

CREATE OR REPLACE FUNCTION public.complete_access_review(
  p_organization_id uuid,
  p_findings text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  review_id uuid;
  period_start date := date_trunc('month', current_date)::date;
BEGIN
  IF NOT public.is_org_manager(p_organization_id) THEN
    RAISE EXCEPTION 'not authorized for access review';
  END IF;
  IF p_findings IS NULL OR char_length(btrim(p_findings)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'findings must be between 3 and 1000 characters';
  END IF;

  INSERT INTO public.access_reviews (
    organization_id,
    review_period,
    reviewer_id,
    active_members_count,
    active_patient_count,
    open_work_items_count,
    findings
  ) VALUES (
    p_organization_id,
    period_start,
    (SELECT auth.uid()),
    (SELECT count(*) FROM public.organization_memberships
      WHERE organization_id = p_organization_id AND status = 'active'),
    (SELECT count(*) FROM public.organization_patient_assignments
      WHERE organization_id = p_organization_id AND status = 'active'),
    (SELECT count(*) FROM public.work_items
      WHERE organization_id = p_organization_id AND status <> 'closed'),
    btrim(p_findings)
  )
  ON CONFLICT (organization_id, review_period) DO UPDATE SET
    reviewer_id = EXCLUDED.reviewer_id,
    active_members_count = EXCLUDED.active_members_count,
    active_patient_count = EXCLUDED.active_patient_count,
    open_work_items_count = EXCLUDED.open_work_items_count,
    findings = EXCLUDED.findings,
    completed_at = now()
  RETURNING id INTO review_id;

  RETURN review_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_team_members()
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  member_id uuid,
  member_name text,
  member_role text,
  is_default boolean,
  is_self boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    organization.id,
    organization.name,
    member.user_id,
    profile.full_name,
    member.role,
    member.is_default,
    member.user_id = (SELECT auth.uid())
  FROM public.organization_memberships AS caller
  JOIN public.organizations AS organization
    ON organization.id = caller.organization_id AND organization.status = 'active'
  JOIN public.organization_memberships AS member
    ON member.organization_id = caller.organization_id AND member.status = 'active'
  JOIN public.profiles AS profile ON profile.id = member.user_id
  WHERE public.provider_aal2()
    AND caller.user_id = (SELECT auth.uid())
    AND caller.status = 'active'
  ORDER BY caller.is_default DESC, organization.name, profile.full_name
$$;

CREATE OR REPLACE FUNCTION public.get_team_workload()
RETURNS TABLE (
  organization_id uuid,
  member_id uuid,
  member_name text,
  member_role text,
  open_count bigint,
  overdue_count bigint,
  due_today_count bigint,
  critical_count bigint,
  oldest_due_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    member.organization_id,
    member.user_id,
    profile.full_name,
    member.role,
    count(item.id) FILTER (WHERE item.status <> 'closed'),
    count(item.id) FILTER (WHERE item.status <> 'closed' AND item.due_at < now()),
    count(item.id) FILTER (
      WHERE item.status <> 'closed'
        AND item.due_at >= date_trunc('day', now())
        AND item.due_at < date_trunc('day', now()) + interval '1 day'
    ),
    count(item.id) FILTER (WHERE item.status <> 'closed' AND item.severity = 'critical'),
    min(item.due_at) FILTER (WHERE item.status <> 'closed')
  FROM public.organization_memberships AS caller
  JOIN public.organization_memberships AS member
    ON member.organization_id = caller.organization_id AND member.status = 'active'
  JOIN public.profiles AS profile ON profile.id = member.user_id
  LEFT JOIN public.work_items AS item
    ON item.organization_id = member.organization_id AND item.assigned_to = member.user_id
  WHERE public.provider_aal2()
    AND caller.user_id = (SELECT auth.uid())
    AND caller.status = 'active'
  GROUP BY member.organization_id, member.user_id, profile.full_name, member.role
  ORDER BY 6 DESC, 8 DESC, 3
$$;

CREATE OR REPLACE FUNCTION public.get_team_delivery_health()
RETURNS TABLE (
  organization_id uuid,
  available_count bigint,
  read_count bigint,
  failed_count bigint,
  superseded_count bigint,
  oldest_available_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    caller.organization_id,
    count(delivery.id) FILTER (WHERE delivery.state = 'available'),
    count(delivery.id) FILTER (WHERE delivery.state = 'read'),
    count(delivery.id) FILTER (WHERE delivery.state = 'failed'),
    count(delivery.id) FILTER (WHERE delivery.state = 'superseded'),
    min(delivery.available_at) FILTER (WHERE delivery.state = 'available')
  FROM public.organization_memberships AS caller
  LEFT JOIN public.notification_deliveries AS delivery
    ON delivery.organization_id = caller.organization_id
  WHERE public.provider_aal2()
    AND caller.user_id = (SELECT auth.uid())
    AND caller.status = 'active'
  GROUP BY caller.organization_id
  ORDER BY caller.organization_id
$$;

REVOKE ALL ON FUNCTION public.complete_access_review(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_team_members() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_team_workload() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_team_delivery_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_access_review(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_team_members() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_workload() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_delivery_health() TO authenticated;

-- Audit authorization/governance mutations without copying clinical payloads.
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.organization_patient_assignments
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.access_reviews
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();

-- ---------------------------------------------------------------------------
-- 7. Server-only, rate-limited professional access intake
-- ---------------------------------------------------------------------------
CREATE TABLE public.access_request_rate_limits (
  requester_hash    text PRIMARY KEY CHECK (char_length(requester_hash) = 64),
  window_started_at timestamptz NOT NULL,
  attempt_count     int NOT NULL CHECK (attempt_count BETWEEN 1 AND 5),
  last_attempt_at   timestamptz NOT NULL
);

ALTER TABLE public.access_request_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.access_request_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.access_request_rate_limits TO service_role;

DROP POLICY IF EXISTS "Anyone may submit a pending access request" ON public.access_requests;
REVOKE INSERT ON TABLE public.access_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_access_request(
  p_requester_hash text,
  p_full_name text,
  p_email text,
  p_npi text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_facility text DEFAULT NULL,
  p_role_claim text DEFAULT NULL,
  p_message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  request_id uuid;
  current_attempts int;
  normalized_email text := lower(btrim(p_email));
BEGIN
  IF p_requester_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid request fingerprint';
  END IF;
  IF char_length(btrim(p_full_name)) NOT BETWEEN 2 AND 120
    OR char_length(normalized_email) NOT BETWEEN 3 AND 254
    OR normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    OR (p_npi IS NOT NULL AND p_npi !~ '^[0-9]{10}$')
    OR (p_state IS NOT NULL AND p_state !~ '^[A-Z]{2}$')
    OR char_length(COALESCE(p_facility, '')) > 160
    OR char_length(COALESCE(p_role_claim, '')) > 40
    OR char_length(COALESCE(p_message, '')) > 1200 THEN
    RAISE EXCEPTION 'invalid access request';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_requester_hash, 0));

  INSERT INTO public.access_request_rate_limits (
    requester_hash, window_started_at, attempt_count, last_attempt_at
  ) VALUES (p_requester_hash, now(), 1, now())
  ON CONFLICT (requester_hash) DO UPDATE SET
    window_started_at = CASE
      WHEN public.access_request_rate_limits.window_started_at < now() - interval '1 hour'
        THEN now()
      ELSE public.access_request_rate_limits.window_started_at
    END,
    attempt_count = CASE
      WHEN public.access_request_rate_limits.window_started_at < now() - interval '1 hour'
        THEN 1
      WHEN public.access_request_rate_limits.attempt_count < 5
        THEN public.access_request_rate_limits.attempt_count + 1
      ELSE public.access_request_rate_limits.attempt_count
    END,
    last_attempt_at = now()
  RETURNING attempt_count INTO current_attempts;

  IF current_attempts >= 5 THEN
    RAISE EXCEPTION 'access request rate limit exceeded';
  END IF;

  IF (
    SELECT count(*)
    FROM public.access_requests
    WHERE lower(email) = normalized_email
      AND created_at > now() - interval '24 hours'
  ) >= 2 THEN
    RAISE EXCEPTION 'access request rate limit exceeded';
  END IF;

  INSERT INTO public.access_requests (
    full_name, email, npi, state, facility, role_claim, message, status
  ) VALUES (
    btrim(p_full_name),
    normalized_email,
    NULLIF(btrim(COALESCE(p_npi, '')), ''),
    NULLIF(btrim(COALESCE(p_state, '')), ''),
    NULLIF(btrim(COALESCE(p_facility, '')), ''),
    NULLIF(btrim(COALESCE(p_role_claim, '')), ''),
    NULLIF(btrim(COALESCE(p_message, '')), ''),
    'pending'
  ) RETURNING id INTO request_id;

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_access_request(text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_access_request(text, text, text, text, text, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Formally validate the legacy rows protected by migration 00025 checks
-- ---------------------------------------------------------------------------
ALTER TABLE public.vitals VALIDATE CONSTRAINT vitals_clinical_ranges;
ALTER TABLE public.lab_results VALIDATE CONSTRAINT lab_results_clinical_ranges;
ALTER TABLE public.patients VALIDATE CONSTRAINT patients_setup_steps_range;
ALTER TABLE public.patients VALIDATE CONSTRAINT patients_comorbidities_limit;
ALTER TABLE public.provider_notes VALIDATE CONSTRAINT provider_notes_content_length;
ALTER TABLE public.provider_messages VALIDATE CONSTRAINT provider_messages_content_length;
ALTER TABLE public.discharge_records VALIDATE CONSTRAINT discharge_notes_length;
ALTER TABLE public.discharge_followups VALIDATE CONSTRAINT discharge_contact_notes_length;
ALTER TABLE public.quality_metric_records VALIDATE CONSTRAINT quality_metric_values_valid;

-- ---------------------------------------------------------------------------
-- 9. Aggregate security posture monitoring (contains no patient-level data)
-- ---------------------------------------------------------------------------
CREATE TABLE public.security_posture_snapshots (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_status                     text NOT NULL CHECK (gate_status IN ('pass', 'degraded')),
  provider_count                  int NOT NULL CHECK (provider_count >= 0),
  providers_with_verified_mfa     int NOT NULL CHECK (providers_with_verified_mfa >= 0),
  organizations_without_review    int NOT NULL CHECK (organizations_without_review >= 0),
  failed_delivery_count           int NOT NULL CHECK (failed_delivery_count >= 0),
  overdue_work_item_count         int NOT NULL CHECK (overdue_work_item_count >= 0),
  captured_at                     timestamptz NOT NULL DEFAULT now(),
  CHECK (providers_with_verified_mfa <= provider_count)
);

CREATE INDEX security_posture_snapshots_captured_idx
  ON public.security_posture_snapshots (captured_at DESC);

ALTER TABLE public.security_posture_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.security_posture_snapshots FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.security_posture_snapshots TO service_role;

-- ---------------------------------------------------------------------------
-- 10. Atomic, rate-limited patient-to-provider linkage
-- ---------------------------------------------------------------------------
CREATE TABLE public.linkage_lookup_rate_limits (
  user_id             uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  window_started_at   timestamptz NOT NULL DEFAULT now(),
  attempt_count       int NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 11),
  last_attempt_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.linkage_lookup_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.linkage_lookup_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.linkage_lookup_rate_limits TO service_role;

DROP POLICY IF EXISTS "patients_insert_linkage_requests" ON public.provider_patient_links;
REVOKE ALL ON FUNCTION public.lookup_provider_by_code(text) FROM authenticated;

CREATE OR REPLACE FUNCTION public.request_provider_linkage(p_code text)
RETURNS TABLE (provider_id uuid, provider_name text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  patient_user_id uuid := (SELECT auth.uid());
  current_attempts int;
  resolved_provider_id uuid;
  resolved_provider_name text;
BEGIN
  IF patient_user_id IS NULL
    OR public.get_user_role() <> 'patient'
    OR NOT public.has_registration_consent()
    OR p_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$' THEN
    RAISE EXCEPTION 'invalid linkage request';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(patient_user_id::text, 0));
  INSERT INTO public.linkage_lookup_rate_limits (
    user_id, window_started_at, attempt_count, last_attempt_at
  ) VALUES (
    patient_user_id, now(), 1, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    window_started_at = CASE
      WHEN public.linkage_lookup_rate_limits.window_started_at < now() - interval '1 hour'
        THEN now()
      ELSE public.linkage_lookup_rate_limits.window_started_at
    END,
    attempt_count = CASE
      WHEN public.linkage_lookup_rate_limits.window_started_at < now() - interval '1 hour'
        THEN 1
      WHEN public.linkage_lookup_rate_limits.attempt_count < 11
        THEN public.linkage_lookup_rate_limits.attempt_count + 1
      ELSE public.linkage_lookup_rate_limits.attempt_count
    END,
    last_attempt_at = now()
  RETURNING attempt_count INTO current_attempts;

  IF current_attempts > 10 THEN
    RAISE EXCEPTION 'linkage request rate limit exceeded';
  END IF;

  SELECT profile.id, profile.full_name
  INTO resolved_provider_id, resolved_provider_name
  FROM public.profiles AS profile
  WHERE profile.role = 'provider'
    AND profile.provider_code = p_code
  LIMIT 1;

  IF resolved_provider_id IS NULL THEN
    RAISE EXCEPTION 'invalid linkage request';
  END IF;

  INSERT INTO public.provider_patient_links (
    provider_id, patient_id, status, invite_email, linked_at
  ) VALUES (
    resolved_provider_id, patient_user_id, 'pending', NULL, NULL
  )
  ON CONFLICT ON CONSTRAINT provider_patient_links_provider_id_patient_id_key DO UPDATE SET
    status = 'pending',
    invite_email = NULL,
    linked_at = NULL
  WHERE public.provider_patient_links.status IN ('rejected', 'revoked');

  RETURN QUERY SELECT resolved_provider_id, resolved_provider_name;
END;
$$;

REVOKE ALL ON FUNCTION public.request_provider_linkage(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_provider_linkage(text) TO authenticated;

-- Remove a legacy PL/pgSQL shadow warning and prevent direct RPC use of the
-- code generator. Provider-code assignment continues through its trigger.
CREATE OR REPLACE FUNCTION public.generate_provider_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  generated_code text := '';
BEGIN
  LOOP
    generated_code := '';
    FOR loop_index IN 1..6 LOOP
      generated_code := generated_code || substr(chars, floor(random() * 30 + 1)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE provider_code = generated_code
    );
  END LOOP;
  RETURN generated_code;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_provider_code() FROM PUBLIC, anon, authenticated;
