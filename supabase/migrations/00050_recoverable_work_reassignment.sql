-- Staged N2 ownership repair. Deploy only with matching clients, all negative/race
-- tests and the separate intent/cutover gates. No clinical threshold or grant seed.

ALTER TABLE public.work_items ADD COLUMN ownership_revision bigint NOT NULL DEFAULT 0 CHECK(ownership_revision>=0);
ALTER TABLE public.work_item_events
  ADD COLUMN ownership_request_id uuid,
  ADD COLUMN ownership_previous_assignee uuid,
  ADD COLUMN ownership_expected_revision bigint,
  ADD COLUMN ownership_new_assignee uuid,
  ADD COLUMN ownership_reason text,
  ADD COLUMN ownership_result_revision bigint;
ALTER TABLE public.work_item_events ADD CONSTRAINT work_reassignment_receipt_shape CHECK(
  num_nonnulls(ownership_request_id,ownership_previous_assignee,ownership_expected_revision,
    ownership_new_assignee,ownership_reason,ownership_result_revision)=0
  OR (num_nonnulls(ownership_request_id,ownership_previous_assignee,ownership_expected_revision,
    ownership_new_assignee,ownership_reason,ownership_result_revision)=6
    AND actor_id IS NOT NULL AND event_type='assigned' AND from_status=to_status AND to_status<>'closed'
    AND ownership_previous_assignee<>ownership_new_assignee AND ownership_expected_revision>=0
    AND ownership_result_revision=ownership_expected_revision+1
    AND char_length(btrim(ownership_reason)) BETWEEN 3 AND 500));
CREATE UNIQUE INDEX work_reassignment_actor_request_unique ON public.work_item_events(actor_id,ownership_request_id)
  WHERE ownership_request_id IS NOT NULL;

REVOKE UPDATE(assigned_to) ON public.work_items FROM authenticated;
-- Scheduled producers retain non-ownership updates. Ownership transitions are
-- definer commands, not administrative service-role DML without a receipt.
REVOKE UPDATE ON public.work_items FROM service_role;
GRANT UPDATE(reason,change_summary,severity,status,due_at,freshness_at,snooze_reason,
  outcome,reviewed_at,actioned_at,closed_at,updated_at,underlying_alert_resolved_at,outcome_code)
  ON public.work_items TO service_role;
-- The service's old ALL grant must not mint or erase a recoverable receipt.
REVOKE INSERT,TRUNCATE ON public.work_item_events FROM PUBLIC,anon,authenticated,service_role;
GRANT INSERT(id,work_item_id,actor_id,event_type,from_status,to_status,occurred_at)
  ON public.work_item_events TO service_role;

