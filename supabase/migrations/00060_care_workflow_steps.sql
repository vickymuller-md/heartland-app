-- H06 operational evidence. No clinical review, communication attestation,
-- successful closure, external transmission or source correction is introduced here.
ALTER TABLE public.care_workflows DROP CONSTRAINT care_workflows_stage_check;
ALTER TABLE public.care_workflows ADD CONSTRAINT care_workflows_stage_check CHECK(stage IN(
 'requested','scheduled','collected','accepted','attended','report_received',
 'assistance_requested','response_received','obtained'));
ALTER TABLE public.care_workflows ADD COLUMN next_action text;
ALTER TABLE public.care_workflows ADD COLUMN next_review_at timestamptz;

CREATE TABLE public.care_step_requests (
 id uuid PRIMARY KEY,
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 expected_revision bigint NOT NULL CHECK(expected_revision BETWEEN 1 AND 9223372036854775806),
 expected_ownership_revision bigint NOT NULL CHECK(expected_ownership_revision>=0),
 command text NOT NULL CHECK(command IN('record_schedule','record_collection','record_destination_acceptance',
  'record_attendance','record_report','record_assistance_request','record_assistance_response','record_obtained','record_exception')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','applied','cancelled')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), applied_at timestamptz, cancelled_at timestamptz,
 acknowledged_at timestamptz, receipt jsonb,
 CHECK((state='prepared' AND num_nonnulls(applied_at,cancelled_at,acknowledged_at,receipt)=0)
  OR (state='applied' AND applied_at IS NOT NULL AND cancelled_at IS NULL AND receipt IS NOT NULL)
  OR (state='cancelled' AND cancelled_at IS NOT NULL AND num_nonnulls(applied_at,acknowledged_at,receipt)=0))
);
CREATE UNIQUE INDEX care_step_prepared_unique ON public.care_step_requests(actor_id,work_item_id) WHERE state='prepared';
CREATE INDEX care_step_pending_idx ON public.care_step_requests(actor_id,organization_id,patient_id,id);
CREATE TABLE public.care_step_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 request_id uuid UNIQUE NOT NULL REFERENCES public.care_step_requests(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 revision bigint NOT NULL CHECK(revision>=2), ownership_revision bigint NOT NULL CHECK(ownership_revision>=0),
 from_stage text NOT NULL, to_stage text NOT NULL,
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(work_item_id,revision)
);
CREATE TABLE public.care_workflow_exceptions (
 id uuid PRIMARY KEY,
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 origin_event_id uuid NOT NULL REFERENCES public.care_step_events(id) ON DELETE RESTRICT,
 code text NOT NULL CHECK(code IN('no_answer','refused','unable_to_contact','destination_refused','missed_appointment',
  'report_missing','medication_not_obtained','not_performed','cancelled','other','assistance_denied')),
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 1000),
 next_action text NOT NULL CHECK(char_length(btrim(next_action)) BETWEEN 3 AND 500),
 next_review_at timestamptz NOT NULL CHECK(isfinite(next_review_at)),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX care_exception_work_due_idx ON public.care_workflow_exceptions(work_item_id,next_review_at,id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['care_step_requests','care_step_events','care_workflow_exceptions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.guard_care_workflow_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='care_workflows' THEN
  IF public.care_workflow_write_authorized(OLD.work_item_id)
   AND (to_jsonb(NEW)-ARRAY['stage','revision','next_action','next_review_at'])
    IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['stage','revision','next_action','next_review_at']) THEN RETURN NEW; END IF;
 END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME IN('care_workflow_requests','care_step_requests') THEN
  IF (to_jsonb(NEW)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt'])
    IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt']) THEN
   IF OLD.state='prepared' AND NEW.state IN('applied','cancelled') THEN RETURN NEW; END IF;
   IF OLD.state='applied' AND NEW.state='applied' AND OLD.acknowledged_at IS NULL AND NEW.acknowledged_at IS NOT NULL
    AND ROW(OLD.applied_at,OLD.cancelled_at,OLD.receipt) IS NOT DISTINCT FROM ROW(NEW.applied_at,NEW.cancelled_at,NEW.receipt) THEN RETURN NEW; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow history is immutable';
END $$;
CREATE TRIGGER guard_care_step_request BEFORE UPDATE OR DELETE ON public.care_step_requests
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_workflow_history();
CREATE TRIGGER guard_care_step_event BEFORE UPDATE OR DELETE ON public.care_step_events
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_workflow_history();
CREATE TRIGGER guard_care_exception BEFORE UPDATE OR DELETE ON public.care_workflow_exceptions
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_workflow_history();

-- Preserve creation receipts. Existing creation RPC gets a controlled projection initializer.
CREATE FUNCTION public.initialize_care_followup_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.care_workflow_write_authorized(NEW.work_item_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care projection requires a typed command';
 END IF;
 SELECT payload->>'purpose',(payload->>'next_review_at')::timestamptz
 INTO NEW.next_action,NEW.next_review_at FROM public.care_workflow_requests WHERE id=NEW.request_id;
 RETURN NEW;
END $$;
CREATE TRIGGER initialize_care_projection BEFORE INSERT ON public.care_workflows
 FOR EACH ROW EXECUTE FUNCTION public.initialize_care_followup_projection();
INSERT INTO public.care_workflow_write_context(work_item_id,xact_id)
 SELECT work_item_id,pg_catalog.pg_current_xact_id() FROM public.care_workflows;
UPDATE public.care_workflows f SET next_action=r.payload->>'purpose',next_review_at=(r.payload->>'next_review_at')::timestamptz
 FROM public.care_workflow_requests r WHERE r.id=f.request_id;
DELETE FROM public.care_workflow_write_context;
ALTER TABLE public.care_workflows ALTER COLUMN next_action SET NOT NULL;
ALTER TABLE public.care_workflows ALTER COLUMN next_review_at SET NOT NULL;
ALTER TABLE public.care_workflows ADD CONSTRAINT care_workflow_review_finite CHECK(isfinite(next_review_at));

CREATE FUNCTION public.care_step_text(p_value jsonb,p_limit integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT COALESCE(jsonb_typeof(p_value)='string' AND char_length(btrim(p_value#>>'{}'))>=3
  AND char_length(p_value#>>'{}')<=p_limit,false)
$$;
CREATE FUNCTION public.care_step_instant(p_value jsonb) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result timestamptz;
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string'
  OR p_value#>>'{}' !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid care step timestamp';
 END IF;
 BEGIN result:=(p_value#>>'{}')::timestamptz;
 EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid care step timestamp';
 END;
 IF NOT isfinite(result) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid care step timestamp'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.validate_care_step_payload(p_command text,p_payload jsonb,p_fresh boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE detail jsonb; keys text[]; appointment date; instant timestamptz; zone text; occurred timestamptz; due timestamptz;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR NOT(p_payload ?& ARRAY['occurred_at','evidence','next_action','next_review_at','details'])
  OR (p_payload-ARRAY['occurred_at','evidence','next_action','next_review_at','details'])<>'{}'::jsonb
  OR NOT public.care_step_text(p_payload->'evidence',1000) OR NOT public.care_step_text(p_payload->'next_action',500)
  OR jsonb_typeof(p_payload->'details') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid care step payload';
 END IF;
 occurred:=public.care_step_instant(p_payload->'occurred_at'); due:=public.care_step_instant(p_payload->'next_review_at');
 IF occurred>clock_timestamp() OR (p_fresh AND due<=clock_timestamp()) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Verify step occurrence and next review';
 END IF;
 detail:=p_payload->'details';
 keys:=CASE p_command WHEN 'record_schedule' THEN ARRAY['appointment_date','appointment_at','appointment_timezone']
  WHEN 'record_collection' THEN ARRAY[]::text[] WHEN 'record_attendance' THEN ARRAY[]::text[]
  WHEN 'record_destination_acceptance' THEN ARRAY['destination'] WHEN 'record_report' THEN ARRAY['report_reference']
  WHEN 'record_assistance_request' THEN ARRAY['assistance_program','request_reference']
  WHEN 'record_assistance_response' THEN ARRAY['outcome','response_reference'] WHEN 'record_obtained' THEN ARRAY['source']
  WHEN 'record_exception' THEN ARRAY['exception_id','code','reason'] ELSE NULL END;
 IF keys IS NULL OR NOT(detail ?& keys) OR detail-keys<>'{}'::jsonb THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid care step details';
 END IF;
 IF p_command='record_schedule' THEN
  IF jsonb_typeof(detail->'appointment_date') IS DISTINCT FROM 'string'
   OR detail->>'appointment_date' !~ '^\d{4}-\d{2}-\d{2}$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid appointment date';
  END IF;
  BEGIN appointment:=(detail->>'appointment_date')::date;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid appointment date'; END;
  IF NOT isfinite(appointment) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid appointment date'; END IF;
  IF (detail->'appointment_at'='null') IS DISTINCT FROM (detail->'appointment_timezone'='null') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Appointment instant and timezone must be supplied together';
  END IF;
  IF detail->'appointment_at'<>'null'::jsonb THEN
   instant:=public.care_step_instant(detail->'appointment_at'); zone:=detail->>'appointment_timezone';
   IF jsonb_typeof(detail->'appointment_timezone') IS DISTINCT FROM 'string'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=zone AND (name='UTC' OR name LIKE '%/%')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid appointment timezone';
   END IF;
   IF (instant AT TIME ZONE zone)::date<>appointment
    OR (instant AT TIME ZONE zone)<>(detail->>'appointment_at')::timestamp THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Appointment date, wall time and offset must agree with timezone';
   END IF;
  END IF;
 ELSIF p_command='record_destination_acceptance' AND NOT public.care_step_text(detail->'destination',500)
  OR p_command='record_report' AND NOT public.care_step_text(detail->'report_reference',1000)
  OR p_command='record_assistance_request' AND (NOT public.care_step_text(detail->'assistance_program',500)
    OR NOT public.care_step_text(detail->'request_reference',1000))
  OR p_command='record_assistance_response' AND (jsonb_typeof(detail->'outcome') IS DISTINCT FROM 'string'
    OR detail->>'outcome' NOT IN('approved','denied','pending','other') OR NOT public.care_step_text(detail->'response_reference',1000))
  OR p_command='record_obtained' AND (jsonb_typeof(detail->'source') IS DISTINCT FROM 'string'
    OR detail->>'source' NOT IN('patient_report','professional_verification')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid care step details';
 END IF;
 IF p_command='record_exception' THEN
  IF jsonb_typeof(detail->'exception_id') IS DISTINCT FROM 'string'
   OR detail->>'exception_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(detail->'code') IS DISTINCT FROM 'string'
   OR detail->>'code' NOT IN('no_answer','refused','unable_to_contact','destination_refused','missed_appointment',
      'report_missing','medication_not_obtained','not_performed','cancelled','other')
   OR NOT public.care_step_text(detail->'reason',1000) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid care step details';
  END IF;
 END IF;
END $$;

CREATE FUNCTION public.care_step_target_stage(p_kind text,p_stage text,p_command text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result text;
BEGIN
 result:=CASE
  WHEN p_command='record_exception' THEN p_stage
  WHEN p_command='record_schedule' AND ((p_kind='laboratory_order' AND p_stage='requested') OR (p_kind='referral' AND p_stage='accepted')) THEN 'scheduled'
  WHEN p_command='record_collection' AND p_kind='laboratory_order' AND p_stage IN('requested','scheduled') THEN 'collected'
  WHEN p_command='record_destination_acceptance' AND p_kind='referral' AND p_stage='requested' THEN 'accepted'
  WHEN p_command='record_attendance' AND p_kind='referral' AND p_stage='scheduled' THEN 'attended'
  WHEN p_command='record_report' AND p_kind='referral' AND p_stage='attended' THEN 'report_received'
  WHEN p_command='record_assistance_request' AND p_kind='medication_access' AND p_stage='requested' THEN 'assistance_requested'
  WHEN p_command='record_assistance_response' AND p_kind='medication_access' AND p_stage IN('assistance_requested','response_received') THEN 'response_received'
  WHEN p_command='record_obtained' AND p_kind='medication_access' AND p_stage='response_received' THEN 'obtained' END;
 IF result IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Care step is not allowed at the current stage'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.require_care_step_owner(p_item public.work_items,p_flow public.care_workflows,
 p_revision bigint,p_ownership_revision bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_item.assigned_to IS DISTINCT FROM (SELECT auth.uid()) OR p_item.accepted_by IS DISTINCT FROM (SELECT auth.uid())
  OR p_item.accepted_at IS NULL OR p_item.transfer_pending_to IS NOT NULL OR p_item.status='closed' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current accepted owner without pending transfer required';
 END IF;
 IF p_revision IS NULL OR p_ownership_revision IS NULL OR p_flow.revision<>p_revision
  OR p_item.ownership_revision<>p_ownership_revision THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Care or ownership revision changed';
 END IF;
END $$;
CREATE FUNCTION public.care_step_request_state(p_request uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('request_id',id,'work_item_id',work_item_id,'actor_id',actor_id,'organization_id',organization_id,
  'patient_id',patient_id,'expected_revision',expected_revision::text,'expected_ownership_revision',expected_ownership_revision::text,
  'command',command,'payload',payload,'state',state,'recorded_at',recorded_at,'acknowledged_at',acknowledged_at,'receipt',receipt)
 FROM public.care_step_requests WHERE id=p_request
$$;

CREATE FUNCTION public.prepare_care_step(p_request_id uuid,p_work_item_id uuid,p_expected_revision bigint,
 p_expected_ownership_revision bigint,p_command text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE item public.work_items%ROWTYPE; flow public.care_workflows%ROWTYPE; saved public.care_step_requests%ROWTYPE;
BEGIN
 SELECT * INTO item FROM public.work_items WHERE id=p_work_item_id AND source_type='care_workflow';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(item.organization_id,item.patient_id,false);
 SELECT * INTO item FROM public.work_items WHERE id=p_work_item_id FOR UPDATE;
 SELECT * INTO flow FROM public.care_workflows WHERE work_item_id=p_work_item_id FOR UPDATE;
 SELECT * INTO saved FROM public.care_step_requests WHERE id=p_request_id FOR UPDATE;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false);
 IF saved.id IS NOT NULL THEN
  IF saved.actor_id<>(SELECT auth.uid()) OR saved.work_item_id<>p_work_item_id OR saved.command IS DISTINCT FROM p_command
   OR saved.expected_revision IS DISTINCT FROM p_expected_revision OR saved.expected_ownership_revision IS DISTINCT FROM p_expected_ownership_revision
   OR saved.payload IS DISTINCT FROM p_payload THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Care step request identity conflict';
  END IF;
  RETURN public.care_step_request_state(saved.id);
 END IF;
 PERFORM public.require_care_step_owner(item,flow,p_expected_revision,p_expected_ownership_revision);
 PERFORM public.validate_care_step_payload(p_command,p_payload,true);
 PERFORM public.care_step_target_stage(flow.kind,flow.stage,p_command);
 IF p_request_id IS NULL OR p_expected_revision NOT BETWEEN 1 AND 9223372036854775806 OR p_expected_ownership_revision<0 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid care step identity';
 END IF;
 IF EXISTS(SELECT 1 FROM public.care_step_requests WHERE actor_id=(SELECT auth.uid()) AND work_item_id=p_work_item_id AND state='prepared') THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Recover or cancel the pending care step first';
 END IF;
 INSERT INTO public.care_step_requests(id,work_item_id,actor_id,organization_id,patient_id,expected_revision,expected_ownership_revision,command,payload)
 VALUES(p_request_id,item.id,(SELECT auth.uid()),item.organization_id,item.patient_id,p_expected_revision,p_expected_ownership_revision,p_command,p_payload);
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false);
 RETURN public.care_step_request_state(p_request_id);
END $$;

CREATE FUNCTION public.apply_care_step(p_request_id uuid) RETURNS jsonb
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
 SELECT pending.deadline,pending.action INTO due,next_action FROM (
  SELECT public.care_step_instant(saved.payload->'next_review_at') AS deadline,saved.payload->>'next_action' AS action,1 AS tie,'' AS identity
  UNION ALL SELECT e.next_review_at,'Exception: '||e.code||' — '||e.next_action,0,e.id::text
   FROM public.care_workflow_exceptions e WHERE e.work_item_id=item.id
 ) pending ORDER BY pending.deadline,pending.tie,pending.identity LIMIT 1;
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

CREATE FUNCTION public.get_care_step_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_step_requests%ROWTYPE;
BEGIN
 SELECT * INTO saved FROM public.care_step_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care step not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 RETURN public.care_step_request_state(saved.id);
END $$;
CREATE FUNCTION public.list_pending_care_steps(p_organization_id uuid,p_patient_id uuid,p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.lock_care_workflow_scope(p_organization_id,p_patient_id,false);
 WITH candidates AS MATERIALIZED(SELECT id FROM public.care_step_requests WHERE actor_id=(SELECT auth.uid())
  AND organization_id=p_organization_id AND patient_id=p_patient_id AND state<>'cancelled' AND acknowledged_at IS NULL
  AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT 26), page AS(SELECT id FROM candidates ORDER BY id LIMIT 25)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.care_step_request_state(id) ORDER BY id) FROM page),'[]'),
  'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>25 THEN (SELECT max(id::text) FROM page) END) INTO result;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
 RETURN result;
END $$;
CREATE FUNCTION public.cancel_care_step(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_step_requests%ROWTYPE;
BEGIN
 SELECT * INTO saved FROM public.care_step_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care step not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 SELECT * INTO saved FROM public.care_step_requests WHERE id=p_request_id FOR UPDATE;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 IF saved.state='prepared' THEN UPDATE public.care_step_requests SET state='cancelled',cancelled_at=clock_timestamp() WHERE id=saved.id; END IF;
 RETURN public.care_step_request_state(saved.id);
END $$;
CREATE FUNCTION public.acknowledge_care_step(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_step_requests%ROWTYPE;
BEGIN
 SELECT * INTO saved FROM public.care_step_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care step not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 SELECT * INTO saved FROM public.care_step_requests WHERE id=p_request_id FOR UPDATE;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 IF saved.state<>'applied' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Only an applied step can be acknowledged'; END IF;
 IF saved.acknowledged_at IS NULL THEN UPDATE public.care_step_requests SET acknowledged_at=clock_timestamp() WHERE id=saved.id; END IF;
 RETURN public.care_step_request_state(saved.id);
END $$;

-- Keep the existing 00059 JSON contract and add explicit operational evidence.
CREATE FUNCTION public.get_care_workflow_steps(p_work_item_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE result jsonb;
BEGIN
 result:=public.get_care_workflow(p_work_item_id);
 SELECT result||jsonb_build_object('next_action',f.next_action,'next_review_at',f.next_review_at,
  'work_status',w.status,'accepted_by',w.accepted_by,'transfer_pending_to',w.transfer_pending_to,
  'steps',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'actor_id',e.actor_id,'revision',e.revision::text,
   'ownership_revision',e.ownership_revision::text,'from_stage',e.from_stage,'to_stage',e.to_stage,
   'occurred_at',e.occurred_at,'recorded_at',e.recorded_at,'command',r.command,'payload',r.payload) ORDER BY e.revision)
   FROM public.care_step_events e JOIN public.care_step_requests r ON r.id=e.request_id WHERE e.work_item_id=f.work_item_id),'[]'),
  'exceptions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'origin_event_id',e.origin_event_id,'code',e.code,
   'reason',e.reason,'next_action',e.next_action,'next_review_at',e.next_review_at,'recorded_at',e.recorded_at) ORDER BY e.next_review_at,e.id)
   FROM public.care_workflow_exceptions e WHERE e.work_item_id=f.work_item_id),'[]')) INTO result
 FROM public.care_workflows f JOIN public.work_items w ON w.id=f.work_item_id WHERE f.work_item_id=p_work_item_id;
 PERFORM public.require_care_workflow_scope((result->>'organization_id')::uuid,(result->>'patient_id')::uuid,false);
 RETURN result;
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'initialize_care_followup_projection','care_step_text','care_step_instant','validate_care_step_payload','care_step_target_stage',
  'require_care_step_owner','care_step_request_state','prepare_care_step','apply_care_step','get_care_step_request',
  'list_pending_care_steps','cancel_care_step','acknowledge_care_step','get_care_workflow_steps') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.prepare_care_step(uuid,uuid,bigint,bigint,text,jsonb),public.apply_care_step(uuid),
 public.get_care_step_request(uuid),public.list_pending_care_steps(uuid,uuid,uuid),public.cancel_care_step(uuid),
 public.acknowledge_care_step(uuid),public.get_care_workflow_steps(uuid) TO authenticated;
