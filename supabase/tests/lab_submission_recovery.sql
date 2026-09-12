-- Durable recovery tests against actual RPCs/triggers. All fixtures are synthetic and rolled back.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT no_plan();
SELECT has_function('public', 'prepare_lab_submission', ARRAY['uuid'], 'durable preparation RPC exists');
SELECT has_function('public', 'get_lab_submission', ARRAY['uuid', 'uuid'], 'serialized recovery RPC exists');
SELECT has_function('public', 'acknowledge_lab_submission', ARRAY['uuid', 'uuid', 'uuid'], 'explicit receipt acknowledgement exists');
SELECT has_function('public', 'cancel_lab_submission', ARRAY['uuid', 'uuid'], 'fenced cancellation RPC exists');

INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
 ('f4000000-0000-4000-8000-000000000001', 'recovery-provider@example.invalid', '{"consent_accepted":true}'),
 ('f4000000-0000-4000-8000-000000000002', 'recovery-other-provider@example.invalid', '{"consent_accepted":true}'),
 ('f4000000-0000-4000-8000-000000000003', 'recovery-unlinked@example.invalid', '{"consent_accepted":true}'),
 ('f4000000-0000-4000-8000-000000000004', 'recovery-no-consent@example.invalid', '{}'),
 ('f4000000-0000-4000-8000-000000000011', 'recovery-patient-one@example.invalid', '{"consent_accepted":true}'),
 ('f4000000-0000-4000-8000-000000000012', 'recovery-patient-two@example.invalid', '{"consent_accepted":true}'),
 ('f4000000-0000-4000-8000-000000000021', 'recovery-tester@example.invalid', '{"signup_intent":"sandbox","consent_accepted":true}');
UPDATE public.profiles SET role = 'provider' WHERE id IN
 ('f4000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000002',
  'f4000000-0000-4000-8000-000000000003', 'f4000000-0000-4000-8000-000000000004');
INSERT INTO public.provider_patient_links(provider_id, patient_id, status, linked_at) VALUES
 ('f4000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000011', 'active', now()),
 ('f4000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000012', 'active', now()),
 ('f4000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000011', 'active', now()),
 ('f4000000-0000-4000-8000-000000000004', 'f4000000-0000-4000-8000-000000000011', 'active', now());
CREATE TEMP TABLE recovery_results (
 label text PRIMARY KEY, request_id uuid, submission_status text, lab_result_id uuid, event_id uuid,
 alert_status text, collected_at timestamptz, potassium numeric, egfr numeric, creatinine numeric,
 sodium numeric, notes text, is_new boolean
);
CREATE TEMP TABLE recovery_saved(label text PRIMARY KEY, lab_result_id uuid, event_id uuid, status text);
GRANT ALL ON recovery_results, recovery_saved TO authenticated, service_role;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f4000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
SELECT is((SELECT count(*)::int FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011')), 0, 'initial read has no active attempt');
INSERT INTO recovery_results SELECT 'first', * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000011');
SELECT is((SELECT submission_status FROM recovery_results WHERE label = 'first'), 'prepared', 'preparation is durable before submission');
SELECT ok((SELECT is_new FROM recovery_results WHERE label = 'first'), 'only newly prepared identity is new');
SELECT ok((SELECT num_nonnulls(lab_result_id, event_id, alert_status, collected_at, potassium, egfr, creatinine, sodium, notes) = 0
 FROM recovery_results WHERE label = 'first'), 'prepared response contains no reconstructed clinical payload');
INSERT INTO recovery_results SELECT 'lost-prepare-response', * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000011');
SELECT is((SELECT request_id FROM recovery_results WHERE label = 'lost-prepare-response'), (SELECT request_id FROM recovery_results WHERE label = 'first'), 'repeated preparation recovers same identity');
SELECT ok(NOT (SELECT is_new FROM recovery_results WHERE label = 'lost-prepare-response'), 'recovered preparation is not a fresh form');
SELECT is((SELECT count(*)::int FROM public.lab_results), 0, 'preparation/read do not save clinical data');
SELECT throws_ok($q$INSERT INTO public.lab_submission_attempts DEFAULT VALUES$q$, '42501', NULL, 'client cannot forge an attempt');
SELECT throws_ok($q$UPDATE public.lab_submission_attempts SET closed_status = 'cancelled'$q$, '42501', NULL, 'client cannot forge cancellation');
SELECT throws_ok($q$INSERT INTO public.lab_results(patient_id, collected_at, potassium) VALUES ('f4000000-0000-4000-8000-000000000011', '2015-01-01', 4)$q$,
 '42501', NULL, 'direct table INSERT cannot bypass durable preparation');
SELECT ok(NOT has_column_privilege('authenticated', 'public.lab_results', 'potassium', 'INSERT'), 'old column-level INSERT grant is removed');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result('f5000000-0000-4000-8000-000000000099', 'f4000000-0000-4000-8000-000000000011', '2015-01-01', 4)$q$,
 '22023', 'Laboratory submission is not prepared', 'old public entry point cannot bypass preparation');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result_v37_internal('f5000000-0000-4000-8000-000000000099', 'f4000000-0000-4000-8000-000000000011', '2015-01-01', 4)$q$,
 '42501', NULL, 'renamed legacy implementation is not an authenticated bypass');
