-- Restricted erasure of laboratory provenance for expired tester accounts (00039).
-- All fixtures are synthetic and rolled back. Proves: only service role, only expired
-- testers, only actor-bound rows, audited, idempotent, and that account deletion
-- becomes possible afterwards while third-party rows stay intact.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

SELECT has_table('public', 'lab_provenance_erasures', 'erasure audit table exists');
SELECT has_function('public', 'purge_expired_tester_provenance', ARRAY['uuid'], 'service-role erasure function exists');
SELECT has_function('public', 'lab_provenance_erasure_active', ARRAY['uuid'], 'transaction-bound erasure check exists');

-- Fixtures: an expired tester (A), an active tester (B), a provider (P), two patients (X, Y).
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
 ('f6000000-0000-4000-8000-0000000000a1', 'erasure-tester-expired@example.invalid', '{"signup_intent":"sandbox","consent_accepted":true}'),
 ('f6000000-0000-4000-8000-0000000000b1', 'erasure-tester-active@example.invalid', '{"signup_intent":"sandbox","consent_accepted":true}'),
 ('f6000000-0000-4000-8000-0000000000c1', 'erasure-provider@example.invalid', '{"consent_accepted":true}'),
 ('f6000000-0000-4000-8000-0000000000d1', 'erasure-patient-x@example.invalid', '{"consent_accepted":true}'),
 ('f6000000-0000-4000-8000-0000000000d2', 'erasure-patient-y@example.invalid', '{"consent_accepted":true}');
UPDATE public.profiles SET role = 'provider' WHERE id = 'f6000000-0000-4000-8000-0000000000c1';
UPDATE public.profiles SET sandbox_expires_at = now() - interval '1 day' WHERE id = 'f6000000-0000-4000-8000-0000000000a1';
SELECT is((SELECT role FROM public.profiles WHERE id = 'f6000000-0000-4000-8000-0000000000a1'), 'tester', 'fixture A is a tester');
SELECT ok((SELECT sandbox_expires_at < now() FROM public.profiles WHERE id = 'f6000000-0000-4000-8000-0000000000a1'), 'fixture A is expired');
SELECT ok((SELECT sandbox_expires_at > now() FROM public.profiles WHERE id = 'f6000000-0000-4000-8000-0000000000b1'), 'fixture B is not expired');

