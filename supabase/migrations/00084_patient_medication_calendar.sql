BEGIN;

-- Calendar authority belongs to the patient. A pinned initial zone survives changes
-- to the care team. Historical civil dates and existing dose timestamps stay as stored.
CREATE TABLE public.patient_medication_calendars (
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  previous_id uuid,
  time_zone text NOT NULL,
  source text NOT NULL CHECK(source IN ('patient','care_team','default')),
  recorded_at timestamptz NOT NULL,
  effective_at timestamptz NOT NULL,
  previous_day date,
  first_day date NOT NULL,
  PRIMARY KEY(patient_id,id),
  CHECK ((source='patient')=(previous_id IS NOT NULL)),
  CHECK (previous_day IS NULL OR first_day>=previous_day)
);
CREATE UNIQUE INDEX patient_medication_calendar_origin ON public.patient_medication_calendars(patient_id) WHERE previous_id IS NULL;
CREATE INDEX patient_medication_calendar_effective ON public.patient_medication_calendars(patient_id,effective_at DESC,recorded_at DESC);
ALTER TABLE public.patient_medication_calendars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_medication_calendars FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.medication_logs ADD COLUMN calendar_time_zone text, ADD COLUMN calendar_source text;
ALTER TABLE public.medication_schedule_versions ADD COLUMN calendar_time_zone text, ADD COLUMN calendar_source text;

CREATE FUNCTION public.medication_calendar_origin(p_patient uuid) RETURNS TABLE(zone text,source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH team AS (
    SELECT o.timezone FROM public.provider_patient_links l
    JOIN public.organization_memberships m ON m.user_id=l.provider_id AND m.status='active' AND m.is_default
    JOIN public.organizations o ON o.id=m.organization_id AND o.status='active'
    WHERE l.patient_id=p_patient AND l.status='active'
    ORDER BY l.linked_at DESC NULLS LAST,l.created_at DESC,l.id LIMIT 1
  ), valid AS (SELECT timezone FROM team WHERE EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=team.timezone))
  SELECT COALESCE((SELECT timezone FROM valid),'America/New_York'), CASE WHEN EXISTS(SELECT 1 FROM valid) THEN 'care_team' ELSE 'default' END
$$;

CREATE FUNCTION public.lock_medication_calendar(p_patient uuid) RETURNS void LANGUAGE sql VOLATILE SET search_path='' AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('medication calendar/'||p_patient::text,0))
$$;