INSERT INTO recovery_saved SELECT 'saved', * FROM public.submit_lab_result(
 (SELECT request_id FROM recovery_results WHERE label = 'first'), 'f4000000-0000-4000-8000-000000000011',
 '2015-01-01T12:13:14.123456Z', 4.5, 30, 1.23, 140.1, 'Synthetic source note');
-- Discarding the submission response does not discard the durable attempt/receipt.
INSERT INTO recovery_results SELECT 'lost-save-response', * FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011');
SELECT is((SELECT submission_status FROM recovery_results WHERE label = 'lost-save-response'), 'committed', 'reload discovers a committed receipt');
SELECT is((SELECT lab_result_id FROM recovery_results WHERE label = 'lost-save-response'), (SELECT lab_result_id FROM recovery_saved WHERE label = 'saved'), 'recovery identifies exact saved exam');
SELECT is((SELECT collected_at FROM recovery_results WHERE label = 'lost-save-response'), '2015-01-01T12:13:14.123456Z'::timestamptz, 'recovery preserves historical collection and microseconds');
SELECT is((SELECT potassium FROM recovery_results WHERE label = 'lost-save-response'), 4.5::numeric, 'recovery uses recorded value');
SELECT is((SELECT notes FROM recovery_results WHERE label = 'lost-save-response'), 'Synthetic source note', 'recovery returns saved notes only after commit');
INSERT INTO recovery_results SELECT 'cancel-lost-race', * FROM public.cancel_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'first'));
SELECT is((SELECT submission_status FROM recovery_results WHERE label = 'cancel-lost-race'), 'committed', 'cancellation cannot claim absence after commit');
SELECT throws_ok($q$SELECT * FROM public.acknowledge_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'first'), 'f5000000-0000-4000-8000-000000000099')$q$,
 '22023', 'Laboratory receipt does not match', 'acknowledgement requires exact saved lab identity');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO recovery_saved SELECT 'processed', * FROM public.process_lab_alert_event((SELECT lab_result_id FROM recovery_saved WHERE label = 'saved'));