CREATE FUNCTION public.work_ownership_member_eligible(p_org uuid,p_patient uuid,p_member uuid,p_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.is_active_org_member(p_org,p_member) AND public.org_has_patient(p_org,p_patient)
    AND public.operational_patient_current(p_patient)
    AND EXISTS(SELECT 1 FROM public.consents WHERE user_id=p_member AND consent_type='registration'
      AND consent_version='v1.0' AND accepted)
    AND EXISTS(SELECT 1 FROM public.provider_patient_links WHERE provider_id=p_member AND patient_id=p_patient AND status='active')
    AND EXISTS(SELECT 1 FROM public.member_authorizations AS grant_row
      JOIN public.organization_memberships AS membership ON membership.id=grant_row.membership_id
      WHERE membership.organization_id=p_org AND membership.user_id=p_member AND membership.status='active'
        AND grant_row.capability='monitor' AND grant_row.revoked_at IS NULL
        AND (grant_row.expires_at IS NULL OR grant_row.expires_at>p_at))
$$;
REVOKE ALL ON FUNCTION public.work_ownership_member_eligible(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.require_work_ownership_scope(p_org uuid,p_patient uuid,p_target uuid,p_manager boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_at timestamptz:=clock_timestamp();
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated' OR (SELECT auth.uid()) IS NULL
    OR NOT COALESCE(public.provider_aal2()
      AND public.work_ownership_member_eligible(p_org,p_patient,(SELECT auth.uid()),v_at)
      AND (NOT p_manager OR public.is_org_manager(p_org)),false)
    OR (p_target IS NOT NULL AND NOT COALESCE(public.work_ownership_member_eligible(p_org,p_patient,p_target,v_at),false)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.require_work_ownership_scope(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.lock_work_ownership_scope(p_org uuid,p_patient uuid,p_old_owner uuid,p_target uuid,p_manager boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_users uuid[]:=ARRAY[(SELECT auth.uid()),p_old_owner,p_target];
BEGIN
  PERFORM public.require_work_ownership_scope(p_org,p_patient,p_target,p_manager);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('heartland:work-ownership:'||p_org||':'||p_patient,0));
  PERFORM id FROM public.profiles WHERE id=ANY(v_users||p_patient) ORDER BY id FOR SHARE;
  PERFORM id FROM public.consents WHERE user_id=ANY(v_users||p_patient)
    AND consent_type='registration' AND consent_version='v1.0' ORDER BY id FOR SHARE;
  PERFORM id FROM public.organizations WHERE id=p_org FOR SHARE;
  -- Lock inactive old membership too; current drift does not grant or require reactivation.
  PERFORM id FROM public.organization_memberships WHERE organization_id=p_org AND user_id=ANY(v_users) ORDER BY id FOR SHARE;
  PERFORM grant_row.id FROM public.member_authorizations AS grant_row
    JOIN public.organization_memberships AS membership ON membership.id=grant_row.membership_id
    WHERE membership.organization_id=p_org AND membership.user_id=ANY(v_users) AND grant_row.capability='monitor'
    ORDER BY grant_row.id FOR SHARE OF grant_row;
  PERFORM id FROM public.provider_patient_links WHERE patient_id=p_patient AND provider_id=ANY(v_users) ORDER BY id FOR SHARE;
  PERFORM id FROM public.organization_patient_assignments WHERE organization_id=p_org AND patient_id=p_patient ORDER BY id FOR SHARE;
  PERFORM id FROM public.patients WHERE id=p_patient FOR KEY SHARE;
  PERFORM public.require_work_ownership_scope(p_org,p_patient,p_target,p_manager);
END;
$$;
REVOKE ALL ON FUNCTION public.lock_work_ownership_scope(uuid,uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- Caller-only gate for restrictive receipt-row RLS. No arbitrary member argument.
CREATE FUNCTION public.can_read_work_ownership_receipt(p_work_item uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
  SELECT (SELECT auth.role())='authenticated' AND (SELECT auth.uid()) IS NOT NULL
    AND public.provider_aal2()
    AND COALESCE((SELECT public.work_ownership_member_eligible(
      item.organization_id,item.patient_id,(SELECT auth.uid()),clock_timestamp())
    FROM public.work_items AS item WHERE item.id=p_work_item),false)
$$;
REVOKE ALL ON FUNCTION public.can_read_work_ownership_receipt(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.can_read_work_ownership_receipt(uuid) TO authenticated;
CREATE POLICY work_event_receipt_scope ON public.work_item_events AS RESTRICTIVE FOR SELECT TO authenticated
  USING(ownership_request_id IS NULL OR public.can_read_work_ownership_receipt(work_item_id));

CREATE FUNCTION public.work_reassignment_receipt_json(p_event uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('request_id',ownership_request_id,'event_id',id,'work_item_id',work_item_id,
    'recorded_assignee',ownership_new_assignee,'recorded_revision',ownership_result_revision::text,
    'recorded_at',occurred_at,'acceptance_recorded',false)
  FROM public.work_item_events WHERE id=p_event AND ownership_request_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.work_reassignment_receipt_json(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Read-only preparation; final command rechecks everything under locks. Names
-- are limited to currently eligible members in this patient's organization.
CREATE FUNCTION public.get_work_reassignment_context(p_work_item_id uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_item public.work_items%ROWTYPE; v_targets jsonb; v_next uuid; v_eligible boolean;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid ownership page';
  END IF;
  SELECT * INTO v_item FROM public.work_items WHERE id=p_work_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized'; END IF;
  PERFORM public.lock_work_ownership_scope(v_item.organization_id,v_item.patient_id,NULL,NULL,true);
  -- The advisory wait may have followed a completed ownership transition.
  SELECT * INTO v_item FROM public.work_items WHERE id=p_work_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized'; END IF;
  v_eligible:=v_item.status<>'closed' AND v_item.accountability_source IS NOT NULL AND v_item.accountability_source<>'legacy_fan_out';
  WITH candidates AS MATERIALIZED(
    SELECT member.user_id,COALESCE(profile.full_name,'Team member') AS name
    FROM public.organization_memberships AS member JOIN public.profiles AS profile ON profile.id=member.user_id
    WHERE v_eligible AND member.organization_id=v_item.organization_id AND member.user_id<>v_item.assigned_to
      AND (p_after IS NULL OR member.user_id>p_after)
      AND public.work_ownership_member_eligible(v_item.organization_id,v_item.patient_id,member.user_id,clock_timestamp())
    ORDER BY member.user_id LIMIT p_limit+1
  ), page AS(SELECT * FROM candidates ORDER BY user_id LIMIT p_limit)
  SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id',user_id,'name',name) ORDER BY user_id) FROM page),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT user_id FROM page ORDER BY user_id DESC LIMIT 1) END
    INTO v_targets,v_next;
  PERFORM public.require_work_ownership_scope(v_item.organization_id,v_item.patient_id,NULL,true);
  RETURN jsonb_build_object('work_item_id',v_item.id,'patient_id',v_item.patient_id,
    'current_assignee',v_item.assigned_to,'current_revision',v_item.ownership_revision::text,
    'eligible',v_eligible,'targets',v_targets,'next_cursor',v_next);
END;
$$;
REVOKE ALL ON FUNCTION public.get_work_reassignment_context(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_work_reassignment_context(uuid,uuid,integer) TO authenticated;

CREATE FUNCTION public.reassign_work_item_recoverable(p_request_id uuid,p_work_item_id uuid,
  p_expected_assignee uuid,p_expected_revision bigint,p_to uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid:=(SELECT auth.uid()); v_context public.work_items%ROWTYPE; v_item public.work_items%ROWTYPE;
  v_receipt public.work_item_events%ROWTYPE; v_event uuid; v_reason text:=btrim(p_reason);
BEGIN
  IF p_request_id IS NULL OR p_expected_assignee IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0
    OR p_to IS NULL OR v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid work reassignment';
  END IF;
  SELECT * INTO v_context FROM public.work_items WHERE id=p_work_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized'; END IF;
  PERFORM public.require_work_ownership_scope(v_context.organization_id,v_context.patient_id,NULL,true);
  -- Decide replay versus fresh only after any preceding ownership command has
  -- committed. A concurrent replay must not depend on the target still eligible.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'heartland:work-ownership:'||v_context.organization_id||':'||v_context.patient_id,0));
  SELECT * INTO v_receipt FROM public.work_item_events WHERE actor_id=v_actor AND ownership_request_id=p_request_id;
  IF FOUND THEN
    PERFORM public.lock_work_ownership_scope(v_context.organization_id,v_context.patient_id,NULL,NULL,true);
    IF v_receipt.work_item_id<>p_work_item_id OR v_receipt.ownership_previous_assignee<>p_expected_assignee
      OR v_receipt.ownership_expected_revision<>p_expected_revision OR v_receipt.ownership_new_assignee<>p_to
      OR v_receipt.ownership_reason<>v_reason THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Reassignment request conflict';
    END IF;
    RETURN public.work_reassignment_receipt_json(v_receipt.id);
  END IF;
  PERFORM public.lock_work_ownership_scope(v_context.organization_id,v_context.patient_id,v_context.assigned_to,p_to,true);
  SELECT * INTO v_item FROM public.work_items WHERE id=p_work_item_id FOR UPDATE;
  IF NOT FOUND OR v_item.organization_id IS DISTINCT FROM v_context.organization_id
    OR v_item.patient_id IS DISTINCT FROM v_context.patient_id THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized';
  END IF;
  -- A concurrent identical command may have committed while this one waited.
  SELECT * INTO v_receipt FROM public.work_item_events WHERE actor_id=v_actor AND ownership_request_id=p_request_id;
  IF FOUND THEN
    PERFORM public.require_work_ownership_scope(v_item.organization_id,v_item.patient_id,NULL,true);
    IF v_receipt.work_item_id<>p_work_item_id OR v_receipt.ownership_previous_assignee<>p_expected_assignee
      OR v_receipt.ownership_expected_revision<>p_expected_revision OR v_receipt.ownership_new_assignee<>p_to
      OR v_receipt.ownership_reason<>v_reason THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Reassignment request conflict';
    END IF;
    RETURN public.work_reassignment_receipt_json(v_receipt.id);
  END IF;
  IF v_item.assigned_to IS DISTINCT FROM v_context.assigned_to OR v_item.assigned_to<>p_expected_assignee
    OR v_item.ownership_revision<>p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Work ownership changed; refresh before retrying';
  END IF;
  PERFORM public.require_work_ownership_scope(v_item.organization_id,v_item.patient_id,p_to,true);
  IF v_item.status='closed' OR v_item.accountability_source IS NULL OR v_item.accountability_source='legacy_fan_out'
    OR p_to=v_item.assigned_to THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='This work is not eligible for reassignment';
  END IF;
  UPDATE public.work_items SET assigned_to=p_to WHERE id=p_work_item_id RETURNING * INTO v_item;
  INSERT INTO public.work_item_events(work_item_id,actor_id,event_type,from_status,to_status,occurred_at,
    ownership_request_id,ownership_previous_assignee,ownership_expected_revision,ownership_new_assignee,ownership_reason,ownership_result_revision)
  VALUES(p_work_item_id,v_actor,'assigned',v_item.status,v_item.status,clock_timestamp(),
    p_request_id,p_expected_assignee,p_expected_revision,p_to,v_reason,v_item.ownership_revision) RETURNING id INTO v_event;
  RETURN public.work_reassignment_receipt_json(v_event);
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_work_item_recoverable(uuid,uuid,uuid,bigint,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reassign_work_item_recoverable(uuid,uuid,uuid,bigint,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reassign_work_item(p_work_item_id uuid,p_to uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='0A000',MESSAGE='Reassignment requires a recoverable request and current ownership revision';
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_work_item(uuid,uuid,text) FROM PUBLIC,anon,service_role;

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
    IF NEW.ownership_revision<>0 THEN RAISE EXCEPTION 'Ownership revision is server-managed'; END IF;
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

  IF NEW.ownership_revision IS DISTINCT FROM OLD.ownership_revision THEN
    RAISE EXCEPTION 'Ownership revision is server-managed';
  END IF;
  IF OLD.status='closed' AND (ROW(NEW.assigned_to,NEW.accepted_at,NEW.accepted_by,NEW.transfer_pending_to,NEW.transfer_offered_at,NEW.transfer_offered_by,NEW.declined_at,NEW.declined_reason,NEW.accountability_source) IS DISTINCT FROM ROW(OLD.assigned_to,OLD.accepted_at,OLD.accepted_by,OLD.transfer_pending_to,OLD.transfer_offered_at,OLD.transfer_offered_by,OLD.declined_at,OLD.declined_reason,OLD.accountability_source)) THEN
    RAISE EXCEPTION 'Closed work ownership is immutable';
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

  IF NEW.status = 'awaiting' AND (OLD.status IS DISTINCT FROM 'awaiting'
    OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.snooze_reason IS DISTINCT FROM OLD.snooze_reason) THEN
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

  IF ROW(NEW.assigned_to,NEW.accepted_at,NEW.accepted_by,NEW.transfer_pending_to,NEW.transfer_offered_at,NEW.transfer_offered_by,NEW.declined_at,NEW.declined_reason,NEW.accountability_source) IS DISTINCT FROM ROW(OLD.assigned_to,OLD.accepted_at,OLD.accepted_by,OLD.transfer_pending_to,OLD.transfer_offered_at,OLD.transfer_offered_by,OLD.declined_at,OLD.declined_reason,OLD.accountability_source) THEN NEW.ownership_revision:=OLD.ownership_revision+1; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.designate_patient_accountable(
  p_organization_id uuid,
  p_patient_id uuid,
  p_accountable_id uuid,
  p_note text DEFAULT NULL,
  p_offer_open_items boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = '' SET lock_timeout='5s'
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  designation_id uuid;
  previous_owner uuid;
  actual_owner uuid;
BEGIN
  IF p_accountable_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='An eligible accountable member is required'; END IF;
  IF p_offer_open_items IS DISTINCT FROM false THEN
    RAISE EXCEPTION USING ERRCODE='0A000',MESSAGE='Bulk transfer offers require individual review';
  END IF;
  IF note IS NOT NULL AND char_length(note) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='A designation note must be documented';
  END IF;
  SELECT accountable_id INTO previous_owner FROM public.patient_accountability
    WHERE organization_id=p_organization_id AND patient_id=p_patient_id AND revoked_at IS NULL;
  PERFORM public.lock_work_ownership_scope(p_organization_id,p_patient_id,previous_owner,p_accountable_id,true);
  SELECT accountable_id INTO actual_owner FROM public.patient_accountability
    WHERE organization_id=p_organization_id AND patient_id=p_patient_id AND revoked_at IS NULL FOR UPDATE;
  IF actual_owner IS DISTINCT FROM previous_owner THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Patient designation changed; refresh before retrying';
  END IF;
  PERFORM public.require_work_ownership_scope(p_organization_id,p_patient_id,p_accountable_id,true);

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

  RETURN designation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_work_item(p_work_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = '' SET lock_timeout='5s'
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  item record;
  initial_item public.work_items%ROWTYPE;
BEGIN
  SELECT * INTO initial_item FROM public.work_items WHERE id=p_work_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized'; END IF;
  PERFORM public.lock_work_ownership_scope(initial_item.organization_id,initial_item.patient_id,initial_item.assigned_to,actor,false);
  SELECT * INTO item FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF item.id IS NULL OR item.organization_id IS DISTINCT FROM initial_item.organization_id
    OR item.patient_id IS DISTINCT FROM initial_item.patient_id THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized';
  END IF;
  IF item.assigned_to IS DISTINCT FROM initial_item.assigned_to OR item.ownership_revision<>initial_item.ownership_revision THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Work ownership changed; refresh before retrying';
  END IF;
  PERFORM public.require_work_ownership_scope(item.organization_id,item.patient_id,actor,false);
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

CREATE OR REPLACE FUNCTION public.offer_work_item_transfer(
  p_work_item_id uuid,
  p_to uuid,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = '' SET lock_timeout='5s'
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  item record;
  initial_item public.work_items%ROWTYPE;
  note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  SELECT * INTO initial_item FROM public.work_items WHERE id=p_work_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized'; END IF;
  PERFORM public.lock_work_ownership_scope(initial_item.organization_id,initial_item.patient_id,initial_item.assigned_to,p_to,false);
  SELECT * INTO item FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF item.id IS NULL OR item.organization_id IS DISTINCT FROM initial_item.organization_id
    OR item.patient_id IS DISTINCT FROM initial_item.patient_id THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized';
  END IF;
  IF item.assigned_to IS DISTINCT FROM initial_item.assigned_to OR item.ownership_revision<>initial_item.ownership_revision THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Work ownership changed; refresh before retrying';
  END IF;
  PERFORM public.require_work_ownership_scope(item.organization_id,item.patient_id,p_to,false);
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

CREATE OR REPLACE FUNCTION public.accept_work_item_transfer(p_work_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = '' SET lock_timeout='5s'
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  item record;
  initial_item public.work_items%ROWTYPE;
BEGIN
  SELECT * INTO initial_item FROM public.work_items WHERE id=p_work_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized'; END IF;
  PERFORM public.lock_work_ownership_scope(initial_item.organization_id,initial_item.patient_id,initial_item.assigned_to,actor,false);
  SELECT * INTO item FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF item.id IS NULL OR item.organization_id IS DISTINCT FROM initial_item.organization_id
    OR item.patient_id IS DISTINCT FROM initial_item.patient_id THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized';
  END IF;
  IF item.assigned_to IS DISTINCT FROM initial_item.assigned_to OR item.ownership_revision<>initial_item.ownership_revision THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Work ownership changed; refresh before retrying';
  END IF;
  PERFORM public.require_work_ownership_scope(item.organization_id,item.patient_id,actor,false);
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

CREATE OR REPLACE FUNCTION public.decline_work_item_transfer(
  p_work_item_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = '' SET lock_timeout='5s'
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  item record;
  initial_item public.work_items%ROWTYPE;
BEGIN
  SELECT * INTO initial_item FROM public.work_items WHERE id=p_work_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized'; END IF;
  PERFORM public.lock_work_ownership_scope(initial_item.organization_id,initial_item.patient_id,initial_item.assigned_to,actor,false);
  SELECT * INTO item FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF item.id IS NULL OR item.organization_id IS DISTINCT FROM initial_item.organization_id
    OR item.patient_id IS DISTINCT FROM initial_item.patient_id THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized';
  END IF;
  IF item.assigned_to IS DISTINCT FROM initial_item.assigned_to OR item.ownership_revision<>initial_item.ownership_revision THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Work ownership changed; refresh before retrying';
  END IF;
  PERFORM public.require_work_ownership_scope(item.organization_id,item.patient_id,actor,false);
  -- The other three RPCs require AAL2 and an active membership; so does this one.
  IF item.id IS NULL OR actor IS NULL OR item.transfer_pending_to IS DISTINCT FROM actor
    OR NOT public.provider_aal2()
    OR NOT public.is_active_org_member(item.organization_id, actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Transfer decline not authorized';
  END IF;
  IF item.status='closed' THEN RAISE EXCEPTION 'closed work items cannot be transferred'; END IF;
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
      AND item.organization_id = NEW.organization_id AND item.status <> 'closed';

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
