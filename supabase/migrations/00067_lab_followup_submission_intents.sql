-- Durable pre-save intention only. No source association, review or completed care.
CREATE TABLE public.lab_followup_submission_intents (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 submission_request_id uuid NOT NULL,
 expected_revision bigint NOT NULL CHECK(expected_revision>=1),
 expected_ownership_revision bigint NOT NULL CHECK(expected_ownership_revision>=0),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','cancelled')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 cancelled_at timestamptz CHECK(cancelled_at IS NULL OR isfinite(cancelled_at)),
 CHECK((state='cancelled')=(cancelled_at IS NOT NULL)),
 UNIQUE(actor_id,patient_id,submission_request_id),
 FOREIGN KEY(actor_id,patient_id,submission_request_id)
  REFERENCES public.lab_submission_attempts(actor_id,patient_id,request_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX lab_followup_intent_open_work ON public.lab_followup_submission_intents(actor_id,work_item_id) WHERE state='prepared';
CREATE INDEX lab_followup_intent_pending ON public.lab_followup_submission_intents(actor_id,organization_id,patient_id,id) WHERE state='prepared';
ALTER TABLE public.lab_followup_submission_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_followup_submission_intents FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.guard_lab_followup_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.state='prepared' AND NEW.state='cancelled' AND NEW.cancelled_at IS NOT NULL
  AND (to_jsonb(OLD)-ARRAY['state','cancelled_at']) IS NOT DISTINCT FROM (to_jsonb(NEW)-ARRAY['state','cancelled_at'])
  AND OLD.actor_id=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM public.lab_submission_attempts a
   WHERE a.actor_id=OLD.actor_id AND a.patient_id=OLD.patient_id AND a.request_id=OLD.submission_request_id AND a.closed_status='cancelled')
  AND NOT EXISTS(SELECT 1 FROM public.lab_submission_receipts r
   WHERE r.actor_id=OLD.actor_id AND r.patient_id=OLD.patient_id AND r.request_id=OLD.submission_request_id) THEN
  PERFORM public.require_care_workflow_scope(OLD.organization_id,OLD.patient_id,false);
  RETURN NEW;
 END IF;
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory follow-up intention is immutable';
END $$;
CREATE TRIGGER guard_lab_followup_intent BEFORE UPDATE OR DELETE ON public.lab_followup_submission_intents
 FOR EACH ROW EXECUTE FUNCTION public.guard_lab_followup_intent();

-- The existing step RPC already holds scope/work locks. Never acquire lab keys here.
CREATE FUNCTION public.guard_step_against_lab_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.lab_followup_submission_intents i
  WHERE i.actor_id=NEW.actor_id AND i.work_item_id=NEW.work_item_id AND i.state='prepared') THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover or reconcile the laboratory follow-up intention first';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_step_against_lab_intent BEFORE INSERT ON public.care_step_requests
 FOR EACH ROW EXECUTE FUNCTION public.guard_step_against_lab_intent();

CREATE FUNCTION public.lock_lab_followup_intent_scope(p_org uuid,p_patient uuid,p_submission uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE actor uuid:=(SELECT auth.uid());
BEGIN
 PERFORM public.require_care_workflow_scope(p_org,p_patient,false);
 IF p_submission IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Exact laboratory submission required'; END IF;
 -- Same order and keys as 00038, before care acquires any row locks.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('heartland:lab-submission:'||actor||':'||p_patient,0));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('heartland:lab-submit:'||actor||':'||p_patient||':'||p_submission,0));
 PERFORM public.lock_care_workflow_scope(p_org,p_patient,false);
 PERFORM request_id FROM public.lab_submission_attempts
  WHERE actor_id=actor AND patient_id=p_patient AND request_id=p_submission FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory submission intention not authorized'; END IF;
 PERFORM public.require_care_workflow_scope(p_org,p_patient,false);
END $$;

