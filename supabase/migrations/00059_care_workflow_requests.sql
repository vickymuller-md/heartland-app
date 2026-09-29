-- Local H06 foundation. No transport, source correction, clinical advancement,
-- automatic acceptance or clinical SLA. Ship only with the full workflow client.
ALTER TABLE public.work_items DROP CONSTRAINT work_items_source_type_check;
ALTER TABLE public.work_items ADD CONSTRAINT work_items_source_type_check CHECK(source_type IN(
 'alert','scheduled_followup','discharge_followup','manual','titration','data_quality','care_workflow'));
ALTER TABLE public.work_items DROP CONSTRAINT work_items_accountability_source;
ALTER TABLE public.work_items ADD CONSTRAINT work_items_accountability_source CHECK(accountability_source IS NULL
 OR accountability_source IN('designated','coverage','sole_member','org_owner','accepted_transfer',
 'manager_reassigned','legacy_fan_out','self_requested'));
ALTER TABLE public.work_items ADD CONSTRAINT care_workflow_self_source
 CHECK(accountability_source IS DISTINCT FROM 'self_requested' OR source_type='care_workflow');

CREATE TABLE public.care_workflow_requests (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 work_item_id uuid NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 command text NOT NULL DEFAULT 'record_request' CHECK(command='record_request'),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','applied','cancelled')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 applied_at timestamptz,
 cancelled_at timestamptz,
 acknowledged_at timestamptz,
 receipt jsonb,
 CHECK((state='prepared' AND num_nonnulls(applied_at,cancelled_at,acknowledged_at,receipt)=0)
  OR (state='applied' AND applied_at IS NOT NULL AND cancelled_at IS NULL AND receipt IS NOT NULL)
  OR (state='cancelled' AND cancelled_at IS NOT NULL AND num_nonnulls(applied_at,acknowledged_at,receipt)=0))
);
CREATE UNIQUE INDEX care_workflow_prepared_unique ON public.care_workflow_requests(actor_id,work_item_id) WHERE state='prepared';
CREATE INDEX care_workflow_recovery_idx ON public.care_workflow_requests(actor_id,organization_id,patient_id,id);

