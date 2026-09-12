-- Real RPC/trigger regression tests. Run on a disposable database after all migrations.
-- Synthetic fixtures and failure injection are rolled back; no transport is invoked.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

SELECT has_function('public', 'submit_lab_result',
  ARRAY['uuid', 'uuid', 'timestamp with time zone', 'numeric', 'numeric', 'numeric', 'numeric', 'text'],
  'authenticated idempotent lab submission exists');
SELECT has_function('public', 'process_lab_alert_event', ARRAY['uuid'], 'service event processor exists');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'lab-provider@example.invalid', '{"consent_accepted":true}'),
  ('f1000000-0000-4000-8000-000000000002', 'lab-unlinked@example.invalid', '{"consent_accepted":true}'),
  ('f1000000-0000-4000-8000-000000000003', 'lab-no-consent@example.invalid', '{}'),
  ('f1000000-0000-4000-8000-000000000011', 'lab-patient-one@example.invalid', '{"consent_accepted":true}'),
  ('f1000000-0000-4000-8000-000000000012', 'lab-patient-two@example.invalid', '{"consent_accepted":true}'),
  ('f1000000-0000-4000-8000-000000000021', 'lab-tester@example.invalid', '{"signup_intent":"sandbox","consent_accepted":true}');
UPDATE public.profiles SET role = 'provider'
WHERE id IN ('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000003');
-- Existing provisioning triggers create governed personal organizations and assignments.
INSERT INTO public.provider_patient_links (provider_id, patient_id, status, linked_at) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000011', 'active', now()),
  ('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000012', 'active', now()),
  ('f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000011', 'active', now());
CREATE TEMP TABLE lab_test_results (label text PRIMARY KEY, lab_result_id uuid, event_id uuid, status text);
GRANT ALL ON TABLE lab_test_results TO authenticated, service_role;