SELECT throws_ok($q$UPDATE public.lab_submission_attempts SET closed_status = 'acknowledged'$q$, '42501', NULL, 'service cannot forge acknowledgement');
SELECT throws_ok($q$SELECT * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', NULL, 'service cannot impersonate preparing provider');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f4000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
INSERT INTO recovery_results SELECT 'after-processing', * FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011');
SELECT is((SELECT submission_status FROM recovery_results WHERE label = 'after-processing'), 'committed', 'terminal alert processing does not acknowledge receipt');
SELECT is((SELECT alert_status FROM recovery_results WHERE label = 'after-processing'), 'not_required', 'recovery reports independent current processing state');
INSERT INTO recovery_results SELECT 'acknowledged', * FROM public.acknowledge_lab_submission('f4000000-0000-4000-8000-000000000011',
 (SELECT request_id FROM recovery_results WHERE label = 'first'), (SELECT lab_result_id FROM recovery_saved WHERE label = 'saved'));
SELECT is((SELECT submission_status FROM recovery_results WHERE label = 'acknowledged'), 'acknowledged', 'explicit acknowledgement closes attempt');
SELECT is((SELECT count(*)::int FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011')), 0, 'acknowledged attempt is no longer active');
INSERT INTO recovery_results SELECT 'lost-ack-response', * FROM public.acknowledge_lab_submission('f4000000-0000-4000-8000-000000000011',
 (SELECT request_id FROM recovery_results WHERE label = 'first'), (SELECT lab_result_id FROM recovery_saved WHERE label = 'saved'));
SELECT is((SELECT submission_status FROM recovery_results WHERE label = 'lost-ack-response'), 'acknowledged', 'lost acknowledgement response is replayable');
INSERT INTO recovery_results SELECT 'exact-closed', * FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'first'));
SELECT is((SELECT submission_status FROM recovery_results WHERE label = 'exact-closed'), 'acknowledged', 'explicit recovery can read closed identity');
SELECT is((SELECT count(*)::int FROM public.lab_results), 1, 'read/acknowledgement do not insert another exam');
INSERT INTO recovery_results SELECT 'second', * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000011');
SELECT isnt((SELECT request_id FROM recovery_results WHERE label = 'second'), (SELECT request_id FROM recovery_results WHERE label = 'first'), 'new preparation requires previous closure');
INSERT INTO recovery_results SELECT 'cancelled', * FROM public.cancel_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'second'));
SELECT is((SELECT submission_status FROM recovery_results WHERE label = 'cancelled'), 'cancelled', 'unsaved preparation is explicitly fenced');
INSERT INTO recovery_results SELECT 'cancel-replay', * FROM public.cancel_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'second'));
SELECT is((SELECT submission_status FROM recovery_results WHERE label = 'cancel-replay'), 'cancelled', 'cancellation response can be recovered without reopening');
INSERT INTO recovery_results SELECT 'third', * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000011');
SELECT throws_ok($q$SELECT * FROM public.submit_lab_result((SELECT request_id FROM recovery_results WHERE label = 'second'), 'f4000000-0000-4000-8000-000000000011', '2014-01-01', 6.2)$q$,
 '23505', 'Laboratory submission is closed', 'late cancelled packet cannot create a lab after another attempt opens');
SELECT throws_ok($q$SELECT * FROM public.acknowledge_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'third'), (SELECT lab_result_id FROM recovery_saved WHERE label = 'saved'))$q$,
 '22023', 'Laboratory receipt does not match', 'prepared attempt cannot be acknowledged with another lab');
INSERT INTO recovery_saved SELECT 'closed-submit-replay', * FROM public.submit_lab_result(
 (SELECT request_id FROM recovery_results WHERE label = 'first'), 'f4000000-0000-4000-8000-000000000011',
 '2015-01-01T07:13:14.123456-05:00', 4.50, 30, 1.23, 140.1, 'Synthetic source note');