CREATE FUNCTION public.pin_medication_calendar(p_patient uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE pinned_at timestamptz;
BEGIN
  IF EXISTS(SELECT 1 FROM public.patient_medication_calendars WHERE patient_id=p_patient) THEN RETURN; END IF;
  PERFORM public.lock_medication_calendar(p_patient);
  pinned_at:=clock_timestamp();
  INSERT INTO public.patient_medication_calendars(patient_id,time_zone,source,recorded_at,effective_at,first_day)
    SELECT p_patient,o.zone,o.source,pinned_at,'-infinity'::timestamptz,(pinned_at AT TIME ZONE o.zone)::date
    FROM public.medication_calendar_origin(p_patient) o ON CONFLICT DO NOTHING;
END;
$$;

WITH boundary AS (SELECT statement_timestamp() AS at)
INSERT INTO public.patient_medication_calendars(patient_id,time_zone,source,recorded_at,effective_at,first_day)
SELECT p.id,o.zone,o.source,b.at,'-infinity'::timestamptz,(b.at AT TIME ZONE o.zone)::date
FROM public.patients p CROSS JOIN boundary b CROSS JOIN LATERAL public.medication_calendar_origin(p.id) o;

-- Neither a job nor a clock on the user's device advances the calendar. A pending
-- westward move can lengthen one day; an extreme eastward move can skip a civil
-- date. Such a date has no established denominator.
CREATE FUNCTION public.medication_calendar_at(p_patient uuid,p_clock timestamptz)
RETURNS TABLE(zone text,source text,day date,revision uuid,pending_zone text,pending_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH current_entry AS (
    SELECT * FROM public.patient_medication_calendars WHERE patient_id=p_patient AND effective_at<=p_clock
    ORDER BY effective_at DESC,recorded_at DESC,id DESC LIMIT 1
  ), pending AS (
    SELECT * FROM public.patient_medication_calendars WHERE patient_id=p_patient AND recorded_at<=p_clock AND effective_at>p_clock
    ORDER BY recorded_at DESC,id DESC LIMIT 1
  )
  SELECT c.time_zone,c.source,coalesce(p.previous_day,(p_clock AT TIME ZONE c.time_zone)::date),
    coalesce(p.id,c.id),p.time_zone,p.effective_at FROM current_entry c LEFT JOIN pending p ON true
  UNION ALL
  SELECT o.zone,o.source,(p_clock AT TIME ZONE o.zone)::date,NULL::uuid,NULL::text,NULL::timestamptz
    FROM public.medication_calendar_origin(p_patient) o WHERE NOT EXISTS(SELECT 1 FROM current_entry)
$$;

CREATE FUNCTION public.unclassified_medication_dates(p_patient uuid,p_from date,p_to date) RETURNS SETOF date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT DISTINCT c.previous_day+i FROM public.patient_medication_calendars c
  CROSS JOIN LATERAL generate_series(1,c.first_day-c.previous_day-1) i
  WHERE c.patient_id=p_patient AND c.previous_day<p_to AND c.first_day>p_from
    AND c.previous_day+i BETWEEN p_from AND p_to
$$;

CREATE OR REPLACE FUNCTION public.medication_calendar_zone_internal(p_patient uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT zone FROM public.medication_calendar_at(p_patient,statement_timestamp())
$$;

CREATE OR REPLACE FUNCTION public.get_patient_timezone() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.medication_calendar_zone_internal(auth.uid())
$$;

-- Civil-day bounds can span a change or a pending handover. Use these exact
-- instants when matching timestamped check-ins to the medication day on Today.
CREATE FUNCTION public.medication_calendar_day_bounds(p_patient uuid,p_day date)
RETURNS TABLE(start_at timestamptz,end_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH eras AS (
    SELECT c.*,lead(recorded_at) OVER era AS next_request,lead(effective_at) OVER era AS next_start,
      lead(previous_day) OVER era AS held_day
    FROM public.patient_medication_calendars c WHERE patient_id=p_patient
    WINDOW era AS (ORDER BY effective_at,recorded_at,id)
  ), spans AS (
    SELECT greatest(effective_at,p_day::timestamp AT TIME ZONE time_zone) AS starts,
      least(coalesce(next_request,'infinity'::timestamptz),(p_day+1)::timestamp AT TIME ZONE time_zone) AS ends FROM eras
    UNION ALL SELECT next_request,next_start FROM eras WHERE held_day=p_day
  )
  SELECT min(starts),max(ends) FROM spans WHERE starts<ends
$$;
REVOKE ALL ON FUNCTION public.medication_calendar_day_bounds(uuid,date) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_patient_medication_calendar(p_patient uuid,p_from date DEFAULT NULL,p_to date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE c record; d1 date; d2 date;
BEGIN
  IF NOT COALESCE((auth.uid()=p_patient AND public.get_user_role()='patient' AND public.has_registration_consent())
    OR public.provider_has_patient(p_patient),false) THEN RAISE EXCEPTION 'Medication calendar unavailable' USING ERRCODE='42501'; END IF;
  IF (p_from IS NULL)<>(p_to IS NULL) OR p_from>p_to OR p_to-p_from>366 THEN RAISE EXCEPTION 'Invalid calendar range' USING ERRCODE='22023'; END IF;
  PERFORM public.pin_medication_calendar(p_patient);
  SELECT * INTO STRICT c FROM public.medication_calendar_at(p_patient,clock_timestamp());
  d1:=coalesce(p_from,c.day-29); d2:=coalesce(p_to,c.day);
  RETURN jsonb_build_object('zone',c.zone,'source',c.source,'day',c.day,'revision',c.revision,
    'pending_zone',c.pending_zone,'pending_at',c.pending_at,
    'day_bounds',(SELECT to_jsonb(b) FROM public.medication_calendar_day_bounds(p_patient,c.day) b),
    'unclassified_dates',ARRAY(SELECT * FROM public.unclassified_medication_dates(p_patient,d1,d2) ORDER BY 1),
    'history',COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.first_day,h.recorded_at) FROM (
      SELECT first_day,previous_day,time_zone AS zone,source,recorded_at FROM public.patient_medication_calendars
      WHERE patient_id=p_patient AND effective_at<=clock_timestamp() AND first_day<=d2
        AND (first_day>=d1 OR first_day=(SELECT max(first_day) FROM public.patient_medication_calendars
          WHERE patient_id=p_patient AND first_day<d1 AND effective_at<=clock_timestamp()))
    ) h),'[]'::jsonb));
END;
$$;

CREATE FUNCTION public.medication_calendar_handover(p_clock timestamptz,p_day date,p_old_zone text,p_new_zone text) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT CASE WHEN (p_clock AT TIME ZONE p_new_zone)::date=p_day THEN p_clock
    ELSE greatest((p_day+1)::timestamp AT TIME ZONE p_old_zone,(p_day+1)::timestamp AT TIME ZONE p_new_zone) END
$$;
REVOKE ALL ON FUNCTION public.medication_calendar_handover(timestamptz,date,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.set_patient_medication_timezone(p_actor uuid,p_request uuid,p_revision uuid,p_zone text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE existing public.patient_medication_calendars%ROWTYPE; current_state record; at_clock timestamptz;
  boundary timestamptz; next_day date;
BEGIN
  IF p_actor IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR public.get_user_role() IS DISTINCT FROM 'patient'
    OR public.has_registration_consent() IS NOT TRUE THEN RAISE EXCEPTION 'Patient session unavailable' USING ERRCODE='42501'; END IF;
  IF p_request IS NULL OR p_revision IS NULL OR p_zone IS NULL OR length(p_zone)>100 OR
    (p_zone<>'UTC' AND (position('/' IN p_zone)=0 OR p_zone LIKE 'posix/%' OR p_zone LIKE 'right/%'))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=p_zone) THEN
    RAISE EXCEPTION 'Choose a recognized timezone' USING ERRCODE='22023';
  END IF;
  PERFORM public.lock_medication_calendar(p_actor);
  PERFORM public.pin_medication_calendar(p_actor);
  SELECT * INTO existing FROM public.patient_medication_calendars WHERE patient_id=p_actor AND id=p_request;
  IF FOUND THEN
    IF (existing.previous_id,existing.time_zone) IS DISTINCT FROM (p_revision,p_zone) THEN
      RAISE EXCEPTION 'Calendar request changed' USING ERRCODE='22023';
    END IF;
    RETURN p_request;
  END IF;
  at_clock:=clock_timestamp();
  SELECT * INTO STRICT current_state FROM public.medication_calendar_at(p_actor,at_clock);
  IF current_state.revision IS DISTINCT FROM p_revision OR current_state.pending_at IS NOT NULL THEN
    RAISE EXCEPTION 'Reload the current calendar choice' USING ERRCODE='22023';
  END IF;
  boundary:=public.medication_calendar_handover(at_clock,current_state.day,current_state.zone,p_zone);
  next_day:=(boundary AT TIME ZONE p_zone)::date;
  INSERT INTO public.patient_medication_calendars(patient_id,id,previous_id,time_zone,source,recorded_at,effective_at,previous_day,first_day)
    VALUES(p_actor,p_request,p_revision,p_zone,'patient',at_clock,boundary,current_state.day,next_day);
  RETURN p_request;
END;
$$;

-- Preserve the provenance of each newly dated revision, and never assign a
-- modern timezone to a dose already present at migration time or replayed later.
CREATE FUNCTION public.stamp_medication_revision_calendar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c record;
BEGIN
  IF TG_OP='UPDATE' AND NEW.id=OLD.id THEN RETURN NEW; END IF;
  SELECT * INTO STRICT c FROM public.medication_calendar_at(NEW.patient_id,clock_timestamp());
  NEW.calendar_time_zone:=c.zone; NEW.calendar_source:=c.source; RETURN NEW;
END;
$$;
CREATE TRIGGER stamp_medication_revision_calendar BEFORE INSERT OR UPDATE ON public.medication_schedule_versions
FOR EACH ROW EXECUTE FUNCTION public.stamp_medication_revision_calendar();

REVOKE ALL ON FUNCTION public.medication_calendar_origin(uuid),public.lock_medication_calendar(uuid),
 public.pin_medication_calendar(uuid),public.medication_calendar_at(uuid,timestamptz),
 public.unclassified_medication_dates(uuid,date,date),public.stamp_medication_revision_calendar(),
 public.get_patient_medication_calendar(uuid,date,date),public.set_patient_medication_timezone(uuid,uuid,uuid,text)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_patient_medication_calendar(uuid,date,date),public.set_patient_medication_timezone(uuid,uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.capture_medication_schedule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  effective_day date;
  c record;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD.name,OLD.dosage,OLD.frequency,OLD.timing,OLD.weekly_day,OLD.active)
    IS NOT DISTINCT FROM ROW(NEW.name,NEW.dosage,NEW.frequency,NEW.timing,NEW.weekly_day,NEW.active) THEN RETURN NEW; END IF;
  PERFORM public.lock_medication_calendar(NEW.patient_id);
  PERFORM public.pin_medication_calendar(NEW.patient_id);
  SELECT * INTO STRICT c FROM public.medication_calendar_at(NEW.patient_id,clock_timestamp());
  effective_day := c.day;
  IF TG_OP = 'INSERT' THEN
    -- A new record starts on the active medication day, including a held date.
    IF NEW.created_at > clock_timestamp() THEN
      effective_day := greatest(effective_day,(NEW.created_at AT TIME ZONE c.zone)::date);
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.medication_logs WHERE medication_id = NEW.id AND scheduled_date = effective_day) THEN
    effective_day := effective_day + 1;
  END IF;
  -- Local date can move backwards after a timezone change. Never rewrite an
  -- earlier interval, including a change already scheduled for tomorrow.
  SELECT greatest(effective_day,max(starts_on)) INTO effective_day
  FROM public.medication_schedule_versions WHERE medication_id = NEW.id;
  UPDATE public.medication_schedule_versions SET ends_before = effective_day
    WHERE medication_id = NEW.id AND ends_before IS NULL AND starts_on < effective_day;
  INSERT INTO public.medication_schedule_versions
    (medication_id,patient_id,starts_on,known,active,name,dosage,frequency,timing,weekly_day)
  VALUES (NEW.id,NEW.patient_id,effective_day,true,NEW.active,NEW.name,NEW.dosage,NEW.frequency,NEW.timing,NEW.weekly_day)
  ON CONFLICT (medication_id,starts_on) DO UPDATE SET id=gen_random_uuid(),known=true,
    active=EXCLUDED.active,name=EXCLUDED.name,dosage=EXCLUDED.dosage,frequency=EXCLUDED.frequency,
    timing=EXCLUDED.timing,weekly_day=EXCLUDED.weekly_day;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_medication_dose_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  slots integer; c record;
BEGIN
  IF TG_OP='UPDATE' AND ROW(OLD.medication_id,OLD.patient_id,OLD.scheduled_date,OLD.dose_number)
    IS DISTINCT FROM ROW(NEW.medication_id,NEW.patient_id,NEW.scheduled_date,NEW.dose_number) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Dose identity cannot change';
  END IF;
  PERFORM 1 FROM public.medications WHERE id=NEW.medication_id AND patient_id=NEW.patient_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Medication unavailable'; END IF;
  PERFORM public.lock_medication_calendar(NEW.patient_id);
  PERFORM public.pin_medication_calendar(NEW.patient_id);
  SELECT * INTO STRICT c FROM public.medication_calendar_at(NEW.patient_id,clock_timestamp());
  IF NEW.scheduled_date IS DISTINCT FROM c.day THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Reload the current medication day';
  END IF;
  SELECT public.medication_dose_slots(v.frequency,v.weekly_day,NEW.scheduled_date) INTO slots
    FROM public.medication_schedule_versions v WHERE v.medication_id=NEW.medication_id
      AND v.active AND v.known AND v.starts_on<=NEW.scheduled_date
      AND (v.ends_before IS NULL OR v.ends_before>NEW.scheduled_date);
  IF slots IS NULL OR NEW.dose_number NOT BETWEEN 1 AND slots THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Dose is not confirmed for this day';
  END IF;
  IF NOT NEW.taken THEN NEW.taken_at:=NULL;
  ELSIF TG_OP='UPDATE' AND OLD.taken THEN NEW.taken_at:=OLD.taken_at;
  ELSE NEW.taken_at:=statement_timestamp(); END IF;
  IF TG_OP='INSERT' THEN NEW.calendar_time_zone:=c.zone; NEW.calendar_source:=c.source;
  ELSE NEW.calendar_time_zone:=OLD.calendar_time_zone; NEW.calendar_source:=OLD.calendar_source; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_medication_scan(p_patient uuid,p_clock timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH bounds AS (SELECT c.zone AS tz,c.day AS last_day FROM public.medication_calendar_at(p_patient,p_clock) c)
 SELECT jsonb_build_object('mode',CASE WHEN last_day<>(p_clock AT TIME ZONE tz)::date
    OR EXISTS(SELECT 1 FROM public.unclassified_medication_dates(p_patient,last_day-6,last_day)) THEN 'calendar-unconfirmed' ELSE 'dated-v1' END,'calendar_timezone',tz,'calendar_dates',
   (SELECT jsonb_agg(to_char(last_day - i,'YYYY-MM-DD') ORDER BY i DESC) FROM generate_series(0,6) i),
   'medications', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM (
     SELECT id,medication_id,starts_on,ends_before,known,active,weekly_day,
       CASE WHEN lower(btrim(frequency)) IN ('daily','once_daily','twice_daily','three_times_daily','four_times_daily','as_needed','weekly')
         THEN lower(btrim(frequency)) END AS schedule_frequency
     FROM public.medication_schedule_versions WHERE patient_id=p_patient AND starts_on<=last_day
       AND (ends_before IS NULL OR ends_before>last_day-6) ORDER BY id LIMIT 1001
   ) v),'[]'::jsonb),
   'logs', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM (
     SELECT id,medication_id,scheduled_date,dose_number,taken FROM public.medication_logs WHERE patient_id=p_patient
       AND scheduled_date BETWEEN last_day-6 AND last_day ORDER BY id LIMIT 10001
   ) l),'[]'::jsonb)) FROM bounds
