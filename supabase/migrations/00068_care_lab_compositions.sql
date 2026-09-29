-- Local composition dependency. Do not release before mixed-history client integration.
ALTER TABLE public.care_workflows DROP CONSTRAINT care_workflows_stage_check;
ALTER TABLE public.care_workflows ADD CONSTRAINT care_workflows_stage_check CHECK(stage IN(
 'requested','scheduled','collected','accepted','attended','report_received','assistance_requested',
 'response_received','obtained','result_received'));

CREATE TABLE public.care_lab_composition_requests (
 id uuid PRIMARY KEY,
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 expected_revision bigint NOT NULL CHECK(expected_revision BETWEEN 1 AND 9223372036854775806),
 expected_ownership_revision bigint NOT NULL CHECK(expected_ownership_revision>=0),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','applied','cancelled')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 applied_at timestamptz, cancelled_at timestamptz, acknowledged_at timestamptz, receipt jsonb,
 CHECK((state='prepared' AND num_nonnulls(applied_at,cancelled_at,acknowledged_at,receipt)=0)
  OR(state='applied' AND applied_at IS NOT NULL AND cancelled_at IS NULL AND receipt IS NOT NULL)
  OR(state='cancelled' AND cancelled_at IS NOT NULL AND num_nonnulls(applied_at,acknowledged_at,receipt)=0))
);
CREATE UNIQUE INDEX care_composition_prepared ON public.care_lab_composition_requests(actor_id,work_item_id) WHERE state='prepared';
CREATE INDEX care_composition_pending ON public.care_lab_composition_requests(actor_id,organization_id,patient_id,id);
CREATE TABLE public.care_lab_composition_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES public.care_lab_composition_requests(id) ON DELETE RESTRICT,
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 previous_event_id uuid REFERENCES public.care_lab_composition_events(id) ON DELETE RESTRICT,
 revision bigint NOT NULL CHECK(revision>=2), ownership_revision bigint NOT NULL CHECK(ownership_revision>=0),
 from_stage text NOT NULL,to_stage text NOT NULL,
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(work_item_id,revision)
);
CREATE TABLE public.care_lab_composition_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.care_lab_composition_events(id) ON DELETE RESTRICT,
 analyte text NOT NULL,
 root_id uuid REFERENCES public.lab_observation_roots(id) ON DELETE RESTRICT,
 observed_version_id uuid REFERENCES public.lab_observation_versions(id) ON DELETE RESTRICT,
 CHECK((root_id IS NULL)=(observed_version_id IS NULL)), UNIQUE(event_id,analyte)
);
CREATE INDEX care_composition_root ON public.care_lab_composition_entries(root_id,event_id) WHERE root_id IS NOT NULL;
-- No work/workflow or mutable head FK in the correction transaction.
CREATE TABLE public.care_lab_source_invalidations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entry_id uuid NOT NULL REFERENCES public.care_lab_composition_entries(id) ON DELETE RESTRICT,
 change_version_id uuid NOT NULL REFERENCES public.lab_observation_change_events(version_id) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(entry_id,change_version_id)
);
CREATE TABLE public.lab_followup_intent_resolutions (
 intent_id uuid PRIMARY KEY REFERENCES public.lab_followup_submission_intents(id) ON DELETE RESTRICT,
 event_id uuid NOT NULL REFERENCES public.care_lab_composition_events(id) ON DELETE RESTRICT,
 lab_result_id uuid NOT NULL REFERENCES public.lab_results(id) ON DELETE RESTRICT,
 disposition text NOT NULL CHECK(disposition IN('linked','not_used')),
 reason text NOT NULL CHECK(char_length(btrim(reason))>=3 AND char_length(reason)<=1000),
 matched_analytes jsonb NOT NULL CHECK(jsonb_typeof(matched_analytes)='array'),
 missing_analytes jsonb NOT NULL CHECK(jsonb_typeof(missing_analytes)='array'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.lab_followup_submission_intents DROP CONSTRAINT lab_followup_submission_intents_state_check;
ALTER TABLE public.lab_followup_submission_intents ADD CONSTRAINT lab_followup_intent_state_check
 CHECK(state IN('prepared','cancelled','reconciled'));
ALTER TABLE public.lab_followup_submission_intents ADD COLUMN reconciled_at timestamptz;
ALTER TABLE public.lab_followup_submission_intents ADD CONSTRAINT lab_followup_intent_reconciled_check
 CHECK((state='reconciled')=(reconciled_at IS NOT NULL) AND(reconciled_at IS NULL OR isfinite(reconciled_at)));

CREATE FUNCTION public.guard_care_composition_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='care_lab_composition_requests'
  AND(to_jsonb(NEW)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt'])
   IS NOT DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt']) THEN
  IF OLD.state='prepared' AND NEW.state IN('applied','cancelled') THEN RETURN NEW; END IF;
  IF OLD.state='applied' AND NEW.state='applied' AND OLD.acknowledged_at IS NULL AND NEW.acknowledged_at IS NOT NULL
   AND ROW(OLD.applied_at,OLD.cancelled_at,OLD.receipt) IS NOT DISTINCT FROM ROW(NEW.applied_at,NEW.cancelled_at,NEW.receipt) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory composition history is immutable';
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['care_lab_composition_requests','care_lab_composition_events','care_lab_composition_entries',
  'care_lab_source_invalidations','lab_followup_intent_resolutions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER guard_composition_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_care_composition_history()',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.guard_lab_followup_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.state='prepared'
  AND(to_jsonb(OLD)-ARRAY['state','cancelled_at','reconciled_at']) IS NOT DISTINCT FROM(to_jsonb(NEW)-ARRAY['state','cancelled_at','reconciled_at']) THEN
  IF NEW.state='cancelled' AND NEW.cancelled_at IS NOT NULL AND NEW.reconciled_at IS NULL AND OLD.actor_id=(SELECT auth.uid())
   AND EXISTS(SELECT 1 FROM public.lab_submission_attempts a WHERE a.actor_id=OLD.actor_id AND a.patient_id=OLD.patient_id
    AND a.request_id=OLD.submission_request_id AND a.closed_status='cancelled')
   AND NOT EXISTS(SELECT 1 FROM public.lab_submission_receipts r WHERE r.actor_id=OLD.actor_id AND r.patient_id=OLD.patient_id AND r.request_id=OLD.submission_request_id) THEN
   PERFORM public.require_care_workflow_scope(OLD.organization_id,OLD.patient_id,false); RETURN NEW;
  END IF;
  IF NEW.state='reconciled' AND NEW.reconciled_at IS NOT NULL AND NEW.cancelled_at IS NULL
   AND public.care_workflow_write_authorized(OLD.work_item_id)
   AND EXISTS(SELECT 1 FROM public.lab_followup_intent_resolutions r JOIN public.care_lab_composition_events e ON e.id=r.event_id
    JOIN public.care_lab_composition_requests q ON q.id=e.request_id
    WHERE r.intent_id=OLD.id AND e.work_item_id=OLD.work_item_id AND q.actor_id=(SELECT auth.uid())
     AND q.organization_id=OLD.organization_id AND q.patient_id=OLD.patient_id) THEN
   PERFORM public.require_care_workflow_scope(OLD.organization_id,OLD.patient_id,false); RETURN NEW;
  END IF;
 END IF;
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory follow-up intention is immutable';
END $$;

CREATE FUNCTION public.guard_new_command_against_composition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.care_lab_composition_requests WHERE actor_id=NEW.actor_id AND work_item_id=NEW.work_item_id AND state='prepared') THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover or cancel the laboratory composition first';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_step_against_composition BEFORE INSERT ON public.care_step_requests
 FOR EACH ROW EXECUTE FUNCTION public.guard_new_command_against_composition();
CREATE TRIGGER guard_intent_against_composition BEFORE INSERT ON public.lab_followup_submission_intents
 FOR EACH ROW EXECUTE FUNCTION public.guard_new_command_against_composition();

CREATE FUNCTION public.care_lab_current_event(p_work uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT id FROM public.care_lab_composition_events WHERE work_item_id=p_work ORDER BY revision DESC LIMIT 1
$$;
CREATE FUNCTION public.fanout_care_lab_source_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.care_lab_source_invalidations(entry_id,change_version_id)
 SELECT entry.id,NEW.version_id FROM public.care_lab_composition_entries entry
 JOIN public.care_lab_composition_events event ON event.id=entry.event_id
 WHERE entry.root_id=NEW.root_id AND NOT EXISTS(SELECT 1 FROM public.care_lab_composition_events newer
  WHERE newer.work_item_id=event.work_item_id AND newer.revision>event.revision)
 ORDER BY entry.id;
 RETURN NEW;
END $$;
CREATE TRIGGER fanout_care_lab_source_change AFTER INSERT ON public.lab_observation_change_events
 FOR EACH ROW EXECUTE FUNCTION public.fanout_care_lab_source_change();

CREATE FUNCTION public.validate_care_lab_payload(p_payload jsonb,p_fresh boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row jsonb; previous text:=''; value text;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR NOT(p_payload ?& ARRAY['occurred_at','evidence','reason','next_action','next_review_at','sources','intent_resolutions'])
  OR p_payload-ARRAY['occurred_at','evidence','reason','next_action','next_review_at','sources','intent_resolutions']<>'{}'::jsonb
  OR NOT public.care_step_text(p_payload->'evidence',1000) OR NOT public.care_step_text(p_payload->'reason',1000)
  OR NOT public.care_step_text(p_payload->'next_action',500)
  OR jsonb_typeof(p_payload->'sources') IS DISTINCT FROM 'array'
  OR jsonb_typeof(p_payload->'intent_resolutions') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid laboratory composition payload';
 END IF;
 IF public.care_step_instant(p_payload->'occurred_at')>clock_timestamp()
  OR(p_fresh AND public.care_step_instant(p_payload->'next_review_at')<=clock_timestamp()) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Verify composition occurrence and next review';
 END IF;
 PERFORM public.care_step_instant(p_payload->'next_review_at');
 IF jsonb_array_length(p_payload->'sources') NOT BETWEEN 1 AND 13 OR jsonb_array_length(p_payload->'intent_resolutions')>25 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid composition list size';
 END IF;
 FOR row IN SELECT * FROM jsonb_array_elements(p_payload->'sources') LOOP
  IF jsonb_typeof(row)<>'object' OR NOT(row ?& ARRAY['analyte','root_id','expected_root_revision'])
   OR row-ARRAY['analyte','root_id','expected_root_revision']<>'{}'::jsonb
   OR jsonb_typeof(row->'analyte') IS DISTINCT FROM 'string'
   OR row->>'analyte' NOT IN('potassium','creatinine','egfr','bun','bnp','nt_probnp','hba1c','glucose','sodium','hemoglobin','ferritin','tsat','ldl')
   OR(row->>'analyte') COLLATE "C"<=previous COLLATE "C" THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Composition analytes must be unique and ordered';
  END IF;
  previous:=row->>'analyte';
  IF row->'root_id'='null'::jsonb THEN
   IF row->'expected_root_revision'<>'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Missing source cannot have revision'; END IF;
  ELSE
   value:=row->>'expected_root_revision';
   IF jsonb_typeof(row->'root_id')<>'string' OR row->>'root_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(row->'expected_root_revision')<>'string' OR value !~ '^[1-9][0-9]{0,18}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Exact source root and revision required';
   END IF;
   IF value::numeric>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid root revision'; END IF;
  END IF;
 END LOOP;
 previous:='';
 FOR row IN SELECT * FROM jsonb_array_elements(p_payload->'intent_resolutions') LOOP
  IF jsonb_typeof(row)<>'object' OR NOT(row ?& ARRAY['intent_id','disposition','reason']) OR row-ARRAY['intent_id','disposition','reason']<>'{}'::jsonb
   OR jsonb_typeof(row->'intent_id') IS DISTINCT FROM 'string'
   OR row->>'intent_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR lower(row->>'intent_id') COLLATE "C"<=previous COLLATE "C"
   OR jsonb_typeof(row->'disposition') IS DISTINCT FROM 'string' OR row->>'disposition' NOT IN('linked','not_used')
   OR NOT public.care_step_text(row->'reason',1000) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid ordered intention resolutions';
  END IF;
  previous:=lower(row->>'intent_id');
 END LOOP;
END $$;

-- Resolve the whole lock set before work; return identities for post-wait rechecking.
CREATE FUNCTION public.lock_care_lab_composition(p_work uuid,p_sources jsonb,p_resolutions jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE item public.work_items; v_event uuid; roots uuid[]; labs uuid[];
BEGIN
 SELECT * INTO item FROM public.work_items WHERE id=p_work AND source_type='care_workflow';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(item.organization_id,item.patient_id,false);
 v_event:=public.care_lab_current_event(p_work);
 SELECT COALESCE(array_agg(DISTINCT id ORDER BY id),ARRAY[]::uuid[]) INTO roots FROM(
  SELECT e.root_id AS id FROM public.care_lab_composition_entries e WHERE e.event_id=v_event AND e.root_id IS NOT NULL
  UNION SELECT (s->>'root_id')::uuid FROM jsonb_array_elements(p_sources) s WHERE s->>'root_id' IS NOT NULL
 ) candidates;
 IF EXISTS(SELECT 1 FROM unnest(roots) id WHERE NOT EXISTS(SELECT 1 FROM public.lab_observation_roots r WHERE r.id=id AND r.patient_id=item.patient_id)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Composition source not authorized';
 END IF;
 SELECT COALESCE(array_agg(DISTINCT id ORDER BY id),ARRAY[]::uuid[]) INTO labs FROM(
  SELECT original_lab_result_id AS id FROM public.lab_observation_roots WHERE id=ANY(roots)
  UNION SELECT r.lab_result_id FROM public.lab_followup_submission_intents i JOIN public.lab_submission_receipts r
   ON r.actor_id=i.actor_id AND r.patient_id=i.patient_id AND r.request_id=i.submission_request_id
   WHERE i.id IN(SELECT (x->>'intent_id')::uuid FROM jsonb_array_elements(p_resolutions) x)
    AND i.work_item_id=p_work AND i.patient_id=item.patient_id AND i.organization_id=item.organization_id
 ) originals;
 PERFORM l.id FROM public.lab_results l WHERE l.id=ANY(labs) AND l.patient_id=item.patient_id ORDER BY l.id FOR UPDATE;
 PERFORM r.id FROM public.lab_observation_roots r WHERE r.id=ANY(roots) ORDER BY r.id FOR UPDATE;
 PERFORM id FROM public.work_items WHERE id=p_work FOR UPDATE;
 PERFORM work_item_id FROM public.care_workflows WHERE work_item_id=p_work FOR UPDATE;
 IF public.care_lab_current_event(p_work) IS DISTINCT FROM v_event THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Composition changed while acquiring source locks';
 END IF;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false);
 RETURN jsonb_build_object('event_id',v_event,'roots',roots,'labs',labs);
END $$;

CREATE FUNCTION public.verify_care_lab_composition(p_item public.work_items,p_flow public.care_workflows,p_payload jsonb,p_fence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row jsonb; source jsonb; head jsonb; intent public.lab_followup_submission_intents;
 saved jsonb; recorded text; matched jsonb; result jsonb:='[]'; mapped boolean; linked_count integer;
BEGIN
 IF p_flow.kind<>'laboratory_order' OR p_flow.stage NOT IN('requested','scheduled','collected','result_received') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Laboratory composition is not available at this stage';
 END IF;
 IF (SELECT jsonb_agg(a ORDER BY a COLLATE "C") FROM unnest(p_flow.requested_analytes) a)
  IS DISTINCT FROM(SELECT jsonb_agg(s->>'analyte' ORDER BY ord) FROM jsonb_array_elements(p_payload->'sources') WITH ORDINALITY x(s,ord)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicitly include every requested analyte';
 END IF;
 FOR source IN SELECT * FROM jsonb_array_elements(p_payload->'sources') LOOP
  IF source->>'root_id' IS NULL THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.lab_observation_roots r WHERE r.id=(source->>'root_id')::uuid
   AND r.patient_id=p_item.patient_id AND r.analyte=source->>'analyte') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Composition source not authorized';
  END IF;
  head:=public.lab_observation_head_snapshot((source->>'root_id')::uuid);
  IF head->>'revision' IS DISTINCT FROM source->>'expected_root_revision' THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Composition source revision changed';
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.care_step_requests WHERE actor_id=(SELECT auth.uid()) AND work_item_id=p_item.id AND state='prepared') THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover or cancel the pending care step first';
 END IF;
 IF EXISTS(SELECT 1 FROM public.lab_followup_submission_intents i WHERE i.actor_id=(SELECT auth.uid()) AND i.work_item_id=p_item.id
  AND i.state='prepared' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'intent_resolutions') r WHERE (r->>'intent_id')::uuid=i.id)) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Include every pending own laboratory intention';
 END IF;
 PERFORM i.id FROM public.lab_followup_submission_intents i WHERE i.id IN(
  SELECT (r->>'intent_id')::uuid FROM jsonb_array_elements(p_payload->'intent_resolutions') r) ORDER BY i.id FOR UPDATE;
 FOR row IN SELECT * FROM jsonb_array_elements(p_payload->'intent_resolutions') LOOP
  SELECT * INTO intent FROM public.lab_followup_submission_intents WHERE id=(row->>'intent_id')::uuid;
  IF intent.id IS NULL OR intent.work_item_id<>p_item.id OR intent.organization_id<>p_item.organization_id OR intent.patient_id<>p_item.patient_id THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Follow-up intention not authorized for this work';
  END IF;
  IF intent.state<>'prepared' THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Follow-up intention was already reconciled or cancelled'; END IF;
  saved:=public.lab_followup_intent_state(intent.id);
  IF saved#>>'{submission,status}'<>'saved_not_linked' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Only an exact saved intention can be reconciled';
  END IF;
  IF NOT((p_fence->'labs') ? (saved#>>'{submission,lab_result_id}')) THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Intention save changed while acquiring source locks';
  END IF;
  matched:='[]'; linked_count:=0;
  FOR recorded IN SELECT a#>>'{}' FROM jsonb_array_elements(intent.payload->'analytes') a
   WHERE (saved#>'{submission,recorded_analytes}') ? (a#>>'{}') LOOP
   SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'sources') s JOIN public.lab_observation_roots r
    ON r.id=(s->>'root_id')::uuid WHERE s->>'analyte'=recorded AND r.analyte=recorded
     AND r.original_lab_result_id=(saved#>>'{submission,lab_result_id}')::uuid) INTO mapped;
   IF mapped THEN matched:=matched||to_jsonb(recorded); linked_count:=linked_count+1; END IF;
   IF row->>'disposition'='linked' AND NOT mapped THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Every recorded intended analyte must link its exact saved source';
   END IF;
  END LOOP;
  IF(row->>'disposition'='linked' AND linked_count=0) OR(row->>'disposition'='not_used' AND linked_count<>0) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Intention disposition contradicts the source mapping';
  END IF;
  result:=result||jsonb_build_object('intent_id',intent.id,'disposition',row->>'disposition','reason',row->>'reason',
   'lab_result_id',saved#>'{submission,lab_result_id}','matched_analytes',matched,'missing_analytes',saved#>'{submission,missing_analytes}');
 END LOOP;
 IF p_fence->>'event_id' IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'sources') s WHERE s->>'root_id' IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result) r WHERE r->>'disposition'='not_used') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Initial composition needs a source or explicit unused saved intention';
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.care_lab_composition_request_state(p_request uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
 SELECT jsonb_build_object('request_id',id,'actor_id',actor_id,'organization_id',organization_id,'patient_id',patient_id,
  'work_item_id',work_item_id,'expected_revision',expected_revision::text,'expected_ownership_revision',expected_ownership_revision::text,
  'payload',payload,'state',state,'recorded_at',recorded_at,'acknowledged_at',acknowledged_at,'receipt',receipt)
 FROM public.care_lab_composition_requests WHERE id=p_request
$$;
CREATE FUNCTION public.get_care_lab_composition_request(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_lab_composition_requests; result jsonb;
BEGIN
 SELECT * INTO saved FROM public.care_lab_composition_requests WHERE id=p_request AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Composition request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 PERFORM id FROM public.care_lab_composition_requests WHERE id=p_request FOR UPDATE;
 result:=public.care_lab_composition_request_state(p_request);
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 RETURN result;
END $$;
CREATE FUNCTION public.prepare_care_lab_composition(p_request_id uuid,p_work_item_id uuid,p_organization_id uuid,p_patient_id uuid,
 p_expected_revision bigint,p_expected_ownership_revision bigint,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_lab_composition_requests; item public.work_items; flow public.care_workflows; fence jsonb; result jsonb;
BEGIN
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
 SELECT * INTO saved FROM public.care_lab_composition_requests WHERE id=p_request_id;
 IF saved.id IS NOT NULL THEN
  IF saved.actor_id<>(SELECT auth.uid()) OR saved.work_item_id IS DISTINCT FROM p_work_item_id
   OR saved.organization_id IS DISTINCT FROM p_organization_id OR saved.patient_id IS DISTINCT FROM p_patient_id
   OR saved.expected_revision IS DISTINCT FROM p_expected_revision OR saved.expected_ownership_revision IS DISTINCT FROM p_expected_ownership_revision
   OR saved.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Composition request identity conflict'; END IF;
  RETURN public.get_care_lab_composition_request(saved.id);
 END IF;
 IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 1 AND 9223372036854775806
  OR p_expected_ownership_revision IS NULL OR p_expected_ownership_revision<0 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid composition identity';
 END IF;
 PERFORM public.validate_care_lab_payload(p_payload,true);
 SELECT * INTO item FROM public.work_items WHERE id=p_work_item_id AND source_type='care_workflow'
  AND organization_id=p_organization_id AND patient_id=p_patient_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow not authorized'; END IF;
 fence:=public.lock_care_lab_composition(item.id,p_payload->'sources',p_payload->'intent_resolutions');
 SELECT * INTO item FROM public.work_items WHERE id=p_work_item_id;
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=item.id;
 -- A same-UUID preparation may have committed while this request waited for scope.
 SELECT * INTO saved FROM public.care_lab_composition_requests WHERE id=p_request_id;
 IF saved.id IS NOT NULL THEN
  IF saved.actor_id<>(SELECT auth.uid()) OR saved.work_item_id<>item.id OR saved.organization_id<>p_organization_id OR saved.patient_id<>p_patient_id
   OR saved.expected_revision IS DISTINCT FROM p_expected_revision OR saved.expected_ownership_revision IS DISTINCT FROM p_expected_ownership_revision
   OR saved.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Composition request identity conflict'; END IF;
  result:=public.care_lab_composition_request_state(saved.id);
 ELSE
  PERFORM public.require_care_step_owner(item,flow,p_expected_revision,p_expected_ownership_revision);
  PERFORM public.verify_care_lab_composition(item,flow,p_payload,fence);
  INSERT INTO public.care_lab_composition_requests(id,work_item_id,actor_id,organization_id,patient_id,expected_revision,expected_ownership_revision,payload)
  VALUES(p_request_id,item.id,(SELECT auth.uid()),item.organization_id,item.patient_id,p_expected_revision,p_expected_ownership_revision,p_payload);
  result:=public.care_lab_composition_request_state(p_request_id);
 END IF;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false);
 RETURN result;
END $$;

CREATE FUNCTION public.apply_care_lab_composition(p_request_id uuid) RETURNS jsonb
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
 SELECT p.deadline,p.action INTO due,action FROM(
  SELECT public.care_step_instant(saved.payload->'next_review_at') AS deadline,saved.payload->>'next_action' AS action,1 AS tie,'' AS identity
  UNION ALL SELECT e.next_review_at,'Exception: '||e.code||' — '||e.next_action,0,e.id::text FROM public.care_workflow_exceptions e WHERE e.work_item_id=item.id
 ) p ORDER BY p.deadline,p.tie,p.identity LIMIT 1;
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

CREATE FUNCTION public.cancel_care_lab_composition(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_lab_composition_requests; result jsonb;
BEGIN
 PERFORM public.get_care_lab_composition_request(p_request_id);
 SELECT * INTO saved FROM public.care_lab_composition_requests WHERE id=p_request_id;
 IF saved.state='prepared' THEN UPDATE public.care_lab_composition_requests SET state='cancelled',cancelled_at=clock_timestamp() WHERE id=saved.id; END IF;
 result:=public.care_lab_composition_request_state(saved.id);
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false); RETURN result;
END $$;
CREATE FUNCTION public.acknowledge_care_lab_composition(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_lab_composition_requests; result jsonb;
BEGIN
 PERFORM public.get_care_lab_composition_request(p_request_id);
 SELECT * INTO saved FROM public.care_lab_composition_requests WHERE id=p_request_id;
 IF saved.state<>'applied' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Only an applied composition can be acknowledged'; END IF;
 IF saved.acknowledged_at IS NULL THEN UPDATE public.care_lab_composition_requests SET acknowledged_at=clock_timestamp() WHERE id=saved.id; END IF;
 result:=public.care_lab_composition_request_state(saved.id);
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false); RETURN result;
END $$;
CREATE FUNCTION public.list_pending_care_lab_compositions(p_organization_id uuid,p_patient_id uuid,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.lock_care_workflow_scope(p_organization_id,p_patient_id,false);
 WITH candidates AS MATERIALIZED(SELECT id FROM public.care_lab_composition_requests WHERE actor_id=(SELECT auth.uid())
  AND organization_id=p_organization_id AND patient_id=p_patient_id AND state<>'cancelled' AND acknowledged_at IS NULL
  AND(p_after IS NULL OR id>p_after) ORDER BY id LIMIT 26),page AS(SELECT id FROM candidates ORDER BY id LIMIT 25)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.care_lab_composition_request_state(id) ORDER BY id) FROM page),'[]'),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>25 THEN(SELECT max(id::text) FROM page) END) INTO result;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false); RETURN result;
END $$;

CREATE FUNCTION public.require_care_lab_read(p_work uuid) RETURNS public.work_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.work_items;
BEGIN
 SELECT * INTO item FROM public.work_items WHERE id=p_work AND source_type='care_workflow';
 IF item.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow not authorized'; END IF;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false);
 IF item.assigned_to IS DISTINCT FROM(SELECT auth.uid()) AND item.transfer_pending_to IS DISTINCT FROM(SELECT auth.uid())
  AND NOT public.is_org_manager(item.organization_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow not authorized';
 END IF;
 RETURN item;
END $$;
CREATE FUNCTION public.care_lab_current_snapshot(p_work uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE flow public.care_workflows; v_event uuid; v_analyte text; entry public.care_lab_composition_entries;
 root public.lab_observation_roots; head jsonb; result jsonb:='[]'; evaluation text; quality text;
 observed_at timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=p_work;
 v_event:=public.care_lab_current_event(p_work);
 FOR v_analyte IN SELECT a FROM unnest(flow.requested_analytes) a ORDER BY a COLLATE "C" LOOP
  SELECT * INTO entry FROM public.care_lab_composition_entries e WHERE e.event_id=v_event AND e.analyte=v_analyte;
  SELECT * INTO root FROM public.lab_observation_roots WHERE id=entry.root_id;
  head:=CASE WHEN root.id IS NULL THEN NULL ELSE public.lab_observation_head_snapshot(root.id) END;
  SELECT status INTO evaluation FROM public.lab_alert_evaluations WHERE lab_result_id=(head->>'effective_lab_result_id')::uuid;
  quality:=CASE WHEN root.id IS NULL THEN 'missing' WHEN head->>'status'='cancelled' THEN 'cancelled'
   WHEN head->>'value' !~ '^\d+(\.\d+)?$' OR head->>'value' IS NULL OR NOT isfinite((head->>'collected_at')::timestamptz)
    OR(head->>'collected_at')::timestamptz>observed_at THEN 'invalid' ELSE 'available' END;
  result:=result||jsonb_build_object('analyte',v_analyte,'entry_id',entry.id,'root_id',root.id,'authority_organization_id',root.organization_id,
   'original_lab_result_id',root.original_lab_result_id,'observed_version_id',entry.observed_version_id,'head',head,
   'evaluation_status',evaluation,'quality',quality);
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION public.get_care_lab_composition(p_work_item_id uuid) RETURNS jsonb
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
   JOIN public.care_lab_composition_events c ON c.id=e.event_id WHERE c.work_item_id=item.id),
  'clinical_review_recorded',false,'communication_confirmed',false,'care_completed',false);
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
END $$;

-- Minimized routing reads: no peer's intention evidence or submission payload.
CREATE FUNCTION public.list_care_lab_intentions(p_work_item_id uuid,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE item public.work_items; result jsonb;
BEGIN
 item:=public.require_care_lab_read(p_work_item_id);
 PERFORM public.lock_care_workflow_scope(item.organization_id,item.patient_id,false);
 PERFORM id FROM public.work_items WHERE id=item.id FOR SHARE;
 item:=public.require_care_lab_read(item.id);
 WITH candidates AS MATERIALIZED(SELECT id FROM public.lab_followup_submission_intents WHERE work_item_id=item.id AND state='prepared'
  AND(p_after IS NULL OR id>p_after) ORDER BY id LIMIT 26),page AS(SELECT id FROM candidates ORDER BY id LIMIT 25),
 states AS(SELECT p.id,public.lab_followup_intent_state(p.id) AS state FROM page p)
 SELECT jsonb_build_object('work_item_id',item.id,'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('intent_id',id,
  'recorded_at',state->'recorded_at','intended_analytes',state#>'{payload,analytes}','submission',state->'submission') ORDER BY id) FROM states),'[]'),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>25 THEN(SELECT max(id::text) FROM page) END) INTO result;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
END $$;
CREATE FUNCTION public.list_care_lab_invalidations(p_work_item_id uuid,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE item public.work_items; result jsonb;
BEGIN
 item:=public.require_care_lab_read(p_work_item_id);
 PERFORM public.lock_care_workflow_scope(item.organization_id,item.patient_id,false);
 PERFORM id FROM public.work_items WHERE id=item.id FOR SHARE;
 item:=public.require_care_lab_read(item.id);
 WITH candidates AS MATERIALIZED(SELECT i.id,i.entry_id,i.change_version_id,i.recorded_at,e.analyte,e.root_id,e.event_id
  FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries e ON e.id=i.entry_id
  JOIN public.care_lab_composition_events c ON c.id=e.event_id WHERE c.work_item_id=item.id AND(p_after IS NULL OR i.id>p_after)
  ORDER BY i.id LIMIT 26),page AS(SELECT * FROM candidates ORDER BY id LIMIT 25)
 SELECT jsonb_build_object('work_item_id',item.id,'items',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM page p),'[]'),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>25 THEN(SELECT max(id::text) FROM page) END) INTO result;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
END $$;

CREATE FUNCTION public.list_care_lab_composition_history(p_work_item_id uuid,p_after bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE item public.work_items; result jsonb;
BEGIN
 IF p_after IS NOT NULL AND p_after<1 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid composition history cursor'; END IF;
 item:=public.require_care_lab_read(p_work_item_id);
 PERFORM public.lock_care_workflow_scope(item.organization_id,item.patient_id,false);
 PERFORM id FROM public.work_items WHERE id=item.id FOR SHARE;
 item:=public.require_care_lab_read(item.id);
 WITH candidates AS MATERIALIZED(SELECT e.revision,q.payload,q.receipt FROM public.care_lab_composition_events e
  JOIN public.care_lab_composition_requests q ON q.id=e.request_id
  WHERE e.work_item_id=item.id AND(p_after IS NULL OR e.revision>p_after) ORDER BY e.revision LIMIT 26),
 page AS(SELECT * FROM candidates ORDER BY revision LIMIT 25)
 SELECT jsonb_build_object('work_item_id',item.id,'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'payload',p.payload,'receipt',p.receipt) ORDER BY p.revision) FROM page p),'[]'),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>25 THEN(SELECT max(revision)::text FROM page) END) INTO result;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false); RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.lab_followup_intent_state(p_intent uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE i public.lab_followup_submission_intents; a public.lab_submission_attempts;
 r public.lab_submission_receipts; e public.lab_alert_evaluations; recorded jsonb; missing jsonb; reconciliation jsonb;
BEGIN
 SELECT * INTO i FROM public.lab_followup_submission_intents WHERE id=p_intent;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory follow-up intention unavailable'; END IF;
 SELECT * INTO a FROM public.lab_submission_attempts WHERE actor_id=i.actor_id AND patient_id=i.patient_id AND request_id=i.submission_request_id;
 SELECT * INTO r FROM public.lab_submission_receipts WHERE actor_id=i.actor_id AND patient_id=i.patient_id AND request_id=i.submission_request_id;
 IF a.request_id IS NULL OR(a.closed_status='acknowledged' AND(r.lab_result_id IS NULL OR a.acknowledged_lab_result_id IS DISTINCT FROM r.lab_result_id))
  OR(a.closed_status='cancelled' AND r.lab_result_id IS NOT NULL) OR(i.state='cancelled' AND a.closed_status IS DISTINCT FROM 'cancelled') THEN
  RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory submission recovery identity is inconsistent';
 END IF;
 IF r.lab_result_id IS NOT NULL THEN
  SELECT * INTO e FROM public.lab_alert_evaluations WHERE lab_result_id=r.lab_result_id AND patient_id=i.patient_id;
  IF e.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.lab_results WHERE id=r.lab_result_id AND patient_id=i.patient_id)
   OR jsonb_typeof(r.payload)<>'object' OR NOT(r.payload ?& ARRAY['potassium','creatinine','egfr','sodium']) THEN
   RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Saved laboratory receipt is inconsistent';
  END IF;
 END IF;
 SELECT COALESCE(jsonb_agg(key ORDER BY key COLLATE "C"),'[]'::jsonb) INTO recorded
 FROM jsonb_each(COALESCE(r.payload,'{}'::jsonb)) WHERE key IN('potassium','creatinine','egfr','sodium') AND value<>'null'::jsonb;
 SELECT COALESCE(jsonb_agg(value ORDER BY ord),'[]'::jsonb) INTO missing
 FROM jsonb_array_elements(i.payload->'analytes') WITH ORDINALITY a(value,ord) WHERE NOT(recorded ? (value#>>'{}'));
 SELECT jsonb_build_object('event_id',resolution.event_id,'disposition',resolution.disposition,'matched_analytes',resolution.matched_analytes,
  'missing_analytes',resolution.missing_analytes,'recorded_at',resolution.recorded_at) INTO reconciliation
 FROM public.lab_followup_intent_resolutions resolution WHERE resolution.intent_id=i.id;
 IF (i.state='reconciled') IS DISTINCT FROM (reconciliation IS NOT NULL) THEN
  RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Intention reconciliation state is inconsistent';
 END IF;
 RETURN jsonb_build_object('intent_id',i.id,'actor_id',i.actor_id,'organization_id',i.organization_id,'patient_id',i.patient_id,
  'work_item_id',i.work_item_id,'submission_request_id',i.submission_request_id,'expected_revision',i.expected_revision::text,
  'expected_ownership_revision',i.expected_ownership_revision::text,'payload',i.payload,'state',i.state,
  'recorded_at',i.recorded_at,'cancelled_at',i.cancelled_at,'reconciled_at',i.reconciled_at,'reconciliation',reconciliation,
  'result_linked',COALESCE(reconciliation->>'disposition'='linked',false),'clinical_review_recorded',false,'care_completed',false,
  'submission',jsonb_build_object('status',CASE WHEN r.lab_result_id IS NOT NULL THEN CASE WHEN i.state='reconciled' THEN 'saved_reconciled' ELSE 'saved_not_linked' END
   WHEN a.closed_status='cancelled' THEN 'submission_cancelled' ELSE 'awaiting_save' END,
   'lab_result_id',r.lab_result_id,'event_id',e.id,'evaluation_status',e.status,'saved_at',r.created_at,
   'acknowledged_at',CASE WHEN a.closed_status='acknowledged' THEN a.closed_at ELSE NULL END,
   'recorded_analytes',recorded,'missing_analytes',missing));
END $$;

CREATE OR REPLACE FUNCTION public.apply_lab_observation(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.lab_observation_requests; lab public.lab_results; root public.lab_observation_roots;
 typed public.lab_results; snapshot jsonb; version_id uuid; recorded timestamptz; v_receipt jsonb;
 new_lab uuid; source_status text; stored_snapshot jsonb;
BEGIN
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 SELECT * INTO lab FROM public.lab_results WHERE id=saved.original_lab_result_id FOR UPDATE;
 IF NOT FOUND OR lab.patient_id<>saved.patient_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation source not authorized'; END IF;
 PERFORM public.require_original_observation_source(lab.id);
 PERFORM id FROM public.lab_observation_roots WHERE original_lab_result_id=lab.id AND analyte=saved.analyte ORDER BY id FOR UPDATE;
 SELECT * INTO saved FROM public.lab_observation_requests WHERE id=p_request_id FOR UPDATE;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 IF saved.state='applied' THEN RETURN public.lab_observation_request_state(saved.id); END IF;
 IF saved.state='cancelled' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Source registration preparation is cancelled'; END IF;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,true);
 IF saved.command='register_source' THEN
  PERFORM public.validate_observation_registration(saved.payload);
  PERFORM public.observation_source_snapshot(lab,saved.analyte);
  IF saved.source_fingerprint IS DISTINCT FROM public.lab_source_fingerprint(lab) THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Source panel changed after preparation';
  END IF;
  IF EXISTS(SELECT 1 FROM public.lab_observation_roots WHERE id=saved.root_id OR(original_lab_result_id=lab.id AND analyte=saved.analyte)) THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Observation source already registered';
  END IF;
  INSERT INTO public.lab_observation_roots(id,request_id,patient_id,organization_id,original_lab_result_id,analyte,registered_by)
  VALUES(saved.root_id,saved.id,saved.patient_id,saved.organization_id,lab.id,saved.analyte,saved.actor_id);
  INSERT INTO public.lab_observation_versions(root_id,request_id,revision,predecessor_id,lab_result_id,status,actor_id,occurred_at)
  VALUES(saved.root_id,saved.id,1,NULL,lab.id,'original',saved.actor_id,(saved.payload->>'occurred_at')::timestamptz)
  RETURNING id,recorded_at INTO version_id,recorded;
  v_receipt:=jsonb_build_object('request_id',saved.id,'root_id',saved.root_id,'version_id',version_id,'revision','1',
   'original_lab_result_id',lab.id,'analyte',saved.analyte,'recorded_at',recorded,'source_authority_registered',true,
   'order_authorship_confirmed',false,'clinical_review_recorded',false,'care_completed',false);
 ELSE
  SELECT * INTO root FROM public.lab_observation_roots WHERE id=saved.root_id;
  IF root.id IS NULL OR root.organization_id<>saved.organization_id OR root.patient_id<>saved.patient_id
   OR root.original_lab_result_id<>lab.id OR root.analyte<>saved.analyte THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Observation source authority not authorized';
  END IF;
  typed:=public.validate_observation_change(saved.command,saved.payload,saved.analyte);
  snapshot:=public.lab_observation_head_snapshot(root.id);
  IF (snapshot->>'revision')::bigint<>saved.expected_revision
   OR saved.source_fingerprint IS DISTINCT FROM public.lab_observation_head_fingerprint(lab,snapshot) THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Observation revision changed';
  END IF;
  IF saved.command='cancel_source' AND snapshot->>'status'='cancelled' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Observation is already cancelled';
  END IF;
  IF saved.command='correct_source' THEN
   -- Only the chosen typed field is nonnull. Never copy order authorship or private reason into public notes.
   INSERT INTO public.lab_results(patient_id,collected_at,potassium,creatinine,egfr,bun,bnp,nt_probnp,hba1c,glucose,
    sodium,hemoglobin,ferritin,tsat,ldl,ordered_by,notes,lab_facility)
   VALUES(saved.patient_id,typed.collected_at,typed.potassium,typed.creatinine,typed.egfr,typed.bun,typed.bnp,typed.nt_probnp,
    typed.hba1c,typed.glucose,typed.sodium,typed.hemoglobin,typed.ferritin,typed.tsat,typed.ldl,NULL,NULL,NULL)
   RETURNING id INTO new_lab;
   source_status:='corrected';
   stored_snapshot:=jsonb_build_object('value',to_jsonb(typed)->>saved.analyte,'collected_at',typed.collected_at);
  ELSE
   source_status:='cancelled';
   stored_snapshot:=jsonb_build_object('value',NULL,'collected_at',snapshot->'collected_at');
  END IF;
  INSERT INTO public.lab_observation_versions(root_id,request_id,revision,predecessor_id,lab_result_id,status,actor_id,occurred_at)
  VALUES(saved.root_id,saved.id,saved.expected_revision+1,(snapshot->>'version_id')::uuid,new_lab,source_status,
   saved.actor_id,public.care_step_instant(saved.payload->'occurred_at'))
  RETURNING id,recorded_at INTO version_id,recorded;
  INSERT INTO public.lab_observation_change_events(version_id,root_id,request_id) VALUES(version_id,root.id,saved.id);
  v_receipt:=jsonb_build_object('request_id',saved.id,'root_id',root.id,'version_id',version_id,
   'revision',(saved.expected_revision+1)::text,'previous_version_id',snapshot->>'version_id','original_lab_result_id',lab.id,
   'analyte',saved.analyte,'status',source_status,'effective_lab_result_id',new_lab,'stored_source',stored_snapshot,
   'evaluation_status',CASE WHEN new_lab IS NOT NULL THEN 'pending' ELSE NULL END,
   'recorded_at',recorded,'source_change_recorded',true,'work_invalidation_recorded',true,
   'order_authorship_confirmed',false,'clinical_review_recorded',false,'care_completed',false);
 END IF;
 UPDATE public.lab_observation_requests SET state='applied',applied_at=recorded,receipt=v_receipt WHERE id=saved.id;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,true);
 RETURN public.lab_observation_request_state(saved.id);
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'guard_care_composition_history','guard_new_command_against_composition','care_lab_current_event','fanout_care_lab_source_change',
  'validate_care_lab_payload','lock_care_lab_composition','verify_care_lab_composition','care_lab_composition_request_state',
  'get_care_lab_composition_request','prepare_care_lab_composition','apply_care_lab_composition','cancel_care_lab_composition',
  'acknowledge_care_lab_composition','list_pending_care_lab_compositions','require_care_lab_read','care_lab_current_snapshot',
  'get_care_lab_composition','list_care_lab_intentions','list_care_lab_invalidations','list_care_lab_composition_history') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.get_care_lab_composition_request(uuid),
 public.prepare_care_lab_composition(uuid,uuid,uuid,uuid,bigint,bigint,jsonb),public.apply_care_lab_composition(uuid),
 public.cancel_care_lab_composition(uuid),public.acknowledge_care_lab_composition(uuid),public.list_pending_care_lab_compositions(uuid,uuid,uuid),
 public.get_care_lab_composition(uuid),public.list_care_lab_intentions(uuid,uuid),public.list_care_lab_invalidations(uuid,uuid),
 public.list_care_lab_composition_history(uuid,bigint) TO authenticated;
COMMENT ON TABLE public.care_lab_source_invalidations IS
 'Atomic per-current-composition source-change evidence. No work lock/FK, automatic reopening, clinical review, contact or resolution.';
