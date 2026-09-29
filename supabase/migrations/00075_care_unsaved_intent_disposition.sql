-- Explicit administrative disposition only. Client recovery must ship before activation.
CREATE TABLE public.care_unsaved_intent_requests (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 intent_id uuid NOT NULL REFERENCES public.lab_followup_submission_intents(id) ON DELETE RESTRICT,
 expected_revision bigint NOT NULL CHECK(expected_revision>=1),
 expected_ownership_revision bigint NOT NULL CHECK(expected_ownership_revision>=0),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','applied','cancelled')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 applied_at timestamptz, cancelled_at timestamptz, acknowledged_at timestamptz, receipt jsonb,
 CHECK((state='prepared' AND num_nonnulls(applied_at,cancelled_at,acknowledged_at,receipt)=0)
  OR(state='applied' AND applied_at IS NOT NULL AND cancelled_at IS NULL AND receipt IS NOT NULL)
  OR(state='cancelled' AND cancelled_at IS NOT NULL AND num_nonnulls(applied_at,acknowledged_at,receipt)=0)),
 CHECK((applied_at IS NULL OR isfinite(applied_at)) AND(cancelled_at IS NULL OR isfinite(cancelled_at))
  AND(acknowledged_at IS NULL OR isfinite(acknowledged_at)))
);
CREATE UNIQUE INDEX care_unsaved_intent_prepared ON public.care_unsaved_intent_requests(actor_id,work_item_id) WHERE state='prepared';
CREATE INDEX care_unsaved_intent_pending ON public.care_unsaved_intent_requests(actor_id,organization_id,patient_id,id);
CREATE TABLE public.care_unsaved_intent_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES public.care_unsaved_intent_requests(id) ON DELETE RESTRICT,
 intent_id uuid NOT NULL UNIQUE REFERENCES public.lab_followup_submission_intents(id) ON DELETE RESTRICT,
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at))
);
CREATE TABLE public.care_unsaved_intent_context (
 xact_id xid8 NOT NULL, request_id uuid NOT NULL, intent_id uuid NOT NULL, work_item_id uuid NOT NULL, actor_id uuid NOT NULL,
 PRIMARY KEY(xact_id,request_id)
);
CREATE FUNCTION public.guard_care_unsaved_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='care_unsaved_intent_requests'
  AND(to_jsonb(OLD)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt'])
   IS NOT DISTINCT FROM(to_jsonb(NEW)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt']) THEN
  IF OLD.state='prepared' AND NEW.state IN('applied','cancelled') THEN RETURN NEW; END IF;
  IF OLD.state='applied' AND NEW.state='applied' AND OLD.acknowledged_at IS NULL AND NEW.acknowledged_at IS NOT NULL
   AND ROW(OLD.applied_at,OLD.cancelled_at,OLD.receipt) IS NOT DISTINCT FROM ROW(NEW.applied_at,NEW.cancelled_at,NEW.receipt) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Administrative disposition history is immutable';
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['care_unsaved_intent_requests','care_unsaved_intent_events','care_unsaved_intent_context'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  IF t<>'care_unsaved_intent_context' THEN
   EXECUTE format('CREATE TRIGGER guard_unsaved_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_care_unsaved_history()',t);
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION public.guard_care_unsaved_pending() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.care_unsaved_intent_requests WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared')
  OR(TG_TABLE_NAME='care_unsaved_intent_requests' AND(
   EXISTS(SELECT 1 FROM public.care_human_requests WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared')
   OR EXISTS(SELECT 1 FROM public.care_step_requests WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared')
   OR EXISTS(SELECT 1 FROM public.care_lab_composition_requests WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared')
   OR EXISTS(SELECT 1 FROM public.lab_followup_submission_intents WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared'))) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover or cancel the pending care operation first';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['care_unsaved_intent_requests','care_human_requests','care_step_requests','care_lab_composition_requests','lab_followup_submission_intents'] LOOP
  EXECUTE format('CREATE TRIGGER guard_against_unsaved_pending BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_care_unsaved_pending()',t);
 END LOOP;
END $$;

-- Minimal authorized-work snapshot; no former actor's payload or submission request UUID.
CREATE FUNCTION public.care_unsaved_intent_snapshot(p_intent uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE i public.lab_followup_submission_intents; a public.lab_submission_attempts;
BEGIN
 SELECT * INTO i FROM public.lab_followup_submission_intents WHERE id=p_intent;
 IF i.id IS NULL OR i.state<>'prepared' THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Intention is no longer pending'; END IF;
 SELECT * INTO a FROM public.lab_submission_attempts WHERE actor_id=i.actor_id AND patient_id=i.patient_id AND request_id=i.submission_request_id;
 IF a.request_id IS NULL OR a.closed_status='acknowledged' OR EXISTS(SELECT 1 FROM public.lab_submission_receipts
  WHERE actor_id=i.actor_id AND patient_id=i.patient_id AND request_id=i.submission_request_id) THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Saved or unavailable submission requires recovery and reconciliation';
 END IF;
 RETURN jsonb_build_object('intent_id',i.id,'recorded_at',i.recorded_at,
  'submission_status',CASE WHEN a.closed_status='cancelled' THEN 'submission_cancelled' ELSE 'awaiting_save' END,
  'submission_cancelled_at',a.closed_at);
END $$;
CREATE FUNCTION public.validate_care_unsaved_payload(p_payload jsonb,p_fresh boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; occurred timestamptz; recorded timestamptz; cancelled timestamptz;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR NOT(p_payload ?& ARRAY['snapshot','occurred_at','evidence','reason','unsaved_cancellation_acknowledged'])
  OR p_payload-ARRAY['snapshot','occurred_at','evidence','reason','unsaved_cancellation_acknowledged']<>'{}'
  OR NOT public.care_step_text(p_payload->'evidence',1000) OR NOT public.care_step_text(p_payload->'reason',1000)
  OR p_payload->'unsaved_cancellation_acknowledged' IS DISTINCT FROM 'true'::jsonb THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit unsaved disposition evidence required';
 END IF;
 s:=p_payload->'snapshot';
 IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT(s ?& ARRAY['intent_id','recorded_at','submission_status','submission_cancelled_at'])
  OR s-ARRAY['intent_id','recorded_at','submission_status','submission_cancelled_at']<>'{}'
  OR jsonb_typeof(s->'intent_id') IS DISTINCT FROM 'string'
  OR (s->>'intent_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR jsonb_typeof(s->'submission_status') IS DISTINCT FROM 'string'
  OR s->>'submission_status' NOT IN('awaiting_save','submission_cancelled') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Exact unsaved intention snapshot required';
 END IF;
 occurred:=public.care_step_instant(p_payload->'occurred_at'); recorded:=public.care_step_instant(s->'recorded_at');
 IF s->>'submission_status'='submission_cancelled' THEN cancelled:=public.care_step_instant(s->'submission_cancelled_at');
 ELSIF s->'submission_cancelled_at' IS DISTINCT FROM 'null'::jsonb THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Open submission cannot have a cancellation instant'; END IF;
 IF occurred<recorded OR(cancelled IS NOT NULL AND occurred<cancelled) OR(p_fresh AND occurred>clock_timestamp()) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Disposition occurrence must follow its exact intention state and not be future';
 END IF;
END $$;

-- Original submitter's keys precede current-author scope, matching 00067. No source locks.
CREATE FUNCTION public.lock_care_unsaved_target(p_work uuid,p_intent uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE i public.lab_followup_submission_intents; item public.work_items;
BEGIN
 SELECT * INTO item FROM public.work_items WHERE id=p_work AND source_type='care_workflow';
 IF item.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow unavailable'; END IF;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,true);
 SELECT * INTO i FROM public.lab_followup_submission_intents WHERE id=p_intent AND work_item_id=item.id
  AND organization_id=item.organization_id AND patient_id=item.patient_id;
 IF i.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Intention is outside the authorized work'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('heartland:lab-submission:'||i.actor_id||':'||i.patient_id,0));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('heartland:lab-submit:'||i.actor_id||':'||i.patient_id||':'||i.submission_request_id,0));
 PERFORM public.lock_care_workflow_scope(i.organization_id,i.patient_id,true);
 PERFORM request_id FROM public.lab_submission_attempts WHERE actor_id=i.actor_id AND patient_id=i.patient_id AND request_id=i.submission_request_id FOR UPDATE;
 PERFORM id FROM public.work_items WHERE id=item.id FOR UPDATE;
 PERFORM work_item_id FROM public.care_workflows WHERE work_item_id=item.id FOR UPDATE;
 PERFORM public.require_care_workflow_scope(i.organization_id,i.patient_id,true);
END $$;
CREATE FUNCTION public.verify_care_unsaved_target(p_work uuid,p_intent uuid,p_revision bigint,p_ownership bigint,p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.work_items; flow public.care_workflows; i public.lab_followup_submission_intents;
BEGIN
 SELECT * INTO item FROM public.work_items WHERE id=p_work;
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=p_work;
 SELECT * INTO i FROM public.lab_followup_submission_intents WHERE id=p_intent AND work_item_id=p_work FOR UPDATE;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,true);
 PERFORM public.require_care_step_owner(item,flow,p_revision,p_ownership);
 IF flow.kind<>'laboratory_order' OR i.id IS NULL OR i.actor_id=(SELECT auth.uid()) OR i.organization_id<>item.organization_id
  OR i.patient_id<>item.patient_id OR i.expected_ownership_revision>=item.ownership_revision THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact former-owner intention required';
 END IF;
 PERFORM public.validate_care_unsaved_payload(p_payload,true);
 IF p_payload->'snapshot' IS DISTINCT FROM public.care_unsaved_intent_snapshot(i.id) THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Unsaved intention snapshot changed';
 END IF;
END $$;
CREATE FUNCTION public.care_unsaved_transition_authorized(p_actor uuid,p_patient uuid,p_submission uuid,p_intent uuid DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.care_unsaved_intent_requests;
BEGIN
 SELECT r.* INTO q FROM public.care_unsaved_intent_context c JOIN public.care_unsaved_intent_requests r ON r.id=c.request_id
 JOIN public.care_unsaved_intent_events e ON e.request_id=r.id AND e.intent_id=c.intent_id AND e.work_item_id=c.work_item_id
 JOIN public.lab_followup_submission_intents i ON i.id=e.intent_id AND i.work_item_id=e.work_item_id
 WHERE c.xact_id=pg_catalog.pg_current_xact_id() AND c.actor_id=(SELECT auth.uid()) AND r.actor_id=c.actor_id AND r.state='prepared'
  AND r.work_item_id=i.work_item_id AND r.intent_id=i.id AND r.organization_id=i.organization_id AND r.patient_id=i.patient_id
  AND i.actor_id=p_actor AND i.actor_id<>r.actor_id AND i.patient_id=p_patient AND i.submission_request_id=p_submission
  AND i.state='prepared' AND(p_intent IS NULL OR i.id=p_intent);
 IF q.id IS NULL THEN RETURN false; END IF;
 PERFORM public.require_care_workflow_scope(q.organization_id,q.patient_id,true);
 RETURN NOT EXISTS(SELECT 1 FROM public.lab_submission_receipts WHERE actor_id=p_actor AND patient_id=p_patient AND request_id=p_submission);
END $$;

-- Keep the 00039 erasure path and the actor's existing ACK/cancellation semantics.
CREATE OR REPLACE FUNCTION public.enforce_lab_submission_attempt_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF public.lab_provenance_erasure_active(OLD.actor_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Laboratory submission history is immutable';
 END IF;
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
  OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.closed_at IS NOT NULL THEN
  RAISE EXCEPTION 'Laboratory submission history is immutable';
 END IF;
 IF (SELECT auth.uid()) IS DISTINCT FROM OLD.actor_id OR NOT COALESCE(public.provider_has_patient(OLD.patient_id),false) THEN
  IF NEW.closed_status IS DISTINCT FROM 'cancelled' OR NEW.acknowledged_lab_result_id IS NOT NULL
   OR NOT public.care_unsaved_transition_authorized(OLD.actor_id,OLD.patient_id,OLD.request_id) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory operation not authorized'; END IF;
 END IF;
 IF NEW.closed_status='acknowledged' THEN
  IF NOT EXISTS(SELECT 1 FROM public.lab_submission_receipts r WHERE r.actor_id=OLD.actor_id AND r.patient_id=OLD.patient_id
   AND r.request_id=OLD.request_id AND r.lab_result_id=NEW.acknowledged_lab_result_id) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Laboratory receipt does not match'; END IF;
 ELSIF NEW.closed_status='cancelled' THEN
  IF EXISTS(SELECT 1 FROM public.lab_submission_receipts r WHERE r.actor_id=OLD.actor_id AND r.patient_id=OLD.patient_id AND r.request_id=OLD.request_id) THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Laboratory submission is committed'; END IF;
 ELSE RAISE EXCEPTION 'Invalid laboratory submission transition'; END IF;
 NEW.closed_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_lab_followup_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.state='prepared'
  AND(to_jsonb(OLD)-ARRAY['state','cancelled_at','reconciled_at']) IS NOT DISTINCT FROM(to_jsonb(NEW)-ARRAY['state','cancelled_at','reconciled_at']) THEN
  IF NEW.state='cancelled' AND NEW.cancelled_at IS NOT NULL AND NEW.reconciled_at IS NULL
   AND(OLD.actor_id=(SELECT auth.uid()) OR public.care_unsaved_transition_authorized(OLD.actor_id,OLD.patient_id,OLD.submission_request_id,OLD.id))
   AND EXISTS(SELECT 1 FROM public.lab_submission_attempts a WHERE a.actor_id=OLD.actor_id AND a.patient_id=OLD.patient_id
    AND a.request_id=OLD.submission_request_id AND a.closed_status='cancelled')
   AND NOT EXISTS(SELECT 1 FROM public.lab_submission_receipts r WHERE r.actor_id=OLD.actor_id AND r.patient_id=OLD.patient_id AND r.request_id=OLD.submission_request_id) THEN
   PERFORM public.require_care_workflow_scope(OLD.organization_id,OLD.patient_id,false); RETURN NEW;
  END IF;
  IF NEW.state='reconciled' AND NEW.reconciled_at IS NOT NULL AND NEW.cancelled_at IS NULL
   AND public.care_workflow_write_authorized(OLD.work_item_id)
   AND EXISTS(SELECT 1 FROM public.lab_followup_intent_resolutions r JOIN public.care_lab_composition_events e ON e.id=r.event_id
    JOIN public.care_lab_composition_requests q ON q.id=e.request_id WHERE r.intent_id=OLD.id AND e.work_item_id=OLD.work_item_id
     AND q.actor_id=(SELECT auth.uid()) AND q.organization_id=OLD.organization_id AND q.patient_id=OLD.patient_id) THEN
   PERFORM public.require_care_workflow_scope(OLD.organization_id,OLD.patient_id,false); RETURN NEW;
  END IF;
 END IF;
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory follow-up intention is immutable';
END $$;

CREATE FUNCTION public.care_unsaved_request_state(p_request uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
 SELECT jsonb_build_object('request_id',id,'actor_id',actor_id,'organization_id',organization_id,'patient_id',patient_id,
  'work_item_id',work_item_id,'intent_id',intent_id,'expected_revision',expected_revision::text,'expected_ownership_revision',expected_ownership_revision::text,
  'payload',payload,'state',state,'recorded_at',recorded_at,'acknowledged_at',acknowledged_at,'receipt',receipt)
 FROM public.care_unsaved_intent_requests WHERE id=p_request
$$;
CREATE FUNCTION public.get_care_unsaved_intent_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE q public.care_unsaved_intent_requests; result jsonb;
BEGIN
 SELECT * INTO q FROM public.care_unsaved_intent_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF q.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Administrative request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(q.organization_id,q.patient_id,false);
 PERFORM id FROM public.care_unsaved_intent_requests WHERE id=q.id FOR UPDATE;
 result:=public.care_unsaved_request_state(q.id);
 PERFORM public.require_care_workflow_scope(q.organization_id,q.patient_id,false); RETURN result;
END $$;
CREATE FUNCTION public.get_care_unsaved_intent_context(p_work_item_id uuid,p_intent_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE item public.work_items; flow public.care_workflows; snapshot jsonb; result jsonb;
BEGIN
 PERFORM public.lock_care_unsaved_target(p_work_item_id,p_intent_id);
 SELECT * INTO item FROM public.work_items WHERE id=p_work_item_id;
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=item.id;
 snapshot:=public.care_unsaved_intent_snapshot(p_intent_id);
 PERFORM public.verify_care_unsaved_target(item.id,p_intent_id,flow.revision,item.ownership_revision,
  jsonb_build_object('snapshot',snapshot,'occurred_at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'evidence','Context eligibility only','reason','Context eligibility only','unsaved_cancellation_acknowledged',true));
 result:=jsonb_build_object('actor_id',(SELECT auth.uid()),'organization_id',item.organization_id,'patient_id',item.patient_id,
  'work_item_id',item.id,'workflow_revision',flow.revision::text,'ownership_revision',item.ownership_revision::text,'snapshot',snapshot);
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,true); RETURN result;
END $$;
CREATE FUNCTION public.prepare_care_unsaved_intent_request(p_request_id uuid,p_work_item_id uuid,p_intent_id uuid,p_organization_id uuid,p_patient_id uuid,
 p_expected_revision bigint,p_expected_ownership_revision bigint,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE q public.care_unsaved_intent_requests; item public.work_items; result jsonb;
BEGIN
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
 SELECT * INTO q FROM public.care_unsaved_intent_requests WHERE id=p_request_id;
 IF q.id IS NOT NULL THEN
  IF q.actor_id IS DISTINCT FROM (SELECT auth.uid()) OR q.organization_id IS DISTINCT FROM p_organization_id OR q.patient_id IS DISTINCT FROM p_patient_id
   OR q.work_item_id IS DISTINCT FROM p_work_item_id OR q.intent_id IS DISTINCT FROM p_intent_id OR q.expected_revision IS DISTINCT FROM p_expected_revision
   OR q.expected_ownership_revision IS DISTINCT FROM p_expected_ownership_revision OR q.payload IS DISTINCT FROM p_payload THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Administrative request identity conflict'; END IF;
  RETURN public.get_care_unsaved_intent_request(q.id);
 END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Request identity required'; END IF;
 PERFORM public.lock_care_unsaved_target(p_work_item_id,p_intent_id);
 SELECT * INTO item FROM public.work_items WHERE id=p_work_item_id;
 IF item.organization_id IS DISTINCT FROM p_organization_id OR item.patient_id IS DISTINCT FROM p_patient_id THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Administrative scope mismatch'; END IF;
 -- A concurrent first preparation may have committed while waiting on the shared scope.
 SELECT * INTO q FROM public.care_unsaved_intent_requests WHERE id=p_request_id FOR UPDATE;
 IF q.id IS NOT NULL THEN
  IF q.actor_id IS DISTINCT FROM (SELECT auth.uid()) OR q.organization_id IS DISTINCT FROM p_organization_id OR q.patient_id IS DISTINCT FROM p_patient_id
   OR q.work_item_id IS DISTINCT FROM p_work_item_id OR q.intent_id IS DISTINCT FROM p_intent_id OR q.expected_revision IS DISTINCT FROM p_expected_revision
   OR q.expected_ownership_revision IS DISTINCT FROM p_expected_ownership_revision OR q.payload IS DISTINCT FROM p_payload THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Administrative request identity conflict'; END IF;
  result:=public.care_unsaved_request_state(q.id);
 ELSE
  PERFORM public.verify_care_unsaved_target(item.id,p_intent_id,p_expected_revision,p_expected_ownership_revision,p_payload);
  INSERT INTO public.care_unsaved_intent_requests(id,actor_id,organization_id,patient_id,work_item_id,intent_id,expected_revision,expected_ownership_revision,payload)
   VALUES(p_request_id,(SELECT auth.uid()),p_organization_id,p_patient_id,item.id,p_intent_id,p_expected_revision,p_expected_ownership_revision,p_payload);
  result:=public.care_unsaved_request_state(p_request_id);
 END IF;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,true); RETURN result;
END $$;
CREATE FUNCTION public.apply_care_unsaved_intent_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE q public.care_unsaved_intent_requests; i public.lab_followup_submission_intents; a public.lab_submission_attempts;
 event public.care_unsaved_intent_events; result jsonb; v_receipt jsonb;
BEGIN
 SELECT * INTO q FROM public.care_unsaved_intent_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF q.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Administrative request not authorized'; END IF;
 IF q.state<>'prepared' THEN RETURN public.get_care_unsaved_intent_request(q.id); END IF;
 PERFORM public.lock_care_unsaved_target(q.work_item_id,q.intent_id);
 SELECT * INTO q FROM public.care_unsaved_intent_requests WHERE id=p_request_id FOR UPDATE;
 IF q.state<>'prepared' THEN
  result:=public.care_unsaved_request_state(q.id);
  PERFORM public.require_care_workflow_scope(q.organization_id,q.patient_id,false); RETURN result;
 END IF;
 PERFORM public.verify_care_unsaved_target(q.work_item_id,q.intent_id,q.expected_revision,q.expected_ownership_revision,q.payload);
 SELECT * INTO i FROM public.lab_followup_submission_intents WHERE id=q.intent_id;
 INSERT INTO public.care_unsaved_intent_context(xact_id,request_id,intent_id,work_item_id,actor_id)
  VALUES(pg_catalog.pg_current_xact_id(),q.id,i.id,q.work_item_id,q.actor_id);
 INSERT INTO public.care_unsaved_intent_events(request_id,intent_id,work_item_id) VALUES(q.id,i.id,q.work_item_id) RETURNING * INTO event;
 UPDATE public.lab_submission_attempts SET closed_status='cancelled',closed_at=clock_timestamp()
  WHERE actor_id=i.actor_id AND patient_id=i.patient_id AND request_id=i.submission_request_id AND closed_status IS NULL;
 SELECT * INTO a FROM public.lab_submission_attempts WHERE actor_id=i.actor_id AND patient_id=i.patient_id AND request_id=i.submission_request_id;
 UPDATE public.lab_followup_submission_intents SET state='cancelled',cancelled_at=clock_timestamp() WHERE id=i.id RETURNING * INTO i;
 v_receipt:=jsonb_build_object('request_id',q.id,'event_id',event.id,'intent_id',i.id,'work_item_id',q.work_item_id,
  'workflow_revision',q.expected_revision::text,'ownership_revision',q.expected_ownership_revision::text,
  'recorded_at',event.recorded_at,'submission_cancelled_at',a.closed_at,'intent_cancelled_at',i.cancelled_at,
  'intention_cancelled',true,'result_saved',false,'result_linked',false,'clinical_review_recorded',false,'communication_confirmed',false,'care_completed',false);
 UPDATE public.care_unsaved_intent_requests SET state='applied',applied_at=clock_timestamp(),receipt=v_receipt WHERE id=q.id;
 DELETE FROM public.care_unsaved_intent_context WHERE xact_id=pg_catalog.pg_current_xact_id() AND request_id=q.id;
 result:=public.care_unsaved_request_state(q.id);
 PERFORM public.require_care_workflow_scope(q.organization_id,q.patient_id,true); RETURN result;
END $$;
CREATE FUNCTION public.cancel_care_unsaved_intent_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE q public.care_unsaved_intent_requests; result jsonb;
BEGIN
 PERFORM public.get_care_unsaved_intent_request(p_request_id);
 SELECT * INTO q FROM public.care_unsaved_intent_requests WHERE id=p_request_id;
 IF q.state='prepared' THEN UPDATE public.care_unsaved_intent_requests SET state='cancelled',cancelled_at=clock_timestamp() WHERE id=q.id; END IF;
 result:=public.care_unsaved_request_state(q.id);
 PERFORM public.require_care_workflow_scope(q.organization_id,q.patient_id,false); RETURN result;
END $$;
CREATE FUNCTION public.acknowledge_care_unsaved_intent_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE q public.care_unsaved_intent_requests; result jsonb;
BEGIN
 PERFORM public.get_care_unsaved_intent_request(p_request_id);
 SELECT * INTO q FROM public.care_unsaved_intent_requests WHERE id=p_request_id;
 IF q.state<>'applied' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='No applied administrative receipt'; END IF;
 IF q.acknowledged_at IS NULL THEN UPDATE public.care_unsaved_intent_requests SET acknowledged_at=clock_timestamp() WHERE id=q.id; END IF;
 result:=public.care_unsaved_request_state(q.id);
 PERFORM public.require_care_workflow_scope(q.organization_id,q.patient_id,false); RETURN result;
END $$;
CREATE FUNCTION public.list_pending_care_unsaved_intent_requests(p_organization_id uuid,p_patient_id uuid,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.lock_care_workflow_scope(p_organization_id,p_patient_id,false);
 WITH candidates AS MATERIALIZED(SELECT id FROM public.care_unsaved_intent_requests
  WHERE actor_id=(SELECT auth.uid()) AND organization_id=p_organization_id AND patient_id=p_patient_id
   AND(state='prepared' OR(state='applied' AND acknowledged_at IS NULL)) AND(p_after IS NULL OR id>p_after) ORDER BY id LIMIT 26),
 page AS(SELECT id FROM candidates ORDER BY id LIMIT 25)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.care_unsaved_request_state(id) ORDER BY id) FROM page),'[]'),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>25 THEN(SELECT max(id::text) FROM page) END) INTO result;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false); RETURN result;
END $$;
CREATE FUNCTION public.list_care_unsaved_intent_history(p_work_item_id uuid,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE item public.work_items; result jsonb;
BEGIN
 item:=public.require_care_lab_read(p_work_item_id);
 PERFORM public.lock_care_workflow_scope(item.organization_id,item.patient_id,false);
 PERFORM id FROM public.work_items WHERE id=item.id FOR SHARE;
 item:=public.require_care_lab_read(item.id);
 WITH candidates AS MATERIALIZED(SELECT id FROM public.care_unsaved_intent_events WHERE work_item_id=item.id
  AND(p_after IS NULL OR id>p_after) ORDER BY id LIMIT 26),page AS(SELECT id FROM candidates ORDER BY id LIMIT 25)
 SELECT jsonb_build_object('work_item_id',item.id,'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'event_id',e.id,'actor_id',q.actor_id,'intent_id',e.intent_id,'recorded_at',e.recorded_at,'payload',q.payload,'receipt',q.receipt) ORDER BY e.id)
  FROM page p JOIN public.care_unsaved_intent_events e ON e.id=p.id JOIN public.care_unsaved_intent_requests q ON q.id=e.request_id),'[]'),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>25 THEN(SELECT max(id::text) FROM page) END) INTO result;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'guard_care_unsaved_history','guard_care_unsaved_pending','care_unsaved_intent_snapshot','validate_care_unsaved_payload',
  'lock_care_unsaved_target','verify_care_unsaved_target','care_unsaved_transition_authorized','care_unsaved_request_state',
  'get_care_unsaved_intent_request','get_care_unsaved_intent_context','prepare_care_unsaved_intent_request','apply_care_unsaved_intent_request',
  'cancel_care_unsaved_intent_request','acknowledge_care_unsaved_intent_request','list_pending_care_unsaved_intent_requests','list_care_unsaved_intent_history') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.get_care_unsaved_intent_request(uuid),public.get_care_unsaved_intent_context(uuid,uuid),
 public.prepare_care_unsaved_intent_request(uuid,uuid,uuid,uuid,uuid,bigint,bigint,jsonb),public.apply_care_unsaved_intent_request(uuid),
 public.cancel_care_unsaved_intent_request(uuid),public.acknowledge_care_unsaved_intent_request(uuid),
 public.list_pending_care_unsaved_intent_requests(uuid,uuid,uuid),public.list_care_unsaved_intent_history(uuid,uuid) TO authenticated;
