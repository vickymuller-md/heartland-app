-- Local backend only. Mixed-history/exception readers and human UI must ship before activation.
-- Records human attestations; no transmission, prescribing, success closure or credential claim.
CREATE TABLE public.care_human_requests (
 id uuid PRIMARY KEY,
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 expected_revision bigint NOT NULL CHECK(expected_revision BETWEEN 1 AND 9223372036854775806),
 expected_ownership_revision bigint NOT NULL CHECK(expected_ownership_revision>=0),
 command text NOT NULL CHECK(command IN('record_review','record_contact')),
 basis jsonb NOT NULL CHECK(jsonb_typeof(basis)='object'),
 basis_signature text NOT NULL CHECK(basis_signature ~ '^[0-9a-f]{64}$'),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','applied','cancelled')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 applied_at timestamptz,cancelled_at timestamptz,acknowledged_at timestamptz,receipt jsonb,
 CHECK((state='prepared' AND num_nonnulls(applied_at,cancelled_at,acknowledged_at,receipt)=0)
  OR(state='applied' AND applied_at IS NOT NULL AND cancelled_at IS NULL AND receipt IS NOT NULL)
  OR(state='cancelled' AND cancelled_at IS NOT NULL AND num_nonnulls(applied_at,acknowledged_at,receipt)=0))
);
CREATE UNIQUE INDEX care_human_prepared ON public.care_human_requests(actor_id,work_item_id) WHERE state='prepared';
CREATE INDEX care_human_pending ON public.care_human_requests(actor_id,organization_id,patient_id,id);
CREATE TABLE public.care_human_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES public.care_human_requests(id) ON DELETE RESTRICT,
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 revision bigint NOT NULL CHECK(revision>=2),ownership_revision bigint NOT NULL CHECK(ownership_revision>=0),
 from_stage text NOT NULL,to_stage text NOT NULL,
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(work_item_id,revision)
);
ALTER TABLE public.care_workflow_exceptions ALTER COLUMN origin_event_id DROP NOT NULL;
ALTER TABLE public.care_workflow_exceptions ADD COLUMN human_origin_event_id uuid REFERENCES public.care_human_events(id) ON DELETE RESTRICT;
ALTER TABLE public.care_workflow_exceptions ADD CONSTRAINT care_exception_one_origin
 CHECK(num_nonnulls(origin_event_id,human_origin_event_id)=1);