-- Testers carry no organization; a tester linked to a patient would make governed work
-- assignment fail when an alert is coalesced, so only the provider is linked here and the
-- tester-authored provenance rows below are inserted directly (the RESTRICT keys are what
-- this suite exercises, not the tester's authorization to submit).
INSERT INTO public.provider_patient_links(provider_id, patient_id, status, linked_at) VALUES
 ('f6000000-0000-4000-8000-0000000000c1', 'f6000000-0000-4000-8000-0000000000d1', 'active', now());

-- Labs written through the provenance path: one by A (acknowledged, with alert), one by B.
INSERT INTO public.lab_results(id, patient_id, collected_at, potassium, egfr) VALUES
 ('f6000000-0000-4000-8000-0000000000e1', 'f6000000-0000-4000-8000-0000000000d1', '2026-01-02T03:04:05Z', 5.9, 60),
 ('f6000000-0000-4000-8000-0000000000e2', 'f6000000-0000-4000-8000-0000000000d2', '2026-01-02T03:04:05Z', 4.2, 80);
INSERT INTO public.lab_submission_receipts(actor_id, patient_id, request_id, payload, lab_result_id) VALUES
 ('f6000000-0000-4000-8000-0000000000a1', 'f6000000-0000-4000-8000-0000000000d1', 'f6000000-0000-4000-8000-0000000000f1', '{"potassium":5.9}', 'f6000000-0000-4000-8000-0000000000e1'),
 ('f6000000-0000-4000-8000-0000000000b1', 'f6000000-0000-4000-8000-0000000000d2', 'f6000000-0000-4000-8000-0000000000f2', '{"potassium":4.2}', 'f6000000-0000-4000-8000-0000000000e2');
INSERT INTO public.lab_submission_attempts(actor_id, patient_id, request_id, closed_status, closed_at, acknowledged_lab_result_id) VALUES
 ('f6000000-0000-4000-8000-0000000000a1', 'f6000000-0000-4000-8000-0000000000d1', 'f6000000-0000-4000-8000-0000000000f1', 'acknowledged', now(), 'f6000000-0000-4000-8000-0000000000e1'),
 ('f6000000-0000-4000-8000-0000000000b1', 'f6000000-0000-4000-8000-0000000000d2', 'f6000000-0000-4000-8000-0000000000f2', 'acknowledged', now(), 'f6000000-0000-4000-8000-0000000000e2');
-- An abandoned, still-open attempt by A on X.
INSERT INTO public.lab_submission_attempts(actor_id, patient_id, request_id) VALUES
 ('f6000000-0000-4000-8000-0000000000a1', 'f6000000-0000-4000-8000-0000000000d1', 'f6000000-0000-4000-8000-0000000000f3');

CREATE TEMP TABLE erasure_results(label text PRIMARY KEY, receipts_deleted int, attempts_deleted int, evaluations_detached int);
GRANT ALL ON erasure_results TO service_role;

-- Record A's alert so evaluation and alert source exist and must survive the erasure.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT is((SELECT status FROM public.process_lab_alert_event('f6000000-0000-4000-8000-0000000000e1')), 'recorded', 'A''s lab produced a recorded alert evaluation');
SELECT is((SELECT count(*)::int FROM public.lab_alert_sources WHERE lab_result_id = 'f6000000-0000-4000-8000-0000000000e1'), 1, 'alert source exists for A''s lab');

-- Before erasure: the account cannot be deleted (this is the defect being addressed).
RESET ROLE;
SELECT throws_ok($q$DELETE FROM auth.users WHERE id = 'f6000000-0000-4000-8000-0000000000a1'$q$, '23503', NULL,
  'expired tester with receipts cannot be deleted before erasure');

-- Guards.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT throws_ok($q$SELECT * FROM public.purge_expired_tester_provenance('f6000000-0000-4000-8000-0000000000b1')$q$, '42501', NULL, 'active tester cannot be erased');
SELECT throws_ok($q$SELECT * FROM public.purge_expired_tester_provenance('f6000000-0000-4000-8000-0000000000c1')$q$, '42501', NULL, 'provider cannot be erased through this path');
SELECT throws_ok($q$SELECT * FROM public.purge_expired_tester_provenance('f6000000-0000-4000-8000-0000000000ff')$q$, '42501', NULL, 'unknown profile is rejected');
SELECT throws_ok($q$DELETE FROM public.lab_submission_receipts WHERE actor_id = 'f6000000-0000-4000-8000-0000000000a1'$q$, '42501', NULL,
  'service role has no direct delete privilege on receipts');
SELECT throws_ok($q$DELETE FROM public.lab_submission_attempts WHERE actor_id = 'f6000000-0000-4000-8000-0000000000a1'$q$, '42501', NULL,
  'service role has no direct delete privilege on attempts');
RESET ROLE;
SELECT throws_ok($q$DELETE FROM public.lab_submission_receipts WHERE actor_id = 'f6000000-0000-4000-8000-0000000000a1'$q$, 'P0001', 'Laboratory provenance is append-only',
  'even the owner cannot delete receipts outside an erasure');
SELECT throws_ok($q$DELETE FROM public.lab_submission_attempts WHERE actor_id = 'f6000000-0000-4000-8000-0000000000a1'$q$, 'P0001', 'Laboratory submission history is immutable',
  'even the owner cannot delete attempts outside an erasure');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT throws_ok($q$INSERT INTO public.lab_provenance_erasures(actor_id, xact_id) VALUES ('f6000000-0000-4000-8000-0000000000a1', pg_current_xact_id())$q$, '42501', NULL,
  'service role cannot forge an erasure record directly');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"f6000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok($q$SELECT * FROM public.purge_expired_tester_provenance('f6000000-0000-4000-8000-0000000000a1')$q$, '42501', NULL, 'authenticated user cannot erase, even themselves');
SELECT throws_ok($q$SELECT public.lab_provenance_erasure_active('f6000000-0000-4000-8000-0000000000a1')$q$, '42501', NULL, 'erasure check is not callable by authenticated users');

-- Erasure.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO erasure_results SELECT 'first', * FROM public.purge_expired_tester_provenance('f6000000-0000-4000-8000-0000000000a1');
SELECT is((SELECT receipts_deleted FROM erasure_results WHERE label = 'first'), 1, 'one receipt of A erased');
SELECT is((SELECT attempts_deleted FROM erasure_results WHERE label = 'first'), 2, 'both attempts of A erased');
SELECT is((SELECT evaluations_detached FROM erasure_results WHERE label = 'first'), 0, 'service-role evaluations carried no actor to detach');
SELECT is((SELECT count(*)::int FROM public.lab_submission_receipts WHERE actor_id = 'f6000000-0000-4000-8000-0000000000a1'), 0, 'A has no receipts left');
SELECT is((SELECT count(*)::int FROM public.lab_submission_attempts WHERE actor_id = 'f6000000-0000-4000-8000-0000000000a1'), 0, 'A has no attempts left');
SELECT is((SELECT count(*)::int FROM public.lab_submission_receipts WHERE actor_id = 'f6000000-0000-4000-8000-0000000000b1'), 1, 'B''s receipt untouched');
SELECT is((SELECT count(*)::int FROM public.lab_submission_attempts WHERE actor_id = 'f6000000-0000-4000-8000-0000000000b1'), 1, 'B''s attempt untouched');
SELECT is((SELECT count(*)::int FROM public.lab_results WHERE id IN ('f6000000-0000-4000-8000-0000000000e1', 'f6000000-0000-4000-8000-0000000000e2')), 2, 'lab results preserved');
SELECT is((SELECT status FROM public.lab_alert_evaluations WHERE lab_result_id = 'f6000000-0000-4000-8000-0000000000e1'), 'recorded', 'evaluation preserved');
SELECT is((SELECT count(*)::int FROM public.lab_alert_sources WHERE lab_result_id = 'f6000000-0000-4000-8000-0000000000e1'), 1, 'alert source preserved');
SELECT is((SELECT count(*)::int FROM public.lab_provenance_erasures WHERE actor_id = 'f6000000-0000-4000-8000-0000000000a1'), 1, 'erasure audited once');
SELECT is((SELECT receipts_deleted FROM public.lab_provenance_erasures WHERE actor_id = 'f6000000-0000-4000-8000-0000000000a1'), 1, 'audit row carries the receipt count');

-- Idempotent re-run.
INSERT INTO erasure_results SELECT 'again', * FROM public.purge_expired_tester_provenance('f6000000-0000-4000-8000-0000000000a1');
SELECT is((SELECT receipts_deleted + attempts_deleted + evaluations_detached FROM erasure_results WHERE label = 'again'), 0, 're-running erases nothing more');
SELECT is((SELECT count(*)::int FROM public.lab_provenance_erasures WHERE actor_id = 'f6000000-0000-4000-8000-0000000000a1'), 2, 'each run is audited');

-- The erasure is bound to its actor: inside the same transaction, another actor's rows stay protected.
RESET ROLE;
SELECT throws_ok($q$DELETE FROM public.lab_submission_receipts WHERE actor_id = 'f6000000-0000-4000-8000-0000000000b1'$q$, 'P0001', 'Laboratory provenance is append-only',
  'another actor''s receipts remain protected during A''s transaction');

-- After erasure the account deletion cascades.
RESET ROLE;
SELECT lives_ok($q$DELETE FROM auth.users WHERE id = 'f6000000-0000-4000-8000-0000000000a1'$q$, 'expired tester can be deleted after erasure');
SELECT is((SELECT count(*)::int FROM public.profiles WHERE id = 'f6000000-0000-4000-8000-0000000000a1'), 0, 'profile cascaded away');
SELECT is((SELECT count(*)::int FROM public.lab_results WHERE id = 'f6000000-0000-4000-8000-0000000000e1'), 1, 'patient X keeps the lab result after the actor is gone');

SELECT * FROM finish();
ROLLBACK;