$$;

CREATE OR REPLACE FUNCTION public.get_provider_scheduled_adherence() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH calendar AS MATERIALIZED (
    SELECT DISTINCT l.patient_id, c.day AS last_day
    FROM public.provider_patient_links l CROSS JOIN LATERAL public.medication_calendar_at(l.patient_id,statement_timestamp()) c
    WHERE l.provider_id=auth.uid() AND l.status='active' AND public.provider_has_patient(l.patient_id)
  ), slots AS MATERIALIZED (
    SELECT s.medication_id, c.last_day - i AS day,
      CASE WHEN NOT s.known OR s.active IS NULL THEN NULL WHEN NOT s.active THEN 0
        ELSE public.medication_dose_slots(s.frequency,s.weekly_day,c.last_day-i) END AS expected
    FROM calendar c CROSS JOIN generate_series(0,6) i
    JOIN public.medication_schedule_versions s ON s.patient_id=c.patient_id AND s.starts_on<=c.last_day-i
      AND (s.ends_before IS NULL OR s.ends_before>c.last_day-i)
  ), logged AS (
    SELECT l.id, s.expected IS NOT NULL AND l.dose_number BETWEEN 1 AND s.expected AS confirmed
    FROM calendar c JOIN public.medication_logs l ON l.patient_id=c.patient_id
      AND l.scheduled_date BETWEEN c.last_day-6 AND c.last_day AND l.taken
    LEFT JOIN slots s ON s.medication_id=l.medication_id AND s.day=l.scheduled_date
  )
  SELECT CASE WHEN EXISTS(SELECT 1 FROM calendar c CROSS JOIN LATERAL public.unclassified_medication_dates(c.patient_id,c.last_day-6,c.last_day) g)
    OR EXISTS(SELECT 1 FROM slots WHERE expected IS NULL)
    OR EXISTS(SELECT 1 FROM logged WHERE NOT confirmed) THEN NULL
    ELSE round(100.0 * (SELECT count(*) FROM logged) / nullif((SELECT sum(expected) FROM slots),0))::integer END