-- Keep the original fixed request UUIDs for outbox regressions. This fixture-only
-- helper closes the preceding attempt through the real APIs, then stages a known
-- identity as the test owner. The separate recovery suite exercises real prepare.
CREATE FUNCTION pg_temp.stage_lab_test_request(p_patient_id uuid, p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := (SELECT auth.uid()); v_current record;
BEGIN
  IF NOT COALESCE(public.provider_has_patient(p_patient_id), false) THEN
    RAISE EXCEPTION 'Invalid laboratory test fixture';
  END IF;
  SELECT * INTO v_current FROM public.get_lab_submission(p_patient_id);
  IF FOUND AND v_current.request_id IS DISTINCT FROM p_request_id THEN
    IF v_current.lab_result_id IS NULL THEN
      PERFORM public.cancel_lab_submission(p_patient_id, v_current.request_id);
    ELSE
      PERFORM public.acknowledge_lab_submission(p_patient_id, v_current.request_id, v_current.lab_result_id);
    END IF;
  END IF;
  INSERT INTO public.lab_submission_attempts(actor_id, patient_id, request_id)
  VALUES (v_actor, p_patient_id, p_request_id) ON CONFLICT (actor_id, patient_id, request_id) DO NOTHING;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
SELECT pg_temp.stage_lab_test_request('f1000000-0000-4000-8000-000000000011', 'f2000000-0000-4000-8000-000000000001');
INSERT INTO lab_test_results SELECT 'boundary', * FROM public.submit_lab_result(
  'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000011', '2020-01-01T12:00:00.123456Z', 5.5, 15);
SELECT is((SELECT status FROM lab_test_results WHERE label = 'boundary'), 'pending', 'submission returns durable pending state');
SELECT is((SELECT count(*)::int FROM public.lab_alert_evaluations), 1, 'one durable evaluation is visible to linked provider');
SELECT is((SELECT collected_at FROM public.lab_results WHERE id = (SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary')),
  '2020-01-01T12:00:00.123456Z'::timestamptz, 'collection preserves microseconds and is not overwritten by entry time');
SELECT ok((SELECT ordered_by IS NULL FROM public.lab_results WHERE id = (SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary')),
  'recorder is not falsely represented as ordering clinician');
SELECT is((SELECT recorded_by FROM public.lab_alert_evaluations WHERE id = (SELECT event_id FROM lab_test_results WHERE label = 'boundary')),
  'f1000000-0000-4000-8000-000000000001'::uuid, 'evaluation records authenticated recorder separately');
INSERT INTO lab_test_results SELECT 'replay', * FROM public.submit_lab_result(
  'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000011', '2020-01-01T07:00:00.123456-05:00', 5.50, 15.0);
SELECT is((SELECT lab_result_id FROM lab_test_results WHERE label = 'replay'),
  (SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary'), 'equivalent instant/numeric payload replays same lab');
SELECT is((SELECT event_id FROM lab_test_results WHERE label = 'replay'),
  (SELECT event_id FROM lab_test_results WHERE label = 'boundary'), 'replay returns same event');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000011', '2020-01-01T12:00:00Z', 6, 15)$q$,
  '23505', 'Laboratory submission conflict', 'changed payload cannot reuse receipt');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result(NULL, 'f1000000-0000-4000-8000-000000000011', '2020-01-01', 4)$q$,
  '22023', 'Invalid laboratory submission', 'null request rejected');
SELECT pg_temp.stage_lab_test_request('f1000000-0000-4000-8000-000000000011', 'f2000000-0000-4000-8000-000000000002');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000011', now() + interval '1 day', 4)$q$,
  '22023', 'Invalid laboratory collection', 'future collection rejected');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000011', '2020-01-01')$q$,
  '22023', 'At least one laboratory value is required', 'empty panel rejected');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000011', '2020-01-01', 5.54)$q$,
  '22023', 'Invalid laboratory values', 'RPC rejects potassium precision that storage would round');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000011', '2020-01-01', NULL, 14.9)$q$,
  '22023', 'Invalid laboratory values', 'RPC rejects noninteger eGFR before threshold evaluation');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000011', '2020-01-01', NULL, NULL, 1.111)$q$,
  '22023', 'Invalid laboratory values', 'RPC rejects creatinine precision loss');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000011', '2020-01-01', NULL, NULL, NULL, 140.11)$q$,
  '22023', 'Invalid laboratory values', 'RPC rejects sodium precision loss');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000011', '2020-01-01', 'NaN')$q$,
  '22023', 'Invalid laboratory values', 'RPC rejects nonfinite analyte');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000011', '2020-01-01', NULL, NULL, NULL, 175)$q$,
  '22023', 'Invalid laboratory values', 'RPC preserves narrower existing form range');
SELECT is((SELECT count(*)::int FROM public.lab_submission_receipts), 1, 'failed inserts do not leave receipts');
SELECT is((SELECT count(*)::int FROM public.lab_alert_evaluations), 1, 'failed inserts do not leave evaluations');
SELECT throws_ok($q$UPDATE public.lab_alert_evaluations SET status = 'recorded'$q$, '42501', NULL, 'provider cannot forge processing status');
SELECT throws_ok($q$INSERT INTO public.lab_submission_receipts DEFAULT VALUES$q$, '42501', NULL, 'provider cannot forge receipt');
SELECT throws_ok($q$INSERT INTO public.lab_alert_sources DEFAULT VALUES$q$, '42501', NULL, 'provider cannot forge source evidence');
SELECT throws_ok($q$SELECT * FROM public.process_lab_alert_event((SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary'))$q$,
  '42501', NULL, 'provider cannot invoke trusted processor');

SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000011', '2020-01-01', 4)$q$,
  '42501', 'Laboratory operation not authorized', 'AAL1 cannot submit');
SELECT is((SELECT count(*)::int FROM public.lab_alert_evaluations), 0, 'AAL1 cannot read evaluation');
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000011', '2020-01-01', 4)$q$,
  '42501', 'Laboratory operation not authorized', 'missing consent cannot submit');
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000011', '2020-01-01', 4)$q$,
  '42501', 'Laboratory operation not authorized', 'unlinked provider cannot submit');
