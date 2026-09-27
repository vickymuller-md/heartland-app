-- Local inert N2 capture. No worker, destinations, attempts, schedule or sends.
-- Apply atomically only after the separate release/retention/cutover gates.
-- Source -> ordered work -> generation/intent. Work updates NEVER lock/write
-- source state or account rows. Revision 0 means unobserved legacy reassignment.

CREATE TABLE public.notification_source_state (
  alert_id uuid PRIMARY KEY REFERENCES public.alerts(id) ON DELETE CASCADE,
  source_revision bigint NOT NULL CHECK (source_revision > 0)
);
CREATE TABLE public.notification_work_state (
  work_item_id uuid PRIMARY KEY REFERENCES public.work_items(id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK (generation > 0)
);
CREATE TABLE public.notification_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE RESTRICT,
  alert_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  source_revision bigint NOT NULL CHECK (source_revision >= 0),
  generation bigint NOT NULL CHECK (generation > 0),
  event_kind text NOT NULL CHECK (event_kind IN ('critical_created','critical_escalated','critical_reassigned')),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  capture_state text NOT NULL CHECK (capture_state IN ('pending','blocked')),
  blocked_reason text CHECK (blocked_reason IN ('inactive_org','inactive_member','no_patient_scope',
    'no_active_link','no_monitor_authorization','blocked_preference')),
  state text NOT NULL CHECK (state IN ('pending','blocked','cancelled')),
  cancelled_at timestamptz,
  cancellation_reason text CHECK (cancellation_reason IN ('work_closed','source_resolved','recipient_superseded')),
  UNIQUE (work_item_id,generation),
  UNIQUE (work_item_id,generation,recipient_id),
  CHECK (source_revision > 0 OR event_kind = 'critical_reassigned'),
  CHECK ((capture_state = 'pending' AND blocked_reason IS NULL)
    OR (capture_state = 'blocked' AND blocked_reason IS NOT NULL)),
  CHECK ((state = capture_state AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR (state = 'cancelled' AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL))
);
CREATE TABLE public.notification_routing_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE RESTRICT,
  alert_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  source_revision bigint NOT NULL CHECK (source_revision > 0),
  reason text NOT NULL CHECK (reason IN ('closed_work_later_signal','critical_new_flag')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id,work_item_id,source_revision)
);

ALTER TABLE public.notification_source_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_work_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_routing_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_source_state,public.notification_work_state,
  public.notification_intents,public.notification_routing_exceptions FROM PUBLIC,anon,authenticated,service_role;
-- No API read grants yet: the separately reviewed scoped operator view must
-- exist before activation. No account/receipt FK, no audit CASCADE or purge claim.

CREATE FUNCTION public.guard_notification_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='notification_intents' THEN
    IF (to_jsonb(NEW)-ARRAY['state','cancelled_at','cancellation_reason'])
      IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','cancelled_at','cancellation_reason'])
    AND OLD.state IN ('pending','blocked') AND NEW.state='cancelled' THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Notification history is immutable';
END;
$$;
CREATE TRIGGER guard_notification_history BEFORE UPDATE OR DELETE ON public.notification_intents
  FOR EACH ROW EXECUTE FUNCTION public.guard_notification_history();
CREATE TRIGGER guard_notification_history BEFORE UPDATE OR DELETE ON public.notification_routing_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_notification_history();

