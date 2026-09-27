-- Local N2 repair recovery across mounts/reload. No transport or clinical policy.
-- Keep preparation and confirmation in the existing append-only technical trail.

ALTER TABLE public.work_item_events DROP CONSTRAINT work_item_events_event_type_check;
ALTER TABLE public.work_item_events ADD CONSTRAINT work_item_events_event_type_check CHECK(event_type IN(
  'created','updated','reviewed','actioned','awaiting','due','closed','assigned','transfer_offered',
  'accepted','declined','coverage_applied','accountable_unavailable','underlying_alert_resolved',
  'administratively_closed','reassignment_requested','reassignment_seen','reassignment_cancelled'));
ALTER TABLE public.work_item_events DROP CONSTRAINT work_reassignment_receipt_shape;
ALTER TABLE public.work_item_events ADD CONSTRAINT work_reassignment_receipt_shape CHECK(
  (num_nonnulls(ownership_request_id,ownership_previous_assignee,ownership_expected_revision,
    ownership_new_assignee,ownership_reason,ownership_result_revision)=0
    AND event_type NOT IN('reassignment_requested','reassignment_seen','reassignment_cancelled'))
  OR (num_nonnulls(ownership_request_id,ownership_previous_assignee,ownership_expected_revision,
      ownership_new_assignee,ownership_reason)=5 AND actor_id IS NOT NULL
    AND from_status IS NOT NULL AND to_status IS NOT NULL AND from_status=to_status
    AND ownership_previous_assignee<>ownership_new_assignee AND ownership_expected_revision>=0
    AND char_length(btrim(ownership_reason)) BETWEEN 3 AND 500
    AND ((event_type IN('reassignment_requested','reassignment_cancelled') AND ownership_result_revision IS NULL)
      OR (event_type IN('assigned','reassignment_seen') AND ownership_result_revision IS NOT NULL
        AND ownership_result_revision=ownership_expected_revision+1 AND to_status<>'closed'))));
DROP INDEX public.work_reassignment_actor_request_unique;
CREATE UNIQUE INDEX work_reassignment_actor_request_kind_unique
  ON public.work_item_events(actor_id,ownership_request_id,event_type) WHERE ownership_request_id IS NOT NULL;
CREATE INDEX work_reassignment_actor_pending_lookup ON public.work_item_events(actor_id,work_item_id,id)
  WHERE event_type='reassignment_requested';

