-- Sandbox Copilot: kind-scoped turn budget for the public AI endpoints.
-- v2 of consume_sandbox_ai_turn parameterizes the caps per kind so the
-- copilot agent (tool-use questions) draws from its own bucket and can never
-- drain the conversational demo budget. The v1 function stays untouched for
-- compatibility; application routes call v2 only. Raw IPs, session
-- identifiers, conversation content and free text are never stored.

-- Caps (raise by migration only, never at runtime):
--   kind 'turn'    — per requester (hourly): 40 · per session (daily): 30 · global (daily): 600
--   kind 'copilot' — per requester (hourly): 10 · per session (daily): 10 · global (daily): 200
-- Buckets are separated per kind by re-hashing the keys with a kind prefix
-- (the storage table CHECK-constrains keys to 64 hex chars); the sentinel
-- global row is likewise kind-scoped.
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
  v_count integer;
  v_global_cap integer;
  v_requester_cap integer;
  v_session_cap integer;
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

  DELETE FROM public.public_sandbox_rate_limits
  WHERE window_started_at < now() - interval '48 hours';

  INSERT INTO public.public_sandbox_rate_limits (requester_hash, window_started_at, event_count)
  VALUES (v_global_hash, v_day, 1)
  ON CONFLICT (requester_hash, window_started_at)
  DO UPDATE SET event_count = public.public_sandbox_rate_limits.event_count + 1
  RETURNING event_count INTO v_count;
  IF v_count > v_global_cap THEN
    RETURN false;
  END IF;

  INSERT INTO public.public_sandbox_rate_limits (requester_hash, window_started_at, event_count)
  VALUES (v_requester_key, v_hour, 1)
  ON CONFLICT (requester_hash, window_started_at)
  DO UPDATE SET event_count = public.public_sandbox_rate_limits.event_count + 1
  RETURNING event_count INTO v_count;
  IF v_count > v_requester_cap THEN
    RETURN false;
  END IF;

  INSERT INTO public.public_sandbox_rate_limits (requester_hash, window_started_at, event_count)
  VALUES (v_session_key, v_day, 1)
  ON CONFLICT (requester_hash, window_started_at)
  DO UPDATE SET event_count = public.public_sandbox_rate_limits.event_count + 1
  RETURNING event_count INTO v_count;
  IF v_count > v_session_cap THEN
    RETURN false;
  END IF;

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.consume_sandbox_ai_turn_v2(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_sandbox_ai_turn_v2(text, text, text)
  TO service_role;