CREATE TABLE public.care_workflows (
 work_item_id uuid PRIMARY KEY REFERENCES public.work_items(id) ON DELETE RESTRICT,
 request_id uuid UNIQUE NOT NULL REFERENCES public.care_workflow_requests(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN('laboratory_order','referral','medication_access')),
 requested_analytes text[] NOT NULL,
 stage text NOT NULL DEFAULT 'requested' CHECK(stage='requested'),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.care_workflow_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 work_item_id uuid NOT NULL REFERENCES public.care_workflows(work_item_id) ON DELETE RESTRICT,
 request_id uuid UNIQUE NOT NULL REFERENCES public.care_workflow_requests(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 revision bigint NOT NULL CHECK(revision>=1),
 event_type text NOT NULL CHECK(event_type='request_recorded'),
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(work_item_id,revision)
);
CREATE TABLE public.care_workflow_write_context (
 work_item_id uuid PRIMARY KEY,
 xact_id xid8 NOT NULL
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['care_workflow_requests','care_workflows','care_workflow_events','care_workflow_write_context'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;

CREATE FUNCTION public.require_care_workflow_scope(p_org uuid,p_patient uuid,p_clinical boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Care workflow requires READ COMMITTED';
 END IF;
 PERFORM public.require_work_ownership_scope(p_org,p_patient,NULL,false);
 IF p_clinical AND NOT EXISTS(
  SELECT 1 FROM public.member_authorizations g JOIN public.organization_memberships m ON m.id=g.membership_id
  WHERE m.organization_id=p_org AND m.user_id=(SELECT auth.uid()) AND m.status='active'
   AND g.capability='clinical_disposition' AND g.revoked_at IS NULL
   AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current clinical disposition authority required'; END IF;
END $$;

-- Dedicated helper: clinical grants are locked BEFORE links/patient/work, never
-- acquired after calling an ownership helper that has already reached work.
CREATE FUNCTION public.lock_care_workflow_scope(p_org uuid,p_patient uuid,p_clinical boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE actor uuid:=(SELECT auth.uid());
BEGIN
 PERFORM public.require_care_workflow_scope(p_org,p_patient,p_clinical);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('heartland:work-ownership:'||p_org||':'||p_patient,0));
 PERFORM id FROM public.profiles WHERE id=ANY(ARRAY[actor,p_patient]) ORDER BY id FOR SHARE;
 PERFORM id FROM public.consents WHERE user_id=ANY(ARRAY[actor,p_patient])
  AND consent_type='registration' AND consent_version='v1.0' ORDER BY id FOR SHARE;
 PERFORM id FROM public.organizations WHERE id=p_org FOR SHARE;
 PERFORM id FROM public.organization_memberships WHERE organization_id=p_org AND user_id=actor ORDER BY id FOR SHARE;
 PERFORM g.id FROM public.member_authorizations g JOIN public.organization_memberships m ON m.id=g.membership_id
  WHERE m.organization_id=p_org AND m.user_id=actor AND g.capability IN('monitor','clinical_disposition') ORDER BY g.id FOR SHARE OF g;
 PERFORM id FROM public.provider_patient_links WHERE patient_id=p_patient AND provider_id=actor ORDER BY id FOR SHARE;
 PERFORM id FROM public.organization_patient_assignments WHERE organization_id=p_org AND patient_id=p_patient ORDER BY id FOR SHARE;
 PERFORM id FROM public.patients WHERE id=p_patient FOR KEY SHARE;
 PERFORM public.require_care_workflow_scope(p_org,p_patient,p_clinical);
END $$;

CREATE FUNCTION public.validate_care_request_payload(p_payload jsonb,p_fresh boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE occurred timestamptz; due timestamptz; n integer;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR (p_payload - ARRAY['kind','source','purpose','evidence','occurred_at','next_review_at','analytes'])<>'{}'::jsonb
  OR NOT (p_payload ?& ARRAY['kind','source','purpose','evidence','occurred_at','next_review_at','analytes'])
  OR jsonb_typeof(p_payload->'kind') IS DISTINCT FROM 'string'
  OR p_payload->>'kind' NOT IN('laboratory_order','referral','medication_access')
  OR jsonb_typeof(p_payload->'source') IS DISTINCT FROM 'string'
  OR p_payload->>'source' NOT IN('external_documented','professional_decision')
  OR jsonb_typeof(p_payload->'purpose') IS DISTINCT FROM 'string'
  OR char_length(btrim(p_payload->>'purpose'))<3 OR char_length(p_payload->>'purpose')>1000
  OR jsonb_typeof(p_payload->'evidence') IS DISTINCT FROM 'string'
  OR char_length(btrim(p_payload->>'evidence'))<3 OR char_length(p_payload->>'evidence')>1000
  OR jsonb_typeof(p_payload->'analytes') IS DISTINCT FROM 'array'
  OR jsonb_typeof(p_payload->'occurred_at') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'next_review_at') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid care request';
 END IF;
 IF p_payload->>'occurred_at' !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
  OR p_payload->>'next_review_at' !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Care request timestamps require explicit offsets';
 END IF;
 BEGIN
  occurred:=(p_payload->>'occurred_at')::timestamptz;
  due:=(p_payload->>'next_review_at')::timestamptz;
 EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid care request timestamps';
 END;
 IF NOT isfinite(occurred) OR NOT isfinite(due) OR occurred>clock_timestamp()
  OR (p_fresh AND due<=clock_timestamp()) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Verify occurred time and next review time';
 END IF;
 n:=jsonb_array_length(p_payload->'analytes');
 IF (p_payload->>'kind'='laboratory_order' AND n NOT BETWEEN 1 AND 13)
  OR (p_payload->>'kind'<>'laboratory_order' AND n<>0)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'analytes') AS a(value)
    WHERE jsonb_typeof(value)<>'string' OR value #>> '{}' NOT IN('potassium','creatinine','egfr','bun','bnp',
      'nt_probnp','hba1c','glucose','sodium','hemoglobin','ferritin','tsat','ldl'))
  OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_payload->'analytes'))<>n THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid requested analytes';
 END IF;
END $$;

CREATE FUNCTION public.care_workflow_write_authorized(p_work uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.care_workflow_write_context
  WHERE work_item_id=p_work AND xact_id=pg_catalog.pg_current_xact_id())