CREATE FUNCTION public.validate_lab_followup_intent(p_payload jsonb,p_requested text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE occurred timestamptz;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR (p_payload-ARRAY['analytes','evidence','occurred_at'])<>'{}'::jsonb
  OR NOT(p_payload ?& ARRAY['analytes','evidence','occurred_at'])
  OR NOT public.care_step_text(p_payload->'evidence',1000)
  OR jsonb_typeof(p_payload->'analytes') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid laboratory follow-up intention';
 END IF;
 IF jsonb_array_length(p_payload->'analytes') NOT BETWEEN 1 AND 4
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'analytes') a WHERE jsonb_typeof(a)<>'string'
   OR a#>>'{}' NOT IN('potassium','creatinine','egfr','sodium') OR NOT((a#>>'{}')=ANY(p_requested)))
  OR (SELECT count(DISTINCT a) FROM jsonb_array_elements(p_payload->'analytes') a)<>jsonb_array_length(p_payload->'analytes') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Intended analytes must be unique, requested and supported by submission';
 END IF;
 occurred:=public.care_step_instant(p_payload->'occurred_at');
 IF occurred>clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Intention occurrence cannot be future'; END IF;
END $$;

-- Private stable read: no lab advisory acquired after scope/work locks. Never use latest lab.
CREATE FUNCTION public.lab_followup_intent_state(p_intent uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE i public.lab_followup_submission_intents; a public.lab_submission_attempts;
 r public.lab_submission_receipts; e public.lab_alert_evaluations; recorded jsonb; missing jsonb;
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
 RETURN jsonb_build_object('intent_id',i.id,'actor_id',i.actor_id,'organization_id',i.organization_id,'patient_id',i.patient_id,
  'work_item_id',i.work_item_id,'submission_request_id',i.submission_request_id,'expected_revision',i.expected_revision::text,
  'expected_ownership_revision',i.expected_ownership_revision::text,'payload',i.payload,'state',i.state,
  'recorded_at',i.recorded_at,'cancelled_at',i.cancelled_at,'result_linked',false,'clinical_review_recorded',false,'care_completed',false,
  'submission',jsonb_build_object('status',CASE WHEN r.lab_result_id IS NOT NULL THEN 'saved_not_linked'
   WHEN a.closed_status='cancelled' THEN 'submission_cancelled' ELSE 'awaiting_save' END,
   'lab_result_id',r.lab_result_id,'event_id',e.id,'evaluation_status',e.status,'saved_at',r.created_at,
   'acknowledged_at',CASE WHEN a.closed_status='acknowledged' THEN a.closed_at ELSE NULL END,
   'recorded_analytes',recorded,'missing_analytes',missing));
END $$;

CREATE FUNCTION public.prepare_lab_followup_intent(p_intent_id uuid,p_work_item_id uuid,p_organization_id uuid,p_patient_id uuid,
 p_submission_request_id uuid,p_expected_revision bigint,p_expected_ownership_revision bigint,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET timezone='UTC' AS $$
DECLARE item public.work_items; flow public.care_workflows; saved public.lab_followup_submission_intents; a public.lab_submission_attempts; result jsonb;
BEGIN
 PERFORM public.lock_lab_followup_intent_scope(p_organization_id,p_patient_id,p_submission_request_id);
 SELECT * INTO item FROM public.work_items WHERE id=p_work_item_id AND source_type='care_workflow'
  AND organization_id=p_organization_id AND patient_id=p_patient_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow not authorized'; END IF;
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=item.id FOR UPDATE;
 SELECT * INTO saved FROM public.lab_followup_submission_intents WHERE id=p_intent_id FOR UPDATE;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
 IF saved.id IS NOT NULL THEN
  IF saved.actor_id<>(SELECT auth.uid()) OR saved.organization_id<>p_organization_id OR saved.patient_id<>p_patient_id
   OR saved.work_item_id<>p_work_item_id OR saved.submission_request_id<>p_submission_request_id
   OR saved.expected_revision IS DISTINCT FROM p_expected_revision OR saved.expected_ownership_revision IS DISTINCT FROM p_expected_ownership_revision
   OR saved.payload IS DISTINCT FROM p_payload THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Laboratory intention identity conflict';
  END IF;
  result:=public.lab_followup_intent_state(saved.id);
  PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
  RETURN result;
 END IF;
 IF p_intent_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Intention identity required'; END IF;
 PERFORM public.require_care_step_owner(item,flow,p_expected_revision,p_expected_ownership_revision);
 IF flow.kind<>'laboratory_order' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Laboratory workflow required'; END IF;
 PERFORM public.validate_lab_followup_intent(p_payload,flow.requested_analytes);
 SELECT * INTO a FROM public.lab_submission_attempts WHERE actor_id=(SELECT auth.uid()) AND patient_id=p_patient_id AND request_id=p_submission_request_id;
 IF a.closed_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.lab_submission_receipts
  WHERE actor_id=(SELECT auth.uid()) AND patient_id=p_patient_id AND request_id=p_submission_request_id) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Pre-save intention requires an unsaved open laboratory attempt';
 END IF;
 IF EXISTS(SELECT 1 FROM public.care_step_requests WHERE actor_id=(SELECT auth.uid()) AND work_item_id=item.id AND state='prepared') THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover or cancel the pending care step first';
 END IF;
 INSERT INTO public.lab_followup_submission_intents(id,actor_id,organization_id,patient_id,work_item_id,submission_request_id,
  expected_revision,expected_ownership_revision,payload)
 VALUES(p_intent_id,(SELECT auth.uid()),p_organization_id,p_patient_id,item.id,p_submission_request_id,p_expected_revision,p_expected_ownership_revision,p_payload);
 result:=public.lab_followup_intent_state(p_intent_id);
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
 RETURN result;
END $$;

CREATE FUNCTION public.get_lab_followup_intent(p_intent_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.lab_followup_submission_intents; result jsonb;
BEGIN
 SELECT * INTO saved FROM public.lab_followup_submission_intents WHERE id=p_intent_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory intention not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 result:=public.lab_followup_intent_state(saved.id);
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 RETURN result;
END $$;
CREATE FUNCTION public.list_pending_lab_followup_intents(p_organization_id uuid,p_patient_id uuid,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.lock_care_workflow_scope(p_organization_id,p_patient_id,false);
 WITH candidates AS MATERIALIZED(SELECT id FROM public.lab_followup_submission_intents
  WHERE actor_id=(SELECT auth.uid()) AND organization_id=p_organization_id AND patient_id=p_patient_id AND state='prepared'
   AND(p_after IS NULL OR id>p_after) ORDER BY id LIMIT 26), page AS(SELECT id FROM candidates ORDER BY id LIMIT 25)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.lab_followup_intent_state(id) ORDER BY id) FROM page),'[]'::jsonb),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>25 THEN(SELECT max(id::text) FROM page) ELSE NULL END) INTO result;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
 RETURN result;
