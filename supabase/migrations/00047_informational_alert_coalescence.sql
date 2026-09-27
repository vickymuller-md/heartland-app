-- Preserve existing proactive rule severities. The scanner already emits
-- informational no_checkin/followup_due signals; do not promote them to warning.
-- Body is 00028's coalescer with only the NULL/allowed-severity guard corrected.
-- No source backfill, delivery, outcome, episode, timing or threshold change.
CREATE OR REPLACE FUNCTION public.coalesce_patient_alert(
  p_patient_id uuid,
  p_vitals_id uuid,
  p_severity text,
  p_flags text[]
)
RETURNS TABLE (alert_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  existing_alert_id uuid;
  normalized_flags text[];
BEGIN
  IF p_severity IS NULL OR p_severity NOT IN ('critical', 'warning', 'informational') THEN
    RAISE EXCEPTION 'invalid alert severity';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT flag
    FROM unnest(p_flags) AS flag
    WHERE flag IS NOT NULL AND btrim(flag) <> ''
    ORDER BY flag
  ) INTO normalized_flags;

  IF cardinality(normalized_flags) = 0 THEN
    RAISE EXCEPTION 'at least one alert flag is required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_patient_id::text, 0)
  );

  SELECT alert.id
  INTO existing_alert_id
  FROM public.alerts AS alert
  WHERE alert.patient_id = p_patient_id
    AND alert.status IN ('open', 'acknowledged')
    AND alert.flags && normalized_flags
  ORDER BY alert.last_seen_at DESC, alert.id
  FOR UPDATE
  LIMIT 1;

  IF existing_alert_id IS NOT NULL THEN
    UPDATE public.alerts
    SET flags = ARRAY(
          SELECT DISTINCT flag
          FROM unnest(public.alerts.flags || normalized_flags) AS flag
          ORDER BY flag
        ),
        severity = CASE
          WHEN public.alerts.severity = 'critical' OR p_severity = 'critical'
            THEN 'critical'
          WHEN public.alerts.severity = 'warning' OR p_severity = 'warning'
            THEN 'warning'
          ELSE 'informational'
        END,
        vitals_id = COALESCE(p_vitals_id, public.alerts.vitals_id),
        occurrence_count = public.alerts.occurrence_count + 1,
        last_seen_at = now()
    WHERE id = existing_alert_id;

    RETURN QUERY SELECT existing_alert_id, false;
    RETURN;
  END IF;

  INSERT INTO public.alerts (
    patient_id, vitals_id, severity, flags, status,
    occurrence_count, first_seen_at, last_seen_at
  ) VALUES (
    p_patient_id, p_vitals_id, p_severity, normalized_flags, 'open',
    1, now(), now()
  ) RETURNING id INTO existing_alert_id;

  RETURN QUERY SELECT existing_alert_id, true;
END;
$$;
