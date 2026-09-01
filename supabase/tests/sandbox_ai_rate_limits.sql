BEGIN;
SELECT plan(18);

DELETE FROM public.public_sandbox_rate_limits
WHERE (requester_hash = repeat('a', 64) AND window_started_at = date_trunc('day', now()))
   OR (requester_hash = repeat('1', 64) AND window_started_at = date_trunc('hour', now()))
   OR (requester_hash = repeat('2', 64) AND window_started_at = date_trunc('day', now()));

INSERT INTO public.public_sandbox_rate_limits (requester_hash, window_started_at, event_count)
VALUES
  (repeat('a', 64), date_trunc('day', now()), 5),
  (repeat('1', 64), date_trunc('hour', now()), 40),
  (repeat('2', 64), date_trunc('day', now()), 3);

SELECT is(
  public.consume_sandbox_ai_turn_v2(repeat('1', 64), repeat('2', 64), 'turn'),
  false,
  'requester cap denies the call'
);
SELECT is(
  (SELECT event_count FROM public.public_sandbox_rate_limits WHERE requester_hash = repeat('a', 64) AND window_started_at = date_trunc('day', now())),
  5,
  'requester denial does not consume global capacity'
);
SELECT is(
  (SELECT event_count FROM public.public_sandbox_rate_limits WHERE requester_hash = repeat('1', 64) AND window_started_at = date_trunc('hour', now())),
  40,
  'requester denial leaves requester capacity unchanged'
);
SELECT is(
  (SELECT event_count FROM public.public_sandbox_rate_limits WHERE requester_hash = repeat('2', 64) AND window_started_at = date_trunc('day', now())),
  3,
  'requester denial leaves session capacity unchanged'
);

UPDATE public.public_sandbox_rate_limits
SET event_count = 39
WHERE requester_hash = repeat('1', 64)
  AND window_started_at = date_trunc('hour', now());

SELECT is(
  public.consume_sandbox_ai_turn_v2(repeat('1', 64), repeat('2', 64), 'turn'),
  true,
  'call below every cap is allowed'
);
SELECT is(
  (SELECT event_count FROM public.public_sandbox_rate_limits WHERE requester_hash = repeat('a', 64) AND window_started_at = date_trunc('day', now())),
  6,
  'allowed call consumes one global turn'
);
SELECT is(
  (SELECT event_count FROM public.public_sandbox_rate_limits WHERE requester_hash = repeat('1', 64) AND window_started_at = date_trunc('hour', now())),
  40,
  'allowed call consumes one requester turn'
);
SELECT is(
  (SELECT event_count FROM public.public_sandbox_rate_limits WHERE requester_hash = repeat('2', 64) AND window_started_at = date_trunc('day', now())),
  4,
  'allowed call consumes one session turn'
);

UPDATE public.public_sandbox_rate_limits
SET event_count = CASE
  WHEN requester_hash = repeat('a', 64) THEN 7
  WHEN requester_hash = repeat('1', 64) THEN 2
  ELSE 30
END
WHERE (requester_hash = repeat('a', 64) AND window_started_at = date_trunc('day', now()))
   OR (requester_hash = repeat('1', 64) AND window_started_at = date_trunc('hour', now()))
   OR (requester_hash = repeat('2', 64) AND window_started_at = date_trunc('day', now()));

SELECT is(
  public.consume_sandbox_ai_turn_v2(repeat('1', 64), repeat('2', 64), 'turn'),
  false,
  'session cap denies the call'
);
SELECT is(
  (SELECT event_count FROM public.public_sandbox_rate_limits WHERE requester_hash = repeat('a', 64) AND window_started_at = date_trunc('day', now())),
  7,
  'session denial does not consume global capacity'
);
SELECT is(
  (SELECT event_count FROM public.public_sandbox_rate_limits WHERE requester_hash = repeat('1', 64) AND window_started_at = date_trunc('hour', now())),
  2,
  'session denial does not consume requester capacity'
);
SELECT is(
  (SELECT event_count FROM public.public_sandbox_rate_limits WHERE requester_hash = repeat('2', 64) AND window_started_at = date_trunc('day', now())),
  30,
  'session denial leaves session capacity unchanged'
);

UPDATE public.public_sandbox_rate_limits
SET event_count = CASE
  WHEN requester_hash = repeat('a', 64) THEN 600
  WHEN requester_hash = repeat('1', 64) THEN 2
  ELSE 3
END
WHERE (requester_hash = repeat('a', 64) AND window_started_at = date_trunc('day', now()))
   OR (requester_hash = repeat('1', 64) AND window_started_at = date_trunc('hour', now()))
   OR (requester_hash = repeat('2', 64) AND window_started_at = date_trunc('day', now()));

SELECT is(
  public.consume_sandbox_ai_turn_v2(repeat('1', 64), repeat('2', 64), 'turn'),
  false,
  'global cap denies the call'
);
SELECT is(
  (SELECT event_count FROM public.public_sandbox_rate_limits WHERE requester_hash = repeat('a', 64) AND window_started_at = date_trunc('day', now())),
  600,
  'global denial leaves global capacity unchanged'
);
SELECT is(
  (SELECT event_count FROM public.public_sandbox_rate_limits WHERE requester_hash = repeat('1', 64) AND window_started_at = date_trunc('hour', now())),
  2,
  'global denial leaves requester capacity unchanged'
);
SELECT is(
  (SELECT event_count FROM public.public_sandbox_rate_limits WHERE requester_hash = repeat('2', 64) AND window_started_at = date_trunc('day', now())),
  3,
  'global denial leaves session capacity unchanged'
);

SELECT ok(
  position(
    'pg_advisory_xact_lock' IN pg_get_functiondef('public.consume_sandbox_ai_turn_v2(text,text,text)'::regprocedure)
  ) > 0,
  'function serializes validation and mutation for each kind'
);
SELECT ok(
  position(
    'IF v_global_count >= v_global_cap' IN pg_get_functiondef('public.consume_sandbox_ai_turn_v2(text,text,text)'::regprocedure)
  ) < position(
    'INSERT INTO public.public_sandbox_rate_limits' IN pg_get_functiondef('public.consume_sandbox_ai_turn_v2(text,text,text)'::regprocedure)
  ),
  'all cap checks occur before the first increment'
);

SELECT * FROM finish();
ROLLBACK;