END $$;
CREATE FUNCTION public.cancel_lab_followup_intent(p_intent_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.lab_followup_submission_intents; a public.lab_submission_attempts; result jsonb;
BEGIN
 SELECT * INTO saved FROM public.lab_followup_submission_intents WHERE id=p_intent_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory intention not authorized'; END IF;
 PERFORM public.lock_lab_followup_intent_scope(saved.organization_id,saved.patient_id,saved.submission_request_id);
 SELECT * INTO saved FROM public.lab_followup_submission_intents WHERE id=p_intent_id FOR UPDATE;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 IF saved.state='prepared' AND NOT EXISTS(SELECT 1 FROM public.lab_submission_receipts
  WHERE actor_id=saved.actor_id AND patient_id=saved.patient_id AND request_id=saved.submission_request_id) THEN
  SELECT * INTO a FROM public.lab_submission_attempts WHERE actor_id=saved.actor_id AND patient_id=saved.patient_id AND request_id=saved.submission_request_id;
  IF a.closed_status IS NULL THEN
   UPDATE public.lab_submission_attempts SET closed_status='cancelled',closed_at=clock_timestamp()
    WHERE actor_id=saved.actor_id AND patient_id=saved.patient_id AND request_id=saved.submission_request_id;
  ELSIF a.closed_status<>'cancelled' THEN
   RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory cancellation state is inconsistent';
  END IF;
  UPDATE public.lab_followup_submission_intents SET state='cancelled',cancelled_at=clock_timestamp() WHERE id=saved.id;
 END IF;
 result:=public.lab_followup_intent_state(saved.id);
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 RETURN result;
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'guard_lab_followup_intent','guard_step_against_lab_intent','lock_lab_followup_intent_scope','validate_lab_followup_intent',
  'lab_followup_intent_state','prepare_lab_followup_intent','get_lab_followup_intent','list_pending_lab_followup_intents','cancel_lab_followup_intent') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.prepare_lab_followup_intent(uuid,uuid,uuid,uuid,uuid,bigint,bigint,jsonb),
 public.get_lab_followup_intent(uuid),public.list_pending_lab_followup_intents(uuid,uuid,uuid),public.cancel_lab_followup_intent(uuid) TO authenticated;
COMMENT ON TABLE public.lab_followup_submission_intents IS
 'Pre-save laboratory-to-work intention; saved_not_linked remains pending even after save ACK. Not result association, source authority, review or care completion.';