-- Capture observation only, not dispatch authorization. No account/scope locks
-- after work, and no use of the human AAL2-only capability wrapper for service.
CREATE FUNCTION public.notification_capture_block_reason(p_org uuid,p_patient uuid,p_recipient uuid,p_flags text[],p_at timestamptz)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE
  WHEN NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND status='active') THEN 'inactive_org'
  WHEN NOT public.is_active_org_member(p_org,p_recipient)
    OR NOT EXISTS(SELECT 1 FROM public.consents WHERE user_id=p_recipient AND consent_type='registration'
      AND consent_version='v1.0' AND accepted) THEN 'inactive_member'
  WHEN NOT public.org_has_patient(p_org,p_patient) OR NOT public.operational_patient_current(p_patient) THEN 'no_patient_scope'
  WHEN NOT EXISTS(SELECT 1 FROM public.provider_patient_links WHERE provider_id=p_recipient AND patient_id=p_patient AND status='active')
    THEN 'no_active_link'
  WHEN NOT EXISTS(SELECT 1 FROM public.member_authorizations AS grant_row
    JOIN public.organization_memberships AS member ON member.id=grant_row.membership_id
    WHERE member.organization_id=p_org AND member.user_id=p_recipient AND member.status='active'
      AND grant_row.capability='monitor' AND grant_row.revoked_at IS NULL
      AND (grant_row.expires_at IS NULL OR grant_row.expires_at>p_at)) THEN 'no_monitor_authorization'
  WHEN EXISTS(SELECT 1 FROM public.alert_preferences WHERE provider_id=p_recipient AND patient_id=p_patient
    AND alert_type=ANY(p_flags) AND muted) THEN 'blocked_preference'
  ELSE NULL END
$$;