CREATE FUNCTION public.guard_care_human_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='care_human_requests'
  AND(to_jsonb(NEW)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt'])
   IS NOT DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt']) THEN
  IF OLD.state='prepared' AND NEW.state IN('applied','cancelled') THEN RETURN NEW; END IF;
  IF OLD.state='applied' AND NEW.state='applied' AND OLD.acknowledged_at IS NULL AND NEW.acknowledged_at IS NOT NULL
   AND ROW(OLD.applied_at,OLD.cancelled_at,OLD.receipt) IS NOT DISTINCT FROM ROW(NEW.applied_at,NEW.cancelled_at,NEW.receipt) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Human evidence history is immutable';
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['care_human_requests','care_human_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER guard_human_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_care_human_history()',t);
 END LOOP;
END $$;
CREATE FUNCTION public.guard_care_exception_origin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.care_workflow_write_authorized(NEW.work_item_id)
  OR(NEW.origin_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.care_step_events WHERE id=NEW.origin_event_id AND work_item_id=NEW.work_item_id))
  OR(NEW.human_origin_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.care_human_events e
   JOIN public.care_human_requests r ON r.id=e.request_id WHERE e.id=NEW.human_origin_event_id AND e.work_item_id=NEW.work_item_id
    AND r.command='record_contact' AND r.payload#>>'{details,outcome}'=NEW.code
    AND(r.payload#>>'{details,exception_id}')::uuid=NEW.id)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exception origin does not match the authorized event';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_care_exception_origin BEFORE INSERT ON public.care_workflow_exceptions
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_exception_origin();
CREATE FUNCTION public.guard_care_human_pending() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.care_human_requests WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared')
  OR(TG_TABLE_NAME='care_human_requests' AND(
   EXISTS(SELECT 1 FROM public.care_step_requests WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared')
   OR EXISTS(SELECT 1 FROM public.lab_followup_submission_intents WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared')
   OR EXISTS(SELECT 1 FROM public.care_lab_composition_requests WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared'))) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover or cancel the pending care operation first';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['care_human_requests','care_step_requests','lab_followup_submission_intents','care_lab_composition_requests'] LOOP
  EXECUTE format('CREATE TRIGGER guard_against_human_pending BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_care_human_pending()',t);
 END LOOP;
END $$;

CREATE FUNCTION public.care_human_signature(p_basis jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(p_basis::text,'UTF8')),'hex')
$$;
CREATE FUNCTION public.lock_care_human_work(p_work uuid,p_clinical boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE item public.work_items; flow public.care_workflows;
BEGIN
 SELECT * INTO item FROM public.work_items WHERE id=p_work AND source_type='care_workflow';
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=p_work;
 IF item.id IS NULL OR flow.work_item_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(item.organization_id,item.patient_id,p_clinical);
 IF flow.kind='laboratory_order' THEN PERFORM public.lock_care_lab_composition(p_work,'[]','[]');
 ELSE
  PERFORM id FROM public.work_items WHERE id=p_work FOR UPDATE;
  PERFORM work_item_id FROM public.care_workflows WHERE work_item_id=p_work FOR UPDATE;
 END IF;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,p_clinical);
END $$;
CREATE FUNCTION public.care_human_basis(p_work uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE flow public.care_workflows; sources jsonb:='[]'; processing jsonb:='[]'; fact jsonb; v_event uuid;
BEGIN
 SELECT * INTO STRICT flow FROM public.care_workflows WHERE work_item_id=p_work;
 IF flow.kind='laboratory_order' THEN
  v_event:=public.care_lab_current_event(p_work); sources:=public.care_lab_current_snapshot(p_work);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('lab_result_id',s.id,'evaluation',CASE WHEN ev.id IS NULL THEN NULL
   ELSE jsonb_build_object('event_id',ev.id,'status',ev.status,'completed_at',ev.completed_at,'source_assessment',ev.source_assessment) END)
   ORDER BY s.id),'[]') INTO processing FROM(
    SELECT DISTINCT (j#>>'{head,effective_lab_result_id}')::uuid AS id FROM jsonb_array_elements(sources) j
    WHERE j#>>'{head,effective_lab_result_id}' IS NOT NULL
   ) s LEFT JOIN public.lab_alert_evaluations ev ON ev.lab_result_id=s.id;
 ELSE
  SELECT jsonb_build_object('event_id',e.id,'revision',e.revision::text,'occurred_at',e.occurred_at,'recorded_at',e.recorded_at,
   'command',r.command,'payload',r.payload) INTO fact FROM public.care_step_events e
   JOIN public.care_step_requests r ON r.id=e.request_id WHERE e.work_item_id=p_work
   AND r.command=CASE WHEN flow.kind='referral' THEN 'record_report' ELSE 'record_obtained' END ORDER BY e.revision DESC LIMIT 1;
 END IF;
 RETURN jsonb_build_object('kind',flow.kind,'composition_event_id',v_event,'sources',sources,'processing',processing,'operational_event',fact);
END $$;
CREATE FUNCTION public.care_latest_human_review(p_work uuid,p_basis jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
 SELECT jsonb_build_object('event_id',e.id,'revision',e.revision::text,'actor_id',e.actor_id,
  'occurred_at',e.occurred_at,'recorded_at',e.recorded_at,'basis_signature',r.basis_signature,
  'is_current',r.basis=p_basis,'decision',r.payload#>'{details,decision}')
 FROM public.care_human_events e JOIN public.care_human_requests r ON r.id=e.request_id
 WHERE e.work_item_id=p_work AND r.command='record_review' ORDER BY e.revision DESC LIMIT 1
$$;
CREATE FUNCTION public.get_care_human_context(p_work_item_id uuid,p_command text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE item public.work_items; flow public.care_workflows; basis jsonb; result jsonb;
BEGIN
 IF p_command IS NULL OR p_command NOT IN('record_review','record_contact') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid human command'; END IF;
 item:=public.require_care_lab_read(p_work_item_id);
 PERFORM public.lock_care_human_work(p_work_item_id,false);
 item:=public.require_care_lab_read(p_work_item_id);
 SELECT * INTO STRICT flow FROM public.care_workflows WHERE work_item_id=item.id;
 basis:=public.care_human_basis(item.id);
 result:=jsonb_build_object('actor_id',(SELECT auth.uid()),'organization_id',item.organization_id,'patient_id',item.patient_id,
  'work_item_id',item.id,'workflow_revision',flow.revision::text,'ownership_revision',item.ownership_revision::text,'kind',flow.kind,
  'stage',flow.stage,'command',p_command,'basis',basis,'basis_signature',public.care_human_signature(basis),
  'latest_review',public.care_latest_human_review(item.id,basis));
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
END $$;

CREATE FUNCTION public.validate_care_human_payload(p_command text,p_payload jsonb,p_fresh boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb; keys text[]; v_key text; occurred timestamptz; due timestamptz;
BEGIN
 IF p_command IS NULL OR p_command NOT IN('record_review','record_contact') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR NOT(p_payload ?& ARRAY['occurred_at','evidence','next_action','next_review_at','details'])
  OR p_payload-ARRAY['occurred_at','evidence','next_action','next_review_at','details']<>'{}'::jsonb
  OR NOT public.care_step_text(p_payload->'evidence',1000) OR NOT public.care_step_text(p_payload->'next_action',500)
  OR jsonb_typeof(p_payload->'details') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid human evidence payload';
 END IF;
 occurred:=public.care_step_instant(p_payload->'occurred_at'); due:=public.care_step_instant(p_payload->'next_review_at');
 IF occurred>clock_timestamp() OR(p_fresh AND due<=clock_timestamp()) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Verify human occurrence and next review'; END IF;
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
CREATE FUNCTION public.verify_care_human_evidence(p_item public.work_items,p_flow public.care_workflows,p_command text,
 p_basis jsonb,p_signature text,p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_basis jsonb; review jsonb;
BEGIN
 PERFORM public.validate_care_human_payload(p_command,p_payload,true);
 current_basis:=public.care_human_basis(p_item.id);
 IF p_basis IS NULL OR p_basis IS DISTINCT FROM current_basis OR p_signature IS DISTINCT FROM public.care_human_signature(current_basis) THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='The evidence previously displayed has changed'; END IF;
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

CREATE FUNCTION public.care_human_request_state(p_request uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
 SELECT jsonb_build_object('request_id',id,'actor_id',actor_id,'organization_id',organization_id,'patient_id',patient_id,
  'work_item_id',work_item_id,'expected_revision',expected_revision::text,'expected_ownership_revision',expected_ownership_revision::text,
  'command',command,'basis',basis,'basis_signature',basis_signature,'payload',payload,'state',state,
  'recorded_at',recorded_at,'acknowledged_at',acknowledged_at,'receipt',receipt) FROM public.care_human_requests WHERE id=p_request
$$;
CREATE FUNCTION public.get_care_human_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_human_requests; result jsonb;
BEGIN
 SELECT * INTO saved FROM public.care_human_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Human request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 PERFORM id FROM public.care_human_requests WHERE id=p_request_id FOR UPDATE;
 result:=public.care_human_request_state(saved.id);
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false); RETURN result;
END $$;
CREATE FUNCTION public.prepare_care_human_request(p_request_id uuid,p_work_item_id uuid,p_organization_id uuid,p_patient_id uuid,
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
 PERFORM public.lock_care_human_work(item.id,p_command='record_review');
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
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,p_command='record_review'); RETURN result;
END $$;

CREATE FUNCTION public.apply_care_human_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE saved public.care_human_requests; item public.work_items; flow public.care_workflows;
 v_event uuid; v_recorded timestamptz; v_exception uuid; due timestamptz; action text; v_receipt jsonb; result jsonb;
BEGIN
 SELECT * INTO saved FROM public.care_human_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Human request not authorized'; END IF;
 IF saved.state='applied' THEN RETURN public.get_care_human_request(saved.id); END IF;
 IF saved.state='cancelled' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Human request was cancelled'; END IF;
 PERFORM public.lock_care_human_work(saved.work_item_id,saved.command='record_review');
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
 UPDATE public.care_workflows SET revision=flow.revision+1,next_action=saved.payload->>'next_action',
  next_review_at=public.care_step_instant(saved.payload->'next_review_at') WHERE work_item_id=item.id;
 SELECT p.deadline,p.action INTO due,action FROM(
  SELECT public.care_step_instant(saved.payload->'next_review_at') AS deadline,saved.payload->>'next_action' AS action,1 AS tie,'' AS identity
  UNION ALL SELECT e.next_review_at,'Exception: '||e.code||' — '||e.next_action,0,e.id::text FROM public.care_workflow_exceptions e WHERE e.work_item_id=item.id
 ) p ORDER BY p.deadline,p.tie,p.identity LIMIT 1;
 UPDATE public.work_items SET status=CASE WHEN due<=clock_timestamp() THEN 'due' ELSE 'awaiting' END,due_at=due,
  snooze_reason=CASE WHEN char_length(action)>500 THEN left(action,497)||'...' ELSE action END WHERE id=item.id;
 v_receipt:=jsonb_build_object('request_id',saved.id,'work_item_id',item.id,'event_id',v_event,'command',saved.command,
  'workflow_revision',(flow.revision+1)::text,'ownership_revision',item.ownership_revision::text,'stage',flow.stage,'recorded_at',v_recorded,
  'basis',saved.basis,'basis_signature',saved.basis_signature,'exception_id',v_exception,'due_at',due,
  'clinical_review_recorded',saved.command='record_review','addresses_current_review',
  saved.command='record_contact' AND COALESCE((saved.payload#>>'{details,review_addressed}')::boolean,false),
  'communication_confirmed',false,'care_completed',false);
 UPDATE public.care_human_requests SET state='applied',applied_at=clock_timestamp(),receipt=v_receipt WHERE id=saved.id;
 DELETE FROM public.care_workflow_write_context WHERE work_item_id=item.id;
 PERFORM public.validate_care_human_payload(saved.command,saved.payload,true);
 result:=public.care_human_request_state(saved.id);
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,saved.command='record_review'); RETURN result;
END $$;
CREATE FUNCTION public.cancel_care_human_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_human_requests; result jsonb;
BEGIN
 PERFORM public.get_care_human_request(p_request_id);
 SELECT * INTO saved FROM public.care_human_requests WHERE id=p_request_id;
 IF saved.state='prepared' THEN UPDATE public.care_human_requests SET state='cancelled',cancelled_at=clock_timestamp() WHERE id=saved.id; END IF;
 result:=public.care_human_request_state(saved.id);
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false); RETURN result;
END $$;
CREATE FUNCTION public.acknowledge_care_human_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_human_requests; result jsonb;
BEGIN
 PERFORM public.get_care_human_request(p_request_id);
 SELECT * INTO saved FROM public.care_human_requests WHERE id=p_request_id;
 IF saved.state<>'applied' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='No applied human evidence receipt'; END IF;
 IF saved.acknowledged_at IS NULL THEN UPDATE public.care_human_requests SET acknowledged_at=clock_timestamp() WHERE id=saved.id; END IF;
 result:=public.care_human_request_state(saved.id);
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false); RETURN result;
END $$;
CREATE FUNCTION public.list_pending_care_human_requests(p_organization_id uuid,p_patient_id uuid,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE items jsonb; cursor uuid; result jsonb;
BEGIN
 PERFORM public.lock_care_workflow_scope(p_organization_id,p_patient_id,false);
 SELECT COALESCE(jsonb_agg(public.care_human_request_state(id) ORDER BY id),'[]') INTO items FROM(
  SELECT id FROM public.care_human_requests WHERE actor_id=(SELECT auth.uid()) AND organization_id=p_organization_id AND patient_id=p_patient_id
   AND(state='prepared' OR(state='applied' AND acknowledged_at IS NULL)) AND(p_after IS NULL OR id>p_after) ORDER BY id LIMIT 25
 ) q;
 IF jsonb_array_length(items)=25 THEN cursor:=(items->24->>'request_id')::uuid; END IF;
 result:=jsonb_build_object('items',items,'next_cursor',cursor);
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false); RETURN result;
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'guard_care_human_history','guard_care_exception_origin','guard_care_human_pending','care_human_signature','lock_care_human_work',
  'care_human_basis','care_latest_human_review','get_care_human_context','validate_care_human_payload','verify_care_human_evidence',
  'care_human_request_state','get_care_human_request','prepare_care_human_request','apply_care_human_request',
  'cancel_care_human_request','acknowledge_care_human_request','list_pending_care_human_requests') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.get_care_human_context(uuid,text),public.get_care_human_request(uuid),
 public.prepare_care_human_request(uuid,uuid,uuid,uuid,bigint,bigint,text,jsonb,text,jsonb),public.apply_care_human_request(uuid),
 public.cancel_care_human_request(uuid),public.acknowledge_care_human_request(uuid),public.list_pending_care_human_requests(uuid,uuid,uuid) TO authenticated;
