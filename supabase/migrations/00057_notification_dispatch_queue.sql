-- N2 transport, inert until explicit service configuration/cutover. No historical
-- enqueue, schedule, clinical timing changes, recipient grants or HTTP in SQL.

CREATE FUNCTION public.require_notification_service() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' OR (SELECT auth.uid()) IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Notification service not authorized';
 END IF;
END $$;

-- This advisory protects an absent preference as well as an existing row.
CREATE FUNCTION public.lock_notification_preference(p_recipient uuid,p_patient uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'heartland:notification-preference:'||p_recipient||':'||p_patient,0))
$$;
REVOKE INSERT,UPDATE,DELETE ON public.alert_preferences FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE col record; BEGIN
 FOR col IN SELECT attname FROM pg_attribute WHERE attrelid='public.alert_preferences'::regclass AND attnum>0 AND NOT attisdropped LOOP
  EXECUTE format('REVOKE INSERT(%I),UPDATE(%I) ON public.alert_preferences FROM PUBLIC,anon,authenticated,service_role',col.attname,col.attname);
 END LOOP;
END $$;
CREATE FUNCTION public.set_alert_notification_preference(p_patient_id uuid,p_alert_type text,p_muted boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
BEGIN
 IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated' OR (SELECT auth.uid()) IS NULL
  OR NOT COALESCE(public.provider_has_patient(p_patient_id),false) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Alert preference not authorized';
 END IF;
 IF p_muted IS NULL OR p_alert_type IS NULL OR p_alert_type NOT IN
  ('weight_gain_3lb_2d','weight_gain_5lb_7d','sbp_low','spo2_low','symptom_red_flag','dyspnea_severe',
   'no_checkin','low_adherence','weight_trend_7d','hyperkalemia','low_egfr','followup_due','followup_overdue')
  OR (p_muted AND p_alert_type IN('sbp_low','spo2_low','hyperkalemia')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid alert preference';
 END IF;
 PERFORM public.lock_notification_preference((SELECT auth.uid()),p_patient_id);
 IF NOT COALESCE(public.provider_has_patient(p_patient_id),false) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Alert preference not authorized';
 END IF;
 INSERT INTO public.alert_preferences(provider_id,patient_id,alert_type,muted)
 VALUES((SELECT auth.uid()),p_patient_id,p_alert_type,p_muted)
 ON CONFLICT(provider_id,patient_id,alert_type) DO UPDATE SET muted=EXCLUDED.muted;
END $$;

ALTER TABLE public.push_subscriptions
 ADD COLUMN notification_version bigint NOT NULL DEFAULT 1 CHECK(notification_version>0),
 ADD COLUMN notification_invalid_at timestamptz,
 ADD COLUMN notification_invalid_reason text CHECK(notification_invalid_reason IN('subscription_expired','invalid_subscription')),
 ADD COLUMN notification_invalid_attempt uuid,
 ADD CONSTRAINT notification_invalid_shape CHECK(
  num_nonnulls(notification_invalid_at,notification_invalid_reason,notification_invalid_attempt) IN(0,3));
CREATE FUNCTION public.version_notification_subscription() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.notification_version:=1;
  NEW.notification_invalid_at:=NULL; NEW.notification_invalid_reason:=NULL; NEW.notification_invalid_attempt:=NULL;
 ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.id IS DISTINCT FROM OLD.id THEN
  RAISE EXCEPTION 'Subscription identity is immutable';
 ELSIF NEW.endpoint IS DISTINCT FROM OLD.endpoint OR NEW.keys IS DISTINCT FROM OLD.keys THEN
  NEW.notification_version:=OLD.notification_version+1;
  NEW.notification_invalid_at:=NULL; NEW.notification_invalid_reason:=NULL; NEW.notification_invalid_attempt:=NULL;
 ELSE NEW.notification_version:=OLD.notification_version;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER version_notification_subscription BEFORE INSERT OR UPDATE ON public.push_subscriptions
 FOR EACH ROW EXECUTE FUNCTION public.version_notification_subscription();

CREATE TABLE public.notification_dispatches (
 intent_id uuid PRIMARY KEY REFERENCES public.notification_intents(id) ON DELETE RESTRICT,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','leased','sending','accepted','unknown','blocked','cancelled')),
 reason text CHECK(reason IN('authorization','preference','configuration','rejection','email_attempt_exists',
  'closed','resolved','superseded_recipient','superseded_generation','destination_limit','worker_lost_confirmation')),
 lease_token uuid, lease_version bigint NOT NULL DEFAULT 0 CHECK(lease_version>=0), lease_expires_at timestamptz,
 destinations_frozen boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(num_nonnulls(lease_token,lease_expires_at) IN(0,2))
);
CREATE TABLE public.notification_dispatch_destinations (
 intent_id uuid NOT NULL REFERENCES public.notification_dispatches(intent_id) ON DELETE RESTRICT,
 position integer NOT NULL CHECK(position>0), subscription_id uuid NOT NULL, subscription_version bigint NOT NULL CHECK(subscription_version>0),
 PRIMARY KEY(intent_id,position), UNIQUE(intent_id,subscription_id)
);
CREATE TABLE public.notification_dispatch_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), intent_id uuid NOT NULL REFERENCES public.notification_dispatches(intent_id) ON DELETE RESTRICT,
 round integer NOT NULL DEFAULT 1 CHECK(round=1), channel text NOT NULL CHECK(channel IN('push','email')),
 subscription_id uuid, subscription_version bigint, lease_token uuid NOT NULL, lease_version bigint NOT NULL CHECK(lease_version>0),
 lease_expires_at timestamptz NOT NULL, state text NOT NULL CHECK(state IN('prepared','sending','accepted','rejected','unknown','not_attempted')),
 code text, http_status integer CHECK(http_status BETWEEN 100 AND 599),
 started_at timestamptz, finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((channel='push' AND subscription_id IS NOT NULL AND subscription_version>0) OR (channel='email' AND subscription_id IS NULL AND subscription_version IS NULL)),
 CHECK((state='prepared' AND started_at IS NULL AND finished_at IS NULL AND code IS NULL AND http_status IS NULL)
  OR (state='sending' AND started_at IS NOT NULL AND finished_at IS NULL AND code IS NULL AND http_status IS NULL)
  OR (state IN('accepted','rejected','unknown','not_attempted') AND finished_at IS NOT NULL AND code IS NOT NULL
    AND (state='not_attempted' OR started_at IS NOT NULL))),
 CHECK(started_at IS NULL OR started_at<lease_expires_at), CHECK(finished_at IS NULL OR started_at IS NULL OR finished_at>=started_at)
);
CREATE UNIQUE INDEX notification_attempt_push_unique ON public.notification_dispatch_attempts(intent_id,round,subscription_id,subscription_version) WHERE channel='push';
CREATE UNIQUE INDEX notification_attempt_email_unique ON public.notification_dispatch_attempts(intent_id,round) WHERE channel='email';
CREATE UNIQUE INDEX notification_attempt_active_unique ON public.notification_dispatch_attempts(intent_id) WHERE state IN('prepared','sending');
CREATE TABLE public.notification_dispatch_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 intent_id uuid NOT NULL REFERENCES public.notification_dispatches(intent_id) ON DELETE RESTRICT,
 attempt_id uuid, kind text NOT NULL, state text NOT NULL, code text, http_status integer,
 lease_version bigint, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Audit event IDs are technical references, not account/source/subscription FKs.
