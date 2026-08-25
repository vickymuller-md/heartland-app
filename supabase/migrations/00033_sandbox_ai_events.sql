-- Sandbox AI-assisted check-in: layered rate limiting for the public LLM
-- endpoint and telemetry allowlist extension. Raw IPs, session identifiers,
-- conversation content and free text are never stored.

-- ── Turn budget for the public AI endpoint ─────────────────────────────────
-- Reuses public.public_sandbox_rate_limits with prefixed HMAC hashes.
-- Caps (raise by migration only, never at runtime):
--   * per requester (hourly window): 40 turns
--   * per anonymous session (daily window): 30 turns
--   * global (daily window, fixed sentinel hash): 600 turns (~40 conversations)
CREATE OR REPLACE FUNCTION public.consume_sandbox_ai_turn(
  p_requester_hash text,
  p_session_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_global_hash constant text := repeat('a', 64); -- sentinel row, not a real HMAC
  v_hour timestamptz := date_trunc('hour', now());
  v_day timestamptz := date_trunc('day', now());
  v_count integer;
BEGIN
  IF p_requester_hash !~ '^[0-9a-f]{64}$' OR p_session_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  DELETE FROM public.public_sandbox_rate_limits
  WHERE window_started_at < now() - interval '48 hours';

  INSERT INTO public.public_sandbox_rate_limits (requester_hash, window_started_at, event_count)
  VALUES (v_global_hash, v_day, 1)
  ON CONFLICT (requester_hash, window_started_at)
  DO UPDATE SET event_count = public.public_sandbox_rate_limits.event_count + 1
  RETURNING event_count INTO v_count;
  IF v_count > 600 THEN
    RETURN false;
  END IF;

  INSERT INTO public.public_sandbox_rate_limits (requester_hash, window_started_at, event_count)
  VALUES (p_requester_hash, v_hour, 1)
  ON CONFLICT (requester_hash, window_started_at)
  DO UPDATE SET event_count = public.public_sandbox_rate_limits.event_count + 1
  RETURNING event_count INTO v_count;
  IF v_count > 40 THEN
    RETURN false;
  END IF;

  INSERT INTO public.public_sandbox_rate_limits (requester_hash, window_started_at, event_count)
  VALUES (p_session_hash, v_day, 1)
  ON CONFLICT (requester_hash, window_started_at)
  DO UPDATE SET event_count = public.public_sandbox_rate_limits.event_count + 1
  RETURNING event_count INTO v_count;
  IF v_count > 30 THEN
    RETURN false;
  END IF;

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.consume_sandbox_ai_turn(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_sandbox_ai_turn(text, text)
  TO service_role;

-- ── Telemetry allowlist: AI demonstration events ───────────────────────────
CREATE OR REPLACE FUNCTION public.record_public_sandbox_event(
  p_requester_hash text,
  p_event_id uuid,
  p_event_name text,
  p_device_class text DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_session_hash text DEFAULT NULL,
  p_campaign_source text DEFAULT NULL,
  p_campaign_medium text DEFAULT NULL,
  p_campaign_name text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_window_started_at timestamptz := date_trunc('hour', now());
  v_event_count integer;
BEGIN
  IF p_requester_hash !~ '^[0-9a-f]{64}$'
     OR p_event_id IS NULL
     OR p_event_name NOT IN (
       'sandbox_view', 'sandbox_first_action',
       'sandbox_task_completed', 'sandbox_returned',
       'ai_checkin_started', 'ai_checkin_completed', 'ai_checkin_fallback',
       'ai_call_sim_run', 'ai_escalation_demonstrated'
     )
     OR (p_device_class IS NOT NULL AND p_device_class NOT IN ('mobile', 'tablet', 'desktop'))
     OR (p_duration_ms IS NOT NULL AND p_duration_ms NOT BETWEEN 0 AND 3600000)
     OR (p_session_hash IS NOT NULL AND p_session_hash !~ '^[0-9a-f]{64}$')
     OR (p_campaign_source IS NOT NULL AND p_campaign_source !~ '^[A-Za-z0-9._~-]{1,80}$')
     OR (p_campaign_medium IS NOT NULL AND p_campaign_medium !~ '^[A-Za-z0-9._~-]{1,80}$')
     OR (p_campaign_name IS NOT NULL AND p_campaign_name !~ '^[A-Za-z0-9._~-]{1,80}$')
  THEN
    RETURN false;
  END IF;

  DELETE FROM public.public_sandbox_rate_limits
  WHERE window_started_at < now() - interval '48 hours';

  INSERT INTO public.public_sandbox_rate_limits (
    requester_hash, window_started_at, event_count
  ) VALUES (
    p_requester_hash, v_window_started_at, 1
  )
  ON CONFLICT (requester_hash, window_started_at)
  DO UPDATE SET event_count = public.public_sandbox_rate_limits.event_count + 1
  RETURNING event_count INTO v_event_count;

  IF v_event_count > 120 THEN
    RETURN false;
  END IF;

  UPDATE public.product_events
  SET duration_ms = COALESCE(p_duration_ms, duration_ms),
      anonymous_session_hash = COALESCE(anonymous_session_hash, p_session_hash),
      campaign_source = COALESCE(campaign_source, p_campaign_source),
      campaign_medium = COALESCE(campaign_medium, p_campaign_medium),
      campaign_name = COALESCE(campaign_name, p_campaign_name)
  WHERE id = p_event_id
    AND actor_id IS NULL
    AND actor_role = 'tester'
    AND event_name = p_event_name
    AND area = 'sandbox';
  IF FOUND THEN
    RETURN true;
  END IF;

  IF EXISTS (SELECT 1 FROM public.product_events WHERE id = p_event_id) THEN
    RETURN false;
  END IF;

  INSERT INTO public.product_events (
    id, actor_id, actor_role, event_name, area, device_class, duration_ms,
    anonymous_session_hash, campaign_source, campaign_medium, campaign_name
  ) VALUES (
    p_event_id, NULL, 'tester', p_event_name, 'sandbox', p_device_class, p_duration_ms,
    p_session_hash, p_campaign_source, p_campaign_medium, p_campaign_name
  );
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.record_public_sandbox_event(
  text, uuid, text, text, integer, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_public_sandbox_event(
  text, uuid, text, text, integer, text, text, text, text
) TO service_role;

-- ── Adoption summary: AI demonstration aggregates ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_adoption_summary(p_since timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'active_sandbox_accounts', (
      SELECT count(*) FROM public.profiles
      WHERE role = 'tester' AND sandbox_expires_at > now()
    ),
    'unique_sandbox_testers', (
      SELECT count(DISTINCT actor_id) FROM public.product_events
      WHERE actor_role = 'tester' AND occurred_at >= p_since AND actor_id IS NOT NULL
    ) + (
      SELECT count(DISTINCT anonymous_session_hash) FROM public.product_events
      WHERE actor_role = 'tester' AND actor_id IS NULL
        AND anonymous_session_hash IS NOT NULL AND occurred_at >= p_since
    ),
    'public_sandbox_sessions', (
      SELECT count(DISTINCT anonymous_session_hash) FROM public.product_events
      WHERE actor_role = 'tester' AND actor_id IS NULL
        AND anonymous_session_hash IS NOT NULL AND occurred_at >= p_since
    ),
    'sandbox_views', (
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND event_name = 'sandbox_view'
        AND occurred_at >= p_since
    ),
    'public_sandbox_views', (
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND actor_id IS NULL
        AND event_name = 'sandbox_view' AND occurred_at >= p_since
    ),
    'sandbox_first_actions', (
      SELECT count(DISTINCT actor_id) FROM public.product_events
      WHERE actor_role = 'tester' AND event_name = 'sandbox_first_action'
        AND occurred_at >= p_since AND actor_id IS NOT NULL
    ) + (
      SELECT count(DISTINCT anonymous_session_hash) FROM public.product_events
      WHERE actor_role = 'tester' AND actor_id IS NULL
        AND anonymous_session_hash IS NOT NULL
        AND event_name = 'sandbox_first_action' AND occurred_at >= p_since
    ),
    'sandbox_task_completions', (
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND event_name = 'sandbox_task_completed'
        AND occurred_at >= p_since
    ),
    'ai_checkins_started', (
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND actor_id IS NULL
        AND event_name = 'ai_checkin_started' AND occurred_at >= p_since
    ),
    'ai_checkins_completed', (
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND actor_id IS NULL
        AND event_name = 'ai_checkin_completed' AND occurred_at >= p_since
    ),
    'ai_checkin_fallbacks', (
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND actor_id IS NULL
        AND event_name = 'ai_checkin_fallback' AND occurred_at >= p_since
    ),
    'ai_call_simulations', (
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND actor_id IS NULL
        AND event_name = 'ai_call_sim_run' AND occurred_at >= p_since
    ),
    'ai_escalations_demonstrated', (
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND actor_id IS NULL
        AND event_name = 'ai_escalation_demonstrated' AND occurred_at >= p_since
    ),
    'median_session_duration_ms', COALESCE((
      SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_ms)
      FROM public.product_events
      WHERE actor_role = 'tester' AND event_name = 'sandbox_view'
        AND occurred_at >= p_since AND duration_ms IS NOT NULL
    ), 0),
    'campaign_sources', COALESCE((
      SELECT jsonb_object_agg(source, session_count)
      FROM (
        SELECT campaign_source AS source,
               count(DISTINCT anonymous_session_hash) AS session_count
        FROM public.product_events
        WHERE actor_role = 'tester' AND actor_id IS NULL
          AND event_name = 'sandbox_view' AND occurred_at >= p_since
          AND anonymous_session_hash IS NOT NULL AND campaign_source IS NOT NULL
        GROUP BY campaign_source
        ORDER BY session_count DESC, campaign_source
      ) AS source_counts
    ), '{}'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION public.get_adoption_summary(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_adoption_summary(timestamptz)
  TO service_role;