SELECT is((SELECT lab_result_id FROM recovery_saved WHERE label = 'closed-submit-replay'), (SELECT lab_result_id FROM recovery_saved WHERE label = 'saved'), 'closed receipt replay is not a new observation');
SELECT is((SELECT request_id FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011')), (SELECT request_id FROM recovery_results WHERE label = 'third'), 'old receipt replay does not replace new active attempt');
SELECT is((SELECT count(*)::int FROM public.lab_submission_receipts), 1, 'cancelled packet leaves no receipt');
SELECT is((SELECT count(*)::int FROM public.lab_alert_evaluations), 1, 'cancelled packet leaves no evaluation');
SAVEPOINT recovery_submission_rollback;
INSERT INTO recovery_saved SELECT 'rolled-back', * FROM public.submit_lab_result(
 (SELECT request_id FROM recovery_results WHERE label = 'third'), 'f4000000-0000-4000-8000-000000000011', '2012-01-01', 4);
ROLLBACK TO SAVEPOINT recovery_submission_rollback;
SELECT is((SELECT submission_status FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011')), 'prepared', 'rolled-back submission leaves same prepared attempt');
SELECT is((SELECT count(*)::int FROM public.lab_results), 1, 'rolled-back submission leaves no additional clinical row');
INSERT INTO recovery_results SELECT 'cancel-acknowledged', * FROM public.cancel_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'first'));
SELECT is((SELECT submission_status FROM recovery_results WHERE label = 'cancel-acknowledged'), 'acknowledged', 'cancellation cannot change prior acknowledgement');
SELECT throws_ok($q$SELECT * FROM public.acknowledge_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'second'), (SELECT lab_result_id FROM recovery_saved WHERE label = 'saved'))$q$,
 '22023', 'Laboratory receipt does not match', 'cancelled identity cannot acknowledge another receipt');

