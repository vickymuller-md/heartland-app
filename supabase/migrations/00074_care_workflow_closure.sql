-- Local backend only. Ship with closure forms/history/reporting and post-closure routing.
-- A documented workflow outcome is not treatment efficacy or confirmed transmission.
ALTER TABLE public.care_human_requests DROP CONSTRAINT care_human_requests_command_check;
ALTER TABLE public.care_human_requests ADD CONSTRAINT care_human_requests_command_check CHECK(command IN(
 'record_review','record_contact','resolve_exception','resolve_source_invalidation','close_success','close_without_completion'));
CREATE TABLE public.care_workflow_closures (
 work_item_id uuid PRIMARY KEY REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 human_event_id uuid NOT NULL UNIQUE REFERENCES public.care_human_events(id) ON DELETE RESTRICT
);
ALTER TABLE public.care_workflow_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.care_workflow_closures FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_care_closure_history BEFORE UPDATE OR DELETE ON public.care_workflow_closures
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_human_history();

CREATE FUNCTION public.care_closure_targets(p_work uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('invalidation_id',i.id,'root_id',e.root_id) ORDER BY i.id),'[]')
 FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries e ON e.id=i.entry_id
 JOIN public.care_lab_composition_events c ON c.id=e.event_id WHERE c.work_item_id=p_work
 AND NOT EXISTS(SELECT 1 FROM public.care_source_invalidation_resolutions r WHERE r.invalidation_id=i.id)
$$;
CREATE FUNCTION public.lock_care_closure(p_work uuid,p_clinical boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE item public.work_items; flow public.care_workflows; targets jsonb;
BEGIN
 item:=public.require_care_lab_read(p_work);
 PERFORM public.lock_care_workflow_scope(item.organization_id,item.patient_id,p_clinical);
 SELECT * INTO STRICT flow FROM public.care_workflows WHERE work_item_id=p_work;
 IF flow.kind='laboratory_order' THEN
  targets:=public.care_closure_targets(p_work);
  PERFORM public.lock_care_lab_composition(p_work,targets,'[]');
  IF targets IS DISTINCT FROM public.care_closure_targets(p_work) THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Closure obligations changed while acquiring source locks'; END IF;
 ELSE
  PERFORM id FROM public.work_items WHERE id=p_work FOR UPDATE;
  PERFORM work_item_id FROM public.care_workflows WHERE work_item_id=p_work FOR UPDATE;
 END IF;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,p_clinical);