SELECT is((SELECT count(*)::int FROM public.lab_alert_evaluations), 0, 'unlinked provider cannot read evaluations');
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000011","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000011', '2020-01-01', 4)$q$,
  '42501', 'Laboratory operation not authorized', 'patient cannot submit provider lab');
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000021","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000011', '2020-01-01', 4)$q$,
  '42501', 'Laboratory operation not authorized', 'tester cannot submit');
SELECT set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000011', '2020-01-01', 4)$q$,
  '42501', 'Laboratory operation not authorized', 'missing identity cannot submit');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT throws_ok($q$UPDATE public.lab_results SET created_at = '2020-01-01' WHERE id = (SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary')$q$,
  'P0001', 'Evaluated laboratory records are immutable', 'table owner cannot rewrite a pending record entry timestamp');
CREATE FUNCTION pg_temp.fail_lab_outbox_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Synthetic outbox failure'; END $$;
CREATE TRIGGER lab_test_outbox_failure BEFORE INSERT ON public.lab_alert_evaluations
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_lab_outbox_insert();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
SELECT pg_temp.stage_lab_test_request('f1000000-0000-4000-8000-000000000011', 'f2000000-0000-4000-8000-000000000009');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-000000000011', '2021-02-03T12:00:00Z', 4)$q$,
  'P0001', 'Synthetic outbox failure', 'queue insertion failure aborts submission');
SELECT is((SELECT count(*)::int FROM public.lab_results WHERE collected_at = '2021-02-03T12:00:00Z'), 0, 'queue failure rolls back laboratory row');
SELECT is((SELECT count(*)::int FROM public.lab_submission_receipts WHERE request_id = 'f2000000-0000-4000-8000-000000000009'), 0, 'queue failure leaves no receipt');
RESET ROLE;
DROP TRIGGER lab_test_outbox_failure ON public.lab_alert_evaluations;
SET LOCAL ROLE anon;
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000011', '2020-01-01', 4)$q$,
  '42501', NULL, 'anonymous caller cannot execute submission');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role","sub":"f1000000-0000-4000-8000-000000000001"}', true);