$$;
CREATE FUNCTION public.guard_care_work_item() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.source_type='care_workflow' AND NOT public.care_workflow_write_authorized(NEW.id) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Typed care work requires a recoverable command';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.source_type='care_workflow' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow history is protected'; END IF;
  IF ROW(NEW.status,NEW.due_at,NEW.snooze_reason,NEW.outcome,NEW.outcome_code,NEW.reviewed_at,NEW.actioned_at,
    NEW.closed_at,NEW.change_summary,NEW.underlying_alert_resolved_at)
   IS DISTINCT FROM ROW(OLD.status,OLD.due_at,OLD.snooze_reason,OLD.outcome,OLD.outcome_code,OLD.reviewed_at,OLD.actioned_at,
    OLD.closed_at,OLD.change_summary,OLD.underlying_alert_resolved_at)
   AND NOT public.care_workflow_write_authorized(OLD.id) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Advance care through the typed workflow command';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_guard_care_work_item BEFORE INSERT OR UPDATE OR DELETE ON public.work_items
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_work_item();

CREATE FUNCTION public.guard_care_workflow_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='care_workflow_requests' THEN
  IF (to_jsonb(NEW)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt'])
    IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','applied_at','cancelled_at','acknowledged_at','receipt']) THEN
   IF OLD.state='prepared' AND NEW.state IN('applied','cancelled') THEN RETURN NEW; END IF;
   IF OLD.state='applied' AND NEW.state='applied' AND OLD.acknowledged_at IS NULL AND NEW.acknowledged_at IS NOT NULL
    AND ROW(OLD.applied_at,OLD.cancelled_at,OLD.receipt) IS NOT DISTINCT FROM ROW(NEW.applied_at,NEW.cancelled_at,NEW.receipt) THEN
    RETURN NEW;
   END IF;
  END IF;
 END IF;
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow history is immutable';
END $$;
CREATE TRIGGER guard_care_request BEFORE UPDATE OR DELETE ON public.care_workflow_requests
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_workflow_history();
CREATE TRIGGER guard_care_event BEFORE UPDATE OR DELETE ON public.care_workflow_events
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_workflow_history();
CREATE TRIGGER guard_care_workflow BEFORE UPDATE OR DELETE ON public.care_workflows
 FOR EACH ROW EXECUTE FUNCTION public.guard_care_workflow_history();

CREATE FUNCTION public.care_request_state(p_request uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('request_id',id,'actor_id',actor_id,'organization_id',organization_id,
  'patient_id',patient_id,'work_item_id',work_item_id,'payload',payload,'state',state,
  'recorded_at',recorded_at,'acknowledged_at',acknowledged_at,'receipt',receipt)
 FROM public.care_workflow_requests WHERE id=p_request
$$;

CREATE FUNCTION public.prepare_care_workflow_request(p_request_id uuid,p_work_item_id uuid,p_organization_id uuid,
 p_patient_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE actor uuid:=(SELECT auth.uid()); saved public.care_workflow_requests%ROWTYPE;
BEGIN
 IF p_request_id IS NULL OR p_work_item_id IS NULL OR p_organization_id IS NULL OR p_patient_id IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid care request identity';
 END IF;
 PERFORM public.lock_care_workflow_scope(p_organization_id,p_patient_id,false);
  SELECT * INTO saved FROM public.care_workflow_requests WHERE id=p_request_id FOR UPDATE;
  IF FOUND THEN
  PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
  IF saved.actor_id<>actor OR saved.organization_id<>p_organization_id OR saved.patient_id<>p_patient_id
   OR saved.work_item_id<>p_work_item_id OR saved.payload IS DISTINCT FROM p_payload THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Care request identity conflict';
  END IF;
  RETURN public.care_request_state(saved.id);
 END IF;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,p_payload->>'source'='professional_decision');
 PERFORM public.validate_care_request_payload(p_payload,true);
 IF EXISTS(SELECT 1 FROM public.work_items WHERE id=p_work_item_id)
  OR EXISTS(SELECT 1 FROM public.care_workflow_requests WHERE actor_id=actor AND work_item_id=p_work_item_id AND state='prepared') THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Care target already exists or has a pending request';
 END IF;
 INSERT INTO public.care_workflow_requests(id,actor_id,organization_id,patient_id,work_item_id,payload)
 VALUES(p_request_id,actor,p_organization_id,p_patient_id,p_work_item_id,p_payload);
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,p_payload->>'source'='professional_decision');
 RETURN public.care_request_state(p_request_id);
END $$;

CREATE FUNCTION public.apply_care_workflow_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE actor uuid:=(SELECT auth.uid()); saved public.care_workflow_requests%ROWTYPE; context public.care_workflow_requests%ROWTYPE;
 event_id uuid; v_receipt jsonb;
BEGIN
 SELECT * INTO context FROM public.care_workflow_requests WHERE id=p_request_id AND actor_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(context.organization_id,context.patient_id,false);
 -- Foundation creates a new work target only. No source/evaluation path is called here.
 PERFORM id FROM public.work_items WHERE id=context.work_item_id FOR UPDATE;
 SELECT * INTO saved FROM public.care_workflow_requests WHERE id=p_request_id AND actor_id=actor FOR UPDATE;
 PERFORM public.require_care_workflow_scope(context.organization_id,context.patient_id,false);
 IF saved.state='applied' THEN RETURN public.care_request_state(saved.id); END IF;
 IF saved.state='cancelled' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Care request was cancelled'; END IF;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,saved.payload->>'source'='professional_decision');
 PERFORM public.validate_care_request_payload(saved.payload,true);
 IF EXISTS(SELECT 1 FROM public.work_items WHERE id=saved.work_item_id) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Care target already exists or has a pending request';
 END IF;
 INSERT INTO public.care_workflow_write_context(work_item_id,xact_id) VALUES(saved.work_item_id,pg_catalog.pg_current_xact_id());
 INSERT INTO public.work_items(id,patient_id,provider_id,assigned_to,organization_id,source_type,source_id,
  title,reason,priority,severity,status,due_at,data_quality,accountability_source)
 VALUES(saved.work_item_id,saved.patient_id,actor,actor,saved.organization_id,'care_workflow',saved.work_item_id,
  CASE saved.payload->>'kind' WHEN 'laboratory_order' THEN 'Laboratory request' WHEN 'referral' THEN 'Referral follow-up'
   ELSE 'Medication access follow-up' END,saved.payload->>'purpose','watching','informational','new',
  (saved.payload->>'next_review_at')::timestamptz,'unknown','self_requested');
 INSERT INTO public.care_workflows(work_item_id,request_id,kind,requested_analytes)
 VALUES(saved.work_item_id,saved.id,saved.payload->>'kind',ARRAY(SELECT jsonb_array_elements_text(saved.payload->'analytes')));
 INSERT INTO public.care_workflow_events(work_item_id,request_id,actor_id,revision,event_type,occurred_at)
 VALUES(saved.work_item_id,saved.id,actor,1,'request_recorded',(saved.payload->>'occurred_at')::timestamptz)
 RETURNING id INTO event_id;
 v_receipt:=jsonb_build_object('request_id',saved.id,'work_item_id',saved.work_item_id,'event_id',event_id,
  'workflow_revision','1','stage','requested','recorded_at',clock_timestamp(),'acceptance_recorded',false,
  'external_transmission_confirmed',false);
 UPDATE public.care_workflow_requests SET state='applied',applied_at=clock_timestamp(),receipt=v_receipt
  WHERE id=saved.id;
 DELETE FROM public.care_workflow_write_context WHERE work_item_id=saved.work_item_id;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,saved.payload->>'source'='professional_decision');
 RETURN public.care_request_state(saved.id);
