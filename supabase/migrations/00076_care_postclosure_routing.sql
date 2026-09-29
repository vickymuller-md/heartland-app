-- Local administrative routing only. Ship with recovery/minimal-reader UI before activation.
-- Existing source invalidations remain durable; no source/clinical workflow is rewritten.
CREATE TABLE public.care_postclosure_requests (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 invalidation_id uuid NOT NULL REFERENCES public.care_lab_source_invalidations(id) ON DELETE RESTRICT,
 predecessor_work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 expected_revision bigint NOT NULL CHECK(expected_revision=1),
 expected_ownership_revision bigint NOT NULL CHECK(expected_ownership_revision>=0),
 expected_routing_revision bigint NOT NULL CHECK(expected_routing_revision BETWEEN 0 AND 9223372036854775806),
 previous_event_id uuid,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','applied','cancelled')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 applied_at timestamptz,cancelled_at timestamptz,acknowledged_at timestamptz,receipt jsonb,
 CHECK(work_item_id<>predecessor_work_item_id),
 CHECK((expected_routing_revision=0)=(previous_event_id IS NULL)),
 CHECK((state='prepared' AND num_nonnulls(applied_at,cancelled_at,acknowledged_at,receipt)=0)
  OR(state='applied' AND applied_at IS NOT NULL AND cancelled_at IS NULL AND receipt IS NOT NULL)
  OR(state='cancelled' AND cancelled_at IS NOT NULL AND num_nonnulls(applied_at,acknowledged_at,receipt)=0))
);
CREATE UNIQUE INDEX care_postclosure_prepared_work ON public.care_postclosure_requests(actor_id,work_item_id) WHERE state='prepared';
CREATE UNIQUE INDEX care_postclosure_prepared_target ON public.care_postclosure_requests(actor_id,invalidation_id) WHERE state='prepared';
CREATE INDEX care_postclosure_pending ON public.care_postclosure_requests(actor_id,organization_id,patient_id,id);
CREATE TABLE public.care_postclosure_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES public.care_postclosure_requests(id) ON DELETE RESTRICT,
 invalidation_id uuid NOT NULL REFERENCES public.care_lab_source_invalidations(id) ON DELETE RESTRICT,
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 previous_event_id uuid REFERENCES public.care_postclosure_events(id) ON DELETE RESTRICT,
 revision bigint NOT NULL CHECK(revision>=1),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(invalidation_id,revision),CHECK((revision=1)=(previous_event_id IS NULL))
);
ALTER TABLE public.care_postclosure_requests ADD FOREIGN KEY(previous_event_id) REFERENCES public.care_postclosure_events(id) ON DELETE RESTRICT;
CREATE FUNCTION public.guard_care_postclosure_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='care_postclosure_requests'
  AND(to_jsonb(OLD)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt'])
   IS NOT DISTINCT FROM(to_jsonb(NEW)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt']) THEN
  IF OLD.state='prepared' AND NEW.state IN('applied','cancelled') THEN RETURN NEW; END IF;
  IF OLD.state='applied' AND NEW.state='applied' AND OLD.acknowledged_at IS NULL AND NEW.acknowledged_at IS NOT NULL
   AND ROW(OLD.applied_at,OLD.cancelled_at,OLD.receipt) IS NOT DISTINCT FROM ROW(NEW.applied_at,NEW.cancelled_at,NEW.receipt) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Post-closure routing history is immutable';
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['care_postclosure_requests','care_postclosure_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER guard_postclosure_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_care_postclosure_history()',t);
 END LOOP;
END $$;
CREATE FUNCTION public.guard_care_postclosure_pending() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.care_postclosure_requests WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared')
  OR(TG_TABLE_NAME='care_postclosure_requests' AND(
   EXISTS(SELECT 1 FROM public.care_step_requests WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared')
   OR EXISTS(SELECT 1 FROM public.care_human_requests WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared')
   OR EXISTS(SELECT 1 FROM public.care_lab_composition_requests WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared')
   OR EXISTS(SELECT 1 FROM public.lab_followup_submission_intents WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared')
   OR EXISTS(SELECT 1 FROM public.care_unsaved_intent_requests WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared'))) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover or cancel the pending care operation first'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['care_postclosure_requests','care_step_requests','care_human_requests','care_lab_composition_requests',
  'lab_followup_submission_intents','care_unsaved_intent_requests'] LOOP
  EXECUTE format('CREATE TRIGGER guard_against_postclosure_pending BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_care_postclosure_pending()',t);
 END LOOP;
END $$;

-- Immutable origin only. No current head, source values or predecessor's private human text.
CREATE FUNCTION public.care_postclosure_snapshot(p_invalidation uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
 SELECT jsonb_build_object('invalidation_id',i.id,'organization_id',w.organization_id,'patient_id',w.patient_id,
  'predecessor_work_item_id',w.id,'closure_event_id',h.id,'closure_recorded_at',h.recorded_at,
  'entry_id',e.id,'composition_event_id',c.id,'analyte',e.analyte,'root_id',e.root_id,
  'change_version_id',i.change_version_id,'change_revision',v.revision::text,'change_status',v.status,
  'change_recorded_at',ch.recorded_at,'invalidation_recorded_at',i.recorded_at)
 FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries e ON e.id=i.entry_id
 JOIN public.care_lab_composition_events c ON c.id=e.event_id JOIN public.work_items w ON w.id=c.work_item_id
 JOIN public.care_workflows f ON f.work_item_id=w.id JOIN public.care_workflow_closures cl ON cl.work_item_id=w.id
 JOIN public.care_human_events h ON h.id=cl.human_event_id JOIN public.care_human_requests q ON q.id=h.request_id
 JOIN public.lab_observation_change_events ch ON ch.version_id=i.change_version_id
 JOIN public.lab_observation_versions v ON v.id=i.change_version_id AND v.root_id=e.root_id
 WHERE i.id=p_invalidation AND f.kind='laboratory_order' AND w.status='closed'
  AND NOT(q.payload#>'{details,snapshot,known_invalidation_ids}' ? i.id::text)
$$;
CREATE FUNCTION public.care_postclosure_current(p_invalidation uuid) RETURNS public.care_postclosure_events
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT e FROM public.care_postclosure_events e WHERE invalidation_id=p_invalidation ORDER BY revision DESC LIMIT 1
$$;
CREATE FUNCTION public.lock_care_postclosure(p_invalidation uuid,p_successor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE s jsonb; previous public.care_postclosure_events; after_lock public.care_postclosure_events; works uuid[];
BEGIN
 s:=public.care_postclosure_snapshot(p_invalidation);
 IF s IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Post-closure need unavailable'; END IF;
 PERFORM public.lock_care_workflow_scope((s->>'organization_id')::uuid,(s->>'patient_id')::uuid,true);
 previous:=public.care_postclosure_current(p_invalidation);
 IF NOT EXISTS(SELECT 1 FROM public.work_items WHERE id=p_successor AND source_type='care_workflow'
  AND organization_id=(s->>'organization_id')::uuid AND patient_id=(s->>'patient_id')::uuid) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Successor is outside the authorized need'; END IF;
 works:=ARRAY[(s->>'predecessor_work_item_id')::uuid,previous.work_item_id,p_successor];
 PERFORM id FROM public.work_items WHERE id=ANY(works) ORDER BY id FOR UPDATE;
 PERFORM work_item_id FROM public.care_workflows WHERE work_item_id=ANY(works) ORDER BY work_item_id FOR UPDATE;
 after_lock:=public.care_postclosure_current(p_invalidation);
 IF after_lock.id IS DISTINCT FROM previous.id THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Routing changed while acquiring its exact work locks'; END IF;
 PERFORM public.require_care_workflow_scope((s->>'organization_id')::uuid,(s->>'patient_id')::uuid,true);
END $$;
CREATE FUNCTION public.verify_care_postclosure_successor(p_invalidation uuid,p_successor uuid,p_revision bigint,p_ownership bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; item public.work_items; flow public.care_workflows; previous public.care_postclosure_events;
BEGIN
 s:=public.care_postclosure_snapshot(p_invalidation);
 IF s IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Post-closure need unavailable'; END IF;
 PERFORM public.require_care_workflow_scope((s->>'organization_id')::uuid,(s->>'patient_id')::uuid,true);
 SELECT * INTO item FROM public.work_items WHERE id=p_successor;
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=p_successor;
 previous:=public.care_postclosure_current(p_invalidation);
 IF item.id IS NULL OR flow.work_item_id IS NULL OR item.organization_id IS DISTINCT FROM (s->>'organization_id')::uuid
  OR item.patient_id IS DISTINCT FROM (s->>'patient_id')::uuid OR item.id=(s->>'predecessor_work_item_id')::uuid
  OR item.id=previous.work_item_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='A distinct authorized successor is required'; END IF;
 PERFORM public.require_care_step_owner(item,flow,p_revision,p_ownership);
 IF flow.kind<>'laboratory_order' OR flow.stage<>'requested' OR flow.revision<>1
  OR NOT(s->>'analyte'=ANY(flow.requested_analytes))
  OR flow.recorded_at<(s->>'invalidation_recorded_at')::timestamptz
  OR flow.next_review_at<=clock_timestamp() OR item.due_at<=clock_timestamp() THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Successor must be newly created, accepted, initial and have an explicit future review'; END IF;
END $$;
CREATE FUNCTION public.verify_care_postclosure_request(p_invalidation uuid,p_successor uuid,p_revision bigint,p_ownership bigint,
 p_routing_revision bigint,p_previous uuid,p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; previous public.care_postclosure_events; flow public.care_workflows; item public.work_items; occurred timestamptz;
BEGIN
 PERFORM public.verify_care_postclosure_successor(p_invalidation,p_successor,p_revision,p_ownership);
 s:=public.care_postclosure_snapshot(p_invalidation); previous:=public.care_postclosure_current(p_invalidation);
 IF p_routing_revision IS NULL OR p_routing_revision NOT BETWEEN 0 AND 9223372036854775806
  OR p_routing_revision<>COALESCE(previous.revision,0) OR p_previous IS DISTINCT FROM previous.id THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Routing revision or previous link changed'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR NOT(p_payload ?& ARRAY['snapshot','occurred_at','reason','evidence','review_at','responsibility_acknowledged','supersession_acknowledged'])
  OR p_payload-ARRAY['snapshot','occurred_at','reason','evidence','review_at','responsibility_acknowledged','supersession_acknowledged']<>'{}'
  OR NOT public.care_step_text(p_payload->'reason',1000) OR NOT public.care_step_text(p_payload->'evidence',1000)
  OR p_payload->'responsibility_acknowledged' IS DISTINCT FROM 'true'::jsonb
  OR p_payload->'supersession_acknowledged' IS DISTINCT FROM to_jsonb(p_routing_revision>0) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit routing evidence and acknowledgements required'; END IF;
 IF p_payload->'snapshot' IS DISTINCT FROM s THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Exact immutable post-closure origin required'; END IF;
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=p_successor;
 SELECT * INTO item FROM public.work_items WHERE id=p_successor;
 occurred:=public.care_step_instant(p_payload->'occurred_at');
 IF occurred>clock_timestamp() OR occurred<GREATEST(flow.recorded_at,item.accepted_at,(s->>'invalidation_recorded_at')::timestamptz)
  OR public.care_step_instant(p_payload->'review_at') IS DISTINCT FROM flow.next_review_at THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Confirm the actual successor review and a nonfuture occurrence after origin, creation and acceptance'; END IF;
END $$;
CREATE FUNCTION public.care_postclosure_request_state(p_request uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
 SELECT jsonb_build_object('request_id',id,'actor_id',actor_id,'organization_id',organization_id,'patient_id',patient_id,
  'invalidation_id',invalidation_id,'predecessor_work_item_id',predecessor_work_item_id,'work_item_id',work_item_id,
  'expected_revision',expected_revision::text,'expected_ownership_revision',expected_ownership_revision::text,
  'expected_routing_revision',expected_routing_revision::text,'previous_event_id',previous_event_id,'payload',payload,
  'state',state,'recorded_at',recorded_at,'acknowledged_at',acknowledged_at,'receipt',receipt)
 FROM public.care_postclosure_requests WHERE id=p_request
$$;
CREATE FUNCTION public.get_care_postclosure_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE q public.care_postclosure_requests; result jsonb;
BEGIN
 SELECT * INTO q FROM public.care_postclosure_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF q.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Routing request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(q.organization_id,q.patient_id,false);
 PERFORM id FROM public.care_postclosure_requests WHERE id=q.id FOR UPDATE;
 result:=public.care_postclosure_request_state(q.id);
 PERFORM public.require_care_workflow_scope(q.organization_id,q.patient_id,false); RETURN result;
END $$;
CREATE FUNCTION public.get_care_postclosure_context(p_invalidation_id uuid,p_work_item_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE s jsonb; item public.work_items; flow public.care_workflows; previous public.care_postclosure_events; result jsonb;
BEGIN
 PERFORM public.lock_care_postclosure(p_invalidation_id,p_work_item_id);
 s:=public.care_postclosure_snapshot(p_invalidation_id);
 SELECT * INTO item FROM public.work_items WHERE id=p_work_item_id;
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=p_work_item_id;
 PERFORM public.verify_care_postclosure_successor(p_invalidation_id,p_work_item_id,flow.revision,item.ownership_revision);
 previous:=public.care_postclosure_current(p_invalidation_id);
 result:=jsonb_build_object('actor_id',(SELECT auth.uid()),'organization_id',item.organization_id,'patient_id',item.patient_id,
  'work_item_id',item.id,'workflow_revision',flow.revision::text,'ownership_revision',item.ownership_revision::text,
  'routing_revision',COALESCE(previous.revision,0)::text,'previous_event_id',previous.id,'previous_work_item_id',previous.work_item_id,
  'successor_created_at',flow.recorded_at,'successor_accepted_at',item.accepted_at,'review_at',flow.next_review_at,'snapshot',s);
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,true); RETURN result;
END $$;
CREATE FUNCTION public.prepare_care_postclosure_request(p_request_id uuid,p_invalidation_id uuid,p_work_item_id uuid,p_organization_id uuid,
 p_patient_id uuid,p_expected_revision bigint,p_expected_ownership_revision bigint,p_expected_routing_revision bigint,p_previous_event_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE q public.care_postclosure_requests; s jsonb; result jsonb;
BEGIN
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
 SELECT * INTO q FROM public.care_postclosure_requests WHERE id=p_request_id;
 IF q.id IS NOT NULL THEN
  IF q.actor_id IS DISTINCT FROM (SELECT auth.uid()) OR q.organization_id IS DISTINCT FROM p_organization_id OR q.patient_id IS DISTINCT FROM p_patient_id
   OR q.work_item_id IS DISTINCT FROM p_work_item_id OR q.invalidation_id IS DISTINCT FROM p_invalidation_id
   OR q.expected_revision IS DISTINCT FROM p_expected_revision OR q.expected_ownership_revision IS DISTINCT FROM p_expected_ownership_revision
   OR q.expected_routing_revision IS DISTINCT FROM p_expected_routing_revision OR q.previous_event_id IS DISTINCT FROM p_previous_event_id
   OR q.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Routing request identity conflict'; END IF;
  RETURN public.get_care_postclosure_request(q.id);
 END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Request identity required'; END IF;
 PERFORM public.lock_care_postclosure(p_invalidation_id,p_work_item_id);
 s:=public.care_postclosure_snapshot(p_invalidation_id);
 IF (s->>'organization_id')::uuid IS DISTINCT FROM p_organization_id OR(s->>'patient_id')::uuid IS DISTINCT FROM p_patient_id THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Routing scope mismatch'; END IF;
 SELECT * INTO q FROM public.care_postclosure_requests WHERE id=p_request_id FOR UPDATE;
 IF q.id IS NOT NULL THEN
  IF q.actor_id IS DISTINCT FROM (SELECT auth.uid()) OR q.organization_id IS DISTINCT FROM p_organization_id OR q.patient_id IS DISTINCT FROM p_patient_id
   OR q.work_item_id IS DISTINCT FROM p_work_item_id OR q.invalidation_id IS DISTINCT FROM p_invalidation_id
   OR q.expected_revision IS DISTINCT FROM p_expected_revision OR q.expected_ownership_revision IS DISTINCT FROM p_expected_ownership_revision
   OR q.expected_routing_revision IS DISTINCT FROM p_expected_routing_revision OR q.previous_event_id IS DISTINCT FROM p_previous_event_id
   OR q.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Routing request identity conflict'; END IF;
  result:=public.care_postclosure_request_state(q.id);
 ELSE
  PERFORM public.verify_care_postclosure_request(p_invalidation_id,p_work_item_id,p_expected_revision,p_expected_ownership_revision,
   p_expected_routing_revision,p_previous_event_id,p_payload);
  INSERT INTO public.care_postclosure_requests(id,actor_id,organization_id,patient_id,invalidation_id,predecessor_work_item_id,work_item_id,
   expected_revision,expected_ownership_revision,expected_routing_revision,previous_event_id,payload)
  VALUES(p_request_id,(SELECT auth.uid()),p_organization_id,p_patient_id,p_invalidation_id,(s->>'predecessor_work_item_id')::uuid,p_work_item_id,
   p_expected_revision,p_expected_ownership_revision,p_expected_routing_revision,p_previous_event_id,p_payload);
  result:=public.care_postclosure_request_state(p_request_id);
 END IF;
 IF result->>'state'='prepared' THEN
  PERFORM public.verify_care_postclosure_request(p_invalidation_id,p_work_item_id,p_expected_revision,p_expected_ownership_revision,
   p_expected_routing_revision,p_previous_event_id,p_payload);
 END IF;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,true); RETURN result;
END $$;
CREATE FUNCTION public.apply_care_postclosure_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE q public.care_postclosure_requests; event public.care_postclosure_events; v_receipt jsonb; result jsonb;
 item public.work_items; flow public.care_workflows;
BEGIN
 SELECT * INTO q FROM public.care_postclosure_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF q.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Routing request not authorized'; END IF;
 IF q.state<>'prepared' THEN RETURN public.get_care_postclosure_request(q.id); END IF;
 PERFORM public.lock_care_postclosure(q.invalidation_id,q.work_item_id);
 SELECT * INTO q FROM public.care_postclosure_requests WHERE id=p_request_id FOR UPDATE;
 IF q.state<>'prepared' THEN
  result:=public.care_postclosure_request_state(q.id);
  PERFORM public.require_care_workflow_scope(q.organization_id,q.patient_id,false); RETURN result;
 END IF;
 PERFORM public.verify_care_postclosure_request(q.invalidation_id,q.work_item_id,q.expected_revision,q.expected_ownership_revision,
  q.expected_routing_revision,q.previous_event_id,q.payload);
 INSERT INTO public.care_postclosure_events(request_id,invalidation_id,work_item_id,previous_event_id,revision)
  VALUES(q.id,q.invalidation_id,q.work_item_id,q.previous_event_id,q.expected_routing_revision+1) RETURNING * INTO event;
 v_receipt:=jsonb_build_object('request_id',q.id,'event_id',event.id,'invalidation_id',q.invalidation_id,
  'predecessor_work_item_id',q.predecessor_work_item_id,'work_item_id',q.work_item_id,'previous_event_id',q.previous_event_id,
  'routing_revision',event.revision::text,'workflow_revision',q.expected_revision::text,'ownership_revision',q.expected_ownership_revision::text,
  'recorded_at',event.recorded_at,'review_at',public.care_step_instant(q.payload->'review_at'),'delegated',true,
  'clinical_invalidation_resolved',false,'clinical_review_recorded',false,'communication_confirmed',false,'care_completed',false);
 UPDATE public.care_postclosure_requests SET state='applied',applied_at=clock_timestamp(),receipt=v_receipt WHERE id=q.id;
 result:=public.care_postclosure_request_state(q.id);
 -- Work/flow locks retain identity and revision; wall time can still expire during writes.
 -- The fresh successor helper cannot be reused: this very event is now the current route.
 SELECT * INTO item FROM public.work_items WHERE id=q.work_item_id;
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=q.work_item_id;
 PERFORM public.require_care_step_owner(item,flow,q.expected_revision,q.expected_ownership_revision);
 IF flow.next_review_at<=clock_timestamp() OR item.due_at<=clock_timestamp()
  OR flow.next_review_at IS DISTINCT FROM public.care_step_instant(q.payload->'review_at') THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Successor review expired or changed during routing'; END IF;
 PERFORM public.require_care_workflow_scope(q.organization_id,q.patient_id,true); RETURN result;
END $$;
CREATE FUNCTION public.cancel_care_postclosure_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE q public.care_postclosure_requests; result jsonb;
BEGIN
 PERFORM public.get_care_postclosure_request(p_request_id);
 SELECT * INTO q FROM public.care_postclosure_requests WHERE id=p_request_id;
 IF q.state='prepared' THEN UPDATE public.care_postclosure_requests SET state='cancelled',cancelled_at=clock_timestamp() WHERE id=q.id; END IF;
 result:=public.care_postclosure_request_state(q.id);
 PERFORM public.require_care_workflow_scope(q.organization_id,q.patient_id,false); RETURN result;
END $$;
CREATE FUNCTION public.acknowledge_care_postclosure_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE q public.care_postclosure_requests; result jsonb;
BEGIN
 PERFORM public.get_care_postclosure_request(p_request_id);
 SELECT * INTO q FROM public.care_postclosure_requests WHERE id=p_request_id;
 IF q.state<>'applied' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='No applied routing receipt'; END IF;
 IF q.acknowledged_at IS NULL THEN UPDATE public.care_postclosure_requests SET acknowledged_at=clock_timestamp() WHERE id=q.id; END IF;
 result:=public.care_postclosure_request_state(q.id);
 PERFORM public.require_care_workflow_scope(q.organization_id,q.patient_id,false); RETURN result;
END $$;
CREATE FUNCTION public.list_pending_care_postclosure_requests(p_organization_id uuid,p_patient_id uuid,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.lock_care_workflow_scope(p_organization_id,p_patient_id,false);
 WITH candidates AS MATERIALIZED(SELECT id FROM public.care_postclosure_requests
  WHERE actor_id=(SELECT auth.uid()) AND organization_id=p_organization_id AND patient_id=p_patient_id
   AND(state='prepared' OR(state='applied' AND acknowledged_at IS NULL)) AND(p_after IS NULL OR id>p_after) ORDER BY id LIMIT 26),
 page AS(SELECT id FROM candidates ORDER BY id LIMIT 25)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.care_postclosure_request_state(id) ORDER BY id) FROM page),'[]'),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>25 THEN(SELECT max(id::text) FROM page) END) INTO result;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false); RETURN result;
END $$;

-- Derived routing need persists independently of the former owner's current eligibility.
CREATE FUNCTION public.care_postclosure_rows(p_org uuid)
RETURNS TABLE(invalidation_id uuid,patient_id uuid,predecessor_work_item_id uuid,recorded_at timestamptz,snapshot jsonb,current_route jsonb,routing_state text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
 SELECT i.id,w.patient_id,w.id,i.recorded_at,public.care_postclosure_snapshot(i.id),
  CASE WHEN e.id IS NOT NULL THEN jsonb_build_object('event_id',e.id,'routing_revision',e.revision::text,'work_item_id',e.work_item_id,
   'recorded_at',e.recorded_at,'assigned_to',child.assigned_to,'accepted_by',child.accepted_by,'accepted_at',child.accepted_at,
   'transfer_pending_to',child.transfer_pending_to,'work_status',child.status,'current_due_at',child.due_at) END,
  CASE WHEN e.id IS NULL THEN 'unrouted' WHEN child.status='closed' THEN 'successor_closed'
   WHEN child.accepted_by IS DISTINCT FROM child.assigned_to OR child.accepted_at IS NULL
    OR NOT COALESCE(public.work_ownership_member_eligible(p_org,w.patient_id,child.assigned_to,clock_timestamp()),false) THEN 'responsibility_unavailable'
   WHEN child.due_at<=clock_timestamp() THEN 'overdue' ELSE 'delegated' END
 FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries en ON en.id=i.entry_id
 JOIN public.care_lab_composition_events c ON c.id=en.event_id JOIN public.work_items w ON w.id=c.work_item_id
 JOIN public.care_workflow_closures cl ON cl.work_item_id=w.id
 JOIN public.care_human_events h ON h.id=cl.human_event_id JOIN public.care_human_requests q ON q.id=h.request_id
 LEFT JOIN LATERAL(SELECT * FROM public.care_postclosure_events WHERE invalidation_id=i.id ORDER BY revision DESC LIMIT 1) e ON true
 LEFT JOIN public.work_items child ON child.id=e.work_item_id
 WHERE w.organization_id=p_org AND NOT(q.payload#>'{details,snapshot,known_invalidation_ids}' ? i.id::text)
$$;
CREATE FUNCTION public.require_care_postclosure_org_read(p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Routing reads require READ COMMITTED'; END IF;
 IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated' OR NOT COALESCE(public.provider_aal2() AND public.is_active_org_member(p_org),false)
  OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=(SELECT auth.uid()) AND role='provider')
  OR NOT EXISTS(SELECT 1 FROM public.consents WHERE user_id=(SELECT auth.uid()) AND consent_type='registration' AND consent_version='v1.0' AND accepted) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Routing visibility is not authorized'; END IF;
END $$;
CREATE FUNCTION public.list_care_postclosure_needs(p_organization_id uuid,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; row jsonb; manager boolean;
BEGIN
 PERFORM public.require_care_postclosure_org_read(p_organization_id);
 manager:=public.is_org_manager(p_organization_id);
 WITH rows AS MATERIALIZED(SELECT * FROM public.care_postclosure_rows(p_organization_id)),
 candidates AS MATERIALIZED(SELECT * FROM rows WHERE public.operational_exception_detail_allowed(p_organization_id,patient_id)
  AND(p_after IS NULL OR invalidation_id>p_after) ORDER BY invalidation_id LIMIT 26),
 page AS(SELECT * FROM candidates ORDER BY invalidation_id LIMIT 25)
 SELECT jsonb_build_object('organization_id',p_organization_id,'items',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY invalidation_id) FROM page p),'[]'),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>25 THEN(SELECT max(invalidation_id::text) FROM page) END,
  'counts',CASE WHEN manager THEN(SELECT jsonb_build_object('unrouted',count(*) FILTER(WHERE routing_state='unrouted'),
   'delegated',count(*) FILTER(WHERE routing_state='delegated'),'overdue',count(*) FILTER(WHERE routing_state='overdue'),
   'responsibility_unavailable',count(*) FILTER(WHERE routing_state='responsibility_unavailable'),
   'successor_closed',count(*) FILTER(WHERE routing_state='successor_closed')) FROM rows) END) INTO result;
 FOR row IN SELECT value FROM jsonb_array_elements(result->'items') LOOP
  PERFORM public.require_care_workflow_scope(p_organization_id,(row->>'patient_id')::uuid,false);
 END LOOP;
 PERFORM public.require_care_postclosure_org_read(p_organization_id);
 IF manager AND NOT public.is_org_manager(p_organization_id) THEN result:=jsonb_set(result,'{counts}','null'); END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.list_care_postclosure_history(p_invalidation_id uuid,p_after bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE s jsonb; result jsonb;
BEGIN
 s:=public.care_postclosure_snapshot(p_invalidation_id);
 IF s IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Post-closure need unavailable'; END IF;
 IF p_after IS NOT NULL AND p_after<0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid routing history cursor'; END IF;
 PERFORM public.lock_care_workflow_scope((s->>'organization_id')::uuid,(s->>'patient_id')::uuid,false);
 WITH candidates AS MATERIALIZED(SELECT id,revision FROM public.care_postclosure_events WHERE invalidation_id=p_invalidation_id
  AND(p_after IS NULL OR revision>p_after) ORDER BY revision LIMIT 26),page AS(SELECT * FROM candidates ORDER BY revision LIMIT 25)
 SELECT jsonb_build_object('invalidation_id',p_invalidation_id,'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'event_id',e.id,'actor_id',q.actor_id,'payload',q.payload,'receipt',q.receipt) ORDER BY e.revision)
  FROM page p JOIN public.care_postclosure_events e ON e.id=p.id JOIN public.care_postclosure_requests q ON q.id=e.request_id),'[]'),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>25 THEN(SELECT max(revision)::text FROM page) END) INTO result;
 PERFORM public.require_care_workflow_scope((s->>'organization_id')::uuid,(s->>'patient_id')::uuid,false); RETURN result;
END $$;
CREATE FUNCTION public.list_care_postclosure_successors(p_invalidation_id uuid,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE s jsonb; previous public.care_postclosure_events; result jsonb;
BEGIN
 s:=public.care_postclosure_snapshot(p_invalidation_id);
 IF s IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Post-closure need unavailable'; END IF;
 PERFORM public.lock_care_workflow_scope((s->>'organization_id')::uuid,(s->>'patient_id')::uuid,false);
 previous:=public.care_postclosure_current(p_invalidation_id);
 WITH candidates AS MATERIALIZED(SELECT w.id AS work_item_id,f.recorded_at AS created_at,w.accepted_at,w.ownership_revision::text,
  f.revision::text AS workflow_revision,f.next_review_at AS review_at
  FROM public.work_items w JOIN public.care_workflows f ON f.work_item_id=w.id
  WHERE w.organization_id=(s->>'organization_id')::uuid AND w.patient_id=(s->>'patient_id')::uuid
   AND w.assigned_to=(SELECT auth.uid()) AND w.accepted_by=(SELECT auth.uid()) AND w.accepted_at IS NOT NULL
   AND w.transfer_pending_to IS NULL AND w.status<>'closed' AND f.kind='laboratory_order' AND f.stage='requested' AND f.revision=1
   AND f.recorded_at>=(s->>'invalidation_recorded_at')::timestamptz AND s->>'analyte'=ANY(f.requested_analytes)
   AND f.next_review_at>clock_timestamp() AND w.due_at>clock_timestamp() AND w.id IS DISTINCT FROM previous.work_item_id
   AND(p_after IS NULL OR w.id>p_after) ORDER BY w.id LIMIT 26),page AS(SELECT * FROM candidates ORDER BY work_item_id LIMIT 25)
 SELECT jsonb_build_object('invalidation_id',p_invalidation_id,'items',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY work_item_id) FROM page p),'[]'),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>25 THEN(SELECT max(work_item_id::text) FROM page) END) INTO result;
 PERFORM public.require_care_workflow_scope((s->>'organization_id')::uuid,(s->>'patient_id')::uuid,false); RETURN result;
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'guard_care_postclosure_history','guard_care_postclosure_pending','care_postclosure_snapshot','care_postclosure_current',
  'lock_care_postclosure','verify_care_postclosure_successor','verify_care_postclosure_request','care_postclosure_request_state',
  'get_care_postclosure_request','get_care_postclosure_context','prepare_care_postclosure_request','apply_care_postclosure_request',
  'cancel_care_postclosure_request','acknowledge_care_postclosure_request','list_pending_care_postclosure_requests',
  'care_postclosure_rows','require_care_postclosure_org_read','list_care_postclosure_needs','list_care_postclosure_history','list_care_postclosure_successors') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.get_care_postclosure_request(uuid),public.get_care_postclosure_context(uuid,uuid),
 public.prepare_care_postclosure_request(uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,uuid,jsonb),public.apply_care_postclosure_request(uuid),
 public.cancel_care_postclosure_request(uuid),public.acknowledge_care_postclosure_request(uuid),public.list_pending_care_postclosure_requests(uuid,uuid,uuid),
 public.list_care_postclosure_needs(uuid,uuid),public.list_care_postclosure_history(uuid,bigint),public.list_care_postclosure_successors(uuid,uuid) TO authenticated;