CREATE OR REPLACE FUNCTION public.work_reassignment_receipt_json(p_event uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('request_id',ownership_request_id,'event_id',id,'work_item_id',work_item_id,
   'recorded_assignee',ownership_new_assignee,'recorded_revision',ownership_result_revision::text,
   'recorded_at',occurred_at,'acceptance_recorded',false)
 FROM public.work_item_events WHERE id=p_event AND ownership_request_id IS NOT NULL AND event_type='assigned'
$$;

CREATE FUNCTION public.work_reassignment_request_state(p_actor uuid,p_request uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('state',CASE
   WHEN EXISTS(SELECT 1 FROM public.work_item_events WHERE actor_id=p_actor AND ownership_request_id=p_request AND event_type='reassignment_seen') THEN 'seen'
   WHEN EXISTS(SELECT 1 FROM public.work_item_events WHERE actor_id=p_actor AND ownership_request_id=p_request AND event_type='reassignment_cancelled') THEN 'cancelled'
   WHEN assigned.id IS NOT NULL THEN 'applied' ELSE 'prepared' END,
   'request',jsonb_build_object('requestId',requested.ownership_request_id,'workItemId',requested.work_item_id,
     'patientId',item.patient_id,'expectedAssignee',requested.ownership_previous_assignee,
     'expectedRevision',requested.ownership_expected_revision::text,'assigneeId',requested.ownership_new_assignee,
     'reason',requested.ownership_reason),
   'receipt',public.work_reassignment_receipt_json(assigned.id))
 FROM public.work_item_events AS requested JOIN public.work_items AS item ON item.id=requested.work_item_id
 LEFT JOIN public.work_item_events AS assigned ON assigned.actor_id=p_actor
   AND assigned.ownership_request_id=p_request AND assigned.event_type='assigned'
 WHERE requested.actor_id=p_actor AND requested.ownership_request_id=p_request AND requested.event_type='reassignment_requested'
$$;
REVOKE ALL ON FUNCTION public.work_reassignment_request_state(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.unresolved_work_reassignment(p_actor uuid,p_item uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT requested.ownership_request_id FROM public.work_item_events AS requested
 WHERE requested.actor_id=p_actor AND requested.work_item_id=p_item AND requested.event_type='reassignment_requested'
 AND NOT EXISTS(SELECT 1 FROM public.work_item_events AS terminal WHERE terminal.actor_id=p_actor
   AND terminal.ownership_request_id=requested.ownership_request_id AND terminal.event_type IN('reassignment_seen','reassignment_cancelled'))
 ORDER BY requested.id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.unresolved_work_reassignment(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prepare_work_reassignment(p_request_id uuid,p_work_item_id uuid,
 p_expected_assignee uuid,p_expected_revision bigint,p_to uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid:=(SELECT auth.uid()); v_context public.work_items%ROWTYPE; v_item public.work_items%ROWTYPE;
 v_request public.work_item_events%ROWTYPE; v_pending uuid; v_reason text:=btrim(p_reason);
BEGIN
 IF p_request_id IS NULL OR p_expected_assignee IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0
   OR p_to IS NULL OR v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 500 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid work reassignment';
 END IF;
 SELECT * INTO v_context FROM public.work_items WHERE id=p_work_item_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized'; END IF;
 PERFORM public.require_work_ownership_scope(v_context.organization_id,v_context.patient_id,NULL,true);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('heartland:work-ownership:'||v_context.organization_id||':'||v_context.patient_id,0));
 SELECT * INTO v_request FROM public.work_item_events WHERE actor_id=v_actor AND ownership_request_id=p_request_id AND event_type='reassignment_requested';
 IF FOUND THEN
   PERFORM public.lock_work_ownership_scope(v_context.organization_id,v_context.patient_id,NULL,NULL,true);
   IF v_request.work_item_id<>p_work_item_id OR v_request.ownership_previous_assignee<>p_expected_assignee
     OR v_request.ownership_expected_revision<>p_expected_revision OR v_request.ownership_new_assignee<>p_to OR v_request.ownership_reason<>v_reason THEN
     RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Reassignment request conflict';
   END IF;
   RETURN public.work_reassignment_request_state(v_actor,p_request_id);
 END IF;
 v_pending:=public.unresolved_work_reassignment(v_actor,p_work_item_id);
 IF v_pending IS NOT NULL THEN
   PERFORM public.lock_work_ownership_scope(v_context.organization_id,v_context.patient_id,NULL,NULL,true);
   RETURN public.work_reassignment_request_state(v_actor,v_pending);
 END IF;
 -- Do not reuse an identity belonging to an earlier pre-00051 assigned receipt.
 IF EXISTS(SELECT 1 FROM public.work_item_events WHERE actor_id=v_actor AND ownership_request_id=p_request_id) THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Reassignment request conflict';
 END IF;
 PERFORM public.lock_work_ownership_scope(v_context.organization_id,v_context.patient_id,v_context.assigned_to,p_to,true);
 SELECT * INTO v_item FROM public.work_items WHERE id=p_work_item_id FOR UPDATE;
 IF NOT FOUND OR v_item.organization_id IS DISTINCT FROM v_context.organization_id OR v_item.patient_id IS DISTINCT FROM v_context.patient_id THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized';
 END IF;
 IF v_item.assigned_to IS DISTINCT FROM v_context.assigned_to OR v_item.assigned_to<>p_expected_assignee OR v_item.ownership_revision<>p_expected_revision THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Work ownership changed; refresh before retrying';
 END IF;
 PERFORM public.require_work_ownership_scope(v_item.organization_id,v_item.patient_id,p_to,true);
 IF v_item.status='closed' OR v_item.accountability_source IS NULL OR v_item.accountability_source='legacy_fan_out' OR p_to=v_item.assigned_to THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='This work is not eligible for reassignment';
 END IF;
 INSERT INTO public.work_item_events(work_item_id,actor_id,event_type,from_status,to_status,occurred_at,
   ownership_request_id,ownership_previous_assignee,ownership_expected_revision,ownership_new_assignee,ownership_reason)
 VALUES(p_work_item_id,v_actor,'reassignment_requested',v_item.status,v_item.status,clock_timestamp(),
   p_request_id,p_expected_assignee,p_expected_revision,p_to,v_reason);
 RETURN public.work_reassignment_request_state(v_actor,p_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_work_reassignment(uuid,uuid,uuid,bigint,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_work_reassignment(uuid,uuid,uuid,bigint,uuid,text) TO authenticated;

CREATE FUNCTION public.recover_work_reassignment(p_work_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_item public.work_items%ROWTYPE; v_request uuid;
BEGIN
 SELECT * INTO v_item FROM public.work_items WHERE id=p_work_item_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized'; END IF;
 PERFORM public.lock_work_ownership_scope(v_item.organization_id,v_item.patient_id,NULL,NULL,true);
 v_request:=public.unresolved_work_reassignment((SELECT auth.uid()),p_work_item_id);
 RETURN public.work_reassignment_request_state((SELECT auth.uid()),v_request);
END;
$$;
REVOKE ALL ON FUNCTION public.recover_work_reassignment(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.recover_work_reassignment(uuid) TO authenticated;

CREATE FUNCTION public.finish_work_reassignment_request(p_request_id uuid,p_receipt_id uuid,p_cancel boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid:=(SELECT auth.uid()); v_request public.work_item_events%ROWTYPE;
 v_assigned public.work_item_events%ROWTYPE; v_item public.work_items%ROWTYPE; v_state jsonb;
BEGIN
 IF p_cancel IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid request disposition'; END IF;
 SELECT * INTO v_request FROM public.work_item_events WHERE actor_id=v_actor AND ownership_request_id=p_request_id AND event_type='reassignment_requested';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized'; END IF;
 SELECT * INTO v_item FROM public.work_items WHERE id=v_request.work_item_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized'; END IF;
 PERFORM public.lock_work_ownership_scope(v_item.organization_id,v_item.patient_id,NULL,NULL,true);
 v_state:=public.work_reassignment_request_state(v_actor,p_request_id);
 SELECT * INTO v_assigned FROM public.work_item_events WHERE actor_id=v_actor AND ownership_request_id=p_request_id AND event_type='assigned';
 IF p_cancel THEN
   IF p_receipt_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Cancellation cannot acknowledge a receipt'; END IF;
   IF v_assigned.id IS NOT NULL OR v_state->>'state'='cancelled' THEN RETURN v_state; END IF;
   INSERT INTO public.work_item_events(work_item_id,actor_id,event_type,from_status,to_status,occurred_at,
     ownership_request_id,ownership_previous_assignee,ownership_expected_revision,ownership_new_assignee,ownership_reason)
   VALUES(v_request.work_item_id,v_actor,'reassignment_cancelled',v_request.from_status,v_request.to_status,clock_timestamp(),
     p_request_id,v_request.ownership_previous_assignee,v_request.ownership_expected_revision,v_request.ownership_new_assignee,v_request.ownership_reason);
 ELSE
   IF v_assigned.id IS NULL OR p_receipt_id IS DISTINCT FROM v_assigned.id THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='An exact recorded receipt is required';
   END IF;
   IF v_state->>'state'='seen' THEN RETURN v_state; END IF;
   INSERT INTO public.work_item_events(work_item_id,actor_id,event_type,from_status,to_status,occurred_at,
     ownership_request_id,ownership_previous_assignee,ownership_expected_revision,ownership_new_assignee,ownership_reason,ownership_result_revision)
   VALUES(v_assigned.work_item_id,v_actor,'reassignment_seen',v_assigned.from_status,v_assigned.to_status,clock_timestamp(),
     p_request_id,v_assigned.ownership_previous_assignee,v_assigned.ownership_expected_revision,v_assigned.ownership_new_assignee,v_assigned.ownership_reason,v_assigned.ownership_result_revision);
 END IF;
 RETURN public.work_reassignment_request_state(v_actor,p_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.finish_work_reassignment_request(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finish_work_reassignment_request(uuid,uuid,boolean) TO authenticated;

CREATE FUNCTION public.work_reassignment_detail_allowed(p_org uuid,p_patient uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT auth.role())='authenticated' AND (SELECT auth.uid()) IS NOT NULL
   AND public.provider_aal2() AND public.is_org_manager(p_org)
   AND public.work_ownership_member_eligible(p_org,p_patient,(SELECT auth.uid()),clock_timestamp())
$$;
REVOKE ALL ON FUNCTION public.work_reassignment_detail_allowed(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_my_work_reassignment_requests(p_after uuid DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
 IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated' OR (SELECT auth.uid()) IS NULL OR NOT COALESCE(public.provider_aal2(),false) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized';
 END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid ownership page'; END IF;
 WITH unresolved AS MATERIALIZED(
   SELECT requested.id,requested.ownership_request_id,item.organization_id,item.patient_id,
     public.work_reassignment_detail_allowed(item.organization_id,item.patient_id) AS authorized
   FROM public.work_item_events AS requested JOIN public.work_items AS item ON item.id=requested.work_item_id
   WHERE requested.actor_id=(SELECT auth.uid()) AND requested.event_type='reassignment_requested'
     AND NOT EXISTS(SELECT 1 FROM public.work_item_events AS terminal WHERE terminal.actor_id=requested.actor_id
       AND terminal.ownership_request_id=requested.ownership_request_id AND terminal.event_type IN('reassignment_seen','reassignment_cancelled'))
 ), candidates AS MATERIALIZED(
   SELECT * FROM unresolved WHERE authorized AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT p_limit+1
 ), page AS(SELECT * FROM candidates ORDER BY id LIMIT p_limit)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.work_reassignment_request_state((SELECT auth.uid()),ownership_request_id) ORDER BY id) FROM page),'[]'::jsonb),
   'inaccessible_count',(SELECT count(*) FROM unresolved WHERE NOT authorized),
   'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT id FROM page ORDER BY id DESC LIMIT 1) END)
 INTO v_result;
 IF NOT COALESCE(public.provider_aal2(),false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized'; END IF;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_work_reassignment_requests(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_work_reassignment_requests(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.reassign_work_item_recoverable(p_request_id uuid,p_work_item_id uuid,
  p_expected_assignee uuid,p_expected_revision bigint,p_to uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid:=(SELECT auth.uid()); v_context public.work_items%ROWTYPE; v_item public.work_items%ROWTYPE;
  v_receipt public.work_item_events%ROWTYPE; v_request public.work_item_events%ROWTYPE; v_event uuid; v_reason text:=btrim(p_reason);
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
  SELECT * INTO v_request FROM public.work_item_events WHERE actor_id=v_actor
    AND ownership_request_id=p_request_id AND event_type='reassignment_requested';
  IF FOUND AND (v_request.work_item_id<>p_work_item_id OR v_request.ownership_previous_assignee<>p_expected_assignee
    OR v_request.ownership_expected_revision<>p_expected_revision OR v_request.ownership_new_assignee<>p_to
    OR v_request.ownership_reason<>v_reason) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Reassignment request conflict';
  END IF;
  IF EXISTS(SELECT 1 FROM public.work_item_events WHERE actor_id=v_actor AND ownership_request_id=p_request_id AND event_type='reassignment_cancelled') THEN
    PERFORM public.lock_work_ownership_scope(v_context.organization_id,v_context.patient_id,NULL,NULL,true);
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='This reassignment request was cancelled';
  END IF;
  SELECT * INTO v_receipt FROM public.work_item_events WHERE actor_id=v_actor AND ownership_request_id=p_request_id AND event_type='assigned';
  IF FOUND THEN
    PERFORM public.lock_work_ownership_scope(v_context.organization_id,v_context.patient_id,NULL,NULL,true);
    IF v_receipt.work_item_id<>p_work_item_id OR v_receipt.ownership_previous_assignee<>p_expected_assignee
      OR v_receipt.ownership_expected_revision<>p_expected_revision OR v_receipt.ownership_new_assignee<>p_to
      OR v_receipt.ownership_reason<>v_reason THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Reassignment request conflict';
    END IF;
    RETURN public.work_reassignment_receipt_json(v_receipt.id);
  END IF;
  IF v_request.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Prepare work reassignment before applying';
  END IF;
  PERFORM public.lock_work_ownership_scope(v_context.organization_id,v_context.patient_id,v_context.assigned_to,p_to,true);
  SELECT * INTO v_item FROM public.work_items WHERE id=p_work_item_id FOR UPDATE;
  IF NOT FOUND OR v_item.organization_id IS DISTINCT FROM v_context.organization_id
    OR v_item.patient_id IS DISTINCT FROM v_context.patient_id THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized';
  END IF;
  -- A concurrent identical command may have committed while this one waited.
  SELECT * INTO v_receipt FROM public.work_item_events WHERE actor_id=v_actor AND ownership_request_id=p_request_id AND event_type='assigned';
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