-- Only orchestrator/row trigger callers, already holding the authoritative work
-- row. All subject consistency is checked NOW; historical recipient is immutable
-- and need not remain today's assigned_to. No source FK/lock here.
CREATE FUNCTION public.capture_notification_intent(p_work uuid,p_kind text,p_revision bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  item public.work_items%ROWTYPE;
  source public.alerts%ROWTYPE;
  next_generation bigint;
  blocked text;
  observed_at timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO STRICT item FROM public.work_items WHERE id=p_work;
  IF item.source_type<>'alert' OR item.source_id IS NULL OR item.status='closed'
    OR item.severity<>'critical' OR item.underlying_alert_resolved_at IS NOT NULL
    OR item.accountability_source IS NULL OR item.accountability_source='legacy_fan_out' THEN RETURN; END IF;
  SELECT * INTO STRICT source FROM public.alerts WHERE id=item.source_id AND patient_id=item.patient_id;
  IF source.status='resolved' THEN RETURN; END IF;
  IF source.severity<>'critical' THEN RAISE EXCEPTION 'Notification source does not match work'; END IF;
  blocked:=public.notification_capture_block_reason(item.organization_id,item.patient_id,item.assigned_to,source.flags,observed_at);
  INSERT INTO public.notification_work_state(work_item_id,generation) VALUES(item.id,1)
    ON CONFLICT(work_item_id) DO UPDATE SET generation=public.notification_work_state.generation+1
    RETURNING generation INTO next_generation;
  INSERT INTO public.notification_intents(work_item_id,alert_id,organization_id,patient_id,recipient_id,
    source_revision,generation,event_kind,captured_at,capture_state,blocked_reason,state)
  VALUES(item.id,source.id,item.organization_id,item.patient_id,item.assigned_to,p_revision,next_generation,p_kind,observed_at,
    CASE WHEN blocked IS NULL THEN 'pending' ELSE 'blocked' END,blocked,
    CASE WHEN blocked IS NULL THEN 'pending' ELSE 'blocked' END);
END;
$$;

CREATE FUNCTION public.capture_work_notification_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint; kind text; cancellation text;
BEGIN
  IF NEW.source_type<>'alert' OR NEW.source_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.severity IS DISTINCT FROM OLD.severity THEN
    RAISE EXCEPTION 'Combined source and ownership mutation is unsupported';
  END IF;
  cancellation:=CASE
    WHEN NEW.status='closed' THEN 'work_closed'
    WHEN NEW.underlying_alert_resolved_at IS NOT NULL THEN 'source_resolved'
    WHEN NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN 'recipient_superseded' END;
  IF cancellation IS NOT NULL THEN
    UPDATE public.notification_intents SET state='cancelled',cancelled_at=clock_timestamp(),cancellation_reason=cancellation
      WHERE work_item_id=NEW.id AND state IN ('pending','blocked');
  END IF;
  kind:=CASE
    WHEN NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.severity='critical' THEN 'critical_reassigned'
    WHEN OLD.severity<>'critical' AND NEW.severity='critical' THEN 'critical_escalated' END;
  IF kind IS NOT NULL THEN
    -- MVCC only; no UPSERT/row lock/FK to source-state. See contract §24.4.
    SELECT source_revision INTO revision FROM public.notification_source_state WHERE alert_id=NEW.source_id;
    PERFORM public.capture_notification_intent(NEW.id,kind,COALESCE(revision,0));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER capture_work_notification_change AFTER UPDATE OF assigned_to,severity,status,underlying_alert_resolved_at
  ON public.work_items FOR EACH ROW EXECUTE FUNCTION public.capture_work_notification_change();

CREATE OR REPLACE FUNCTION public.sync_alert_work_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  assignment record;
  owner_id uuid;
  owner_source text;
  linked_provider uuid;
  mapped_priority text;
  mapped_due timestamptz;
  new_item_id uuid;
  revision bigint;
  signal_changed boolean;
  new_critical_flag boolean:=false;
  item public.work_items%ROWTYPE;
BEGIN
  signal_changed:=TG_OP='INSERT';
  IF TG_OP='UPDATE' THEN
    signal_changed:=NEW.flags IS DISTINCT FROM OLD.flags OR NEW.severity IS DISTINCT FROM OLD.severity
      OR NEW.occurrence_count IS DISTINCT FROM OLD.occurrence_count OR NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at;
    new_critical_flag:=OLD.severity='critical' AND NEW.severity='critical' AND NOT NEW.flags<@OLD.flags;
  END IF;
  IF signal_changed THEN
    INSERT INTO public.notification_source_state(alert_id,source_revision) VALUES(NEW.id,1)
      ON CONFLICT(alert_id) DO UPDATE SET source_revision=public.notification_source_state.source_revision+1
      RETURNING source_revision INTO revision;
  END IF;
  mapped_priority:=CASE NEW.severity WHEN 'critical' THEN 'now' WHEN 'warning' THEN 'today' ELSE 'watching' END;
  mapped_due:=CASE NEW.severity WHEN 'critical' THEN NEW.created_at
    WHEN 'warning' THEN NEW.created_at+interval '24 hours' ELSE NEW.created_at+interval '7 days' END;
  IF TG_OP='INSERT' THEN
    FOR assignment IN
      SELECT opa.organization_id FROM public.organization_patient_assignments AS opa
      JOIN public.organizations AS org ON org.id=opa.organization_id AND org.status='active'
      WHERE opa.patient_id=NEW.patient_id AND opa.status='active' ORDER BY opa.organization_id
    LOOP
      SELECT resolved.accountable_id,resolved.accountability_source INTO owner_id,owner_source
        FROM public.resolve_accountable_provider(assignment.organization_id,NEW.patient_id,now()) AS resolved;
      IF owner_id IS NOT NULL THEN
        INSERT INTO public.work_items(patient_id,provider_id,assigned_to,organization_id,source_type,source_id,
          title,reason,priority,severity,status,due_at,freshness_at,data_quality,accountability_source)
        VALUES(NEW.patient_id,owner_id,owner_id,assignment.organization_id,'alert',NEW.id,'Review patient alert',
          'Triggered signals: '||array_to_string(NEW.flags,', '),mapped_priority,NEW.severity,'new',mapped_due,NEW.created_at,
          CASE WHEN NEW.vitals_id IS NULL THEN 'partial' ELSE 'verified' END,owner_source)
        ON CONFLICT(organization_id,source_id) WHERE source_type='alert' AND source_id IS NOT NULL
          AND accountability_source IN ('designated','coverage','sole_member','org_owner','accepted_transfer','manager_reassigned')
        DO NOTHING RETURNING id INTO new_item_id;
        IF new_item_id IS NOT NULL THEN
          IF owner_source='coverage' THEN
            INSERT INTO public.work_item_events(work_item_id,actor_id,event_type,from_status,to_status)
              VALUES(new_item_id,(SELECT auth.uid()),'coverage_applied',NULL,'new');
          END IF;
          IF NEW.severity='critical' THEN
            PERFORM public.capture_notification_intent(new_item_id,'critical_created',revision);
          END IF;
        END IF;
      ELSE
        FOR linked_provider IN SELECT link.provider_id FROM public.provider_patient_links AS link
          WHERE link.patient_id=NEW.patient_id AND link.status='active'
            AND public.is_active_org_member(assignment.organization_id,link.provider_id) ORDER BY link.provider_id
        LOOP
          INSERT INTO public.work_items(patient_id,provider_id,assigned_to,organization_id,source_type,source_id,
            title,reason,priority,severity,status,due_at,freshness_at,data_quality,accountability_source)
          VALUES(NEW.patient_id,linked_provider,linked_provider,assignment.organization_id,'alert',NEW.id,'Review patient alert',
            'Triggered signals: '||array_to_string(NEW.flags,', '),mapped_priority,NEW.severity,'new',mapped_due,NEW.created_at,
            CASE WHEN NEW.vitals_id IS NULL THEN 'partial' ELSE 'verified' END,'legacy_fan_out')
          ON CONFLICT(organization_id,provider_id,source_type,source_id) WHERE source_id IS NOT NULL AND source_type='alert'
          DO NOTHING;
        END LOOP;
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  IF signal_changed THEN
    -- Do not filter closed rows out of the lock query. Under READ COMMITTED the
    -- row returned after a closure wins its lock is the closed version.
    FOR item IN SELECT * FROM public.work_items WHERE source_type='alert' AND source_id=NEW.id ORDER BY id FOR UPDATE
    LOOP
      IF item.status='closed' THEN
        INSERT INTO public.notification_routing_exceptions(work_item_id,alert_id,organization_id,patient_id,source_revision,reason)
          VALUES(item.id,NEW.id,item.organization_id,item.patient_id,revision,'closed_work_later_signal');
      ELSE
        UPDATE public.work_items SET reason='Triggered signals: '||array_to_string(NEW.flags,', ')
          ||' · observed '||NEW.occurrence_count||' times',severity=NEW.severity,freshness_at=NEW.last_seen_at,updated_at=now()
          WHERE id=item.id AND status<>'closed';
        IF new_critical_flag THEN
          INSERT INTO public.notification_routing_exceptions(work_item_id,alert_id,organization_id,patient_id,source_revision,reason)
            VALUES(item.id,NEW.id,item.organization_id,item.patient_id,revision,'critical_new_flag');
        END IF;
      END IF;
    END LOOP;
  END IF;
  -- Status projection retains the00043 semantics: no clinical closure/outcome.
  IF NEW.status='acknowledged' AND OLD.status='open' THEN
    UPDATE public.work_items AS projected SET status='reviewed',reviewed_at=COALESCE(projected.reviewed_at,NEW.acknowledged_at,now())
      WHERE projected.source_type='alert' AND projected.source_id=NEW.id AND projected.status='new';
  END IF;
  IF NEW.status='resolved' AND OLD.status<>'resolved' THEN
    UPDATE public.work_items AS projected SET underlying_alert_resolved_at=COALESCE(projected.underlying_alert_resolved_at,NEW.resolved_at,now())
      WHERE projected.source_type='alert' AND projected.source_id=NEW.id AND projected.status<>'closed';
    INSERT INTO public.work_item_events(work_item_id,actor_id,event_type,from_status,to_status)
      SELECT projected.id,(SELECT auth.uid()),'underlying_alert_resolved',projected.status,projected.status FROM public.work_items AS projected
      WHERE projected.source_type='alert' AND projected.source_id=NEW.id AND projected.status<>'closed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER refresh_coalesced_alert_work_item ON public.alerts;
DROP TRIGGER sync_alert_work_items ON public.alerts;
CREATE TRIGGER sync_alert_work_items AFTER INSERT OR UPDATE OF status,last_seen_at,occurrence_count,flags,severity
  ON public.alerts FOR EACH ROW EXECUTE FUNCTION public.sync_alert_work_items();

REVOKE ALL ON FUNCTION public.guard_notification_history(),
  public.notification_capture_block_reason(uuid,uuid,uuid,text[],timestamptz),
  public.capture_notification_intent(uuid,text,bigint),public.capture_work_notification_change()
  FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.notification_intents IS
  'Inert transactional capture only. No dispatch authority, attempts, transport receipt or approved retention. Historical subject erasure is a pre-hosted gate.';
COMMENT ON TABLE public.notification_source_state IS
  'Private technical counter cache, not an event ledger. Only source projection writes. Missing cache is revision0 only for actual legacy critical reassignment.';
