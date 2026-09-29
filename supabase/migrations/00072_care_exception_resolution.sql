-- Local backend: clients must understand resolve_exception before activation.
-- Resolving an operational barrier neither resolves source invalidations nor completes care.
ALTER TABLE public.care_human_requests DROP CONSTRAINT care_human_requests_command_check;
ALTER TABLE public.care_human_requests ADD CONSTRAINT care_human_requests_command_check
 CHECK(command IN('record_review','record_contact','resolve_exception'));
CREATE TABLE public.care_exception_resolutions (
 exception_id uuid PRIMARY KEY REFERENCES public.care_workflow_exceptions(id) ON DELETE RESTRICT,
 human_event_id uuid NOT NULL UNIQUE REFERENCES public.care_human_events(id) ON DELETE RESTRICT,
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT
);
ALTER TABLE public.care_exception_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.care_exception_resolutions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_care_resolution_history BEFORE UPDATE OR DELETE ON public.care_exception_resolutions
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_human_history();

CREATE FUNCTION public.care_exception_snapshot(p_work uuid,p_exception uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
 SELECT jsonb_build_object('exception_id',x.id,'origin_event_id',x.origin_event_id,'human_origin_event_id',x.human_origin_event_id,
  'origin_revision',COALESCE(s.revision,h.revision)::text,'origin_occurred_at',COALESCE(s.occurred_at,h.occurred_at),
  'code',x.code,'reason',x.reason,'next_action',x.next_action,'next_review_at',x.next_review_at,'recorded_at',x.recorded_at)
 FROM public.care_workflow_exceptions x
 LEFT JOIN public.care_step_events s ON s.id=x.origin_event_id AND s.work_item_id=x.work_item_id
 LEFT JOIN public.care_human_events h ON h.id=x.human_origin_event_id AND h.work_item_id=x.work_item_id
 WHERE x.id=p_exception AND x.work_item_id=p_work
$$;

CREATE FUNCTION public.care_human_requires_clinical(p_command text,p_payload jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT COALESCE(p_command='record_review' OR(p_command='resolve_exception' AND p_payload#>>'{details,disposition}'='clinical_non_delivery'),false)
$$;

CREATE FUNCTION public.validate_care_resolution_details(p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb:=p_payload->'details'; x jsonb; k text;
BEGIN
 IF d IS NULL OR jsonb_typeof(d)<>'object' OR NOT(d ?& ARRAY['exception','disposition','resolution_reason'])
  OR d-ARRAY['exception','disposition','resolution_reason']<>'{}'::jsonb
  OR jsonb_typeof(d->'disposition') IS DISTINCT FROM 'string' OR d->>'disposition' NOT IN('barrier_addressed','clinical_non_delivery')
  OR NOT public.care_step_text(d->'resolution_reason',1000) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid exception resolution details'; END IF;
 x:=d->'exception';
 IF x IS NULL OR jsonb_typeof(x)<>'object'
  OR NOT(x ?& ARRAY['exception_id','origin_event_id','human_origin_event_id','origin_revision','origin_occurred_at','code','reason','next_action','next_review_at','recorded_at'])
  OR x-ARRAY['exception_id','origin_event_id','human_origin_event_id','origin_revision','origin_occurred_at','code','reason','next_action','next_review_at','recorded_at']<>'{}'::jsonb
  OR jsonb_typeof(x->'exception_id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(x->'origin_revision') IS DISTINCT FROM 'string'
  OR x->>'origin_revision' !~ '^[1-9][0-9]{0,18}$'
  OR NOT public.care_step_text(x->'code',100) OR NOT public.care_step_text(x->'reason',1000)
  OR NOT public.care_step_text(x->'next_action',500) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid immutable exception snapshot'; END IF;
 IF (x->>'origin_revision')::numeric NOT BETWEEN 2 AND 9223372036854775807
  OR(x->'origin_event_id'='null'::jsonb)=(x->'human_origin_event_id'='null'::jsonb) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid exception origin revision'; END IF;
 FOREACH k IN ARRAY ARRAY['exception_id','origin_event_id','human_origin_event_id'] LOOP
  IF x->k<>'null'::jsonb AND(jsonb_typeof(x->k) IS DISTINCT FROM 'string'
   OR x->>k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid exception identity'; END IF;
 END LOOP;
 PERFORM public.care_step_instant(x->'recorded_at');
 PERFORM public.care_step_instant(x->'next_review_at');
 IF public.care_step_instant(p_payload->'occurred_at')<public.care_step_instant(x->'origin_occurred_at') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Resolution cannot precede the documented barrier'; END IF;
END $$;

CREATE FUNCTION public.verify_care_exception_resolution(p_work uuid,p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid:=(p_payload#>>'{details,exception,exception_id}')::uuid; expected jsonb;
BEGIN
 PERFORM id FROM public.care_workflow_exceptions WHERE id=target AND work_item_id=p_work FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exception not authorized for this work'; END IF;
 expected:=public.care_exception_snapshot(p_work,target);
 IF expected IS NULL OR expected IS DISTINCT FROM p_payload#>'{details,exception}' THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='The exception previously displayed does not match'; END IF;
 IF EXISTS(SELECT 1 FROM public.care_exception_resolutions WHERE exception_id=target) THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Exception already resolved by another request'; END IF;
END $$;

CREATE FUNCTION public.guard_care_resolution_origin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE payload jsonb;
BEGIN
 IF NOT public.care_workflow_write_authorized(NEW.work_item_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Resolution requires its typed write context'; END IF;
 SELECT r.payload INTO payload FROM public.care_human_events e JOIN public.care_human_requests r ON r.id=e.request_id
 WHERE e.id=NEW.human_event_id AND e.work_item_id=NEW.work_item_id AND r.work_item_id=NEW.work_item_id
  AND r.command='resolve_exception' AND e.from_stage=e.to_stage
  AND(r.payload#>>'{details,exception,exception_id}')::uuid=NEW.exception_id;
 IF payload IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Resolution does not match its human event'; END IF;
 PERFORM public.verify_care_exception_resolution(NEW.work_item_id,payload);
 RETURN NEW;
END $$;
CREATE TRIGGER guard_care_resolution_origin BEFORE INSERT ON public.care_exception_resolutions
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_resolution_origin();

CREATE FUNCTION public.care_followup_deadline(p_work uuid) RETURNS TABLE(deadline timestamptz,action text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.deadline,p.action FROM(
  SELECT f.next_review_at AS deadline,f.next_action AS action,1 AS tie,'' AS identity FROM public.care_workflows f WHERE f.work_item_id=p_work
  UNION ALL SELECT e.next_review_at,'Exception: '||e.code||' — '||e.next_action,0,e.id::text
   FROM public.care_workflow_exceptions e WHERE e.work_item_id=p_work
   AND NOT EXISTS(SELECT 1 FROM public.care_exception_resolutions r WHERE r.exception_id=e.id)
 ) p ORDER BY p.deadline,p.tie,p.identity LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.care_exception_snapshot(uuid,uuid),public.care_human_requires_clinical(text,jsonb),
 public.validate_care_resolution_details(jsonb),public.verify_care_exception_resolution(uuid,jsonb),
 public.guard_care_resolution_origin(),public.care_followup_deadline(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_care_human_context(p_work_item_id uuid,p_command text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE item public.work_items; flow public.care_workflows; basis jsonb; result jsonb;
BEGIN
 IF p_command IS NULL OR p_command NOT IN('record_review','record_contact','resolve_exception') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid human command'; END IF;
 item:=public.require_care_lab_read(p_work_item_id);
 PERFORM public.lock_care_human_work(p_work_item_id,false);
 item:=public.require_care_lab_read(p_work_item_id);
 SELECT * INTO STRICT flow FROM public.care_workflows WHERE work_item_id=item.id;
 basis:=public.care_human_basis(item.id);
 result:=jsonb_build_object('actor_id',(SELECT auth.uid()),'organization_id',item.organization_id,'patient_id',item.patient_id,
  'work_item_id',item.id,'workflow_revision',flow.revision::text,'ownership_revision',item.ownership_revision::text,'kind',flow.kind,
  'stage',flow.stage,'command',p_command,'basis',basis,'basis_signature',public.care_human_signature(basis),
  'latest_review',public.care_latest_human_review(item.id,basis));
 IF p_command='resolve_exception' THEN
  result:=result||jsonb_build_object('exceptions',COALESCE((SELECT jsonb_agg(public.care_exception_snapshot(item.id,e.id) ORDER BY e.next_review_at,e.id)
   FROM public.care_workflow_exceptions e WHERE e.work_item_id=item.id
    AND NOT EXISTS(SELECT 1 FROM public.care_exception_resolutions r WHERE r.exception_id=e.id)),'[]'::jsonb));
 END IF;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.validate_care_human_payload(p_command text,p_payload jsonb,p_fresh boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb; keys text[]; v_key text; occurred timestamptz; due timestamptz;
BEGIN
 IF p_command IS NULL OR p_command NOT IN('record_review','record_contact','resolve_exception') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR NOT(p_payload ?& ARRAY['occurred_at','evidence','next_action','next_review_at','details'])
  OR p_payload-ARRAY['occurred_at','evidence','next_action','next_review_at','details']<>'{}'::jsonb
  OR NOT public.care_step_text(p_payload->'evidence',1000) OR NOT public.care_step_text(p_payload->'next_action',500)
  OR jsonb_typeof(p_payload->'details') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid human evidence payload';
 END IF;
 occurred:=public.care_step_instant(p_payload->'occurred_at'); due:=public.care_step_instant(p_payload->'next_review_at');
 IF occurred>clock_timestamp() OR(p_fresh AND due<=clock_timestamp()) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Verify human occurrence and next review'; END IF;
 IF p_command='resolve_exception' THEN PERFORM public.validate_care_resolution_details(p_payload); RETURN; END IF;
 d:=p_payload->'details'; keys:=CASE WHEN p_command='record_review' THEN ARRAY['decision','limitations'] ELSE
  ARRAY['channel','recipient_type','recipient_reference','outcome','review_event_id','review_addressed','exception_id','reason'] END;
 IF NOT(d ?& keys) OR d-keys<>'{}'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid human evidence details'; END IF;
 IF p_command='record_review' THEN
  IF NOT public.care_step_text(d->'decision',1000) OR NOT public.care_step_text(d->'limitations',1000) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Review decision and limitations are required'; END IF;
 ELSE
  IF jsonb_typeof(d->'channel') IS DISTINCT FROM 'string' OR d->>'channel' NOT IN('phone','in_person','video','secure_message','mail','other')
   OR jsonb_typeof(d->'recipient_type') IS DISTINCT FROM 'string' OR d->>'recipient_type' NOT IN('patient','caregiver','receiving_professional','other')
   OR NOT public.care_step_text(d->'recipient_reference',500) OR jsonb_typeof(d->'outcome') IS DISTINCT FROM 'string'
   OR d->>'outcome' NOT IN('human_reached','no_answer','refused','unable_to_contact')
   OR jsonb_typeof(d->'review_addressed') IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid documented contact'; END IF;
  FOREACH v_key IN ARRAY ARRAY['review_event_id','exception_id'] LOOP
   IF d->v_key<>'null'::jsonb AND(jsonb_typeof(d->v_key)<>'string'
    OR d->>v_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid contact evidence identity'; END IF;
  END LOOP;
  IF (d->>'review_addressed')::boolean AND(d->>'outcome'<>'human_reached' OR d->'review_event_id'='null'::jsonb)
   OR(d->>'outcome'='human_reached' AND(d->'exception_id'<>'null'::jsonb OR d->'reason'<>'null'::jsonb))
   OR(d->>'outcome'<>'human_reached' AND(d->'exception_id'='null'::jsonb OR NOT public.care_step_text(d->'reason',1000))) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Contact outcome and evidence disagree'; END IF;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.verify_care_human_evidence(p_item public.work_items,p_flow public.care_workflows,p_command text,
 p_basis jsonb,p_signature text,p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_basis jsonb; review jsonb;
BEGIN
 PERFORM public.validate_care_human_payload(p_command,p_payload,true);
 current_basis:=public.care_human_basis(p_item.id);
 IF p_basis IS NULL OR p_basis IS DISTINCT FROM current_basis OR p_signature IS DISTINCT FROM public.care_human_signature(current_basis) THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='The evidence previously displayed has changed'; END IF;
 IF p_command='resolve_exception' THEN
  PERFORM public.require_care_workflow_scope(p_item.organization_id,p_item.patient_id,public.care_human_requires_clinical(p_command,p_payload));
  PERFORM public.verify_care_exception_resolution(p_item.id,p_payload); RETURN;
 END IF;
 IF p_command='record_review' THEN
  PERFORM public.require_care_workflow_scope(p_item.organization_id,p_item.patient_id,true);
  IF NOT((p_flow.kind='laboratory_order' AND p_flow.stage='result_received' AND p_basis->'composition_event_id'<>'null'::jsonb)
   OR(p_flow.kind='referral' AND p_flow.stage='report_received' AND p_basis->'operational_event'<>'null'::jsonb)
   OR(p_flow.kind='medication_access' AND p_flow.stage='obtained' AND p_basis->'operational_event'<>'null'::jsonb)) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Documented evidence is required before human review'; END IF;
 ELSE
  IF p_payload#>>'{details,review_event_id}' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.care_human_events e
   JOIN public.care_human_requests r ON r.id=e.request_id WHERE e.id=(p_payload#>>'{details,review_event_id}')::uuid
    AND e.work_item_id=p_item.id AND r.command='record_review') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Referenced review is not authorized for this work'; END IF;
  IF (p_payload#>>'{details,review_addressed}')::boolean THEN
   review:=public.care_latest_human_review(p_item.id,current_basis);
   IF review IS NULL OR(review->>'event_id')::uuid IS DISTINCT FROM(p_payload#>>'{details,review_event_id}')::uuid
    OR NOT(review->>'is_current')::boolean OR public.care_step_instant(p_payload->'occurred_at')<(review->>'occurred_at')::timestamptz THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Contact does not address the current reviewed evidence'; END IF;
  END IF;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.prepare_care_human_request(p_request_id uuid,p_work_item_id uuid,p_organization_id uuid,p_patient_id uuid,
 p_expected_revision bigint,p_expected_ownership_revision bigint,p_command text,p_basis jsonb,p_basis_signature text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_human_requests; item public.work_items; flow public.care_workflows; result jsonb;
BEGIN
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
 SELECT * INTO saved FROM public.care_human_requests WHERE id=p_request_id;
 IF saved.id IS NOT NULL THEN
  IF saved.actor_id IS DISTINCT FROM(SELECT auth.uid()) OR saved.work_item_id IS DISTINCT FROM p_work_item_id
   OR saved.organization_id IS DISTINCT FROM p_organization_id OR saved.patient_id IS DISTINCT FROM p_patient_id
   OR ROW(saved.expected_revision,saved.expected_ownership_revision,saved.command,saved.basis,saved.basis_signature,saved.payload)
    IS DISTINCT FROM ROW(p_expected_revision,p_expected_ownership_revision,p_command,p_basis,p_basis_signature,p_payload) THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Human request identity conflict'; END IF;
  RETURN public.get_care_human_request(saved.id);
 END IF;
 IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 1 AND 9223372036854775806
  OR p_expected_ownership_revision IS NULL OR p_expected_ownership_revision<0 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid human request identity'; END IF;
 PERFORM public.validate_care_human_payload(p_command,p_payload,true);
 SELECT * INTO item FROM public.work_items WHERE id=p_work_item_id AND source_type='care_workflow'
  AND organization_id=p_organization_id AND patient_id=p_patient_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow not authorized'; END IF;
 PERFORM public.lock_care_human_work(item.id,public.care_human_requires_clinical(p_command,p_payload));
 SELECT * INTO item FROM public.work_items WHERE id=p_work_item_id;
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=item.id;
 SELECT * INTO saved FROM public.care_human_requests WHERE id=p_request_id;
 IF saved.id IS NOT NULL THEN
  IF saved.actor_id IS DISTINCT FROM(SELECT auth.uid()) OR saved.work_item_id IS DISTINCT FROM p_work_item_id
   OR saved.organization_id IS DISTINCT FROM p_organization_id OR saved.patient_id IS DISTINCT FROM p_patient_id
   OR ROW(saved.expected_revision,saved.expected_ownership_revision,saved.command,saved.basis,saved.basis_signature,saved.payload)
    IS DISTINCT FROM ROW(p_expected_revision,p_expected_ownership_revision,p_command,p_basis,p_basis_signature,p_payload) THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Human request identity conflict'; END IF;
 ELSE
  PERFORM public.require_care_step_owner(item,flow,p_expected_revision,p_expected_ownership_revision);
  PERFORM public.verify_care_human_evidence(item,flow,p_command,p_basis,p_basis_signature,p_payload);
  INSERT INTO public.care_human_requests(id,work_item_id,actor_id,organization_id,patient_id,expected_revision,expected_ownership_revision,command,basis,basis_signature,payload)
  VALUES(p_request_id,item.id,(SELECT auth.uid()),item.organization_id,item.patient_id,p_expected_revision,p_expected_ownership_revision,p_command,p_basis,p_basis_signature,p_payload);
 END IF;
 result:=public.care_human_request_state(p_request_id);
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,public.care_human_requires_clinical(p_command,p_payload)); RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.apply_care_human_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE saved public.care_human_requests; item public.work_items; flow public.care_workflows;
 v_event uuid; v_recorded timestamptz; v_exception uuid; due timestamptz; action text; v_receipt jsonb; result jsonb;
BEGIN
 SELECT * INTO saved FROM public.care_human_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Human request not authorized'; END IF;
 IF saved.state='applied' THEN RETURN public.get_care_human_request(saved.id); END IF;
 IF saved.state='cancelled' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Human request was cancelled'; END IF;
 PERFORM public.lock_care_human_work(saved.work_item_id,public.care_human_requires_clinical(saved.command,saved.payload));
 SELECT * INTO item FROM public.work_items WHERE id=saved.work_item_id;
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=item.id;
 SELECT * INTO saved FROM public.care_human_requests WHERE id=p_request_id FOR UPDATE;
 IF saved.state='applied' THEN
  result:=public.care_human_request_state(saved.id);
  PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
 END IF;
 IF saved.state='cancelled' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Human request was cancelled'; END IF;
 PERFORM public.require_care_step_owner(item,flow,saved.expected_revision,saved.expected_ownership_revision);
 PERFORM public.verify_care_human_evidence(item,flow,saved.command,saved.basis,saved.basis_signature,saved.payload);
 INSERT INTO public.care_workflow_write_context(work_item_id,xact_id) VALUES(item.id,pg_catalog.pg_current_xact_id());
 INSERT INTO public.care_human_events(request_id,work_item_id,actor_id,revision,ownership_revision,from_stage,to_stage,occurred_at)
 VALUES(saved.id,item.id,(SELECT auth.uid()),flow.revision+1,item.ownership_revision,flow.stage,flow.stage,
  public.care_step_instant(saved.payload->'occurred_at')) RETURNING id,recorded_at INTO v_event,v_recorded;
 IF saved.command='record_contact' AND saved.payload#>>'{details,outcome}'<>'human_reached' THEN
  v_exception:=(saved.payload#>>'{details,exception_id}')::uuid;
  INSERT INTO public.care_workflow_exceptions(id,work_item_id,human_origin_event_id,code,reason,next_action,next_review_at)
  VALUES(v_exception,item.id,v_event,saved.payload#>>'{details,outcome}',saved.payload#>>'{details,reason}',
   saved.payload->>'next_action',public.care_step_instant(saved.payload->'next_review_at'));
 END IF;
 IF saved.command='resolve_exception' THEN
  INSERT INTO public.care_exception_resolutions(exception_id,human_event_id,work_item_id)
  VALUES((saved.payload#>>'{details,exception,exception_id}')::uuid,v_event,item.id);
 END IF;
 UPDATE public.care_workflows SET revision=flow.revision+1,next_action=saved.payload->>'next_action',
  next_review_at=public.care_step_instant(saved.payload->'next_review_at') WHERE work_item_id=item.id;
 SELECT p.deadline,p.action INTO due,action FROM public.care_followup_deadline(item.id) p;
 UPDATE public.work_items SET status=CASE WHEN due<=clock_timestamp() THEN 'due' ELSE 'awaiting' END,due_at=due,
  snooze_reason=CASE WHEN char_length(action)>500 THEN left(action,497)||'...' ELSE action END WHERE id=item.id;
 v_receipt:=jsonb_build_object('request_id',saved.id,'work_item_id',item.id,'event_id',v_event,'command',saved.command,
  'workflow_revision',(flow.revision+1)::text,'ownership_revision',item.ownership_revision::text,'stage',flow.stage,'recorded_at',v_recorded,
  'basis',saved.basis,'basis_signature',saved.basis_signature,'exception_id',v_exception,'due_at',due,
  'clinical_review_recorded',saved.command='record_review','addresses_current_review',
  saved.command='record_contact' AND COALESCE((saved.payload#>>'{details,review_addressed}')::boolean,false),
  'communication_confirmed',false,'care_completed',false);
 IF saved.command='resolve_exception' THEN
  v_receipt:=v_receipt||jsonb_build_object('resolved_exception_id',saved.payload#>>'{details,exception,exception_id}','resolution_event_id',v_event);
 END IF;
 UPDATE public.care_human_requests SET state='applied',applied_at=clock_timestamp(),receipt=v_receipt WHERE id=saved.id;
 DELETE FROM public.care_workflow_write_context WHERE work_item_id=item.id;
 PERFORM public.validate_care_human_payload(saved.command,saved.payload,true);
 result:=public.care_human_request_state(saved.id);
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,public.care_human_requires_clinical(saved.command,saved.payload)); RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.apply_care_step(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_step_requests%ROWTYPE; item public.work_items%ROWTYPE; flow public.care_workflows%ROWTYPE;
 target_stage text; event_id uuid; exception_id uuid; v_receipt jsonb; due timestamptz; next_action text;
BEGIN
 SELECT * INTO saved FROM public.care_step_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care step not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 SELECT * INTO item FROM public.work_items WHERE id=saved.work_item_id FOR UPDATE;
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=item.id FOR UPDATE;
 SELECT * INTO saved FROM public.care_step_requests WHERE id=p_request_id FOR UPDATE;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false);
 IF saved.state='applied' THEN RETURN public.care_step_request_state(saved.id); END IF;
 IF saved.state='cancelled' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Care step was cancelled'; END IF;
 PERFORM public.require_care_step_owner(item,flow,saved.expected_revision,saved.expected_ownership_revision);
 PERFORM public.validate_care_step_payload(saved.command,saved.payload,true);
 target_stage:=public.care_step_target_stage(flow.kind,flow.stage,saved.command);
 INSERT INTO public.care_workflow_write_context(work_item_id,xact_id) VALUES(item.id,pg_catalog.pg_current_xact_id());
 INSERT INTO public.care_step_events(work_item_id,request_id,actor_id,revision,ownership_revision,from_stage,to_stage,occurred_at)
 VALUES(item.id,saved.id,(SELECT auth.uid()),flow.revision+1,item.ownership_revision,flow.stage,target_stage,
  public.care_step_instant(saved.payload->'occurred_at')) RETURNING id INTO event_id;
 IF saved.command='record_exception' OR (saved.command='record_assistance_response' AND saved.payload#>>'{details,outcome}'='denied') THEN
  exception_id:=CASE WHEN saved.command='record_exception' THEN (saved.payload#>>'{details,exception_id}')::uuid ELSE gen_random_uuid() END;
  INSERT INTO public.care_workflow_exceptions(id,work_item_id,origin_event_id,code,reason,next_action,next_review_at)
  VALUES(exception_id,item.id,event_id,CASE WHEN saved.command='record_exception' THEN saved.payload#>>'{details,code}' ELSE 'assistance_denied' END,
   CASE WHEN saved.command='record_exception' THEN saved.payload#>>'{details,reason}' ELSE saved.payload->>'evidence' END,
   saved.payload->>'next_action',public.care_step_instant(saved.payload->'next_review_at'));
 END IF;
 UPDATE public.care_workflows SET stage=target_stage,revision=flow.revision+1,next_action=saved.payload->>'next_action',
  next_review_at=public.care_step_instant(saved.payload->'next_review_at') WHERE work_item_id=item.id;
 SELECT p.deadline,p.action INTO due,next_action FROM public.care_followup_deadline(item.id) p;
 UPDATE public.work_items SET status=CASE WHEN due<=clock_timestamp() THEN 'due' ELSE 'awaiting' END,
  due_at=due,snooze_reason=CASE WHEN char_length(next_action)>500 THEN left(next_action,497)||'...' ELSE next_action END WHERE id=item.id;
 v_receipt:=jsonb_build_object('request_id',saved.id,'work_item_id',item.id,'event_id',event_id,
  'workflow_revision',(flow.revision+1)::text,'ownership_revision',item.ownership_revision::text,
  'stage',target_stage,'exception_id',exception_id,'due_at',due,'recorded_at',clock_timestamp(),
  'clinical_review_recorded',false,'communication_confirmed',false,'care_completed',false);
 UPDATE public.care_step_requests SET state='applied',applied_at=clock_timestamp(),receipt=v_receipt WHERE id=saved.id;
 DELETE FROM public.care_workflow_write_context WHERE work_item_id=item.id;
 PERFORM public.validate_care_step_payload(saved.command,saved.payload,true);
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false);
 RETURN public.care_step_request_state(saved.id);
END $$;

CREATE OR REPLACE FUNCTION public.apply_care_lab_composition(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE saved public.care_lab_composition_requests; item public.work_items; flow public.care_workflows;
 fence jsonb; resolutions jsonb; row jsonb; head jsonb; v_event uuid; v_receipt jsonb; entries jsonb:='[]';
 target text; due timestamptz; action text; result jsonb; v_recorded timestamptz;
BEGIN
 SELECT * INTO saved FROM public.care_lab_composition_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Composition request not authorized'; END IF;
 IF saved.state='applied' THEN RETURN public.get_care_lab_composition_request(saved.id); END IF;
 IF saved.state='cancelled' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Composition request was cancelled'; END IF;
 fence:=public.lock_care_lab_composition(saved.work_item_id,saved.payload->'sources',saved.payload->'intent_resolutions');
 SELECT * INTO item FROM public.work_items WHERE id=saved.work_item_id;
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=item.id;
 SELECT * INTO saved FROM public.care_lab_composition_requests WHERE id=p_request_id FOR UPDATE;
 IF saved.state='applied' THEN
  result:=public.care_lab_composition_request_state(saved.id);
  PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
 END IF;
 IF saved.state='cancelled' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Composition request was cancelled'; END IF;
 PERFORM public.require_care_step_owner(item,flow,saved.expected_revision,saved.expected_ownership_revision);
 PERFORM public.validate_care_lab_payload(saved.payload,true);
 resolutions:=public.verify_care_lab_composition(item,flow,saved.payload,fence);
 target:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(saved.payload->'sources') s WHERE s->>'root_id' IS NOT NULL)
  THEN 'result_received' ELSE flow.stage END;
 INSERT INTO public.care_workflow_write_context(work_item_id,xact_id) VALUES(item.id,pg_catalog.pg_current_xact_id());
 INSERT INTO public.care_lab_composition_events(request_id,work_item_id,previous_event_id,revision,ownership_revision,from_stage,to_stage,occurred_at)
 VALUES(saved.id,item.id,(fence->>'event_id')::uuid,flow.revision+1,item.ownership_revision,flow.stage,target,
  public.care_step_instant(saved.payload->'occurred_at')) RETURNING id,recorded_at INTO v_event,v_recorded;
 FOR row IN SELECT * FROM jsonb_array_elements(saved.payload->'sources') LOOP
  head:=CASE WHEN row->>'root_id' IS NULL THEN NULL ELSE public.lab_observation_head_snapshot((row->>'root_id')::uuid) END;
  INSERT INTO public.care_lab_composition_entries(event_id,analyte,root_id,observed_version_id)
  VALUES(v_event,row->>'analyte',(row->>'root_id')::uuid,(head->>'version_id')::uuid);
  entries:=entries||jsonb_build_object('analyte',row->>'analyte','root_id',row->'root_id','observed_head',head);
 END LOOP;
 FOR row IN SELECT * FROM jsonb_array_elements(resolutions) LOOP
  INSERT INTO public.lab_followup_intent_resolutions(intent_id,event_id,lab_result_id,disposition,reason,matched_analytes,missing_analytes)
  VALUES((row->>'intent_id')::uuid,v_event,(row->>'lab_result_id')::uuid,row->>'disposition',row->>'reason',row->'matched_analytes',row->'missing_analytes');
  UPDATE public.lab_followup_submission_intents SET state='reconciled',reconciled_at=clock_timestamp() WHERE id=(row->>'intent_id')::uuid;
 END LOOP;
 UPDATE public.care_workflows SET stage=target,revision=flow.revision+1,next_action=saved.payload->>'next_action',
  next_review_at=public.care_step_instant(saved.payload->'next_review_at') WHERE work_item_id=item.id;
 SELECT p.deadline,p.action INTO due,action FROM public.care_followup_deadline(item.id) p;
 UPDATE public.work_items SET status=CASE WHEN due<=clock_timestamp() THEN 'due' ELSE 'awaiting' END,due_at=due,
  snooze_reason=CASE WHEN char_length(action)>500 THEN left(action,497)||'...' ELSE action END WHERE id=item.id;
 v_receipt:=jsonb_build_object('request_id',saved.id,'work_item_id',item.id,'event_id',v_event,'previous_event_id',fence->'event_id',
  'workflow_revision',(flow.revision+1)::text,'ownership_revision',item.ownership_revision::text,'stage',target,'recorded_at',v_recorded,
  'sources',entries,'intent_resolutions',resolutions,'due_at',due,'clinical_review_recorded',false,'communication_confirmed',false,'care_completed',false);
 UPDATE public.care_lab_composition_requests SET state='applied',applied_at=clock_timestamp(),receipt=v_receipt WHERE id=saved.id;
 DELETE FROM public.care_workflow_write_context WHERE work_item_id=item.id;
 PERFORM public.validate_care_lab_payload(saved.payload,true);
 result:=public.care_lab_composition_request_state(saved.id);
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
END $$;
