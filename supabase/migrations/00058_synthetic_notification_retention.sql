-- Synthetic-only lifecycle. Existing/unregistered work stays protected. No
-- clinical/source/account deletion, backfill, transport, or automatic activation.
CREATE TABLE public.notification_retention_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 scan_after uuid
);
INSERT INTO public.notification_retention_policy(singleton) VALUES(true);
CREATE TABLE public.notification_retention_scopes (
 work_item_id uuid PRIMARY KEY REFERENCES public.work_items(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose='disposable_synthetic_test'),
 authorization_id uuid NOT NULL,
 enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 preservation_hold boolean NOT NULL DEFAULT false,
 erased_at timestamptz
);
CREATE TABLE public.notification_erasure_context (
 work_item_id uuid PRIMARY KEY,
 xact_id xid8 NOT NULL
);
CREATE TABLE public.notification_erasure_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 policy text NOT NULL DEFAULT 'synthetic_n2_v1' CHECK(policy='synthetic_n2_v1'),
 reason text NOT NULL CHECK(reason IN('retention_expired','authorized_synthetic_erasure')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 intents_deleted integer NOT NULL CHECK(intents_deleted>=0),
 dispatches_deleted integer NOT NULL CHECK(dispatches_deleted>=0),
 destinations_deleted integer NOT NULL CHECK(destinations_deleted>=0),
 attempts_deleted integer NOT NULL CHECK(attempts_deleted>=0),
 events_deleted integer NOT NULL CHECK(events_deleted>=0)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['notification_retention_policy','notification_retention_scopes',
   'notification_erasure_context','notification_erasure_receipts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
-- This is a technical counter, not clinical evidence. Keep it during erasure,
-- but do not make it an independent obstacle to a separately lawful work delete.
ALTER TABLE public.notification_work_state DROP CONSTRAINT notification_work_state_work_item_id_fkey;
ALTER TABLE public.notification_work_state ADD CONSTRAINT notification_work_state_work_item_id_fkey
 FOREIGN KEY(work_item_id) REFERENCES public.work_items(id) ON DELETE CASCADE;

CREATE FUNCTION public.notification_erasure_authorized(p_work uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.notification_erasure_context
  WHERE work_item_id=p_work AND xact_id=pg_catalog.pg_current_xact_id())
$$;
-- A closed-work signal inserts routing evidence under a work lock without
-- updating the work row. Repeatable snapshots could miss that committed row
-- after waiting. Every lifecycle/preflight entry therefore requires RC.
CREATE FUNCTION public.require_notification_retention_isolation() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Notification lifecycle requires READ COMMITTED';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.guard_notification_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND TG_TABLE_NAME='notification_intents'
  AND public.notification_erasure_authorized(OLD.work_item_id) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='notification_intents' THEN
  IF (to_jsonb(NEW)-ARRAY['state','cancelled_at','cancellation_reason'])
    IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','cancelled_at','cancellation_reason'])
   AND OLD.state IN('pending','blocked') AND NEW.state='cancelled' THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Notification history is immutable';
END $$;
CREATE OR REPLACE FUNCTION public.guard_notification_dispatch_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.notification_intents i
  WHERE i.id=OLD.intent_id AND public.notification_erasure_authorized(i.work_item_id)) THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' OR TG_TABLE_NAME IN('notification_dispatch_destinations','notification_dispatch_events') THEN
  RAISE EXCEPTION 'Notification transport history is immutable';
 END IF;
 IF TG_TABLE_NAME='notification_dispatch_attempts' THEN
  IF (to_jsonb(NEW)-ARRAY['state','code','http_status','started_at','finished_at','lease_token','lease_version','lease_expires_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','code','http_status','started_at','finished_at','lease_token','lease_version','lease_expires_at'])
   OR OLD.state NOT IN('prepared','sending') OR (OLD.state='sending' AND
    (NEW.state NOT IN('accepted','rejected','unknown','not_attempted') OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR ROW(NEW.lease_token,NEW.lease_version,NEW.lease_expires_at) IS DISTINCT FROM ROW(OLD.lease_token,OLD.lease_version,OLD.lease_expires_at))) THEN
   RAISE EXCEPTION 'Notification transport history is immutable';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_notification_dispatch_delete BEFORE DELETE ON public.notification_dispatches
 FOR EACH ROW EXECUTE FUNCTION public.guard_notification_dispatch_history();

CREATE FUNCTION public.enroll_synthetic_notification_work(p_work_id uuid,p_purpose text,p_authorization_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE w public.work_items%ROWTYPE; s public.notification_retention_scopes%ROWTYPE;
BEGIN
 PERFORM public.require_notification_service();
 PERFORM public.require_notification_retention_isolation();
 IF p_purpose IS DISTINCT FROM 'disposable_synthetic_test' OR p_authorization_id IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit synthetic authorization required';
 END IF;
 SELECT * INTO w FROM public.work_items WHERE id=p_work_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Notification work not found'; END IF;
 IF w.created_at<=(SELECT activated_at FROM public.notification_retention_policy WHERE singleton) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Historical work remains protected';
 END IF;
 SELECT * INTO s FROM public.notification_retention_scopes WHERE work_item_id=p_work_id FOR UPDATE;
 IF FOUND THEN
  IF s.authorization_id IS DISTINCT FROM p_authorization_id THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Synthetic authorization cannot be replaced';
  END IF;
  RETURN;
 END IF;
 INSERT INTO public.notification_retention_scopes(work_item_id,purpose,authorization_id)
  VALUES(p_work_id,p_purpose,p_authorization_id);
END $$;
CREATE FUNCTION public.set_synthetic_notification_hold(p_work_id uuid,p_hold boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
BEGIN
 PERFORM public.require_notification_service();
 PERFORM public.require_notification_retention_isolation();
 IF p_hold IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit hold value required'; END IF;
 PERFORM id FROM public.work_items WHERE id=p_work_id FOR UPDATE;
 UPDATE public.notification_retention_scopes SET preservation_hold=p_hold WHERE work_item_id=p_work_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Synthetic scope not found'; END IF;
END $$;

-- Both preflight and execution take the authoritative work lock, then scope,
-- intents and queue. No return to account/source/subscription locks afterward.
CREATE FUNCTION public.check_synthetic_notification_erasure(p_work_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE w public.work_items%ROWTYPE; s public.notification_retention_scopes%ROWTYPE;
 last_activity timestamptz; eligible_at timestamptz; n integer;
BEGIN
 PERFORM public.require_notification_service();
 PERFORM public.require_notification_retention_isolation();
 IF p_reason IS NULL OR p_reason NOT IN('retention_expired','authorized_synthetic_erasure') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid synthetic erasure reason';
 END IF;
 SELECT * INTO w FROM public.work_items WHERE id=p_work_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','missing'); END IF;
 SELECT * INTO s FROM public.notification_retention_scopes WHERE work_item_id=p_work_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','protected'); END IF;
 IF s.preservation_hold THEN RETURN jsonb_build_object('status','held'); END IF;
 IF w.status<>'closed' OR w.closed_at IS NULL THEN RETURN jsonb_build_object('status','open'); END IF;
 -- Source coalescence takes this work lock before inserting a routing exception.
 -- An exception arriving AFTER erasure remains visible; no tombstone silences it.
 IF EXISTS(SELECT 1 FROM public.notification_routing_exceptions WHERE work_item_id=p_work_id) THEN
  RETURN jsonb_build_object('status','routing_pending');
 END IF;
 IF s.erased_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_erased'); END IF;
 SELECT count(*) INTO n FROM public.notification_intents WHERE work_item_id=p_work_id;
 IF n>1000 THEN RETURN jsonb_build_object('status','manual_review'); END IF;
 PERFORM id FROM public.notification_intents WHERE work_item_id=p_work_id ORDER BY id FOR UPDATE;
 PERFORM q.intent_id FROM public.notification_dispatches q JOIN public.notification_intents i ON i.id=q.intent_id
  WHERE i.work_item_id=p_work_id ORDER BY q.intent_id FOR UPDATE OF q;
 PERFORM a.id FROM public.notification_dispatch_attempts a JOIN public.notification_intents i ON i.id=a.intent_id
  WHERE i.work_item_id=p_work_id ORDER BY a.id FOR UPDATE OF a;
 IF EXISTS(SELECT 1 FROM public.notification_intents i LEFT JOIN public.notification_dispatches q ON q.intent_id=i.id
  WHERE i.work_item_id=p_work_id AND (CASE WHEN q.intent_id IS NULL THEN i.state<>'cancelled'
   ELSE q.state NOT IN('accepted','cancelled') END))
  OR EXISTS(SELECT 1 FROM public.notification_dispatch_attempts a JOIN public.notification_intents i ON i.id=a.intent_id
   WHERE i.work_item_id=p_work_id AND a.state IN('sending','unknown')) THEN
  RETURN jsonb_build_object('status','transport_pending');
 END IF;
 IF EXISTS(SELECT 1 FROM public.notification_dispatches q JOIN public.notification_intents i ON i.id=q.intent_id
  WHERE i.work_item_id=p_work_id AND q.lease_expires_at>clock_timestamp()) THEN
  RETURN jsonb_build_object('status','lease_active');
 END IF;
 -- A prepared-but-never-started attempt is eligible only after its queue was
 -- terminally cancelled and its lease expired. Its start RPC can no longer run.
 IF EXISTS(SELECT 1 FROM public.notification_dispatch_attempts a JOIN public.notification_intents i ON i.id=a.intent_id
  JOIN public.notification_dispatches q ON q.intent_id=i.id WHERE i.work_item_id=p_work_id AND a.state='prepared'
   AND (q.state<>'cancelled' OR a.lease_expires_at>clock_timestamp())) THEN
  RETURN jsonb_build_object('status','transport_pending');
 END IF;
 SELECT greatest(w.closed_at,w.updated_at,
  (SELECT max(greatest(captured_at,cancelled_at)) FROM public.notification_intents WHERE work_item_id=p_work_id),
  (SELECT max(q.updated_at) FROM public.notification_dispatches q JOIN public.notification_intents i ON i.id=q.intent_id WHERE i.work_item_id=p_work_id),
  (SELECT max(greatest(a.created_at,a.finished_at)) FROM public.notification_dispatch_attempts a JOIN public.notification_intents i ON i.id=a.intent_id WHERE i.work_item_id=p_work_id),
  (SELECT max(e.recorded_at) FROM public.notification_dispatch_events e JOIN public.notification_intents i ON i.id=e.intent_id WHERE i.work_item_id=p_work_id)) INTO last_activity;
 eligible_at:=last_activity+CASE p_reason WHEN 'retention_expired' THEN interval '30 days' ELSE interval '2 minutes' END;
 IF eligible_at>clock_timestamp() THEN RETURN jsonb_build_object('status','not_due','eligibleAt',eligible_at); END IF;
 RETURN jsonb_build_object('status','eligible','intents',n,'eligibleAt',eligible_at);
END $$;

CREATE FUNCTION public.erase_synthetic_notification_work(p_work_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE preflight jsonb; ni integer; nq integer; nd integer; na integer; ne integer; receipt uuid;
BEGIN
 preflight:=public.check_synthetic_notification_erasure(p_work_id,p_reason);
 IF preflight->>'status'<>'eligible' THEN RETURN preflight; END IF;
 INSERT INTO public.notification_erasure_context(work_item_id,xact_id) VALUES(p_work_id,pg_catalog.pg_current_xact_id());
 DELETE FROM public.notification_dispatch_events e USING public.notification_intents i WHERE e.intent_id=i.id AND i.work_item_id=p_work_id;
 GET DIAGNOSTICS ne=ROW_COUNT;
 DELETE FROM public.notification_dispatch_attempts a USING public.notification_intents i WHERE a.intent_id=i.id AND i.work_item_id=p_work_id;
 GET DIAGNOSTICS na=ROW_COUNT;
 DELETE FROM public.notification_dispatch_destinations d USING public.notification_intents i WHERE d.intent_id=i.id AND i.work_item_id=p_work_id;
 GET DIAGNOSTICS nd=ROW_COUNT;
 DELETE FROM public.notification_dispatches q USING public.notification_intents i WHERE q.intent_id=i.id AND i.work_item_id=p_work_id;
 GET DIAGNOSTICS nq=ROW_COUNT;
 DELETE FROM public.notification_intents WHERE work_item_id=p_work_id;
 GET DIAGNOSTICS ni=ROW_COUNT;
 UPDATE public.notification_retention_scopes SET erased_at=clock_timestamp() WHERE work_item_id=p_work_id;
 DELETE FROM public.notification_erasure_context WHERE work_item_id=p_work_id;
 INSERT INTO public.notification_erasure_receipts(reason,intents_deleted,dispatches_deleted,destinations_deleted,attempts_deleted,events_deleted)
  VALUES(p_reason,ni,nq,nd,na,ne) RETURNING id INTO receipt;
 RETURN jsonb_build_object('status','erased','receipt',receipt,'intents',ni,'dispatches',nq,'destinations',nd,'attempts',na,'events',ne);
END $$;

-- A cursor avoids starving later scopes behind held/open/uncertain work. Each
-- exact-work operation is revalidated; any SQL fault rolls the whole batch back.
CREATE FUNCTION public.maintain_synthetic_notifications(p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE after_id uuid; target uuid; result jsonb; scanned integer:=0; erased integer:=0; expired integer;
BEGIN
 PERFORM public.require_notification_service();
 PERFORM public.require_notification_retention_isolation();
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid maintenance limit'; END IF;
 SELECT scan_after INTO after_id FROM public.notification_retention_policy WHERE singleton FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','busy'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.notification_retention_scopes WHERE erased_at IS NULL AND (after_id IS NULL OR work_item_id>after_id)) THEN after_id:=NULL; END IF;
 FOR target IN SELECT work_item_id FROM public.notification_retention_scopes
  WHERE erased_at IS NULL AND (after_id IS NULL OR work_item_id>after_id) ORDER BY work_item_id LIMIT p_limit LOOP
  result:=public.erase_synthetic_notification_work(target,'retention_expired');
  scanned:=scanned+1;
  IF result->>'status'='erased' THEN erased:=erased+1; END IF;
  after_id:=target;
 END LOOP;
 UPDATE public.notification_retention_policy SET scan_after=after_id WHERE singleton;
 DELETE FROM public.notification_erasure_receipts WHERE recorded_at<=clock_timestamp()-interval '90 days';
 GET DIAGNOSTICS expired=ROW_COUNT;
 RETURN jsonb_build_object('status','complete','scanned',scanned,'erased',erased,'retained',scanned-erased,'receiptsExpired',expired);
END $$;

-- Fail BEFORE actor-provenance deletion if the tester is also a historical N2
-- subject. Existing clinical/work RESTRICT FKs remain; no blanket account purge.
CREATE FUNCTION public.require_no_notification_subject(p_subject uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
BEGIN
 PERFORM public.require_notification_retention_isolation();
 PERFORM w.id FROM public.work_items w WHERE w.patient_id=p_subject OR w.assigned_to=p_subject OR w.provider_id=p_subject
  OR EXISTS(SELECT 1 FROM public.notification_intents i WHERE i.work_item_id=w.id AND (i.patient_id=p_subject OR i.recipient_id=p_subject))
  ORDER BY w.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.notification_intents WHERE patient_id=p_subject OR recipient_id=p_subject)
  OR EXISTS(SELECT 1 FROM public.notification_routing_exceptions WHERE patient_id=p_subject) THEN
  RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='Notification subject evidence requires explicit disposition';
 END IF;
END $$;
CREATE FUNCTION public.guard_notification_subject_erasure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM public.require_no_notification_subject(OLD.id); RETURN OLD;
 ELSE PERFORM public.require_no_notification_subject(NEW.actor_id); RETURN NEW; END IF;
END $$;
CREATE TRIGGER guard_notification_subject_erasure BEFORE DELETE ON public.profiles
 FOR EACH ROW EXECUTE FUNCTION public.guard_notification_subject_erasure();
CREATE TRIGGER guard_notification_subject_provenance BEFORE INSERT ON public.lab_provenance_erasures
 FOR EACH ROW EXECUTE FUNCTION public.guard_notification_subject_erasure();

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'notification_erasure_authorized','require_notification_retention_isolation','enroll_synthetic_notification_work','set_synthetic_notification_hold',
  'check_synthetic_notification_erasure','erase_synthetic_notification_work','maintain_synthetic_notifications',
  'require_no_notification_subject','guard_notification_subject_erasure') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.enroll_synthetic_notification_work(uuid,text,uuid),public.set_synthetic_notification_hold(uuid,boolean),
 public.check_synthetic_notification_erasure(uuid,text),public.erase_synthetic_notification_work(uuid,text),public.maintain_synthetic_notifications(integer) TO service_role;
COMMENT ON TABLE public.notification_retention_scopes IS
 'Explicit disposable synthetic work only; legacy and unregistered work protected. Work-linked metadata is pseudonymous, not anonymous. No clinical retention claim.';
COMMENT ON TABLE public.notification_erasure_receipts IS
 'Minimized aggregate erasure receipt retained90days; no subject/work/intent/destination IDs or payload. No proof of delivery or care.';
