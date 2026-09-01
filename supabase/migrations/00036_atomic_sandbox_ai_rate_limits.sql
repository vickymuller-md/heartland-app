-- Make the public sandbox AI budget atomic across all three buckets.
-- A denied request does not consume global, requester, or session capacity.
-- The kind-scoped advisory lock also serializes the first insert into an empty
-- bucket, where row locks alone cannot prevent concurrent over-admission.
CREATE OR REPLACE FUNCTION public.consume_sandbox_ai_turn_v2(
  p_requester_hash text,
  p_session_hash text,
  p_kind text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_hour timestamptz := date_trunc('hour', now());
  v_day timestamptz := date_trunc('day', now());
  v_global_cap integer;
  v_requester_cap integer;
  v_session_cap integer;
  v_global_count integer;
  v_requester_count integer;
  v_session_count integer;
  v_global_hash text;
  v_requester_key text;
  v_session_key text;
BEGIN
  IF p_requester_hash !~ '^[0-9a-f]{64}$' OR p_session_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  IF p_kind = 'turn' THEN
    v_global_cap := 600; v_requester_cap := 40; v_session_cap := 30;
    -- Unprefixed keys keep continuity with the v1 buckets.
    v_global_hash := repeat('a', 64);
    v_requester_key := p_requester_hash;
    v_session_key := p_session_hash;
  ELSIF p_kind = 'copilot' THEN
    v_global_cap := 200; v_requester_cap := 10; v_session_cap := 10;
    v_global_hash := repeat('b', 64); -- sentinel row, not a real HMAC
    v_requester_key := encode(sha256(('copilot:' || p_requester_hash)::bytea), 'hex');
    v_session_key := encode(sha256(('copilot:' || p_session_hash)::bytea), 'hex');
  ELSE
    RETURN false;
  END IF;

  -- Public demo traffic is intentionally low-volume. Serializing each kind
  -- makes validation plus increment one atomic critical section, including
  -- when one or more bucket rows do not exist yet.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('heartland:sandbox-ai-rate-limit:' || p_kind, 0)
  );

  DELETE FROM public.public_sandbox_rate_limits
  WHERE window_started_at < now() - interval '48 hours';

  SELECT COALESCE(MAX(event_count), 0)
  INTO v_global_count
  FROM public.public_sandbox_rate_limits
  WHERE requester_hash = v_global_hash
    AND window_started_at = v_day;

  SELECT COALESCE(MAX(event_count), 0)
  INTO v_requester_count
  FROM public.public_sandbox_rate_limits
  WHERE requester_hash = v_requester_key
    AND window_started_at = v_hour;

  SELECT COALESCE(MAX(event_count), 0)
  INTO v_session_count
  FROM public.public_sandbox_rate_limits
  WHERE requester_hash = v_session_key
    AND window_started_at = v_day;

  IF v_global_count >= v_global_cap
     OR v_requester_count >= v_requester_cap
     OR v_session_count >= v_session_cap
  THEN
    RETURN false;
  END IF;

  INSERT INTO public.public_sandbox_rate_limits (requester_hash, window_started_at, event_count)
  VALUES (v_global_hash, v_day, 1)
  ON CONFLICT (requester_hash, window_started_at)
  DO UPDATE SET event_count = public.public_sandbox_rate_limits.event_count + 1;

  INSERT INTO public.public_sandbox_rate_limits (requester_hash, window_started_at, event_count)
  VALUES (v_requester_key, v_hour, 1)
  ON CONFLICT (requester_hash, window_started_at)
  DO UPDATE SET event_count = public.public_sandbox_rate_limits.event_count + 1;

  INSERT INTO public.public_sandbox_rate_limits (requester_hash, window_started_at, event_count)
  VALUES (v_session_key, v_day, 1)
  ON CONFLICT (requester_hash, window_started_at)
  DO UPDATE SET event_count = public.public_sandbox_rate_limits.event_count + 1;

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.consume_sandbox_ai_turn_v2(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_sandbox_ai_turn_v2(text, text, text)
  TO service_role;
