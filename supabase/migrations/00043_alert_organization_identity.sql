-- N2p2: organization-scoped alert identity; non-alert identity is unchanged.
-- Apply as ONE transaction (Supabase migration runner / psql -1). Replacement
-- indexes and every effective writer change together; concurrent index creation
-- is intentionally not used. No data backfill, historical merge or relabelling.
-- Keep work_items_one_accountable_per_alert (00041) exactly as it is.
-- Before hosted application: independent patch review + backup/dry-run/readback.

CREATE UNIQUE INDEX work_items_non_alert_source_unique
  ON public.work_items (provider_id, source_type, source_id)
  WHERE source_id IS NOT NULL AND source_type <> 'alert';

CREATE UNIQUE INDEX work_items_alert_org_source_unique
  ON public.work_items (organization_id, provider_id, source_type, source_id)
  WHERE source_id IS NOT NULL AND source_type = 'alert';

DROP INDEX public.work_items_source_unique;

-- CREATE OR REPLACE retains function OIDs, ACLs, security settings and trigger
-- bindings. Resolver precedence, projections, status/closing rules stay unchanged.
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
        ON CONFLICT (organization_id, source_id)
          WHERE source_type = 'alert' AND source_id IS NOT NULL
            AND accountability_source IN (
              'designated', 'coverage', 'sole_member', 'org_owner',
              'accepted_transfer', 'manager_reassigned'
            )
        DO NOTHING
        RETURNING id INTO new_item_id;

        IF new_item_id IS NOT NULL AND owner_source = 'coverage' THEN
          INSERT INTO public.work_item_events (
            work_item_id, actor_id, event_type, from_status, to_status
          ) VALUES (new_item_id, (SELECT auth.uid()), 'coverage_applied', NULL, 'new');
        END IF;
      ELSE
        -- Keep fallback explicit and scoped to this organization. Do not use a
        -- member's primary organization or create work for unrelated patient links.
        -- Historical NULL/legacy rows are not rewritten or promoted.
        FOR linked_provider IN
          SELECT link.provider_id
          FROM public.provider_patient_links AS link
          WHERE link.patient_id = NEW.patient_id AND link.status = 'active'
            AND public.is_active_org_member(assignment.organization_id, link.provider_id)
        LOOP
          INSERT INTO public.work_items (
            patient_id, provider_id, assigned_to, organization_id, source_type, source_id,
            title, reason, priority, severity, status, due_at, freshness_at,
            data_quality, accountability_source
          ) VALUES (
            NEW.patient_id, linked_provider, linked_provider, assignment.organization_id, 'alert', NEW.id,
            'Review patient alert',
            'Triggered signals: ' || array_to_string(NEW.flags, ', '),
            mapped_priority, NEW.severity, 'new', mapped_due, NEW.created_at,
            CASE WHEN NEW.vitals_id IS NULL THEN 'partial' ELSE 'verified' END,
            'legacy_fan_out'
          )
          ON CONFLICT (organization_id, provider_id, source_type, source_id)
            WHERE source_id IS NOT NULL AND source_type = 'alert'
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

-- Follow-up bodies are identical to 00041 except for the conflict predicate.
-- Keep provider/source identity, DO UPDATE assignments and outcome rules intact.
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
    WHERE source_id IS NOT NULL AND source_type <> 'alert'
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
    WHERE source_id IS NOT NULL AND source_type <> 'alert'
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