END $$;

CREATE FUNCTION public.get_care_workflow_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_workflow_requests%ROWTYPE;
BEGIN
 SELECT * INTO saved FROM public.care_workflow_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 RETURN public.care_request_state(saved.id);
END $$;

CREATE FUNCTION public.list_pending_care_requests(p_organization_id uuid,p_patient_id uuid,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.lock_care_workflow_scope(p_organization_id,p_patient_id,false);
 WITH candidates AS MATERIALIZED(
  SELECT id FROM public.care_workflow_requests WHERE actor_id=(SELECT auth.uid())
   AND organization_id=p_organization_id AND patient_id=p_patient_id AND state<>'cancelled' AND acknowledged_at IS NULL
   AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT 26
 ), page AS(SELECT id FROM candidates ORDER BY id LIMIT 25)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.care_request_state(id) ORDER BY id) FROM page),'[]'::jsonb),
  'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>25 THEN (SELECT max(id::text) FROM page) END) INTO result;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
 RETURN result;
END $$;

CREATE FUNCTION public.cancel_care_workflow_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_workflow_requests%ROWTYPE;
BEGIN
 SELECT * INTO saved FROM public.care_workflow_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 SELECT * INTO saved FROM public.care_workflow_requests WHERE id=p_request_id FOR UPDATE;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 IF saved.state='applied' THEN RETURN public.care_request_state(saved.id); END IF;
 IF saved.state='prepared' THEN
  UPDATE public.care_workflow_requests SET state='cancelled',cancelled_at=clock_timestamp() WHERE id=saved.id;
 END IF;
 RETURN public.care_request_state(saved.id);