SELECT throws_ok($q$SELECT * FROM public.process_lab_alert_event((SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary'))$q$,
  '42501', 'Laboratory operation not authorized', 'processor rejects a human identity even with service role');
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT throws_ok($q$SELECT * FROM public.process_lab_alert_event((SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary'))$q$,
  '42501', 'Laboratory operation not authorized', 'processor requires explicit service claim');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT throws_ok($q$UPDATE public.lab_results SET potassium = 6.5 WHERE id = (SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary')$q$,
  'P0001', 'Evaluated laboratory records are immutable', 'service cannot change a pending evaluation payload');
INSERT INTO lab_test_results SELECT 'processed-boundary', * FROM public.process_lab_alert_event((SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary'));
SELECT is((SELECT status FROM lab_test_results WHERE label = 'processed-boundary'), 'not_required', 'equal K/eGFR boundaries do not trigger');
SELECT is((SELECT attempt_count FROM public.lab_alert_evaluations WHERE id = (SELECT event_id FROM lab_test_results WHERE label = 'boundary')), 1, 'processing counts one attempt');
SELECT throws_ok($q$UPDATE public.lab_results SET collected_at = '2019-01-01' WHERE id = (SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary')$q$,
  'P0001', 'Evaluated laboratory records are immutable', 'service cannot change collection after terminal evaluation');
SELECT throws_ok($q$UPDATE public.lab_results SET patient_id = 'f1000000-0000-4000-8000-000000000012' WHERE id = (SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary')$q$,
  'P0001', 'Evaluated laboratory records are immutable', 'service cannot move a evaluated lab to another patient');
SELECT throws_ok($q$DELETE FROM public.lab_results WHERE id = (SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary')$q$,
  '23503', NULL, 'service cannot delete lab underpinning evaluation and receipt');
SELECT lives_ok($q$UPDATE public.lab_results SET potassium = potassium WHERE id = (SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary')$q$,
  'no-op update does not pretend to create a correction');
SELECT throws_ok($q$SELECT * FROM public.process_lab_alert_event(NULL)$q$, '22023', 'Invalid laboratory event', 'null event rejected');
SELECT throws_ok($q$SELECT * FROM public.process_lab_alert_event('f3000000-0000-4000-8000-000000000099')$q$,
  '22023', 'Invalid laboratory event', 'unknown event rejected generically');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{}', true);
SELECT throws_ok($q$UPDATE public.lab_results SET notes = 'Replacement note' WHERE id = (SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary')$q$,
  'P0001', 'Evaluated laboratory records are immutable', 'table owner cannot rewrite recorded payload metadata');
SELECT throws_ok($q$INSERT INTO public.lab_results(patient_id, collected_at, potassium) VALUES ('f1000000-0000-4000-8000-000000000011', 'infinity', 4)$q$,
  '22023', 'Invalid laboratory collection', 'direct insert rejects infinite collection');
SELECT throws_ok($q$INSERT INTO public.lab_results(patient_id, collected_at, potassium) VALUES ('f1000000-0000-4000-8000-000000000011', NULL, 4)$q$,
  '22023', 'Invalid laboratory collection', 'direct insert rejects null collection');
SELECT throws_ok($q$INSERT INTO public.lab_results(patient_id, collected_at) VALUES ('f1000000-0000-4000-8000-000000000011', '2020-01-01')$q$,
  '22023', 'At least one laboratory value is required', 'direct insert cannot bypass nonempty requirement');
-- Explicitly model a pre-migration row lacking an evaluation, without backfilling it.
ALTER TABLE public.lab_results DISABLE TRIGGER create_lab_alert_evaluation;
INSERT INTO public.lab_results(id, patient_id, collected_at, potassium) VALUES
  ('f3000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-000000000011', '2016-01-01', 4);
ALTER TABLE public.lab_results ENABLE TRIGGER create_lab_alert_evaluation;
SELECT lives_ok($q$UPDATE public.lab_results SET potassium = 4.1 WHERE id = 'f3000000-0000-4000-8000-000000000009'$q$,
  'new immutability guard does not silently redefine legacy records lacking evaluation');
SELECT is((SELECT count(*)::int FROM public.lab_alert_evaluations WHERE lab_result_id = 'f3000000-0000-4000-8000-000000000009'), 0,
  'legacy fixture is not backfilled by update');
INSERT INTO public.lab_results(id, patient_id, collected_at, bnp) VALUES
  ('f3000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000011', '2019-01-01', 0);
SELECT is((SELECT count(*)::int FROM public.lab_alert_evaluations WHERE lab_result_id = 'f3000000-0000-4000-8000-000000000001'), 1,
  'direct insert of another analyte including zero creates an evaluation');
SELECT lives_ok(format(
  'INSERT INTO public.lab_results(patient_id, collected_at, %I) VALUES (%L, %L, %s)',
  field, 'f1000000-0000-4000-8000-000000000011', '2019-02-01', value
), 'direct nonempty validation accepts existing analyte ' || field)
FROM (VALUES ('potassium', 4), ('creatinine', 1), ('egfr', 30), ('bun', 0), ('bnp', 0),
  ('nt_probnp', 0), ('hba1c', 5), ('glucose', 90), ('sodium', 140), ('hemoglobin', 12),
  ('ferritin', 0), ('tsat', 0), ('ldl', 0)) AS analytes(field, value);
INSERT INTO public.lab_results(id, patient_id, collected_at, potassium, egfr) VALUES
  ('f3000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000012', '2020-01-01', 4, 30);

-- Insert historical critical data after a newer normal result. No recency policy is invented.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
SELECT pg_temp.stage_lab_test_request('f1000000-0000-4000-8000-000000000012', 'f2000000-0000-4000-8000-000000000004');
INSERT INTO lab_test_results SELECT 'critical', * FROM public.submit_lab_result(
  'f2000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000012', '2018-01-01T12:00:00Z', 6.2, 14);
SELECT pg_temp.stage_lab_test_request('f1000000-0000-4000-8000-000000000012', 'f2000000-0000-4000-8000-000000000001');
INSERT INTO lab_test_results SELECT 'other-patient-key', * FROM public.submit_lab_result(
  'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000012', '2020-01-01T12:00:00Z', 5.5, 15);
SELECT isnt((SELECT lab_result_id FROM lab_test_results WHERE label = 'other-patient-key'),
  (SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary'), 'request identity is scoped by patient');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
CREATE FUNCTION pg_temp.fail_second_lab_signal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.flags @> ARRAY['low_egfr']::text[] THEN RAISE EXCEPTION 'Synthetic private failure detail'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_test_partial_failure BEFORE INSERT OR UPDATE ON public.alerts
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_second_lab_signal();
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO lab_test_results SELECT 'failed-critical', * FROM public.process_lab_alert_event((SELECT lab_result_id FROM lab_test_results WHERE label = 'critical'));
SELECT is((SELECT status FROM lab_test_results WHERE label = 'failed-critical'), 'pending', 'partial failure remains retryable');
SELECT is((SELECT attempt_count FROM public.lab_alert_evaluations WHERE id = (SELECT event_id FROM lab_test_results WHERE label = 'critical')), 1, 'failed attempt is durable');
SELECT is((SELECT last_error_code FROM public.lab_alert_evaluations WHERE id = (SELECT event_id FROM lab_test_results WHERE label = 'critical')),
  'evaluation_failed', 'failure stores only generic code, never SQLERRM');
SELECT is((SELECT count(*)::int FROM public.alerts WHERE patient_id = 'f1000000-0000-4000-8000-000000000012'), 0, 'second signal failure rolls back first alert');
SELECT is((SELECT count(*)::int FROM public.lab_alert_sources WHERE lab_result_id = (SELECT lab_result_id FROM lab_test_results WHERE label = 'critical')), 0, 'failure rolls back source links');
SELECT is((SELECT count(*)::int FROM public.work_items WHERE patient_id = 'f1000000-0000-4000-8000-000000000012'), 0, 'failure rolls back trigger-created work items');
RESET ROLE;
DROP TRIGGER lab_test_partial_failure ON public.alerts;
SET LOCAL ROLE service_role;
INSERT INTO lab_test_results SELECT 'retried-critical', * FROM public.process_lab_alert_event((SELECT lab_result_id FROM lab_test_results WHERE label = 'critical'));
SELECT is((SELECT status FROM lab_test_results WHERE label = 'retried-critical'), 'recorded', 'same lab retry records signals');
SELECT is((SELECT attempt_count FROM public.lab_alert_evaluations WHERE id = (SELECT event_id FROM lab_test_results WHERE label = 'critical')), 2, 'retry records second attempt');
SELECT is((SELECT count(*)::int FROM public.lab_alert_sources WHERE lab_result_id = (SELECT lab_result_id FROM lab_test_results WHERE label = 'critical')), 2, 'both unchanged threshold flags have source evidence');
SELECT ok((SELECT bool_and(collected_at = '2018-01-01T12:00:00Z'::timestamptz AND detected_at > collected_at)
  FROM public.lab_alert_sources WHERE lab_result_id = (SELECT lab_result_id FROM lab_test_results WHERE label = 'critical')), 'source distinguishes historical collection from detection');
INSERT INTO lab_test_results SELECT 'terminal-replay', * FROM public.process_lab_alert_event((SELECT lab_result_id FROM lab_test_results WHERE label = 'critical'));
SELECT is((SELECT attempt_count FROM public.lab_alert_evaluations WHERE id = (SELECT event_id FROM lab_test_results WHERE label = 'critical')), 2, 'terminal replay does not count attempt');
SELECT is((SELECT sum(occurrence_count)::int FROM public.alerts WHERE patient_id = 'f1000000-0000-4000-8000-000000000012'), 2, 'terminal replay does not increment occurrences');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
SELECT pg_temp.stage_lab_test_request('f1000000-0000-4000-8000-000000000012', 'f2000000-0000-4000-8000-000000000005');
INSERT INTO lab_test_results SELECT 'second-critical', * FROM public.submit_lab_result(
  'f2000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000012', '2017-01-01T12:00:00Z', 6.1, 14);
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO lab_test_results SELECT 'processed-second-critical', * FROM public.process_lab_alert_event((SELECT lab_result_id FROM lab_test_results WHERE label = 'second-critical'));
SELECT is((SELECT status FROM lab_test_results WHERE label = 'processed-second-critical'), 'recorded', 'new observation may coalesce an existing active signal');
SELECT is((SELECT count(*)::int FROM public.alerts WHERE patient_id = 'f1000000-0000-4000-8000-000000000012'), 2, 'coalescence does not create duplicate active alerts');
SELECT is((SELECT sum(occurrence_count)::int FROM public.alerts WHERE patient_id = 'f1000000-0000-4000-8000-000000000012'), 4, 'each distinct observation is counted once per flag');
SELECT is((SELECT count(*)::int FROM public.lab_alert_sources), 4, 'coalesced alerts retain both observations instead of replacing provenance');
RESET ROLE;
SELECT throws_ok($q$UPDATE public.lab_alert_sources SET flag = 'changed'$q$, 'P0001', 'Laboratory provenance is append-only', 'source cannot be rewritten even by table owner');
SELECT throws_ok($q$DELETE FROM public.lab_submission_receipts$q$, 'P0001', 'Laboratory provenance is append-only', 'receipt cannot be deleted');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
INSERT INTO lab_test_results SELECT 'terminal-submit-replay', * FROM public.submit_lab_result(
  'f2000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000012', '2018-01-01T12:00:00Z', 6.2, 14);
SELECT is((SELECT status FROM lab_test_results WHERE label = 'terminal-submit-replay'), 'recorded', 'submission replay returns current terminal status');
SELECT is((SELECT count(*)::int FROM public.lab_alert_sources), 4, 'linked provider can read source provenance');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.provider_patient_links (provider_id, patient_id, status, linked_at) VALUES
  ('f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000011', 'active', now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
SELECT pg_temp.stage_lab_test_request('f1000000-0000-4000-8000-000000000011', 'f2000000-0000-4000-8000-000000000001');
INSERT INTO lab_test_results SELECT 'other-actor-key', * FROM public.submit_lab_result(
  'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000011', '2020-01-01T12:00:00.123456Z', 5.5, 15);
SELECT isnt((SELECT lab_result_id FROM lab_test_results WHERE label = 'other-actor-key'),
  (SELECT lab_result_id FROM lab_test_results WHERE label = 'boundary'), 'request identity is scoped by actor');
SELECT is((SELECT count(*)::int FROM public.lab_submission_receipts), 1, 'provider sees only own idempotency receipts');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
UPDATE public.provider_patient_links SET status = 'revoked'
WHERE provider_id = 'f1000000-0000-4000-8000-000000000001' AND patient_id = 'f1000000-0000-4000-8000-000000000012';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f2000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000012', '2018-01-01T12:00:00Z', 6.2, 14)$q$,
  '42501', 'Laboratory operation not authorized', 'replay rechecks revoked authorization');
SELECT is((SELECT count(*)::int FROM public.lab_alert_sources), 0, 'revoked link hides historical source evidence');
SELECT is((SELECT count(*)::int FROM public.lab_alert_evaluations WHERE patient_id = 'f1000000-0000-4000-8000-000000000012'), 0, 'revoked link hides pending/terminal evaluation');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
