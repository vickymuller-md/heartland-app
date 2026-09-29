-- Backend rehearsal only: the fourth human variant requires coordinated client integration.
-- Explicit target-specific human attestation, never inferred communication or completed care.
ALTER TABLE public.care_human_requests DROP CONSTRAINT care_human_requests_command_check;
ALTER TABLE public.care_human_requests ADD CONSTRAINT care_human_requests_command_check
 CHECK(command IN('record_review','record_contact','resolve_exception','resolve_source_invalidation'));
CREATE TABLE public.care_source_invalidation_resolutions (
 invalidation_id uuid PRIMARY KEY REFERENCES public.care_lab_source_invalidations(id) ON DELETE RESTRICT,
 human_event_id uuid NOT NULL UNIQUE REFERENCES public.care_human_events(id) ON DELETE RESTRICT,
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT
);
ALTER TABLE public.care_source_invalidation_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.care_source_invalidation_resolutions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_care_source_resolution_history BEFORE UPDATE OR DELETE ON public.care_source_invalidation_resolutions
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_human_history();

CREATE FUNCTION public.care_invalidation_snapshot(p_work uuid,p_invalidation uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
 SELECT jsonb_build_object('invalidation_id',i.id,'entry_id',e.id,'composition_event_id',c.id,'composition_revision',c.revision::text,
  'analyte',e.analyte,'root_id',r.id,'observed_version_id',e.observed_version_id,'change_version_id',v.id,'change_revision',v.revision::text,
  'change_status',v.status,'change_recorded_at',ch.recorded_at,'recorded_at',i.recorded_at,
  'head',public.lab_observation_head_snapshot(r.id),'head_recorded_at',head.recorded_at)
 FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries e ON e.id=i.entry_id
 JOIN public.care_lab_composition_events c ON c.id=e.event_id
 JOIN public.care_workflows f ON f.work_item_id=c.work_item_id
 JOIN public.work_items w ON w.id=f.work_item_id
 JOIN public.lab_observation_roots r ON r.id=e.root_id AND r.patient_id=w.patient_id AND r.analyte=e.analyte
 JOIN public.lab_observation_change_events ch ON ch.version_id=i.change_version_id AND ch.root_id=r.id
 JOIN public.lab_observation_versions v ON v.id=ch.version_id AND v.root_id=r.id
 JOIN LATERAL(SELECT recorded_at FROM public.lab_observation_versions WHERE root_id=r.id ORDER BY revision DESC LIMIT 1) head ON true
 WHERE i.id=p_invalidation AND c.work_item_id=p_work AND f.kind='laboratory_order'
$$;

CREATE FUNCTION public.lock_care_source_resolution(p_work uuid,p_invalidation uuid,p_clinical boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE item public.work_items; root uuid;
BEGIN
 item:=public.require_care_lab_read(p_work);
 PERFORM public.lock_care_workflow_scope(item.organization_id,item.patient_id,p_clinical);
 -- Derive the historical root only from this authorized target relation, never the caller's snapshot.
 SELECT e.root_id INTO root FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries e ON e.id=i.entry_id
 JOIN public.care_lab_composition_events c ON c.id=e.event_id
 JOIN public.lab_observation_change_events ch ON ch.version_id=i.change_version_id AND ch.root_id=e.root_id
 WHERE i.id=p_invalidation AND c.work_item_id=p_work;
 IF root IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Source invalidation not authorized for this work'; END IF;
 PERFORM public.lock_care_lab_composition(p_work,jsonb_build_array(jsonb_build_object('root_id',root)),'[]');
 IF public.care_invalidation_snapshot(p_work,p_invalidation) IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Source invalidation not authorized for this work'; END IF;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,p_clinical);
END $$;

CREATE FUNCTION public.care_source_contact(p_work uuid,p_review uuid,p_basis jsonb,p_contact uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
 SELECT jsonb_build_object('event_id',e.id,'revision',e.revision::text,'actor_id',e.actor_id,'occurred_at',e.occurred_at,'recorded_at',e.recorded_at,
  'review_event_id',p_review,'basis_signature',r.basis_signature,'channel',r.payload#>'{details,channel}',
  'recipient_type',r.payload#>'{details,recipient_type}','recipient_reference',r.payload#>'{details,recipient_reference}')
 FROM public.care_human_events e JOIN public.care_human_requests r ON r.id=e.request_id
 WHERE e.work_item_id=p_work AND r.work_item_id=p_work AND r.command='record_contact' AND r.state='applied'
  AND(r.payload#>>'{details,review_event_id}')::uuid=p_review AND r.payload#>'{details,review_addressed}'='true'::jsonb
  AND r.payload#>>'{details,outcome}'='human_reached' AND r.basis=p_basis
  AND r.basis_signature=public.care_human_signature(p_basis) AND(p_contact IS NULL OR e.id=p_contact)
 ORDER BY e.revision DESC LIMIT 1
$$;

CREATE FUNCTION public.get_care_source_resolution_context(p_work_item_id uuid,p_invalidation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE item public.work_items; flow public.care_workflows; basis jsonb; review jsonb; result jsonb; target jsonb;
BEGIN
 PERFORM public.lock_care_source_resolution(p_work_item_id,p_invalidation_id,false);
 item:=public.require_care_lab_read(p_work_item_id);
 SELECT * INTO STRICT flow FROM public.care_workflows WHERE work_item_id=item.id;
 target:=public.care_invalidation_snapshot(item.id,p_invalidation_id);
 IF EXISTS(SELECT 1 FROM public.care_source_invalidation_resolutions WHERE invalidation_id=p_invalidation_id) THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Source invalidation already resolved'; END IF;
 basis:=public.care_human_basis(item.id); review:=public.care_latest_human_review(item.id,basis);
 result:=jsonb_build_object('actor_id',(SELECT auth.uid()),'organization_id',item.organization_id,'patient_id',item.patient_id,
  'work_item_id',item.id,'workflow_revision',flow.revision::text,'ownership_revision',item.ownership_revision::text,'kind',flow.kind,
  'stage',flow.stage,'command','resolve_source_invalidation','basis',basis,'basis_signature',public.care_human_signature(basis),
  'latest_review',review,'invalidation',target,'contact',public.care_source_contact(item.id,(review->>'event_id')::uuid,basis));
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
END $$;

CREATE FUNCTION public.validate_care_source_resolution(p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb:=p_payload->'details'; target jsonb; k text;
BEGIN
 IF d IS NULL OR jsonb_typeof(d)<>'object'
  OR NOT(d ?& ARRAY['invalidation','review_event_id','contact_event_id','disposition','resolution_reason','source_reviewed',
   'change_addressed_in_contact','source_review_evidence','source_communication_evidence'])
  OR d-ARRAY['invalidation','review_event_id','contact_event_id','disposition','resolution_reason','source_reviewed',
   'change_addressed_in_contact','source_review_evidence','source_communication_evidence']<>'{}'::jsonb
  OR d->'source_reviewed' IS DISTINCT FROM 'true'::jsonb OR d->'change_addressed_in_contact' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(d->'disposition') IS DISTINCT FROM 'string' OR d->>'disposition' NOT IN('retained_in_current_composition','no_longer_used')
  OR NOT public.care_step_text(d->'resolution_reason',1000) OR NOT public.care_step_text(d->'source_review_evidence',1000)
  OR NOT public.care_step_text(d->'source_communication_evidence',1000) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit source review and communication attestations are required'; END IF;
 FOREACH k IN ARRAY ARRAY['review_event_id','contact_event_id'] LOOP
  IF jsonb_typeof(d->k) IS DISTINCT FROM 'string' OR d->>k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid source attestation reference'; END IF;
 END LOOP;
 target:=d->'invalidation';
 IF target IS NULL OR jsonb_typeof(target)<>'object'
  OR NOT(target ?& ARRAY['invalidation_id','entry_id','composition_event_id','composition_revision','analyte','root_id','observed_version_id',
   'change_version_id','change_revision','change_status','change_recorded_at','recorded_at','head','head_recorded_at'])
  OR target-ARRAY['invalidation_id','entry_id','composition_event_id','composition_revision','analyte','root_id','observed_version_id',
   'change_version_id','change_revision','change_status','change_recorded_at','recorded_at','head','head_recorded_at']<>'{}'::jsonb
  OR jsonb_typeof(target->'head') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid exact source invalidation snapshot'; END IF;
 FOREACH k IN ARRAY ARRAY['invalidation_id','entry_id','composition_event_id','root_id','observed_version_id','change_version_id'] LOOP
  IF jsonb_typeof(target->k) IS DISTINCT FROM 'string' OR target->>k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid source invalidation identity'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['composition_revision','change_revision'] LOOP
  IF jsonb_typeof(target->k) IS DISTINCT FROM 'string' OR target->>k !~ '^[1-9][0-9]{0,18}$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid source invalidation revision'; END IF;
  IF (target->>k)::numeric NOT BETWEEN 2 AND 9223372036854775807 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid source invalidation revision'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['change_recorded_at','recorded_at','head_recorded_at'] LOOP PERFORM public.care_step_instant(target->k); END LOOP;
 IF target->>'change_status' NOT IN('corrected','cancelled') OR jsonb_typeof(target->'change_status') IS DISTINCT FROM 'string'
  OR NOT public.care_step_text(target->'analyte',100) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid changed source'; END IF;
END $$;

CREATE FUNCTION public.verify_care_source_resolution(p_work uuid,p_basis jsonb,p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb:=p_payload->'details'; target uuid:=(d#>>'{invalidation,invalidation_id}')::uuid;
 expected jsonb; review jsonb; contact jsonb; item public.work_items; current_composition public.care_lab_composition_events; retained boolean;
BEGIN
 SELECT * INTO STRICT item FROM public.work_items WHERE id=p_work;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,true);
 PERFORM i.id FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries e ON e.id=i.entry_id
  JOIN public.care_lab_composition_events c ON c.id=e.event_id WHERE i.id=target AND c.work_item_id=p_work FOR UPDATE OF i;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Source invalidation not authorized for this work'; END IF;
 expected:=public.care_invalidation_snapshot(p_work,target);
 IF expected IS NULL OR expected IS DISTINCT FROM d->'invalidation' THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='The exact source invalidation or historical head changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.care_source_invalidation_resolutions WHERE invalidation_id=target) THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Source invalidation already resolved by another request'; END IF;
 SELECT * INTO current_composition FROM public.care_lab_composition_events WHERE id=public.care_lab_current_event(p_work);
 retained:=EXISTS(SELECT 1 FROM public.care_lab_composition_entries WHERE event_id=current_composition.id AND root_id=(expected->>'root_id')::uuid);
 IF (d->>'disposition'='retained_in_current_composition') IS DISTINCT FROM retained
  OR NOT retained AND(current_composition.id IS NULL OR current_composition.revision<=(expected->>'composition_revision')::bigint
   OR current_composition.recorded_at<(expected->>'recorded_at')::timestamptz) THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Disposition does not match the current composition'; END IF;
 review:=public.care_latest_human_review(p_work,p_basis);
 IF review IS NULL OR NOT(review->>'is_current')::boolean OR(review->>'event_id')::uuid IS DISTINCT FROM(d->>'review_event_id')::uuid
  OR NOT EXISTS(SELECT 1 FROM public.care_human_events e JOIN public.care_human_requests r ON r.id=e.request_id
   WHERE e.id=(review->>'event_id')::uuid AND r.state='applied')
  OR(review->>'revision')::bigint<=current_composition.revision
  OR(review->>'occurred_at')::timestamptz<GREATEST((expected->>'recorded_at')::timestamptz,(expected->>'head_recorded_at')::timestamptz) THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='A current applied review after the source change is required'; END IF;
 contact:=public.care_source_contact(p_work,(review->>'event_id')::uuid,p_basis,(d->>'contact_event_id')::uuid);
 IF contact IS NULL OR(contact->>'revision')::bigint<=(review->>'revision')::bigint
  OR(contact->>'occurred_at')::timestamptz<(review->>'occurred_at')::timestamptz
  OR public.care_step_instant(p_payload->'occurred_at')<(contact->>'occurred_at')::timestamptz THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='The exact documented contact must address the current review after the change'; END IF;
END $$;

CREATE FUNCTION public.guard_care_source_resolution_origin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE payload jsonb; basis jsonb;
BEGIN
 IF NOT public.care_workflow_write_authorized(NEW.work_item_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Source resolution requires its typed write context'; END IF;
 SELECT r.payload,r.basis INTO payload,basis FROM public.care_human_events e JOIN public.care_human_requests r ON r.id=e.request_id
 WHERE e.id=NEW.human_event_id AND e.work_item_id=NEW.work_item_id AND r.work_item_id=NEW.work_item_id
  AND r.command='resolve_source_invalidation' AND e.from_stage=e.to_stage AND(r.payload#>>'{details,invalidation,invalidation_id}')::uuid=NEW.invalidation_id;
 IF payload IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Source resolution does not match its human event'; END IF;
 PERFORM public.verify_care_source_resolution(NEW.work_item_id,basis,payload);
 RETURN NEW;
END $$;
CREATE TRIGGER guard_care_source_resolution_origin BEFORE INSERT ON public.care_source_invalidation_resolutions
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_source_resolution_origin();

CREATE OR REPLACE FUNCTION public.care_human_requires_clinical(p_command text,p_payload jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT COALESCE(p_command IN('record_review','resolve_source_invalidation')
  OR(p_command='resolve_exception' AND p_payload#>>'{details,disposition}'='clinical_non_delivery'),false)
$$;

CREATE OR REPLACE FUNCTION public.validate_care_human_payload(p_command text,p_payload jsonb,p_fresh boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb; keys text[]; v_key text; occurred timestamptz; due timestamptz;
BEGIN
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
 IF p_command='resolve_source_invalidation' THEN
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
 IF saved.command='resolve_source_invalidation' THEN
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
 UPDATE public.care_human_requests SET state='applied',applied_at=clock_timestamp(),receipt=v_receipt WHERE id=saved.id;
 DELETE FROM public.care_workflow_write_context WHERE work_item_id=item.id;
 PERFORM public.validate_care_human_payload(saved.command,saved.payload,true);
 result:=public.care_human_request_state(saved.id);
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,public.care_human_requires_clinical(saved.command,saved.payload)); RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.get_care_lab_composition(p_work_item_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE item public.work_items; flow public.care_workflows; result jsonb; fence jsonb;
BEGIN
 PERFORM public.require_care_lab_read(p_work_item_id);
 fence:=public.lock_care_lab_composition(p_work_item_id,'[]','[]');
 item:=public.require_care_lab_read(p_work_item_id);
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=item.id;
 IF flow.kind<>'laboratory_order' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Laboratory workflow required'; END IF;
 result:=jsonb_build_object('actor_id',(SELECT auth.uid()),'organization_id',item.organization_id,'patient_id',item.patient_id,
  'work_item_id',item.id,'workflow_revision',flow.revision::text,'ownership_revision',item.ownership_revision::text,
  'stage',flow.stage,'composition_event_id',fence->'event_id','sources',public.care_lab_current_snapshot(item.id),
  'pending_intent_count',(SELECT count(*)::text FROM public.lab_followup_submission_intents WHERE work_item_id=item.id AND state='prepared'),
  'invalidation_count',(SELECT count(*)::text FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries e ON e.id=i.entry_id
   JOIN public.care_lab_composition_events c ON c.id=e.event_id WHERE c.work_item_id=item.id
   AND NOT EXISTS(SELECT 1 FROM public.care_source_invalidation_resolutions r WHERE r.invalidation_id=i.id)),
  'clinical_review_recorded',false,'communication_confirmed',false,'care_completed',false);
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.list_care_lab_invalidations(p_work_item_id uuid,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE item public.work_items; result jsonb;
BEGIN
 item:=public.require_care_lab_read(p_work_item_id);
 PERFORM public.lock_care_workflow_scope(item.organization_id,item.patient_id,false);
 PERFORM id FROM public.work_items WHERE id=item.id FOR SHARE;
 item:=public.require_care_lab_read(item.id);
 WITH candidates AS MATERIALIZED(SELECT i.id,i.entry_id,i.change_version_id,i.recorded_at,e.analyte,e.root_id,e.event_id,
  (SELECT jsonb_build_object('event_id',r.human_event_id,'revision',h.revision::text,'recorded_at',h.recorded_at,
    'disposition',q.payload#>'{details,disposition}') FROM public.care_source_invalidation_resolutions r
   JOIN public.care_human_events h ON h.id=r.human_event_id JOIN public.care_human_requests q ON q.id=h.request_id
   WHERE r.invalidation_id=i.id) AS resolution
  FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries e ON e.id=i.entry_id
  JOIN public.care_lab_composition_events c ON c.id=e.event_id WHERE c.work_item_id=item.id AND(p_after IS NULL OR i.id>p_after)
  ORDER BY i.id LIMIT 26),page AS(SELECT * FROM candidates ORDER BY id LIMIT 25)
 SELECT jsonb_build_object('work_item_id',item.id,'items',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM page p),'[]'),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>25 THEN(SELECT max(id::text) FROM page) END) INTO result;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.care_invalidation_snapshot(uuid,uuid),public.lock_care_source_resolution(uuid,uuid,boolean),
 public.care_source_contact(uuid,uuid,jsonb,uuid),public.validate_care_source_resolution(jsonb),
 public.verify_care_source_resolution(uuid,jsonb,jsonb),public.guard_care_source_resolution_origin(),
 public.get_care_source_resolution_context(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_care_source_resolution_context(uuid,uuid) TO authenticated;
COMMENT ON TABLE public.care_source_invalidation_resolutions IS
 'Exact immutable target-specific human attestation; prior review/contact records remain unchanged. Not confirmed transmission or care completion.';
