-- Privacy-safe anonymous telemetry for the public synthetic sandbox.
-- Raw IP addresses, cookies, user agents, patient IDs and free text are never stored.

CREATE TABLE public.public_sandbox_rate_limits (
  requester_hash    text NOT NULL CHECK (requester_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  event_count       integer NOT NULL DEFAULT 1 CHECK (event_count > 0),
  PRIMARY KEY (requester_hash, window_started_at)
);

ALTER TABLE public.public_sandbox_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_sandbox_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.public_sandbox_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.public_sandbox_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.record_public_sandbox_event(
  p_requester_hash text,
  p_event_id uuid,
  p_event_name text,
  p_device_class text DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL
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
       'sandbox_task_completed', 'sandbox_returned'
     )
     OR (p_device_class IS NOT NULL AND p_device_class NOT IN ('mobile', 'tablet', 'desktop'))
     OR (p_duration_ms IS NOT NULL AND p_duration_ms NOT BETWEEN 0 AND 3600000)
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

  -- Shared networks receive enough capacity for a full tour while obvious event
  -- floods fail closed. The daily HMAC input rotates outside the database.
  IF v_event_count > 120 THEN
    RETURN false;
  END IF;

  UPDATE public.product_events
  SET duration_ms = COALESCE(p_duration_ms, duration_ms)
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
    id, actor_id, actor_role, event_name, area, device_class, duration_ms
  ) VALUES (
    p_event_id, NULL, 'tester', p_event_name, 'sandbox', p_device_class, p_duration_ms
  );
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.record_public_sandbox_event(text, uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_public_sandbox_event(text, uuid, text, text, integer)
  TO service_role;

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
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND actor_id IS NULL
        AND event_name = 'sandbox_first_action' AND occurred_at >= p_since
    ),
    'public_sandbox_first_actions', (
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND actor_id IS NULL
        AND event_name = 'sandbox_first_action' AND occurred_at >= p_since
    ),
    'sandbox_task_completions', (
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND event_name = 'sandbox_task_completed'
        AND occurred_at >= p_since
    ),
    'public_sandbox_task_completions', (
      SELECT count(*) FROM public.product_events
      WHERE actor_role = 'tester' AND actor_id IS NULL
        AND event_name = 'sandbox_task_completed' AND occurred_at >= p_since
    ),
    'median_session_duration_ms', COALESCE((
      SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_ms)
      FROM public.product_events
      WHERE actor_role = 'tester' AND event_name = 'sandbox_view'
        AND occurred_at >= p_since AND duration_ms IS NOT NULL
    ), 0)
  )
$$;

REVOKE ALL ON FUNCTION public.get_adoption_summary(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_adoption_summary(timestamptz)
  TO service_role;