END $$;
CREATE FUNCTION public.care_closure_snapshot(p_work uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
 SELECT jsonb_build_object(
  'exceptions',(SELECT COALESCE(jsonb_agg(public.care_exception_snapshot(p_work,e.id) ORDER BY e.id),'[]')
   FROM public.care_workflow_exceptions e WHERE e.work_item_id=p_work
   AND NOT EXISTS(SELECT 1 FROM public.care_exception_resolutions r WHERE r.exception_id=e.id)),
  'invalidations',(SELECT COALESCE(jsonb_agg(public.care_invalidation_snapshot(p_work,(t->>'invalidation_id')::uuid)
   ORDER BY (t->>'invalidation_id')::uuid),'[]') FROM jsonb_array_elements(public.care_closure_targets(p_work)) t),
  'known_invalidation_ids',(SELECT COALESCE(jsonb_agg(i.id ORDER BY i.id),'[]') FROM public.care_lab_source_invalidations i
   JOIN public.care_lab_composition_entries e ON e.id=i.entry_id JOIN public.care_lab_composition_events c ON c.id=e.event_id
   WHERE c.work_item_id=p_work),
  'prepared_intents',(SELECT COALESCE(jsonb_agg(jsonb_build_object('intent_id',i.id,'state',i.state,'recorded_at',i.recorded_at)
   ORDER BY i.id),'[]') FROM public.lab_followup_submission_intents i WHERE i.work_item_id=p_work AND i.state='prepared'))
$$;
CREATE FUNCTION public.get_care_closure_context(p_work_item_id uuid,p_command text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE item public.work_items; flow public.care_workflows; basis jsonb; review jsonb; result jsonb;
BEGIN
 IF p_command IS NULL OR p_command NOT IN('close_success','close_without_completion') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid closure command'; END IF;
 PERFORM public.lock_care_closure(p_work_item_id,false);
 item:=public.require_care_lab_read(p_work_item_id);
 SELECT * INTO STRICT flow FROM public.care_workflows WHERE work_item_id=item.id;
 basis:=public.care_human_basis(item.id); review:=public.care_latest_human_review(item.id,basis);
 result:=jsonb_build_object('actor_id',(SELECT auth.uid()),'organization_id',item.organization_id,'patient_id',item.patient_id,
  'work_item_id',item.id,'workflow_revision',flow.revision::text,'ownership_revision',item.ownership_revision::text,'kind',flow.kind,
  'stage',flow.stage,'command',p_command,'basis',basis,'basis_signature',public.care_human_signature(basis),
  'latest_review',review,'contact',public.care_source_contact(item.id,(review->>'event_id')::uuid,basis),
  'snapshot',public.care_closure_snapshot(item.id));
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
END $$;

CREATE FUNCTION public.validate_care_closure_payload(p_command text,p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb:=p_payload->'details'; keys text[]; k text; row jsonb; snapshot jsonb;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR NOT(p_payload ?& ARRAY['occurred_at','evidence','details'])
  OR p_payload-ARRAY['occurred_at','evidence','details']<>'{}'::jsonb OR NOT public.care_step_text(p_payload->'evidence',1000)
  OR jsonb_typeof(d) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid explicit closure payload'; END IF;
 IF public.care_step_instant(p_payload->'occurred_at')>clock_timestamp() THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Closure occurrence cannot be in the future'; END IF;
 keys:=CASE WHEN p_command='close_success' THEN ARRAY['snapshot','outcome','review_event_id','contact_event_id','workflow_completed','review_contact_accepted']
  ELSE ARRAY['snapshot','outcome','disposition','reason','declarations'] END;
 IF NOT(d ?& keys) OR d-keys<>'{}'::jsonb OR NOT public.care_step_text(d->'outcome',1000) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid closure details'; END IF;
 snapshot:=d->'snapshot';
 IF jsonb_typeof(snapshot) IS DISTINCT FROM 'object' OR NOT(snapshot ?& ARRAY['exceptions','invalidations','known_invalidation_ids','prepared_intents'])
  OR snapshot-ARRAY['exceptions','invalidations','known_invalidation_ids','prepared_intents']<>'{}'::jsonb THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Exact complete closure snapshot is required'; END IF;
 FOREACH k IN ARRAY ARRAY['exceptions','invalidations','known_invalidation_ids','prepared_intents'] LOOP
  IF jsonb_typeof(snapshot->k) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid closure snapshot list'; END IF;
 END LOOP;
 IF p_command='close_success' THEN
  IF d->'workflow_completed' IS DISTINCT FROM 'true'::jsonb OR d->'review_contact_accepted' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit workflow and referenced-evidence attestations are required'; END IF;
  FOREACH k IN ARRAY ARRAY['review_event_id','contact_event_id'] LOOP
   IF jsonb_typeof(d->k) IS DISTINCT FROM 'string' OR d->>k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid closure evidence reference'; END IF;
  END LOOP;
 ELSE
  IF jsonb_typeof(d->'disposition') IS DISTINCT FROM 'string' OR d->>'disposition' NOT IN('refused','not_performed','cancelled','transferred')
   OR NOT public.care_step_text(d->'reason',1000) OR jsonb_typeof(d->'declarations') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit non-completion disposition and rationale are required'; END IF;
  FOR row IN SELECT * FROM jsonb_array_elements(d->'declarations') LOOP
   IF jsonb_typeof(row)<>'object' OR NOT(row ?& ARRAY['target_type','target_id','reason','non_delivery_acknowledged'])
    OR row-ARRAY['target_type','target_id','reason','non_delivery_acknowledged']<>'{}'::jsonb
    OR jsonb_typeof(row->'target_type') IS DISTINCT FROM 'string' OR row->>'target_type' NOT IN('exception','source_invalidation')
    OR jsonb_typeof(row->'target_id') IS DISTINCT FROM 'string' OR row->>'target_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR NOT public.care_step_text(row->'reason',1000) OR row->'non_delivery_acknowledged' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid target-specific non-delivery declaration'; END IF;
  END LOOP;
 END IF;
END $$;

CREATE FUNCTION public.verify_care_closure(p_item public.work_items,p_flow public.care_workflows,p_command text,p_basis jsonb,p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb:=p_payload->'details'; snapshot jsonb; review jsonb; contact jsonb; row jsonb; occurred timestamptz;
 latest_occurrence timestamptz; declared integer;
BEGIN
 PERFORM public.require_care_workflow_scope(p_item.organization_id,p_item.patient_id,true);
 snapshot:=public.care_closure_snapshot(p_item.id);
 IF snapshot IS DISTINCT FROM d->'snapshot' THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Closure obligations or their source heads changed'; END IF;
 IF snapshot->'prepared_intents'<>'[]'::jsonb THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Resolve all prepared laboratory intentions before closure'; END IF;
 occurred:=public.care_step_instant(p_payload->'occurred_at');
 SELECT max(t.occurred_at) INTO latest_occurrence FROM(
  SELECT occurred_at FROM public.care_workflow_events WHERE work_item_id=p_item.id
  UNION ALL SELECT occurred_at FROM public.care_step_events WHERE work_item_id=p_item.id
  UNION ALL SELECT occurred_at FROM public.care_lab_composition_events WHERE work_item_id=p_item.id
  UNION ALL SELECT occurred_at FROM public.care_human_events WHERE work_item_id=p_item.id) t;
 IF occurred<latest_occurrence THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Closure cannot precede documented workflow history'; END IF;
 IF p_command='close_success' THEN
  IF snapshot->'exceptions'<>'[]'::jsonb OR snapshot->'invalidations'<>'[]'::jsonb THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Unresolved obligations prevent successful closure'; END IF;
  IF NOT((p_flow.kind='laboratory_order' AND p_flow.stage='result_received' AND p_basis->'composition_event_id'<>'null'::jsonb)
   OR(p_flow.kind='referral' AND p_flow.stage='report_received' AND p_basis->'operational_event'<>'null'::jsonb)
   OR(p_flow.kind='medication_access' AND p_flow.stage='obtained' AND p_basis->'operational_event'<>'null'::jsonb)) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Documented final factual evidence is required for successful closure'; END IF;
  IF p_flow.kind='laboratory_order' AND(
   jsonb_array_length(p_basis->'sources')<>cardinality(p_flow.requested_analytes)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_basis->'sources') s WHERE s->>'quality' IS DISTINCT FROM 'available'
    OR s#>>'{head,status}'='cancelled' OR s#>>'{head,effective_lab_result_id}' IS NULL
    OR s#>>'{head,collected_at}' IS NULL OR NOT isfinite((s#>>'{head,collected_at}')::timestamptz)
    OR(s#>>'{head,collected_at}')::timestamptz>clock_timestamp())
   OR jsonb_array_length(p_basis->'processing')=0
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_basis->'processing') p WHERE
    COALESCE(p#>>'{evaluation,status}','missing') NOT IN('recorded','not_required') OR p#>>'{evaluation,completed_at}' IS NULL)) THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Every requested result must be available with completed processing'; END IF;
  review:=public.care_latest_human_review(p_item.id,p_basis);
  IF review IS NULL OR NOT(review->>'is_current')::boolean OR(review->>'event_id')::uuid IS DISTINCT FROM(d->>'review_event_id')::uuid
   OR NOT EXISTS(SELECT 1 FROM public.care_human_events e JOIN public.care_human_requests r ON r.id=e.request_id
    WHERE e.id=(review->>'event_id')::uuid AND r.state='applied' AND r.basis_signature=public.care_human_signature(p_basis)) THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='The latest applied review must address the exact current evidence'; END IF;
  contact:=public.care_source_contact(p_item.id,(review->>'event_id')::uuid,p_basis,(d->>'contact_event_id')::uuid);
  IF contact IS NULL OR(contact->>'revision')::bigint<=(review->>'revision')::bigint
   OR(contact->>'occurred_at')::timestamptz<(review->>'occurred_at')::timestamptz OR occurred<(contact->>'occurred_at')::timestamptz THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Exact documented contact after the current review is required'; END IF;
 ELSE
  SELECT count(DISTINCT (x->>'target_type',(x->>'target_id')::uuid)) INTO declared FROM jsonb_array_elements(d->'declarations') x;
  IF declared<>jsonb_array_length(d->'declarations') OR declared<>jsonb_array_length(snapshot->'exceptions')+jsonb_array_length(snapshot->'invalidations') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Declare non-delivery for each and only each unresolved target'; END IF;
  FOR row IN SELECT * FROM jsonb_array_elements(snapshot->'exceptions') LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'declarations') x WHERE x->>'target_type'='exception'
    AND(x->>'target_id')::uuid=(row->>'exception_id')::uuid) OR occurred<(row->>'origin_occurred_at')::timestamptz THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='A causal target-specific exception declaration is required'; END IF;
  END LOOP;
  FOR row IN SELECT * FROM jsonb_array_elements(snapshot->'invalidations') LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'declarations') x WHERE x->>'target_type'='source_invalidation'
    AND(x->>'target_id')::uuid=(row->>'invalidation_id')::uuid)
    OR occurred<GREATEST((row->>'recorded_at')::timestamptz,(row->>'head_recorded_at')::timestamptz) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='A causal target-specific source declaration is required'; END IF;
  END LOOP;
 END IF;
END $$;

CREATE FUNCTION public.guard_care_closure_origin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved public.care_human_requests; item public.work_items; flow public.care_workflows;
BEGIN
 IF NOT public.care_workflow_write_authorized(NEW.work_item_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Closure requires its typed write context'; END IF;
 SELECT r.* INTO saved FROM public.care_human_events e JOIN public.care_human_requests r ON r.id=e.request_id
 WHERE e.id=NEW.human_event_id AND e.work_item_id=NEW.work_item_id AND r.work_item_id=NEW.work_item_id
  AND r.command IN('close_success','close_without_completion') AND e.from_stage=e.to_stage AND r.state='prepared';
 IF saved.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Closure does not match its human event'; END IF;
 SELECT * INTO STRICT item FROM public.work_items WHERE id=NEW.work_item_id;
 SELECT * INTO STRICT flow FROM public.care_workflows WHERE work_item_id=NEW.work_item_id;
 PERFORM public.require_care_step_owner(item,flow,saved.expected_revision,saved.expected_ownership_revision);
 PERFORM public.verify_care_human_evidence(item,flow,saved.command,saved.basis,saved.basis_signature,saved.payload);
 RETURN NEW;
END $$;
CREATE TRIGGER guard_care_closure_origin BEFORE INSERT ON public.care_workflow_closures
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_closure_origin();
-- Runs AFTER the legacy BEFORE trigger assigns transaction-start now(), before audit/queue AFTER triggers.
CREATE FUNCTION public.project_care_closure_time() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recorded timestamptz;
BEGIN
 IF NEW.source_type='care_workflow' AND NEW.status='closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
  SELECT e.recorded_at INTO recorded FROM public.care_workflow_closures c JOIN public.care_human_events e ON e.id=c.human_event_id
   WHERE c.work_item_id=NEW.id;
  IF recorded IS NULL OR NOT public.care_workflow_write_authorized(NEW.id) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Typed closure event required'; END IF;
  NEW.closed_at:=recorded;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_project_care_closure_time BEFORE UPDATE ON public.work_items
 FOR EACH ROW EXECUTE FUNCTION public.project_care_closure_time();

-- Existing human RPCs are replaced below; recovery remains monitor-only.
CREATE OR REPLACE FUNCTION public.care_human_requires_clinical(p_command text,p_payload jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT COALESCE(p_command IN('record_review','resolve_source_invalidation','close_success','close_without_completion')
  OR(p_command='resolve_exception' AND p_payload#>>'{details,disposition}'='clinical_non_delivery'),false)
$$;

CREATE OR REPLACE FUNCTION public.validate_care_human_payload(p_command text,p_payload jsonb,p_fresh boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb; keys text[]; v_key text; occurred timestamptz; due timestamptz;
BEGIN
 IF p_command IN('close_success','close_without_completion') THEN PERFORM public.validate_care_closure_payload(p_command,p_payload); RETURN; END IF;
 IF p_command IS NULL OR p_command NOT IN('record_review','record_contact','resolve_exception','resolve_source_invalidation') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR NOT(p_payload ?& ARRAY['occurred_at','evidence','next_action','next_review_at','details'])
  OR p_payload-ARRAY['occurred_at','evidence','next_action','next_review_at','details']<>'{}'::jsonb
  OR NOT public.care_step_text(p_payload->'evidence',1000) OR NOT public.care_step_text(p_payload->'next_action',500)
  OR jsonb_typeof(p_payload->'details') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid human evidence payload';
 END IF;
 occurred:=public.care_step_instant(p_payload->'occurred_at'); due:=public.care_step_instant(p_payload->'next_review_at');
 IF occurred>clock_timestamp() OR(p_fresh AND due<=clock_timestamp()) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Verify human occurrence and next review'; END IF;
 IF p_command='resolve_source_invalidation' THEN PERFORM public.validate_care_source_resolution(p_payload); RETURN; END IF;
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
 IF p_command IN('close_success','close_without_completion') THEN
  PERFORM public.verify_care_closure(p_item,p_flow,p_command,p_basis,p_payload); RETURN;
 END IF;
 IF p_command='resolve_source_invalidation' THEN
  PERFORM public.verify_care_source_resolution(p_item.id,p_basis,p_payload); RETURN;
 END IF;
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
 IF p_command IN('close_success','close_without_completion') THEN PERFORM public.lock_care_closure(item.id,true);
 ELSIF p_command='resolve_source_invalidation' THEN
  PERFORM public.lock_care_source_resolution(item.id,(p_payload#>>'{details,invalidation,invalidation_id}')::uuid,true);
 ELSE PERFORM public.lock_care_human_work(item.id,public.care_human_requires_clinical(p_command,p_payload)); END IF;
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
 IF saved.command IN('close_success','close_without_completion') THEN PERFORM public.lock_care_closure(saved.work_item_id,true);
 ELSIF saved.command='resolve_source_invalidation' THEN
  PERFORM public.lock_care_source_resolution(saved.work_item_id,(saved.payload#>>'{details,invalidation,invalidation_id}')::uuid,true);
 ELSE PERFORM public.lock_care_human_work(saved.work_item_id,public.care_human_requires_clinical(saved.command,saved.payload)); END IF;
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
 IF saved.command='resolve_source_invalidation' THEN
  INSERT INTO public.care_source_invalidation_resolutions(invalidation_id,human_event_id,work_item_id)
  VALUES((saved.payload#>>'{details,invalidation,invalidation_id}')::uuid,v_event,item.id);
 END IF;
 IF saved.command IN('close_success','close_without_completion') THEN
  INSERT INTO public.care_workflow_closures(work_item_id,human_event_id) VALUES(item.id,v_event);
  UPDATE public.care_workflows SET revision=flow.revision+1 WHERE work_item_id=item.id;
  UPDATE public.work_items SET status='closed',outcome=saved.payload#>>'{details,outcome}',
   outcome_code=CASE WHEN saved.command='close_success' THEN 'followup_completed'
    WHEN saved.payload#>>'{details,disposition}'='transferred' THEN 'transferred_to_other_team' ELSE 'care_not_delivered' END
   WHERE id=item.id;
  v_receipt:=jsonb_build_object('request_id',saved.id,'work_item_id',item.id,'event_id',v_event,'command',saved.command,
   'workflow_revision',(flow.revision+1)::text,'ownership_revision',item.ownership_revision::text,'stage',flow.stage,'recorded_at',v_recorded,
   'basis',saved.basis,'basis_signature',saved.basis_signature,'work_closed',true,
   'completion_outcome',CASE WHEN saved.command='close_success' THEN 'documented_workflow_completion' ELSE saved.payload#>>'{details,disposition}' END,
   'closed_at',(SELECT closed_at FROM public.work_items WHERE id=item.id),'clinical_review_recorded',false,
   'addresses_current_review',false,'communication_confirmed',false,'care_completed',saved.command='close_success');
 ELSE
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
 IF saved.command='resolve_source_invalidation' THEN
  v_receipt:=v_receipt||jsonb_build_object('resolved_invalidation_id',saved.payload#>>'{details,invalidation,invalidation_id}',
   'resolution_event_id',v_event,'source_review_attested',true,'source_contact_attested',true);
 END IF;
 END IF;
 UPDATE public.care_human_requests SET state='applied',applied_at=clock_timestamp(),receipt=v_receipt WHERE id=saved.id;
 DELETE FROM public.care_workflow_write_context WHERE work_item_id=item.id;
 PERFORM public.validate_care_human_payload(saved.command,saved.payload,true);
 result:=public.care_human_request_state(saved.id);
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,public.care_human_requires_clinical(saved.command,saved.payload)); RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.care_closure_targets(uuid),public.lock_care_closure(uuid,boolean),
 public.care_closure_snapshot(uuid),public.get_care_closure_context(uuid,text),public.validate_care_closure_payload(text,jsonb),
 public.verify_care_closure(public.work_items,public.care_workflows,text,jsonb,jsonb),
 public.guard_care_closure_origin(),public.project_care_closure_time() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_care_closure_context(uuid,text) TO authenticated;
COMMENT ON TABLE public.care_workflow_closures IS
 'Immutable explicit workflow completion or non-completion. Prior obligations remain history; not confirmed delivery, efficacy or an accepted transfer.';