SELECT set_config('request.jwt.claims', '{"sub":"f4000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
SELECT is((SELECT count(*)::int FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011')), 0, 'another linked provider does not inherit first actor attempt');
SELECT is((SELECT count(*)::int FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'first'))), 0, 'known request identity does not bypass actor scope');
INSERT INTO recovery_results SELECT 'other-actor', * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000011');
SELECT isnt((SELECT request_id FROM recovery_results WHERE label = 'other-actor'), (SELECT request_id FROM recovery_results WHERE label = 'third'), 'different actor has independent active slot');
SELECT is((SELECT count(*)::int FROM public.lab_submission_attempts), 1, 'direct metadata RLS exposes only current actor attempts');
SELECT set_config('request.jwt.claims', '{"sub":"f4000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
SELECT is((SELECT count(*)::int FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000012', (SELECT request_id FROM recovery_results WHERE label = 'first'))), 0, 'known identity does not bypass patient scope');
SAVEPOINT recovery_preparation_rollback;
INSERT INTO recovery_results SELECT 'rolled-back-prepare', * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000012');
ROLLBACK TO SAVEPOINT recovery_preparation_rollback;
SELECT is((SELECT count(*)::int FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000012')), 0, 'rolled-back preparation does not leave an active slot');
INSERT INTO recovery_results SELECT 'other-patient', * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000012');
SELECT isnt((SELECT request_id FROM recovery_results WHERE label = 'other-patient'), (SELECT request_id FROM recovery_results WHERE label = 'third'), 'same actor may separately prepare another patient');
SELECT throws_ok($q$SELECT * FROM public.cancel_lab_submission('f4000000-0000-4000-8000-000000000011', NULL)$q$, '22023', 'Invalid laboratory submission', 'null cancellation identity rejected');
SELECT throws_ok($q$SELECT * FROM public.acknowledge_lab_submission('f4000000-0000-4000-8000-000000000011', NULL, NULL)$q$, '22023', 'Invalid laboratory submission', 'null acknowledgement identity rejected');
SELECT throws_ok($q$SELECT * FROM public.cancel_lab_submission('f4000000-0000-4000-8000-000000000011', 'f5000000-0000-4000-8000-000000000099')$q$, '22023', 'Invalid laboratory submission', 'unknown cancellation is not evidence of absence');

-- Every new RPC rechecks authoritative access without privilege-elevating test helpers.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f4000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
SELECT throws_ok($q$SELECT * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', 'Laboratory operation not authorized', 'AAL1 cannot prepare');
SELECT throws_ok($q$SELECT * FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', 'Laboratory operation not authorized', 'AAL1 cannot read recovery');
SELECT throws_ok($q$SELECT * FROM public.cancel_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'third'))$q$, '42501', 'Laboratory operation not authorized', 'AAL1 cannot cancel');
SELECT throws_ok($q$SELECT * FROM public.acknowledge_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'first'), (SELECT lab_result_id FROM recovery_saved WHERE label = 'saved'))$q$, '42501', 'Laboratory operation not authorized', 'AAL1 cannot acknowledge');
SELECT set_config('request.jwt.claims', '{"sub":"f4000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok($q$SELECT * FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', 'Laboratory operation not authorized', 'missing consent cannot recover');
SELECT throws_ok($q$SELECT * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', 'Laboratory operation not authorized', 'missing consent cannot prepare');
SELECT throws_ok($q$SELECT * FROM public.cancel_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'third'))$q$, '42501', 'Laboratory operation not authorized', 'missing consent cannot cancel');
SELECT throws_ok($q$SELECT * FROM public.acknowledge_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'first'), (SELECT lab_result_id FROM recovery_saved WHERE label = 'saved'))$q$, '42501', 'Laboratory operation not authorized', 'missing consent cannot acknowledge');
SELECT set_config('request.jwt.claims', '{"sub":"f4000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok($q$SELECT * FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', 'Laboratory operation not authorized', 'unlinked provider cannot recover');
SELECT throws_ok($q$SELECT * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', 'Laboratory operation not authorized', 'unlinked provider cannot prepare');
SELECT throws_ok($q$SELECT * FROM public.cancel_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'third'))$q$, '42501', 'Laboratory operation not authorized', 'unlinked provider cannot cancel');
SELECT throws_ok($q$SELECT * FROM public.acknowledge_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'first'), (SELECT lab_result_id FROM recovery_saved WHERE label = 'saved'))$q$, '42501', 'Laboratory operation not authorized', 'unlinked provider cannot acknowledge');
SELECT set_config('request.jwt.claims', '{"sub":"f4000000-0000-4000-8000-000000000011","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok($q$SELECT * FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', 'Laboratory operation not authorized', 'patient cannot recover provider attempt');
SELECT throws_ok($q$SELECT * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', 'Laboratory operation not authorized', 'patient cannot prepare provider attempt');
SELECT throws_ok($q$SELECT * FROM public.cancel_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'third'))$q$, '42501', 'Laboratory operation not authorized', 'patient cannot cancel provider attempt');
SELECT throws_ok($q$SELECT * FROM public.acknowledge_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'first'), (SELECT lab_result_id FROM recovery_saved WHERE label = 'saved'))$q$, '42501', 'Laboratory operation not authorized', 'patient cannot acknowledge provider attempt');
SELECT set_config('request.jwt.claims', '{"sub":"f4000000-0000-4000-8000-000000000021","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok($q$SELECT * FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', 'Laboratory operation not authorized', 'tester cannot recover provider attempt');
SELECT throws_ok($q$SELECT * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', 'Laboratory operation not authorized', 'tester cannot prepare provider attempt');
SELECT throws_ok($q$SELECT * FROM public.cancel_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'third'))$q$, '42501', 'Laboratory operation not authorized', 'tester cannot cancel provider attempt');
SELECT throws_ok($q$SELECT * FROM public.acknowledge_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'first'), (SELECT lab_result_id FROM recovery_saved WHERE label = 'saved'))$q$, '42501', 'Laboratory operation not authorized', 'tester cannot acknowledge provider attempt');
SELECT set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok($q$SELECT * FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', 'Laboratory operation not authorized', 'missing identity cannot recover');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($q$SELECT * FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', NULL, 'anonymous caller cannot recover');
RESET ROLE;

