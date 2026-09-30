-- N2p1: real coalescer/trigger regressions, synthetic fixtures rolled back.
-- One transaction intentionally keeps now() fixed. This proves sequential closure,
-- not a committed two-session closure race or notification delivery.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

SELECT ok(NOT has_column_privilege('authenticated', 'public.alerts', 'severity', 'UPDATE'),
  'clients cannot change alert severity');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.refresh_coalesced_alert_work_item()', 'EXECUTE'), 'refresh stays internal');
SELECT ok(NOT has_function_privilege('anon',
  'public.refresh_coalesced_alert_work_item()', 'EXECUTE'), 'anonymous refresh denied');

INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
 ('42000000-0000-4000-8000-000000000001', 'refresh-provider@example.invalid', '{"consent_accepted":true}'),
 ('42000000-0000-4000-8000-000000000011', 'refresh-patient@example.invalid', '{"consent_accepted":true}');
UPDATE public.profiles SET role = 'provider', full_name = 'Synthetic Refresh Provider'
WHERE id = '42000000-0000-4000-8000-000000000001';
INSERT INTO public.provider_patient_links(provider_id, patient_id, status, linked_at)
VALUES ('42000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000011', 'active', now());
INSERT INTO public.organization_patient_assignments(organization_id, patient_id, assigned_by)
SELECT public.primary_organization_for_provider('42000000-0000-4000-8000-000000000001'),
  '42000000-0000-4000-8000-000000000011', '42000000-0000-4000-8000-000000000001'
ON CONFLICT (organization_id, patient_id) DO NOTHING;

-- Rolled-back monitoring grant for the fixture's explicit acceptance command.
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor',user_id FROM public.organization_memberships
 WHERE user_id='42000000-0000-4000-8000-000000000001' AND status='active';
CREATE TEMP TABLE refresh_calls(label text PRIMARY KEY, alert_id uuid, created boolean);
GRANT SELECT, INSERT ON refresh_calls TO service_role, authenticated;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO refresh_calls SELECT 'first', * FROM public.coalesce_patient_alert(
  '42000000-0000-4000-8000-000000000011', NULL, 'warning', ARRAY['sodium_high']);
SELECT ok((SELECT created FROM refresh_calls WHERE label = 'first'), 'first call creates alert');
RESET ROLE;
CREATE TEMP TABLE refresh_initial AS
SELECT * FROM public.work_items WHERE source_id = (SELECT alert_id FROM refresh_calls WHERE label = 'first');
GRANT SELECT ON refresh_initial TO service_role, authenticated;
SELECT is((SELECT count(*)::int FROM refresh_initial), 1, 'one accountable fixture item exists');

SET LOCAL ROLE service_role;
INSERT INTO refresh_calls SELECT 'repeat', * FROM public.coalesce_patient_alert(
  '42000000-0000-4000-8000-000000000011', NULL, 'warning', ARRAY['sodium_high']);
SELECT ok(NOT (SELECT created FROM refresh_calls WHERE label = 'repeat'), 'repeat coalesces');
SELECT is((SELECT alert_id FROM refresh_calls WHERE label = 'repeat'),
  (SELECT alert_id FROM refresh_calls WHERE label = 'first'), 'same alert identity');
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT last_seen_at FROM public.alerts WHERE id = (SELECT alert_id FROM refresh_calls WHERE label = 'first')),
  (SELECT freshness_at FROM refresh_initial), 'now remains fixed without manipulating the clock');
SELECT is((SELECT occurrence_count FROM public.alerts WHERE id = (SELECT alert_id FROM refresh_calls WHERE label = 'first')),
  2, 'source counts both observations');