CREATE FUNCTION public.guard_notification_dispatch_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
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
CREATE FUNCTION public.audit_notification_dispatch_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='notification_dispatch_attempts' THEN
  INSERT INTO public.notification_dispatch_events(intent_id,attempt_id,kind,state,code,http_status,lease_version)
  VALUES(NEW.intent_id,NEW.id,'attempt',NEW.state,NEW.code,NEW.http_status,NEW.lease_version);
 ELSE
  INSERT INTO public.notification_dispatch_events(intent_id,kind,state,code,lease_version)
  VALUES(NEW.intent_id,'dispatch',NEW.state,NEW.reason,NEW.lease_version);
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['notification_dispatches','notification_dispatch_destinations','notification_dispatch_attempts','notification_dispatch_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  IF t<>'notification_dispatches' THEN
   EXECUTE format('CREATE TRIGGER guard_notification_dispatch_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_notification_dispatch_history()',t);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.notification_dispatch_events_id_seq FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER audit_notification_dispatch_change AFTER INSERT OR UPDATE ON public.notification_dispatches
 FOR EACH ROW EXECUTE FUNCTION public.audit_notification_dispatch_change();
CREATE TRIGGER audit_notification_dispatch_change AFTER INSERT OR UPDATE ON public.notification_dispatch_attempts
 FOR EACH ROW EXECUTE FUNCTION public.audit_notification_dispatch_change();

-- No source/alert locks here. Scope locks precede work, which precedes intent.
CREATE FUNCTION public.lock_notification_dispatch_scope(p_intent uuid,p_subscription uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE i public.notification_intents%ROWTYPE;
BEGIN
 PERFORM public.require_notification_service();
 SELECT * INTO i FROM public.notification_intents WHERE id=p_intent;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('heartland:work-ownership:'||i.organization_id||':'||i.patient_id,0));
 PERFORM id FROM public.profiles WHERE id=ANY(ARRAY[i.recipient_id,i.patient_id]) ORDER BY id FOR SHARE;
 PERFORM id FROM public.consents WHERE user_id=ANY(ARRAY[i.recipient_id,i.patient_id])
  AND consent_type='registration' AND consent_version='v1.0' ORDER BY id FOR SHARE;
 PERFORM id FROM public.organizations WHERE id=i.organization_id FOR SHARE;
 PERFORM id FROM public.organization_memberships WHERE organization_id=i.organization_id AND user_id=i.recipient_id ORDER BY id FOR SHARE;
 PERFORM g.id FROM public.member_authorizations g JOIN public.organization_memberships m ON m.id=g.membership_id
  WHERE m.organization_id=i.organization_id AND m.user_id=i.recipient_id AND g.capability='monitor' ORDER BY g.id FOR SHARE OF g;
 PERFORM id FROM public.provider_patient_links WHERE provider_id=i.recipient_id AND patient_id=i.patient_id ORDER BY id FOR SHARE;
 PERFORM id FROM public.organization_patient_assignments WHERE organization_id=i.organization_id AND patient_id=i.patient_id ORDER BY id FOR SHARE;
 PERFORM id FROM public.patients WHERE id=i.patient_id FOR KEY SHARE;
 PERFORM public.lock_notification_preference(i.recipient_id,i.patient_id);
 IF p_subscription IS NOT NULL THEN PERFORM id FROM public.push_subscriptions WHERE id=p_subscription FOR SHARE; END IF;
 PERFORM id FROM public.work_items WHERE id=i.work_item_id FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM id FROM public.notification_intents WHERE id=p_intent FOR UPDATE SKIP LOCKED;
 RETURN FOUND;
END $$;

CREATE FUNCTION public.notification_dispatch_eligibility(p_intent uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.notification_intents%ROWTYPE; w public.work_items%ROWTYPE; a public.alerts%ROWTYPE; reason text;
BEGIN
 SELECT * INTO i FROM public.notification_intents WHERE id=p_intent;
 SELECT * INTO w FROM public.work_items WHERE id=i.work_item_id;
 -- Fresh MVCC read AFTER work lock in claim/start, never a source row lock.
 SELECT * INTO a FROM public.alerts WHERE id=i.alert_id;
 IF w.id IS NULL OR a.id IS NULL OR w.patient_id IS DISTINCT FROM i.patient_id OR a.patient_id IS DISTINCT FROM i.patient_id
  OR w.organization_id IS DISTINCT FROM i.organization_id OR w.source_id IS DISTINCT FROM i.alert_id THEN RETURN 'authorization'; END IF;
 IF w.status='closed' THEN RETURN 'closed'; END IF;
 IF a.status='resolved' OR w.underlying_alert_resolved_at IS NOT NULL THEN RETURN 'resolved'; END IF;
 IF w.assigned_to IS DISTINCT FROM i.recipient_id THEN RETURN 'superseded_recipient'; END IF;
 IF i.generation IS DISTINCT FROM (SELECT generation FROM public.notification_work_state WHERE work_item_id=i.work_item_id) THEN RETURN 'superseded_generation'; END IF;
 IF i.state='cancelled' OR w.accountability_source IS NULL OR w.accountability_source='legacy_fan_out'
  OR w.severity<>'critical' OR a.severity<>'critical' THEN RETURN 'authorization'; END IF;
 reason:=public.notification_capture_block_reason(i.organization_id,i.patient_id,i.recipient_id,a.flags,clock_timestamp());
 RETURN CASE WHEN reason='blocked_preference' THEN 'preference' WHEN reason IS NOT NULL THEN 'authorization' ELSE NULL END;
END $$;

CREATE FUNCTION public.notification_dispatch_next(p_intent uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.notification_dispatch_attempts%ROWTYPE; d public.notification_dispatch_destinations%ROWTYPE;
BEGIN
 IF EXISTS(SELECT 1 FROM public.notification_dispatch_attempts WHERE intent_id=p_intent AND state='accepted') THEN RETURN jsonb_build_object('kind','stop','reason','accepted'); END IF;
 IF EXISTS(SELECT 1 FROM public.notification_dispatch_attempts WHERE intent_id=p_intent AND state IN('sending','unknown')) THEN RETURN jsonb_build_object('kind','stop','reason','unknown'); END IF;
 IF EXISTS(SELECT 1 FROM public.notification_dispatch_attempts WHERE intent_id=p_intent AND code IN('credentials_rejected','missing_credentials','invalid_app_url','payload_failed')) THEN RETURN jsonb_build_object('kind','blocked','reason','configuration'); END IF;
 IF EXISTS(SELECT 1 FROM public.notification_dispatch_attempts WHERE intent_id=p_intent AND state='rejected'
  AND NOT(channel='push' AND code='subscription_expired' AND http_status IN(404,410))) THEN RETURN jsonb_build_object('kind','blocked','reason','rejection'); END IF;
 IF EXISTS(SELECT 1 FROM public.notification_dispatch_attempts WHERE intent_id=p_intent AND channel='email' AND state<>'prepared') THEN RETURN jsonb_build_object('kind','blocked','reason','email_attempt_exists'); END IF;
 SELECT * INTO a FROM public.notification_dispatch_attempts WHERE intent_id=p_intent AND state='prepared';
 IF FOUND THEN RETURN jsonb_build_object('kind','prepared','attempt_id',a.id,'channel',a.channel,'subscription_id',a.subscription_id); END IF;
 SELECT * INTO d FROM public.notification_dispatch_destinations dest WHERE dest.intent_id=p_intent
  AND NOT EXISTS(SELECT 1 FROM public.notification_dispatch_attempts attempts WHERE attempts.intent_id=p_intent AND attempts.subscription_id=dest.subscription_id AND attempts.subscription_version=dest.subscription_version)
  ORDER BY position LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('kind','prepare','channel','push','subscription_id',d.subscription_id,'subscription_version',d.subscription_version::text); END IF;
 RETURN jsonb_build_object('kind','prepare','channel','email','subscription_id',NULL);
END $$;

CREATE FUNCTION public.claim_notification_dispatch(p_intent_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE q public.notification_dispatches%ROWTYPE; i public.notification_intents%ROWTYPE; v_reason text; token uuid; n integer;
BEGIN
 IF NOT public.lock_notification_dispatch_scope(p_intent_id) THEN RETURN NULL; END IF;
 SELECT * INTO i FROM public.notification_intents WHERE id=p_intent_id;
 -- Captured blocks require individual review, not automatic release on a timer.
 IF i.state<>'pending' THEN RETURN NULL; END IF;
 INSERT INTO public.notification_dispatches(intent_id) VALUES(p_intent_id) ON CONFLICT(intent_id) DO NOTHING;
 SELECT * INTO q FROM public.notification_dispatches WHERE intent_id=p_intent_id FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR q.state NOT IN('pending','leased','sending') THEN RETURN NULL; END IF;
 IF q.state IN('leased','sending') AND q.lease_expires_at>clock_timestamp() THEN RETURN NULL; END IF;
 IF q.state='sending' OR EXISTS(SELECT 1 FROM public.notification_dispatch_attempts WHERE intent_id=p_intent_id AND state='sending') THEN
  UPDATE public.notification_dispatch_attempts SET state='unknown',code='worker_lost_confirmation',finished_at=clock_timestamp()
   WHERE intent_id=p_intent_id AND state='sending';
  UPDATE public.notification_dispatches SET state='unknown',reason='worker_lost_confirmation',updated_at=clock_timestamp() WHERE intent_id=p_intent_id;
  RETURN NULL;
 END IF;
 v_reason:=public.notification_dispatch_eligibility(p_intent_id);
 IF v_reason IS NOT NULL THEN
  UPDATE public.notification_dispatches SET state=CASE WHEN v_reason IN('closed','resolved','superseded_recipient','superseded_generation')
    AND NOT EXISTS(SELECT 1 FROM public.notification_dispatch_attempts WHERE intent_id=p_intent_id AND started_at IS NOT NULL) THEN 'cancelled' ELSE 'blocked' END,
   reason=v_reason,updated_at=clock_timestamp() WHERE intent_id=p_intent_id;
  RETURN NULL;
 END IF;
 IF NOT q.destinations_frozen THEN
  SELECT count(*) INTO n FROM public.push_subscriptions WHERE user_id=i.recipient_id AND notification_invalid_at IS NULL;
  IF n>100 THEN
   UPDATE public.notification_dispatches SET state='blocked',reason='destination_limit',updated_at=clock_timestamp() WHERE intent_id=p_intent_id;
   RETURN NULL;
  END IF;
  INSERT INTO public.notification_dispatch_destinations(intent_id,position,subscription_id,subscription_version)
   SELECT p_intent_id,row_number() OVER(ORDER BY id)::integer,id,notification_version
   FROM public.push_subscriptions WHERE user_id=i.recipient_id AND notification_invalid_at IS NULL;
  -- A concurrent new device cannot create a partially frozen set: verify the actual insert size.
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n>100 THEN RAISE EXCEPTION 'Notification destination limit exceeded'; END IF;
 END IF;
 token:=gen_random_uuid();
 UPDATE public.notification_dispatches SET state='leased',reason=NULL,lease_token=token,lease_version=lease_version+1,
  lease_expires_at=clock_timestamp()+interval '120 seconds',destinations_frozen=true,updated_at=clock_timestamp()
  WHERE intent_id=p_intent_id RETURNING * INTO q;
 UPDATE public.notification_dispatch_attempts SET lease_token=q.lease_token,lease_version=q.lease_version,lease_expires_at=q.lease_expires_at
  WHERE intent_id=p_intent_id AND state='prepared';
 RETURN jsonb_build_object('eventId',p_intent_id,'token',q.lease_token,'version',q.lease_version::text);
END $$;

CREATE FUNCTION public.get_notification_dispatch_snapshot(p_intent_id uuid,p_token uuid,p_version bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE q public.notification_dispatches%ROWTYPE; reason text; destinations jsonb; attempts jsonb;
BEGIN
 PERFORM public.require_notification_service();
 SELECT * INTO q FROM public.notification_dispatches WHERE intent_id=p_intent_id FOR SHARE;
 IF NOT FOUND OR q.lease_token IS DISTINCT FROM p_token OR q.lease_version IS DISTINCT FROM p_version THEN RETURN NULL; END IF;
 reason:=public.notification_dispatch_eligibility(p_intent_id);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',subscription_id,'version',subscription_version::text) ORDER BY position),'[]')
  INTO destinations FROM public.notification_dispatch_destinations WHERE intent_id=p_intent_id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'eventId',intent_id,'round',round,'channel',channel,
  'destination',CASE WHEN channel='push' THEN jsonb_build_object('id',subscription_id,'version',subscription_version::text) END,
  'lease',jsonb_build_object('eventId',intent_id,'round',round,'token',lease_token,'version',lease_version::text,'expiresAt',lease_expires_at),
  'state',state,'code',code,'httpStatus',http_status,'startedAt',started_at,'finishedAt',finished_at) ORDER BY created_at,id),'[]')
  INTO attempts FROM public.notification_dispatch_attempts WHERE intent_id=p_intent_id;
 RETURN jsonb_build_object('history','complete','eventId',p_intent_id,'round',1,'observedAt',clock_timestamp(),
  'expectedDestinationCount',jsonb_array_length(destinations),'expectedAttemptCount',jsonb_array_length(attempts),
  'destinations',destinations,'attempts',attempts,'presentedClaim',jsonb_build_object('token',p_token,'version',p_version::text),
  'persistedLease',jsonb_build_object('eventId',p_intent_id,'round',1,'token',q.lease_token,'version',q.lease_version::text,'expiresAt',q.lease_expires_at),
  'eligibility',CASE WHEN reason='authorization' THEN 'no_monitor_authorization' WHEN reason='preference' THEN 'eligible' ELSE COALESCE(reason,'eligible') END,
  'preference',CASE WHEN reason='preference' THEN 'muted' ELSE 'allowed' END);
END $$;

CREATE FUNCTION public.prepare_notification_dispatch(p_intent_id uuid,p_token uuid,p_version bigint,p_configuration_ready boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE q public.notification_dispatches%ROWTYPE; a public.notification_dispatch_attempts%ROWTYPE; next jsonb; v_reason text;
BEGIN
 IF NOT public.lock_notification_dispatch_scope(p_intent_id) THEN RETURN NULL; END IF;
 SELECT * INTO q FROM public.notification_dispatches WHERE intent_id=p_intent_id FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR q.state<>'leased' OR q.lease_token IS DISTINCT FROM p_token OR q.lease_version IS DISTINCT FROM p_version OR q.lease_expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 v_reason:=public.notification_dispatch_eligibility(p_intent_id);
 IF v_reason IS NULL AND p_configuration_ready IS DISTINCT FROM true THEN v_reason:='configuration'; END IF;
 next:=public.notification_dispatch_next(p_intent_id);
 IF v_reason IS NULL AND next->>'kind' IN('stop','blocked') THEN v_reason:=CASE WHEN next->>'reason' IN('accepted','unknown') THEN 'rejection' ELSE next->>'reason' END; END IF;
 IF v_reason IS NOT NULL THEN
  UPDATE public.notification_dispatches SET state='blocked',reason=v_reason,updated_at=clock_timestamp() WHERE intent_id=p_intent_id;
  RETURN NULL;
 END IF;
 IF next->>'kind'='prepared' THEN SELECT * INTO a FROM public.notification_dispatch_attempts WHERE id=(next->>'attempt_id')::uuid;
 ELSE
  INSERT INTO public.notification_dispatch_attempts(intent_id,channel,subscription_id,subscription_version,lease_token,lease_version,lease_expires_at,state)
  VALUES(p_intent_id,next->>'channel',(next->>'subscription_id')::uuid,(next->>'subscription_version')::bigint,p_token,p_version,q.lease_expires_at,'prepared') RETURNING * INTO a;
 END IF;
 RETURN jsonb_build_object('id',a.id,'channel',a.channel);
END $$;

CREATE FUNCTION public.start_notification_dispatch(p_intent_id uuid,p_attempt_id uuid,p_token uuid,p_version bigint,p_configuration_ready boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE q public.notification_dispatches%ROWTYPE; a public.notification_dispatch_attempts%ROWTYPE; s public.push_subscriptions%ROWTYPE;
 i public.notification_intents%ROWTYPE; v_reason text; next jsonb; email text;
BEGIN
 PERFORM public.require_notification_service();
 SELECT * INTO a FROM public.notification_dispatch_attempts WHERE id=p_attempt_id AND intent_id=p_intent_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT public.lock_notification_dispatch_scope(p_intent_id,a.subscription_id) THEN RETURN NULL; END IF;
 SELECT * INTO q FROM public.notification_dispatches WHERE intent_id=p_intent_id FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR q.state<>'leased' OR q.lease_token IS DISTINCT FROM p_token OR q.lease_version IS DISTINCT FROM p_version OR q.lease_expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 SELECT * INTO a FROM public.notification_dispatch_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF a.state<>'prepared' OR a.lease_token IS DISTINCT FROM p_token OR a.lease_version IS DISTINCT FROM p_version THEN RETURN NULL; END IF;
 v_reason:=public.notification_dispatch_eligibility(p_intent_id);
 IF v_reason IS NULL AND p_configuration_ready IS DISTINCT FROM true THEN v_reason:='configuration'; END IF;
 next:=public.notification_dispatch_next(p_intent_id);
 IF v_reason IS NULL AND (next->>'kind'<>'prepared' OR (next->>'attempt_id')::uuid IS DISTINCT FROM p_attempt_id) THEN v_reason:='rejection'; END IF;
 IF v_reason IS NOT NULL THEN
  UPDATE public.notification_dispatches SET state='blocked',reason=v_reason,updated_at=clock_timestamp() WHERE intent_id=p_intent_id;
  RETURN NULL;
 END IF;
 SELECT * INTO i FROM public.notification_intents WHERE id=p_intent_id;
 IF a.channel='push' THEN
  SELECT * INTO s FROM public.push_subscriptions WHERE id=a.subscription_id;
  IF s.id IS NULL OR s.user_id IS DISTINCT FROM i.recipient_id OR s.notification_version IS DISTINCT FROM a.subscription_version OR s.notification_invalid_at IS NOT NULL THEN
   UPDATE public.notification_dispatch_attempts SET state='not_attempted',code='invalid_subscription',finished_at=clock_timestamp() WHERE id=a.id;
   UPDATE public.notification_dispatches SET state='pending',updated_at=clock_timestamp() WHERE intent_id=p_intent_id;
   RETURN jsonb_build_object('kind','not_attempted');
  END IF;
 ELSE
  -- Resolve contact at start only; never save it to queue/attempt/events.
  SELECT p.email INTO email FROM public.profiles p WHERE p.id=i.recipient_id;
  IF email IS NULL OR btrim(email)='' THEN
   UPDATE public.notification_dispatch_attempts SET state='not_attempted',code='missing_recipient',finished_at=clock_timestamp() WHERE id=a.id;
   UPDATE public.notification_dispatches SET state='blocked',reason='email_attempt_exists',updated_at=clock_timestamp() WHERE intent_id=p_intent_id;
   RETURN jsonb_build_object('kind','not_attempted');
  END IF;
 END IF;
 IF q.lease_expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 UPDATE public.notification_dispatch_attempts SET state='sending',started_at=clock_timestamp() WHERE id=a.id;
 UPDATE public.notification_dispatches SET state='sending',updated_at=clock_timestamp() WHERE intent_id=p_intent_id;
 RETURN jsonb_build_object('kind','started','id',a.id,'channel',a.channel,
  'subscription',CASE WHEN a.channel='push' THEN jsonb_build_object('endpoint',s.endpoint,'keys',s.keys) END,
  'email',CASE WHEN a.channel='email' THEN email END);
END $$;

CREATE FUNCTION public.finish_notification_dispatch(p_intent_id uuid,p_attempt_id uuid,p_token uuid,p_version bigint,
 p_state text,p_code text,p_http_status integer DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE a public.notification_dispatch_attempts%ROWTYPE; q public.notification_dispatches%ROWTYPE; valid boolean; next jsonb; cancellation text;
BEGIN
 PERFORM public.require_notification_service();
 SELECT * INTO a FROM public.notification_dispatch_attempts WHERE id=p_attempt_id AND intent_id=p_intent_id;
 IF NOT FOUND OR a.lease_token IS DISTINCT FROM p_token OR a.lease_version IS DISTINCT FROM p_version THEN RETURN 'stale'; END IF;
 valid:=CASE p_state
  WHEN 'accepted' THEN p_code='accepted' AND p_http_status BETWEEN 200 AND 299
  WHEN 'not_attempted' THEN p_http_status IS NULL AND (p_code IN('missing_credentials','invalid_app_url')
   OR (a.channel='push' AND p_code IN('invalid_subscription','payload_failed')) OR (a.channel='email' AND p_code='missing_recipient'))
  WHEN 'unknown' THEN (p_code IN('timeout','network_error') AND p_http_status IS NULL)
   OR (p_code='server_error' AND p_http_status BETWEEN 500 AND 599) OR (p_code='request_timeout' AND p_http_status=408)
   OR (p_code='redirect_unconfirmed' AND p_http_status BETWEEN 300 AND 399)
  WHEN 'rejected' THEN p_http_status BETWEEN 400 AND 499 AND p_http_status<>408 AND p_code=CASE
   WHEN p_http_status IN(401,403) THEN 'credentials_rejected' WHEN p_http_status=429 THEN 'rate_limited'
   WHEN a.channel='push' AND p_http_status IN(404,410) THEN 'subscription_expired' ELSE 'http_rejected' END
  ELSE false END;
 IF NOT COALESCE(valid,false) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid notification result'; END IF;
 -- Subscription-before-queue order matches start. No work/account locks in finish.
 IF a.channel='push' AND p_code IN('subscription_expired','invalid_subscription') THEN
  PERFORM id FROM public.push_subscriptions WHERE id=a.subscription_id FOR UPDATE;
 END IF;
 SELECT * INTO q FROM public.notification_dispatches WHERE intent_id=p_intent_id FOR UPDATE;
 SELECT * INTO a FROM public.notification_dispatch_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF q.lease_token IS DISTINCT FROM p_token OR q.lease_version IS DISTINCT FROM p_version THEN RETURN 'stale'; END IF;
 IF a.state<>'sending' OR q.lease_expires_at<=clock_timestamp() THEN
  IF a.state='sending' THEN
   UPDATE public.notification_dispatch_attempts SET state='unknown',code='worker_lost_confirmation',finished_at=clock_timestamp() WHERE id=a.id;
   UPDATE public.notification_dispatches SET state='unknown',reason='worker_lost_confirmation',updated_at=clock_timestamp() WHERE intent_id=p_intent_id;
  END IF;
  -- Late evidence is append-only and does not turn unknown into permission to retry.
  INSERT INTO public.notification_dispatch_events(intent_id,attempt_id,kind,state,code,http_status,lease_version)
   VALUES(p_intent_id,a.id,'late_result',p_state,p_code,p_http_status,p_version);
  RETURN 'late_evidence';
 END IF;
 UPDATE public.notification_dispatch_attempts SET state=p_state,code=p_code,http_status=p_http_status,finished_at=clock_timestamp() WHERE id=a.id;
 IF a.channel='push' AND p_code IN('subscription_expired','invalid_subscription') THEN
  UPDATE public.push_subscriptions SET notification_invalid_at=clock_timestamp(),notification_invalid_reason=p_code,notification_invalid_attempt=a.id
   WHERE id=a.subscription_id AND notification_version=a.subscription_version;
 END IF;
 next:=public.notification_dispatch_next(p_intent_id);
 -- A work transition that won the race with finish already left immutable evidence.
 -- Do not return to work/source locks after queue; the opposite ordering is handled
 -- by the work trigger after finish commits. Accepted/unknown remain transport facts.
 IF next->>'kind'='prepare' THEN
  SELECT CASE state WHEN 'work_closed' THEN 'closed' WHEN 'source_resolved' THEN 'resolved'
    WHEN 'recipient_superseded' THEN 'superseded_recipient' END INTO cancellation
   FROM public.notification_dispatch_events WHERE intent_id=p_intent_id AND kind='eligibility_changed'
    AND state IN('work_closed','source_resolved','recipient_superseded') ORDER BY id DESC LIMIT 1;
  IF cancellation IS NOT NULL THEN next:=jsonb_build_object('kind','blocked','reason',cancellation); END IF;
 END IF;
 UPDATE public.notification_dispatches SET state=CASE WHEN p_state='accepted' THEN 'accepted' WHEN p_state='unknown' THEN 'unknown'
   WHEN next->>'kind'='prepare' THEN 'pending' ELSE 'blocked' END,
  reason=CASE WHEN next->>'kind'='blocked' THEN next->>'reason' END,updated_at=clock_timestamp() WHERE intent_id=p_intent_id;
 RETURN 'recorded';
END $$;

-- APIs can observe current dispatch outcome through the existing scoped view.
-- No API receives direct ledger reads, recipient IDs or destination secrets.
ALTER FUNCTION public.operational_exception_rows(uuid) RENAME TO operational_exception_rows_before_dispatch;
CREATE FUNCTION public.operational_exception_rows(p_org uuid)
RETURNS TABLE(key text,category text,patient_id uuid,work_item_id uuid,state text,reasons text[],recorded_at timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT old.key,old.category,old.patient_id,old.work_item_id,old.state,old.reasons,old.recorded_at
 FROM public.operational_exception_rows_before_dispatch(p_org) old WHERE old.category<>'notification'
 UNION ALL
 SELECT 'notification:'||i.id,'notification',i.patient_id,i.work_item_id,
  CASE WHEN q.intent_id IS NULL THEN i.state ELSE CASE q.state WHEN 'leased' THEN 'pending' ELSE q.state END END,
  CASE WHEN q.intent_id IS NULL THEN array_remove(ARRAY[i.event_kind,CASE WHEN i.blocked_reason IS NOT NULL THEN 'captured_'||i.blocked_reason END],NULL)
   ELSE array_remove(ARRAY[i.event_kind,'transport_'||CASE q.state WHEN 'leased' THEN 'pending' ELSE q.state END,
    CASE WHEN q.reason IS NOT NULL THEN 'dispatch_'||q.reason END],NULL) END,
  COALESCE(q.updated_at,i.captured_at)
 FROM public.notification_intents i JOIN public.work_items w ON w.id=i.work_item_id AND w.patient_id=i.patient_id AND w.organization_id=i.organization_id
 LEFT JOIN public.notification_dispatches q ON q.intent_id=i.id
 WHERE i.organization_id=p_org AND COALESCE(q.state,i.state)<>'cancelled'
$$;

CREATE OR REPLACE FUNCTION public.capture_work_notification_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision bigint; kind text; cancellation text; event record;
BEGIN
 IF NEW.source_type<>'alert' OR NEW.source_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.severity IS DISTINCT FROM OLD.severity THEN
  RAISE EXCEPTION 'Combined source and ownership mutation is unsupported';
 END IF;
 cancellation:=CASE WHEN NEW.status='closed' THEN 'work_closed' WHEN NEW.underlying_alert_resolved_at IS NOT NULL THEN 'source_resolved'
  WHEN NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN 'recipient_superseded' END;
 IF cancellation IS NOT NULL THEN
  FOR event IN SELECT i.id FROM public.notification_intents i WHERE i.work_item_id=NEW.id AND i.state IN('pending','blocked') ORDER BY i.id FOR UPDATE LOOP
   IF NOT EXISTS(SELECT 1 FROM public.notification_dispatch_attempts WHERE intent_id=event.id AND started_at IS NOT NULL) THEN
    UPDATE public.notification_intents SET state='cancelled',cancelled_at=clock_timestamp(),cancellation_reason=cancellation WHERE id=event.id;
    UPDATE public.notification_dispatches SET state='cancelled',reason=CASE cancellation WHEN 'work_closed' THEN 'closed' WHEN 'source_resolved' THEN 'resolved' ELSE 'superseded_recipient' END,
     updated_at=clock_timestamp() WHERE intent_id=event.id;
   ELSE
    INSERT INTO public.notification_dispatch_events(intent_id,kind,state,code)
     VALUES(event.id,'eligibility_changed',cancellation,NULL);
    UPDATE public.notification_dispatches SET state='blocked',reason=CASE cancellation WHEN 'work_closed' THEN 'closed'
      WHEN 'source_resolved' THEN 'resolved' ELSE 'superseded_recipient' END,updated_at=clock_timestamp()
     WHERE intent_id=event.id AND state IN('pending','leased');
   END IF;
  END LOOP;
 END IF;
 kind:=CASE WHEN NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.severity='critical' THEN 'critical_reassigned'
  WHEN OLD.severity<>'critical' AND NEW.severity='critical' THEN 'critical_escalated' END;
 IF kind IS NOT NULL THEN
  SELECT source_revision INTO revision FROM public.notification_source_state WHERE alert_id=NEW.source_id;
  PERFORM public.capture_notification_intent(NEW.id,kind,COALESCE(revision,0));
 END IF;
 RETURN NEW;
END $$;

-- Whitelist only the public RPC boundary; all private helpers remain uncallable.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'require_notification_service','lock_notification_preference','set_alert_notification_preference','version_notification_subscription',
  'guard_notification_dispatch_history','audit_notification_dispatch_change','lock_notification_dispatch_scope','notification_dispatch_eligibility',
  'notification_dispatch_next','claim_notification_dispatch','get_notification_dispatch_snapshot','prepare_notification_dispatch',
  'start_notification_dispatch','finish_notification_dispatch','operational_exception_rows','operational_exception_rows_before_dispatch') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.set_alert_notification_preference(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_dispatch(uuid),public.get_notification_dispatch_snapshot(uuid,uuid,bigint),
 public.prepare_notification_dispatch(uuid,uuid,bigint,boolean),public.start_notification_dispatch(uuid,uuid,uuid,bigint,boolean),
 public.finish_notification_dispatch(uuid,uuid,uuid,bigint,text,text,integer) TO service_role;
COMMENT ON TABLE public.notification_dispatches IS 'Local N2 candidate. Transport outcome is not delivery/read/care. Hosted retention, erasure and cutover gates remain required.';