-- Model an already existing 00037 receipt via its owner-only implementation.
-- This does not manufacture an acknowledgement or a new public legacy path.
SELECT set_config('request.jwt.claims', '{"sub":"f4000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
INSERT INTO recovery_saved SELECT 'legacy', * FROM public.submit_lab_result_v37_internal(
 'f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000012', '2013-01-01', 4);
SET LOCAL ROLE authenticated;
INSERT INTO recovery_results SELECT 'legacy-explicit', * FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000012', 'f5000000-0000-4000-8000-000000000001');
SELECT is((SELECT submission_status FROM recovery_results WHERE label = 'legacy-explicit'), 'committed', 'known legacy receipt is not presumed acknowledged');
SELECT is((SELECT request_id FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000012')), (SELECT request_id FROM recovery_results WHERE label = 'other-patient'), 'legacy lookup does not replace existing active attempt');
INSERT INTO recovery_results SELECT 'legacy-cancel', * FROM public.cancel_lab_submission('f4000000-0000-4000-8000-000000000012', 'f5000000-0000-4000-8000-000000000001');
SELECT is((SELECT submission_status FROM recovery_results WHERE label = 'legacy-cancel'), 'committed', 'legacy cancellation cannot deny an existing receipt');
SELECT is((SELECT count(*)::int FROM public.lab_submission_attempts WHERE request_id = 'f5000000-0000-4000-8000-000000000001'), 0, 'legacy read/cancel do not backfill an attempt');
INSERT INTO recovery_results SELECT 'legacy-ack', * FROM public.acknowledge_lab_submission('f4000000-0000-4000-8000-000000000012', 'f5000000-0000-4000-8000-000000000001', (SELECT lab_result_id FROM recovery_saved WHERE label = 'legacy'));
SELECT is((SELECT submission_status FROM recovery_results WHERE label = 'legacy-ack'), 'acknowledged', 'legacy acknowledgement is explicit and exact');
INSERT INTO recovery_saved SELECT 'legacy-replay', * FROM public.submit_lab_result(
 'f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000012', '2013-01-01', 4);
SELECT is((SELECT lab_result_id FROM recovery_saved WHERE label = 'legacy-replay'), (SELECT lab_result_id FROM recovery_saved WHERE label = 'legacy'), 'legacy replay never creates another observation');
SELECT ok((SELECT bool_and(NOT is_new) FROM recovery_results WHERE label NOT IN ('first', 'second', 'third', 'other-actor', 'other-patient')), 'reads/cancel/ack and recovered prepare never label results new');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT throws_ok($q$UPDATE public.lab_submission_attempts SET closed_status = NULL, closed_at = NULL, acknowledged_lab_result_id = NULL WHERE request_id = (SELECT request_id FROM recovery_results WHERE label = 'second')$q$,
 'P0001', 'Laboratory submission history is immutable', 'ordinary owner update cannot revive cancelled identity');
SELECT throws_ok($q$DELETE FROM public.lab_submission_attempts WHERE request_id = (SELECT request_id FROM recovery_results WHERE label = 'first')$q$,
 'P0001', 'Laboratory submission history is immutable', 'attempt history cannot be deleted');
UPDATE public.provider_patient_links SET status = 'revoked'
WHERE provider_id = 'f4000000-0000-4000-8000-000000000001' AND patient_id = 'f4000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f4000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok($q$SELECT * FROM public.get_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'first'))$q$,
 '42501', 'Laboratory operation not authorized', 'revoked link cannot recover even exact receipt identity');
SELECT throws_ok($q$SELECT * FROM public.prepare_lab_submission('f4000000-0000-4000-8000-000000000011')$q$, '42501', 'Laboratory operation not authorized', 'revoked link cannot prepare');
SELECT throws_ok($q$SELECT * FROM public.cancel_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'third'))$q$, '42501', 'Laboratory operation not authorized', 'revoked link cannot cancel');
SELECT throws_ok($q$SELECT * FROM public.acknowledge_lab_submission('f4000000-0000-4000-8000-000000000011', (SELECT request_id FROM recovery_results WHERE label = 'first'), (SELECT lab_result_id FROM recovery_saved WHERE label = 'saved'))$q$, '42501', 'Laboratory operation not authorized', 'revoked link cannot acknowledge');
SELECT is((SELECT count(*)::int FROM public.lab_submission_attempts WHERE patient_id = 'f4000000-0000-4000-8000-000000000011'), 0, 'revocation also applies to direct metadata reads');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