SET LOCAL ROLE service_role;
SELECT is((SELECT reason FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  'Triggered signals: sodium_high · observed 2 times', 'count-only refresh updates the work item');
SELECT is((SELECT count(*)::int FROM public.work_item_events
  WHERE work_item_id = (SELECT id FROM refresh_initial) AND event_type = 'updated'),
  1, 'count-only refresh records one updated event');

INSERT INTO refresh_calls SELECT 'flag', * FROM public.coalesce_patient_alert(
  '42000000-0000-4000-8000-000000000011', NULL, 'warning', ARRAY['sodium_high', 'weight_gain']);
SELECT is((SELECT reason FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  'Triggered signals: sodium_high, weight_gain · observed 3 times', 'new flag refreshes at unchanged severity/time');
SELECT is((SELECT severity FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  'warning', 'adding a warning flag does not invent critical severity');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"42000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok($q$SELECT public.accept_work_item((SELECT id FROM refresh_initial))$q$,
  'real provider RPC accepts work');
UPDATE public.alerts SET status = 'acknowledged'
WHERE id = (SELECT alert_id FROM refresh_calls WHERE label = 'first');
SELECT is((SELECT status FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  'reviewed', 'human ACK projects reviewed status');
SELECT throws_ok($q$UPDATE public.alerts SET severity = 'critical'
  WHERE id = (SELECT alert_id FROM refresh_calls WHERE label = 'first')$q$,
  '42501', 'permission denied for table alerts', 'authenticated severity mutation denied');
SELECT throws_ok($q$UPDATE public.work_items SET reason = 'Forged signal context'
  WHERE id = (SELECT id FROM refresh_initial)$q$,
  '42501', 'permission denied for table work_items', 'authenticated context mutation denied');
RESET ROLE;
CREATE TEMP TABLE refresh_accepted AS SELECT * FROM public.work_items WHERE id = (SELECT id FROM refresh_initial);
GRANT SELECT ON refresh_accepted TO service_role;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO refresh_calls SELECT 'escalate', * FROM public.coalesce_patient_alert(
  '42000000-0000-4000-8000-000000000011', NULL, 'critical', ARRAY['sodium_high']);
SELECT is((SELECT severity FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  'critical', 'warning escalates to critical after ACK in the same transaction');
SELECT is((SELECT reason FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  'Triggered signals: sodium_high, weight_gain · observed 4 times', 'escalation count reaches item');
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT status FROM public.alerts WHERE id = (SELECT alert_id FROM refresh_calls WHERE label = 'first')),
  'acknowledged', 'escalation does not clear human ACK');
SET LOCAL ROLE service_role;
SELECT is((SELECT status FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  'reviewed', 'escalation does not invent a new review or reopen work');
SELECT is((SELECT priority FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  'today', 'known urgency gap: critical signal keeps original today priority');
SELECT is((SELECT due_at FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  (SELECT due_at FROM refresh_initial), 'known urgency gap: due time unchanged');
SELECT is((SELECT assigned_to FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  (SELECT assigned_to FROM refresh_accepted), 'assignee unchanged');
SELECT is((SELECT accepted_at FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  (SELECT accepted_at FROM refresh_accepted), 'human acceptance timestamp preserved');
SELECT is((SELECT accepted_by FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  (SELECT accepted_by FROM refresh_accepted), 'human acceptance actor preserved');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id = (SELECT alert_id FROM refresh_calls WHERE label = 'first')),
  1, 'escalation does not duplicate work');

-- Isolate the trigger's remaining columns: coalescer calls above also change count,
-- so they alone cannot prove independent flag/severity/freshness predicates.
-- Owner fixture writes test the trigger independently of installation-specific
-- legacy service grants. Public coalescer calls above/below retain service_role.
RESET ROLE;
UPDATE public.alerts SET flags = flags || ARRAY['isolated_fixture_flag']
WHERE id = (SELECT alert_id FROM refresh_calls WHERE label = 'first');
SELECT ok((SELECT reason LIKE '%isolated_fixture_flag%' FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  'flag-only source update refreshes the work item context');
UPDATE public.alerts SET severity = 'warning'
WHERE id = (SELECT alert_id FROM refresh_calls WHERE label = 'first');
SELECT is((SELECT severity FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  'warning', 'severity-only change reaches the item');
UPDATE public.alerts SET severity = 'critical'
WHERE id = (SELECT alert_id FROM refresh_calls WHERE label = 'first');
SELECT is((SELECT severity FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  'critical', 'severity-only escalation reaches the item');
-- Separate timestamp-only projection case; core intratransaction tests above never adjust time.
UPDATE public.alerts SET last_seen_at = last_seen_at - interval '1 microsecond'
WHERE id = (SELECT alert_id FROM refresh_calls WHERE label = 'first');
SELECT is((SELECT freshness_at FROM public.work_items WHERE id = (SELECT id FROM refresh_initial)),
  (SELECT last_seen_at FROM public.alerts WHERE id = (SELECT alert_id FROM refresh_calls WHERE label = 'first')),
  'timestamp-only change retains the prior refresh behavior');

CREATE TEMP TABLE refresh_before_noop AS SELECT * FROM public.work_items WHERE id = (SELECT id FROM refresh_initial);
CREATE TEMP TABLE refresh_event_count AS SELECT count(*)::int AS n FROM public.work_item_events WHERE work_item_id = (SELECT id FROM refresh_initial);
GRANT SELECT ON refresh_before_noop, refresh_event_count TO service_role;
UPDATE public.alerts SET flags = flags, severity = severity, occurrence_count = occurrence_count, last_seen_at = last_seen_at
WHERE id = (SELECT alert_id FROM refresh_calls WHERE label = 'first');
SELECT is((SELECT to_jsonb(w) FROM public.work_items w WHERE id = (SELECT id FROM refresh_initial)),
  (SELECT to_jsonb(w) FROM refresh_before_noop w), 'semantic no-op leaves the whole item unchanged');
SELECT is((SELECT count(*)::int FROM public.work_item_events WHERE work_item_id = (SELECT id FROM refresh_initial)),
  (SELECT n FROM refresh_event_count), 'semantic no-op writes no event');

-- Sequential closure: retain the open underlying alert on purpose. A later signal
-- is not permission to rewrite completed context or invent a new clinical episode.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"42000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
UPDATE public.work_items SET status = 'closed', outcome = 'Synthetic documented disposition', outcome_code = 'clinical_action_taken'
WHERE id = (SELECT id FROM refresh_initial);
RESET ROLE;
CREATE TEMP TABLE refresh_closed AS SELECT * FROM public.work_items WHERE id = (SELECT id FROM refresh_initial);
CREATE TEMP TABLE refresh_closed_events AS SELECT count(*)::int AS n FROM public.work_item_events WHERE work_item_id = (SELECT id FROM refresh_initial);
GRANT SELECT ON refresh_closed, refresh_closed_events TO service_role;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO refresh_calls SELECT 'after_close', * FROM public.coalesce_patient_alert(
  '42000000-0000-4000-8000-000000000011', NULL, 'critical', ARRAY['sodium_high', 'dyspnea']);
-- Owner inspection only; the preceding operation retains its API role.
RESET ROLE;
SELECT is((SELECT occurrence_count FROM public.alerts WHERE id = (SELECT alert_id FROM refresh_calls WHERE label = 'first')),
  5, 'later source signal remains recorded');
SET LOCAL ROLE service_role;
SELECT is((SELECT to_jsonb(w) FROM public.work_items w WHERE id = (SELECT id FROM refresh_initial)),
  (SELECT to_jsonb(w) FROM refresh_closed w), 'later coalescence preserves every closed item field');
SELECT is((SELECT count(*)::int FROM public.work_item_events WHERE work_item_id = (SELECT id FROM refresh_initial)),
  (SELECT n FROM refresh_closed_events), 'later coalescence appends no closed-item refresh event');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE source_id = (SELECT alert_id FROM refresh_calls WHERE label = 'first')),
  1, 'closed recurrence does not manufacture a new episode');
SELECT throws_ok($q$UPDATE public.work_items SET reason = 'Service rewrite of closed context'
  WHERE id = (SELECT id FROM refresh_initial)$q$, 'P0001', 'work item source and context are immutable',
  'enforcer rejects direct service rewrite of closed reason');
SELECT throws_ok($q$UPDATE public.work_items SET severity = 'warning'
  WHERE id = (SELECT id FROM refresh_initial)$q$, 'P0001', 'work item source and context are immutable',
  'enforcer rejects direct service rewrite of closed severity');
SELECT throws_ok($q$UPDATE public.work_items SET freshness_at = NULL
  WHERE id = (SELECT id FROM refresh_initial)$q$, 'P0001', 'work item source and context are immutable',
  'enforcer rejects direct service rewrite of closed freshness');
SELECT throws_ok($q$UPDATE public.work_items SET status = 'reviewed'
  WHERE id = (SELECT id FROM refresh_initial)$q$, 'P0001', 'closed work items cannot be reopened',
  'closed status remains irreversible');
SELECT throws_ok($q$UPDATE public.work_items SET outcome_code = 'no_action_needed'
  WHERE id = (SELECT id FROM refresh_initial)$q$, 'P0001', 'closed work items cannot be reopened',
  'closed outcome code remains immutable');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