$$;

-- Authenticated clients must go through a dated receipt. Keep the old RPC for
-- untouched calendars and harmless replays, including an interrupted earlier save.
ALTER FUNCTION public.record_medication_dose(uuid,uuid,uuid,date,integer,boolean) RENAME TO record_medication_dose_core;
REVOKE ALL ON FUNCTION public.record_medication_dose_core(uuid,uuid,uuid,date,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE INSERT,UPDATE ON public.medication_logs FROM PUBLIC,anon,authenticated;
DO $$
DECLARE columns text;
BEGIN
  SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO columns FROM pg_catalog.pg_attribute
    WHERE attrelid='public.medication_logs'::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('REVOKE INSERT (%1$s), UPDATE (%1$s) ON public.medication_logs FROM PUBLIC, anon, authenticated',columns);
END $$;
CREATE FUNCTION public.record_medication_dose(p_actor uuid,p_medication uuid,p_version uuid,p_day date,p_slot integer,p_taken boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
BEGIN
  IF p_actor IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR public.get_user_role() IS DISTINCT FROM 'patient'
    OR public.has_registration_consent() IS NOT TRUE THEN RAISE EXCEPTION 'Medication session changed' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.medications WHERE id=p_medication AND patient_id=p_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reload the medication schedule' USING ERRCODE='22023'; END IF;
  PERFORM public.lock_medication_calendar(p_actor);
  IF EXISTS(SELECT 1 FROM public.patient_medication_calendars WHERE patient_id=p_actor AND source='patient') THEN
    IF EXISTS(SELECT 1 FROM public.medication_logs l JOIN public.medication_schedule_versions s ON s.medication_id=l.medication_id
      WHERE l.patient_id=p_actor AND l.medication_id=p_medication AND l.scheduled_date=p_day AND l.dose_number=p_slot AND l.taken=p_taken
      AND s.id=p_version AND s.starts_on<=p_day AND (s.ends_before IS NULL OR s.ends_before>p_day)) THEN RETURN; END IF;
    RAISE EXCEPTION 'Reload the medication calendar' USING ERRCODE='22023';
  END IF;
  PERFORM public.record_medication_dose_core(p_actor,p_medication,p_version,p_day,p_slot,p_taken);
END;
$$;
REVOKE ALL ON FUNCTION public.record_medication_dose(uuid,uuid,uuid,date,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_medication_dose(uuid,uuid,uuid,date,integer,boolean) TO authenticated;

CREATE FUNCTION public.record_medication_dose_in_calendar(p_actor uuid,p_medication uuid,p_version uuid,p_day date,p_slot integer,p_taken boolean,p_calendar_revision uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE c record;
BEGIN
  IF p_actor IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR public.get_user_role() IS DISTINCT FROM 'patient'
    OR public.has_registration_consent() IS NOT TRUE THEN RAISE EXCEPTION 'Patient session unavailable' USING ERRCODE='42501'; END IF;
  -- Source-row then calendar lock, also used by the ordinary update and raw-log triggers.
  PERFORM 1 FROM public.medications WHERE id=p_medication AND patient_id=p_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medication unavailable' USING ERRCODE='22023'; END IF;
  PERFORM public.lock_medication_calendar(p_actor);
  SELECT * INTO STRICT c FROM public.medication_calendar_at(p_actor,clock_timestamp());
  IF c.revision IS DISTINCT FROM p_calendar_revision OR c.day IS DISTINCT FROM p_day THEN
    IF EXISTS(SELECT 1 FROM public.patient_medication_calendars WHERE patient_id=p_actor AND id=p_calendar_revision)
       AND EXISTS(SELECT 1 FROM public.medication_logs l JOIN public.medication_schedule_versions s ON s.medication_id=l.medication_id
        WHERE l.patient_id=p_actor AND l.medication_id=p_medication AND l.scheduled_date=p_day AND l.dose_number=p_slot AND l.taken=p_taken
        AND s.id=p_version AND s.starts_on<=p_day AND (s.ends_before IS NULL OR s.ends_before>p_day)) THEN RETURN; END IF;
    RAISE EXCEPTION 'Reload the medication calendar' USING ERRCODE='22023';
  END IF;
  PERFORM public.record_medication_dose_core(p_actor,p_medication,p_version,p_day,p_slot,p_taken);
END;
$$;
REVOKE ALL ON FUNCTION public.record_medication_dose_in_calendar(uuid,uuid,uuid,date,integer,boolean,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_medication_dose_in_calendar(uuid,uuid,uuid,date,integer,boolean,uuid) TO authenticated;
COMMIT;