END $$;

CREATE FUNCTION public.acknowledge_care_workflow_request(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE saved public.care_workflow_requests%ROWTYPE;
BEGIN
 SELECT * INTO saved FROM public.care_workflow_requests WHERE id=p_request_id AND actor_id=(SELECT auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care request not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 SELECT * INTO saved FROM public.care_workflow_requests WHERE id=p_request_id FOR UPDATE;
 PERFORM public.require_care_workflow_scope(saved.organization_id,saved.patient_id,false);
 IF saved.state<>'applied' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Only an applied receipt can be acknowledged'; END IF;
 IF saved.acknowledged_at IS NULL THEN
  UPDATE public.care_workflow_requests SET acknowledged_at=clock_timestamp() WHERE id=saved.id;
 END IF;
 RETURN public.care_request_state(saved.id);
END $$;

CREATE FUNCTION public.get_care_workflow(p_work_item_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE item public.work_items%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO item FROM public.work_items WHERE id=p_work_item_id AND source_type='care_workflow';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow not authorized'; END IF;
 PERFORM public.lock_care_workflow_scope(item.organization_id,item.patient_id,false);
 -- Follow existing queue visibility; monitoring scope alone does not disclose a peer's work.
 SELECT * INTO item FROM public.work_items WHERE id=p_work_item_id FOR SHARE;
 IF item.assigned_to IS DISTINCT FROM (SELECT auth.uid()) AND item.transfer_pending_to IS DISTINCT FROM (SELECT auth.uid())
  AND NOT public.is_org_manager(item.organization_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Care workflow not authorized';
 END IF;
 SELECT jsonb_build_object('work_item_id',flow.work_item_id,'patient_id',item.patient_id,'organization_id',item.organization_id,
  'assigned_to',item.assigned_to,'accepted_at',item.accepted_at,'ownership_revision',item.ownership_revision::text,
  'due_at',item.due_at,'kind',flow.kind,'stage',flow.stage,'revision',flow.revision::text,
  'requested_analytes',flow.requested_analytes,'request',r.payload,
  'events',(SELECT jsonb_agg(jsonb_build_object('id',e.id,'actor_id',e.actor_id,'revision',e.revision::text,
   'event_type',e.event_type,'occurred_at',e.occurred_at,'recorded_at',e.recorded_at) ORDER BY e.revision)
   FROM public.care_workflow_events e WHERE e.work_item_id=flow.work_item_id)) INTO result
 FROM public.care_workflows flow JOIN public.care_workflow_requests r ON r.id=flow.request_id WHERE flow.work_item_id=item.id;
 PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,false);
 RETURN result;
END $$;

-- Preserve every legacy policy and narrow only new typed-work projections.
CREATE FUNCTION public.care_projection_read_allowed(p_work uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE((SELECT source_type<>'care_workflow' OR public.can_read_work_ownership_receipt(id)
  FROM public.work_items WHERE id=p_work),false)
$$;
CREATE POLICY care_work_current_scope ON public.work_items AS RESTRICTIVE FOR SELECT TO authenticated
 USING(source_type<>'care_workflow' OR public.care_projection_read_allowed(id));
CREATE POLICY care_event_current_scope ON public.work_item_events AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.care_projection_read_allowed(work_item_id));
CREATE POLICY care_delivery_current_scope ON public.notification_deliveries AS RESTRICTIVE FOR SELECT TO authenticated
 USING(work_item_id IS NULL OR public.care_projection_read_allowed(work_item_id));

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'require_care_workflow_scope','lock_care_workflow_scope','validate_care_request_payload','care_workflow_write_authorized',
  'guard_care_work_item','guard_care_workflow_history','care_request_state','prepare_care_workflow_request',
  'apply_care_workflow_request','get_care_workflow_request','list_pending_care_requests','cancel_care_workflow_request',
  'acknowledge_care_workflow_request','get_care_workflow','care_projection_read_allowed') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.prepare_care_workflow_request(uuid,uuid,uuid,uuid,jsonb),
 public.apply_care_workflow_request(uuid),public.get_care_workflow_request(uuid),public.list_pending_care_requests(uuid,uuid,uuid),
 public.cancel_care_workflow_request(uuid),public.acknowledge_care_workflow_request(uuid),public.get_care_workflow(uuid),
 public.care_projection_read_allowed(uuid) TO authenticated;
