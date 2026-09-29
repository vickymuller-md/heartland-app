-- Read immutable mixed history under the existing scope -> work SHARE fence.
-- Deliberately do not acquire any source/head lock after the work lock.
CREATE OR REPLACE FUNCTION public.get_care_workflow_steps(p_work_item_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE result jsonb;
BEGIN
 result:=public.get_care_workflow(p_work_item_id);
 SELECT result||jsonb_build_object('next_action',f.next_action,'next_review_at',f.next_review_at,
  'work_status',w.status,'accepted_by',w.accepted_by,'transfer_pending_to',w.transfer_pending_to,
  'steps',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'actor_id',e.actor_id,'revision',e.revision::text,
   'ownership_revision',e.ownership_revision::text,'from_stage',e.from_stage,'to_stage',e.to_stage,
   'occurred_at',e.occurred_at,'recorded_at',e.recorded_at,'command',r.command,'payload',r.payload) ORDER BY e.revision)
   FROM public.care_step_events e JOIN public.care_step_requests r ON r.id=e.request_id WHERE e.work_item_id=f.work_item_id),'[]'),
  'compositions',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',e.id,'revision',e.revision::text,'ownership_revision',e.ownership_revision::text,
   'actor_id',r.actor_id,'from_stage',e.from_stage,'to_stage',e.to_stage,'occurred_at',e.occurred_at,'recorded_at',e.recorded_at,
   'payload',r.payload,'receipt',r.receipt) ORDER BY e.revision)
   FROM public.care_lab_composition_events e JOIN public.care_lab_composition_requests r ON r.id=e.request_id
   WHERE e.work_item_id=f.work_item_id),'[]'),
  'humans',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',e.id,'revision',e.revision::text,'ownership_revision',e.ownership_revision::text,
   'actor_id',e.actor_id,'from_stage',e.from_stage,'to_stage',e.to_stage,'occurred_at',e.occurred_at,'recorded_at',e.recorded_at,
   'request',public.care_human_request_state(r.id)-ARRAY['state','acknowledged_at','receipt'],
   'receipt',r.receipt) ORDER BY e.revision)
   FROM public.care_human_events e JOIN public.care_human_requests r ON r.id=e.request_id
   WHERE e.work_item_id=f.work_item_id),'[]'),
  'exceptions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'origin_event_id',e.origin_event_id,'human_origin_event_id',e.human_origin_event_id,'code',e.code,
   'reason',e.reason,'next_action',e.next_action,'next_review_at',e.next_review_at,'recorded_at',e.recorded_at) ORDER BY e.next_review_at,e.id)
   FROM public.care_workflow_exceptions e WHERE e.work_item_id=f.work_item_id),'[]')) INTO result
 FROM public.care_workflows f JOIN public.work_items w ON w.id=f.work_item_id WHERE f.work_item_id=p_work_item_id;
 PERFORM public.require_care_workflow_scope((result->>'organization_id')::uuid,(result->>'patient_id')::uuid,false);
 RETURN result;
END $$;
