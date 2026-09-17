-- Single accountable provider, acceptance, transfer and structured outcome (00041).
-- All fixtures are synthetic and rolled back. Proves: one accountable item per organization
-- for a new alert; the labelled fan-out when no owner is resolvable; legacy duplicates of the
-- pre-00041 fan-out survive untouched and outside the new unique index; acceptance is never
-- inferred; transfers are offers, not possession; resolving an alert does not close the item;
-- closing an item of the new model requires an outcome code (with the deploy grace period);
-- and the three new read surfaces require AAL2.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- ---------------------------------------------------------------------------
-- A. Structure and contract
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'patient_accountability', 'designation table exists');
SELECT has_table('public', 'accountability_coverage', 'coverage table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.patient_accountability'::regclass),
  'patient_accountability has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.accountability_coverage'::regclass),
  'accountability_coverage has RLS enabled');

SELECT has_function('public', 'resolve_accountable_provider', ARRAY['uuid', 'uuid', 'timestamptz'],
  'accountable resolution exists');
SELECT has_function('public', 'accept_work_item', ARRAY['uuid'], 'acceptance RPC exists');
SELECT has_function('public', 'offer_work_item_transfer', ARRAY['uuid', 'uuid', 'text'], 'transfer offer RPC exists');
SELECT has_function('public', 'accept_work_item_transfer', ARRAY['uuid'], 'transfer acceptance RPC exists');
SELECT has_function('public', 'decline_work_item_transfer', ARRAY['uuid', 'text'], 'transfer decline RPC exists');
SELECT has_function('public', 'designate_patient_accountable',
  ARRAY['uuid', 'uuid', 'uuid', 'text', 'boolean'], 'designation RPC exists');
SELECT has_function('public', 'reassign_work_item', ARRAY['uuid', 'uuid', 'text'], 'forced reassignment RPC exists');
SELECT has_function('public', 'schedule_accountability_coverage',
  ARRAY['uuid', 'uuid', 'uuid', 'timestamptz', 'timestamptz', 'text'], 'coverage RPC exists');
SELECT has_function('public', 'get_unowned_work', ARRAY['uuid'], 'accountability gap RPC exists');
SELECT has_function('public', 'enforce_coverage_window', 'coverage overlap trigger function exists');
SELECT has_function('public', 'handle_membership_deactivation', 'membership deactivation trigger function exists');
SELECT has_function('public', 'work_item_outcome_grace_until', 'the closing grace deadline is a single object');

-- The App writes only outcome_code directly; acceptance and transfer are RPC-only.
SELECT is(
  (SELECT array_agg(DISTINCT column_name::text ORDER BY column_name::text)
   FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'work_items'
     AND grantee = 'authenticated' AND privilege_type = 'UPDATE'),
  ARRAY['assigned_to', 'due_at', 'outcome', 'outcome_code', 'snooze_reason', 'status'],
  'work_items grants UPDATE on exactly six columns');
SELECT ok(NOT has_column_privilege('authenticated', 'public.work_items', 'accepted_at', 'UPDATE'),
  'acceptance cannot be written by a client directly');
SELECT ok(NOT has_column_privilege('authenticated', 'public.work_items', 'transfer_pending_to', 'UPDATE'),
  'a transfer cannot be written by a client directly');
SELECT ok(NOT has_column_privilege('authenticated', 'public.work_items', 'accountability_source', 'UPDATE'),
  'the accountability label cannot be written by a client directly');

SELECT ok(NOT has_function_privilege('authenticated', 'public.resolve_accountable_provider(uuid,uuid,timestamptz)', 'EXECUTE'),
  'the resolution function is not callable by a client');
SELECT ok(has_function_privilege('service_role', 'public.resolve_accountable_provider(uuid,uuid,timestamptz)', 'EXECUTE'),
  'the resolution function is callable by the server path');
SELECT ok(NOT has_function_privilege('authenticated', 'public.work_item_outcome_grace_until()', 'EXECUTE'),
  'the grace deadline is not readable by a client');
SELECT ok(NOT has_function_privilege('anon', 'public.accept_work_item(uuid)', 'EXECUTE'),
  'anonymous callers cannot accept work');
SELECT ok(NOT has_function_privilege('anon', 'public.designate_patient_accountable(uuid,uuid,uuid,text,boolean)', 'EXECUTE'),
  'anonymous callers cannot designate accountability');
SELECT ok(NOT has_table_privilege('authenticated', 'public.patient_accountability', 'INSERT'),
  'a member cannot designate itself by writing the table');
SELECT ok(NOT has_table_privilege('authenticated', 'public.accountability_coverage', 'INSERT'),
  'a member cannot schedule coverage by writing the table');

SELECT is((SELECT count(*)::int FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('resolve_accountable_provider', 'accept_work_item', 'offer_work_item_transfer',
                    'accept_work_item_transfer', 'decline_work_item_transfer',
                    'designate_patient_accountable', 'reassign_work_item',
                    'schedule_accountability_coverage', 'get_unowned_work',
                    'enforce_coverage_window', 'handle_membership_deactivation',
                    'work_item_outcome_grace_until')
    AND pg_get_functiondef(oid) NOT LIKE '%SET search_path TO ''''%'
), 0, 'every new function pins an empty search_path');

-- The unique index carries the value list, not accountability_source IS NOT NULL: the fan-out
-- writes several 'legacy_fan_out' rows per (organization, alert) and they must stay outside it.
SELECT ok((SELECT pg_get_indexdef('public.work_items_one_accountable_per_alert'::regclass)
  LIKE '%''designated''%'), 'the unique index lists the single-accountable values');
SELECT ok((SELECT pg_get_indexdef('public.work_items_one_accountable_per_alert'::regclass)
  NOT LIKE '%legacy_fan_out%'), 'the unique index excludes the labelled fan-out');

SELECT ok((SELECT pg_get_constraintdef(oid) LIKE '%outcome_not_recorded%' FROM pg_constraint
  WHERE conrelid = 'public.work_items'::regclass AND conname = 'work_items_outcome_code'),
  'the outcome vocabulary includes the grace-period marker');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY[
    'clinical_action_taken', 'no_action_needed', 'patient_unreachable', 'care_not_delivered',
    'transferred_to_other_team', 'duplicate_or_superseded', 'administrative_close',
    'followup_completed', 'followup_skipped', 'outcome_not_recorded']) AS code
  WHERE (SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conrelid = 'public.work_items'::regclass AND conname = 'work_items_outcome_code')
        NOT LIKE '%''' || code || '''%'), 0, 'all ten outcome codes are accepted');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY[
    'designated', 'coverage', 'sole_member', 'org_owner', 'accepted_transfer',
    'manager_reassigned', 'legacy_fan_out']) AS label
  WHERE (SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conrelid = 'public.work_items'::regclass AND conname = 'work_items_accountability_source')
        NOT LIKE '%''' || label || '''%'), 0, 'all seven accountability labels are accepted');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY[
    'assigned', 'transfer_offered', 'accepted', 'declined', 'coverage_applied',
    'accountable_unavailable', 'underlying_alert_resolved', 'administratively_closed']) AS event
  WHERE (SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conrelid = 'public.work_item_events'::regclass
           AND conname = 'work_item_events_event_type_check')
        NOT LIKE '%''' || event || '''%'), 0, 'the event vocabulary carries the eight new types');

-- PGRST201 rule: no new key mixes a patients foreign key with a profiles foreign key.
SELECT is((SELECT count(*)::int
  FROM pg_constraint AS key
  JOIN pg_index AS idx ON idx.indexrelid = key.conindid
  WHERE key.conrelid IN ('public.patient_accountability'::regclass,
                         'public.accountability_coverage'::regclass)
    AND key.contype IN ('p', 'u')
    AND EXISTS (
      SELECT 1 FROM pg_constraint AS fk
      WHERE fk.conrelid = key.conrelid AND fk.contype = 'f'
        AND fk.confrelid = 'public.patients'::regclass
        AND fk.conkey && key.conkey)
    AND EXISTS (
      SELECT 1 FROM pg_constraint AS fk
      WHERE fk.conrelid = key.conrelid AND fk.contype = 'f'
        AND fk.confrelid = 'public.profiles'::regclass
        AND fk.conkey && key.conkey)
), 0, 'no new primary or unique key combines a patients and a profiles foreign key');
SELECT ok((SELECT pg_get_indexdef('public.patient_accountability_active_unique'::regclass)
  NOT LIKE '%accountable_id%'), 'the designation unique index excludes accountable_id');

-- The three new policies all require the second factor.
SELECT is((SELECT count(*)::int FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname IN ('members_read_accountability', 'members_read_coverage',
                       'transfer_recipients_read_work_items',
                       'transfer_recipients_read_work_item_events')
    AND qual LIKE '%provider_aal2%'), 4, 'every new read policy requires provider_aal2()');

-- ---------------------------------------------------------------------------
-- B. Fixtures
--    Organization A: owner OA, admin AD, clinicians C1, C2, C3. Organization B: owner OB.
--    One outsider provider. Six patients, one per accountability scenario.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
 ('41000000-0000-4000-8000-000000000a01', 'pa-owner-a@example.invalid', '{"consent_accepted":true}'),
 ('41000000-0000-4000-8000-000000000a02', 'pa-admin-a@example.invalid', '{"consent_accepted":true}'),
 ('41000000-0000-4000-8000-000000000a03', 'pa-clinician-1@example.invalid', '{"consent_accepted":true}'),
 ('41000000-0000-4000-8000-000000000a04', 'pa-clinician-2@example.invalid', '{"consent_accepted":true}'),
 ('41000000-0000-4000-8000-000000000a05', 'pa-clinician-3@example.invalid', '{"consent_accepted":true}'),
 ('41000000-0000-4000-8000-000000000b01', 'pa-owner-b@example.invalid', '{"consent_accepted":true}'),
 ('41000000-0000-4000-8000-000000000c01', 'pa-outsider@example.invalid', '{"consent_accepted":true}'),
 ('41000000-0000-4000-8000-000000000d01', 'pa-patient-1@example.invalid', '{"consent_accepted":true}'),
 ('41000000-0000-4000-8000-000000000d02', 'pa-patient-2@example.invalid', '{"consent_accepted":true}'),
 ('41000000-0000-4000-8000-000000000d03', 'pa-patient-3@example.invalid', '{"consent_accepted":true}'),
 ('41000000-0000-4000-8000-000000000d04', 'pa-patient-4@example.invalid', '{"consent_accepted":true}'),
 ('41000000-0000-4000-8000-000000000d05', 'pa-patient-5@example.invalid', '{"consent_accepted":true}'),
 ('41000000-0000-4000-8000-000000000d06', 'pa-patient-6@example.invalid', '{"consent_accepted":true}');

UPDATE public.profiles SET role = 'provider', full_name = 'Fixture Provider'
WHERE id IN ('41000000-0000-4000-8000-000000000a01', '41000000-0000-4000-8000-000000000a02',
             '41000000-0000-4000-8000-000000000a03', '41000000-0000-4000-8000-000000000a04',
             '41000000-0000-4000-8000-000000000a05', '41000000-0000-4000-8000-000000000b01',
             '41000000-0000-4000-8000-000000000c01');

-- Promoting a profile to provider provisions a personal organization (00027). Left active,
-- each fixture provider would own a team of its own and primary_organization_for_provider
-- would put its work there instead of in the fixture organizations below.
UPDATE public.organization_memberships AS membership SET status = 'revoked'
WHERE membership.user_id IN ('41000000-0000-4000-8000-000000000a01', '41000000-0000-4000-8000-000000000a02',
                             '41000000-0000-4000-8000-000000000a03', '41000000-0000-4000-8000-000000000a04',
                             '41000000-0000-4000-8000-000000000a05', '41000000-0000-4000-8000-000000000b01',
                             '41000000-0000-4000-8000-000000000c01')
  AND EXISTS (SELECT 1 FROM public.organizations AS organization
              WHERE organization.id = membership.organization_id AND organization.is_personal);
UPDATE public.organizations SET status = 'suspended'
WHERE is_personal
  AND created_by IN ('41000000-0000-4000-8000-000000000a01', '41000000-0000-4000-8000-000000000a02',
                     '41000000-0000-4000-8000-000000000a03', '41000000-0000-4000-8000-000000000a04',
                     '41000000-0000-4000-8000-000000000a05', '41000000-0000-4000-8000-000000000b01',
                     '41000000-0000-4000-8000-000000000c01');

INSERT INTO public.organizations(id, name, created_by) VALUES
 ('41000000-0000-4000-8000-0000000000aa', 'Accountability fixture A', '41000000-0000-4000-8000-000000000a01'),
 ('41000000-0000-4000-8000-0000000000bb', 'Accountability fixture B', '41000000-0000-4000-8000-000000000b01');

INSERT INTO public.organization_memberships(id, organization_id, user_id, role, status, joined_at, created_by) VALUES
 ('41000000-0000-4000-8000-000000001101', '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000a01', 'owner', 'active', now(), '41000000-0000-4000-8000-000000000a01'),
 ('41000000-0000-4000-8000-000000001102', '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000a02', 'admin', 'active', now(), '41000000-0000-4000-8000-000000000a01'),
 ('41000000-0000-4000-8000-000000001103', '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000a03', 'clinician', 'active', now(), '41000000-0000-4000-8000-000000000a01'),
 ('41000000-0000-4000-8000-000000001104', '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000a04', 'clinician', 'active', now(), '41000000-0000-4000-8000-000000000a01'),
 ('41000000-0000-4000-8000-000000001105', '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000a05', 'clinician', 'active', now(), '41000000-0000-4000-8000-000000000a01'),
 ('41000000-0000-4000-8000-000000001201', '41000000-0000-4000-8000-0000000000bb', '41000000-0000-4000-8000-000000000b01', 'owner', 'active', now(), '41000000-0000-4000-8000-000000000b01');

INSERT INTO public.organization_patient_assignments(organization_id, patient_id, assigned_by) VALUES
 ('41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d01', '41000000-0000-4000-8000-000000000a01'),
 ('41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d02', '41000000-0000-4000-8000-000000000a01'),
 ('41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d03', '41000000-0000-4000-8000-000000000a01'),
 ('41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d04', '41000000-0000-4000-8000-000000000a01'),
 ('41000000-0000-4000-8000-0000000000bb', '41000000-0000-4000-8000-000000000d04', '41000000-0000-4000-8000-000000000b01'),
 ('41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d05', '41000000-0000-4000-8000-000000000a01'),
 ('41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d06', '41000000-0000-4000-8000-000000000a01');

-- P1: three linked members of A (designation and transfer scenarios).
-- P2: owner plus one clinician, no designation (org_owner fallback).
-- P3: owner plus two clinicians (legacy duplicates of the pre-00041 fan-out).
-- P4: one member of A and the owner of B (one item per organization).
-- P5: two clinicians of A, the owner NOT linked (no resolvable owner: labelled fan-out).
-- P6: no link at all (resolution returns NULL).
INSERT INTO public.provider_patient_links(provider_id, patient_id, status, linked_at) VALUES
 ('41000000-0000-4000-8000-000000000a01', '41000000-0000-4000-8000-000000000d01', 'active', now()),
 ('41000000-0000-4000-8000-000000000a03', '41000000-0000-4000-8000-000000000d01', 'active', now()),
 ('41000000-0000-4000-8000-000000000a04', '41000000-0000-4000-8000-000000000d01', 'active', now()),
 ('41000000-0000-4000-8000-000000000a01', '41000000-0000-4000-8000-000000000d02', 'active', now()),
 ('41000000-0000-4000-8000-000000000a03', '41000000-0000-4000-8000-000000000d02', 'active', now()),
 ('41000000-0000-4000-8000-000000000a01', '41000000-0000-4000-8000-000000000d03', 'active', now()),
 ('41000000-0000-4000-8000-000000000a03', '41000000-0000-4000-8000-000000000d03', 'active', now()),
 ('41000000-0000-4000-8000-000000000a04', '41000000-0000-4000-8000-000000000d03', 'active', now()),
 ('41000000-0000-4000-8000-000000000a03', '41000000-0000-4000-8000-000000000d04', 'active', now()),
 ('41000000-0000-4000-8000-000000000b01', '41000000-0000-4000-8000-000000000d04', 'active', now()),
 ('41000000-0000-4000-8000-000000000a03', '41000000-0000-4000-8000-000000000d05', 'active', now()),
 ('41000000-0000-4000-8000-000000000a04', '41000000-0000-4000-8000-000000000d05', 'active', now());

-- ---------------------------------------------------------------------------
-- C. Designation and resolution
-- ---------------------------------------------------------------------------
-- A clinician is not a manager.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a03","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.designate_patient_accountable('41000000-0000-4000-8000-0000000000aa',
      '41000000-0000-4000-8000-000000000d01', '41000000-0000-4000-8000-000000000a03')$q$,
  '42501', NULL, 'a clinician cannot designate accountability');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000b01","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.designate_patient_accountable('41000000-0000-4000-8000-0000000000aa',
      '41000000-0000-4000-8000-000000000d01', '41000000-0000-4000-8000-000000000a03')$q$,
  '42501', NULL, 'a manager of another organization cannot designate here');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal1"}', true);
SELECT throws_ok(
  $q$SELECT public.designate_patient_accountable('41000000-0000-4000-8000-0000000000aa',
      '41000000-0000-4000-8000-000000000d01', '41000000-0000-4000-8000-000000000a03')$q$,
  '42501', NULL, 'designating accountability requires AAL2');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.designate_patient_accountable('41000000-0000-4000-8000-0000000000aa',
      '41000000-0000-4000-8000-000000000d01', '41000000-0000-4000-8000-000000000c01')$q$,
  '22023', NULL, 'the accountable member must belong to the organization');
SELECT lives_ok(
  $q$SELECT public.designate_patient_accountable('41000000-0000-4000-8000-0000000000aa',
      '41000000-0000-4000-8000-000000000d01', '41000000-0000-4000-8000-000000000a03',
      'Primary nurse for this patient')$q$,
  'a manager designates the accountable member');
-- The PHI boundary: designating an unlinked member creates the link in the same transaction.
SELECT lives_ok(
  $q$SELECT public.designate_patient_accountable('41000000-0000-4000-8000-0000000000aa',
      '41000000-0000-4000-8000-000000000d06', '41000000-0000-4000-8000-000000000a05',
      'Covering the unassigned patient')$q$,
  'a manager designates a member who was not linked yet');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.patient_accountability
  WHERE organization_id = '41000000-0000-4000-8000-0000000000aa'
    AND patient_id = '41000000-0000-4000-8000-000000000d01' AND revoked_at IS NULL), 1,
  'exactly one active designation exists for the patient');
SELECT is((SELECT count(*)::int FROM public.provider_patient_links
  WHERE provider_id = '41000000-0000-4000-8000-000000000a05'
    AND patient_id = '41000000-0000-4000-8000-000000000d06' AND status = 'active'), 1,
  'the designation created the missing provider-patient link');
SELECT throws_ok(
  $q$INSERT INTO public.patient_accountability (organization_id, patient_id, accountable_id, designated_by)
     VALUES ('41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d01',
             '41000000-0000-4000-8000-000000000a04', '41000000-0000-4000-8000-000000000a01')$q$,
  '23505', NULL, 'a second active designation for the same organization and patient is rejected');

SELECT is((SELECT resolved.accountability_source FROM public.resolve_accountable_provider(
    '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d01') AS resolved),
  'designated', 'the designated member is resolved');
SELECT is((SELECT resolved.accountable_id FROM public.resolve_accountable_provider(
    '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d01') AS resolved),
  '41000000-0000-4000-8000-000000000a03'::uuid, 'the designated member is the one recorded');
-- The single-member branch: this is the query the review found invalid as written
-- (a window function in HAVING, 42803); it must compile and return one member.
SELECT is((SELECT resolved.accountability_source FROM public.resolve_accountable_provider(
    '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d04') AS resolved),
  'sole_member', 'the single linked member of the organization is resolved');
SELECT is((SELECT resolved.accountable_id FROM public.resolve_accountable_provider(
    '41000000-0000-4000-8000-0000000000bb', '41000000-0000-4000-8000-000000000d04') AS resolved),
  '41000000-0000-4000-8000-000000000b01'::uuid, 'each organization resolves its own member');
SELECT is((SELECT resolved.accountability_source FROM public.resolve_accountable_provider(
    '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d02') AS resolved),
  'org_owner', 'two linked members and no designation fall back to the organization owner');
SELECT is((SELECT resolved.accountability_source FROM public.resolve_accountable_provider(
    '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d05') AS resolved),
  NULL, 'an unlinked owner and several linked members resolve to nobody');
SELECT is((SELECT resolved.accountable_id FROM public.resolve_accountable_provider(
    '41000000-0000-4000-8000-0000000000bb', '41000000-0000-4000-8000-000000000d01') AS resolved),
  NULL, 'an organization with no linked member resolves to nobody');

-- Coverage inside and outside the window.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$SELECT public.schedule_accountability_coverage('41000000-0000-4000-8000-0000000000aa',
      '41000000-0000-4000-8000-000000000a03', '41000000-0000-4000-8000-000000000a04',
      now() - interval '1 hour', now() + interval '1 hour', 'Night shift')$q$,
  'a manager schedules a coverage window');
RESET ROLE;
SELECT is((SELECT resolved.accountable_id FROM public.resolve_accountable_provider(
    '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d01') AS resolved),
  '41000000-0000-4000-8000-000000000a04'::uuid, 'inside the window the covering member answers');
SELECT is((SELECT resolved.accountability_source FROM public.resolve_accountable_provider(
    '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d01') AS resolved),
  'coverage', 'the covering member is labelled as coverage');
SELECT is((SELECT resolved.accountable_id FROM public.resolve_accountable_provider(
    '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d01',
    now() + interval '2 hours') AS resolved),
  '41000000-0000-4000-8000-000000000a03'::uuid, 'outside the window the designated member answers again');

-- A designation without an active patient link does not answer for the patient.
UPDATE public.provider_patient_links SET status = 'revoked'
WHERE provider_id = '41000000-0000-4000-8000-000000000a05'
  AND patient_id = '41000000-0000-4000-8000-000000000d06';
SELECT is((SELECT resolved.accountability_source FROM public.resolve_accountable_provider(
    '41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000d06') AS resolved),
  NULL, 'a designated member whose link was revoked is ignored');

-- Overlapping and adjacent coverage windows.
SELECT throws_ok(
  $q$INSERT INTO public.accountability_coverage (organization_id, member_id, covering_member_id,
       starts_at, ends_at, reason, created_by)
     VALUES ('41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000a03',
             '41000000-0000-4000-8000-000000000a05', now(), now() + interval '30 minutes',
             'Overlapping shift', '41000000-0000-4000-8000-000000000a01')$q$,
  'P0001', 'overlapping coverage window for this member',
  'an overlapping coverage window is rejected');
SELECT lives_ok(
  $q$INSERT INTO public.accountability_coverage (organization_id, member_id, covering_member_id,
       starts_at, ends_at, reason, created_by)
     VALUES ('41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000a03',
             '41000000-0000-4000-8000-000000000a05', now() + interval '1 hour',
             now() + interval '3 hours', 'Adjacent shift', '41000000-0000-4000-8000-000000000a01')$q$,
  'an adjacent coverage window is accepted');
SELECT throws_ok(
  $q$INSERT INTO public.accountability_coverage (organization_id, member_id, covering_member_id,
       starts_at, ends_at, reason, created_by)
     VALUES ('41000000-0000-4000-8000-0000000000aa', '41000000-0000-4000-8000-000000000a04',
             '41000000-0000-4000-8000-000000000a05', now(), now() - interval '1 hour',
             'Backwards shift', '41000000-0000-4000-8000-000000000a01')$q$,
  '23514', NULL, 'a window that ends before it starts is rejected');
SELECT throws_ok(
  $q$SELECT public.schedule_accountability_coverage('41000000-0000-4000-8000-0000000000aa',
      '41000000-0000-4000-8000-000000000a03', '41000000-0000-4000-8000-000000000a03',
      now() + interval '5 hours', now() + interval '6 hours', 'Self cover')$q$,
  '22023', NULL, 'a member cannot cover itself');

-- Non-AAL2 sessions read nothing from the three new surfaces.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a03","role":"authenticated","aal":"aal1"}', true);
SELECT is((SELECT count(*)::int FROM public.patient_accountability), 0,
  'an AAL1 provider session reads no designation');
SELECT is((SELECT count(*)::int FROM public.accountability_coverage), 0,
  'an AAL1 provider session reads no coverage window');
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE organization_id = '41000000-0000-4000-8000-0000000000aa'), 0,
  'an AAL1 provider session reads no work item');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000c01","role":"authenticated","aal":"aal2"}', true);
SELECT is((SELECT count(*)::int FROM public.patient_accountability), 0,
  'a provider outside the organization reads no designation');
SELECT is((SELECT count(*)::int FROM public.accountability_coverage), 0,
  'a provider outside the organization reads no coverage window');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a04","role":"authenticated","aal":"aal2"}', true);
SELECT is((SELECT count(*)::int FROM public.patient_accountability
  WHERE patient_id = '41000000-0000-4000-8000-000000000d01'), 1,
  'a member of the organization reads the designation of its patient');

-- ---------------------------------------------------------------------------
-- D. One accountable item per organization
-- ---------------------------------------------------------------------------
-- Coverage is in force for P1, so the first alert lands on the covering member.
RESET ROLE;
INSERT INTO public.alerts(id, patient_id, severity, flags, status, first_seen_at, last_seen_at) VALUES
 ('41000000-0000-4000-8000-000000009001', '41000000-0000-4000-8000-000000000d01', 'critical',
  ARRAY['weight_gain'], 'open', now(), now());
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE source_type = 'alert' AND source_id = '41000000-0000-4000-8000-000000009001'), 1,
  'a new alert creates exactly one accountable item');
SELECT is((SELECT assigned_to FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009001'),
  '41000000-0000-4000-8000-000000000a04'::uuid, 'the item goes to the covering member');
SELECT is((SELECT accountability_source FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009001'), 'coverage',
  'the item records how accountability was resolved');
SELECT is((SELECT provider_id FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009001'),
  '41000000-0000-4000-8000-000000000a04'::uuid, 'the accountable member is also the item owner');
SELECT is((SELECT count(*)::int FROM public.work_item_events AS event
  JOIN public.work_items AS item ON item.id = event.work_item_id
  WHERE item.source_id = '41000000-0000-4000-8000-000000009001'
    AND event.event_type = 'coverage_applied'), 1,
  'applying a coverage window is recorded as an event');
SELECT ok((SELECT accepted_at IS NULL FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009001'),
  'a created item is not accepted by itself');

-- A patient in two organizations gets one item per organization, each with its own owner.
INSERT INTO public.alerts(id, patient_id, severity, flags, status, first_seen_at, last_seen_at) VALUES
 ('41000000-0000-4000-8000-000000009002', '41000000-0000-4000-8000-000000000d04', 'warning',
  ARRAY['bp_low'], 'open', now(), now());
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009002'), 2,
  'a patient shared by two organizations gets one item in each');
SELECT is((SELECT count(DISTINCT organization_id)::int FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009002'), 2,
  'the two items belong to different organizations');
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009002'
    AND accountability_source = 'sole_member'), 2,
  'both items are labelled sole_member');

-- A second alert produces its own item.
INSERT INTO public.alerts(id, patient_id, severity, flags, status, first_seen_at, last_seen_at) VALUES
 ('41000000-0000-4000-8000-000000009003', '41000000-0000-4000-8000-000000000d02', 'warning',
  ARRAY['symptom_worsening'], 'open', now(), now());
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009003'
    AND accountability_source = 'org_owner'), 1,
  'the owner fallback creates one item, not one per linked provider');

-- No resolvable owner: the labelled fan-out, several rows for one organization and alert.
INSERT INTO public.alerts(id, patient_id, severity, flags, status, first_seen_at, last_seen_at) VALUES
 ('41000000-0000-4000-8000-000000009004', '41000000-0000-4000-8000-000000000d05', 'critical',
  ARRAY['potassium_high'], 'open', now(), now());
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009004'), 2,
  'with no resolvable owner the fan-out creates one item per linked provider');
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009004'
    AND accountability_source = 'legacy_fan_out'), 2,
  'every fallback item is labelled legacy_fan_out, never NULL');
SELECT is((SELECT count(DISTINCT organization_id)::int FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009004'), 1,
  'two labelled fan-out rows of the same alert coexist in one organization');

-- The unique index still rejects a duplicate inside the single-accountable model.
SELECT throws_ok(
  $q$INSERT INTO public.work_items (patient_id, provider_id, assigned_to, organization_id,
       source_type, source_id, title, reason, priority, severity, status, accountability_source)
     VALUES ('41000000-0000-4000-8000-000000000d02', '41000000-0000-4000-8000-000000000a03',
             '41000000-0000-4000-8000-000000000a03', '41000000-0000-4000-8000-0000000000aa',
             'alert', '41000000-0000-4000-8000-000000009003', 'Review patient alert',
             'Triggered signals: symptom_worsening', 'today', 'warning', 'new', 'designated')$q$,
  '23505', NULL, 'a second single-accountable item for the same organization and alert is rejected');

-- ---------------------------------------------------------------------------
-- E. Acceptance and transfer
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE pa_items(label text PRIMARY KEY, id uuid);
INSERT INTO pa_items(label, id)
SELECT 'covered', id FROM public.work_items WHERE source_id = '41000000-0000-4000-8000-000000009001';
INSERT INTO pa_items(label, id)
SELECT 'owner_fallback', id FROM public.work_items WHERE source_id = '41000000-0000-4000-8000-000000009003';
GRANT SELECT ON pa_items TO anon, authenticated, service_role;

-- Acceptance belongs to the accountable member alone.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a03","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.accept_work_item((SELECT id FROM pa_items WHERE label = 'covered'))$q$,
  '42501', NULL, 'a member cannot accept an item assigned to somebody else');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a04","role":"authenticated","aal":"aal1"}', true);
SELECT throws_ok(
  $q$SELECT public.accept_work_item((SELECT id FROM pa_items WHERE label = 'covered'))$q$,
  '42501', NULL, 'accepting work requires AAL2');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a04","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$SELECT public.accept_work_item((SELECT id FROM pa_items WHERE label = 'covered'))$q$,
  'the accountable member accepts the item');
SELECT lives_ok(
  $q$SELECT public.accept_work_item((SELECT id FROM pa_items WHERE label = 'covered'))$q$,
  'accepting twice is idempotent');
RESET ROLE;
SELECT is((SELECT accepted_by FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')),
  '41000000-0000-4000-8000-000000000a04'::uuid, 'the acceptance is attributed to the session');
SELECT is((SELECT count(*)::int FROM public.work_item_events
  WHERE work_item_id = (SELECT id FROM pa_items WHERE label = 'covered')
    AND event_type = 'accepted'), 1, 'acceptance is recorded once');
SELECT throws_ok(
  $q$UPDATE public.work_items SET accepted_at = now(),
       accepted_by = '41000000-0000-4000-8000-000000000a05'
     WHERE id = (SELECT id FROM pa_items WHERE label = 'owner_fallback')$q$,
  'P0001', 'acceptance must be recorded by the accountable member',
  'acceptance cannot be recorded for another member, even by the table owner');

-- Offering a transfer does not move the item.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a04","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.offer_work_item_transfer((SELECT id FROM pa_items WHERE label = 'covered'),
      '41000000-0000-4000-8000-000000000c01')$q$,
  'P0001', 'transfer target must be an active team member',
  'work cannot be offered to somebody outside the team');
SELECT throws_ok(
  $q$SELECT public.offer_work_item_transfer((SELECT id FROM pa_items WHERE label = 'covered'),
      '41000000-0000-4000-8000-000000000a04')$q$,
  'P0001', 'the item is already assigned to this member',
  'work cannot be offered to its current owner');
SELECT lives_ok(
  $q$SELECT public.offer_work_item_transfer((SELECT id FROM pa_items WHERE label = 'covered'),
      '41000000-0000-4000-8000-000000000a03', 'Handing back to the designated nurse')$q$,
  'the accountable member offers the item to a teammate');
SELECT throws_ok(
  $q$SELECT public.offer_work_item_transfer((SELECT id FROM pa_items WHERE label = 'covered'),
      '41000000-0000-4000-8000-000000000a05')$q$,
  'P0001', 'another transfer is already pending on this item',
  'a second pending transfer on the same item is rejected');
RESET ROLE;
SELECT is((SELECT assigned_to FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')),
  '41000000-0000-4000-8000-000000000a04'::uuid, 'a pending offer does not move assigned_to');
SELECT is((SELECT transfer_pending_to FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')),
  '41000000-0000-4000-8000-000000000a03'::uuid, 'the offer records its recipient');
SELECT is((SELECT count(*)::int FROM public.work_item_events
  WHERE work_item_id = (SELECT id FROM pa_items WHERE label = 'covered')
    AND event_type = 'transfer_offered'), 1, 'the offer is recorded as an event');

-- The recipient can see the offered item although they are neither owner nor manager.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a03","role":"authenticated","aal":"aal2"}', true);
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')), 1,
  'the transfer recipient reads the offered item');
SELECT ok((SELECT count(*)::int FROM public.work_item_events
  WHERE work_item_id = (SELECT id FROM pa_items WHERE label = 'covered')) > 0,
  'the transfer recipient reads the item trail');

-- Declining returns the item, with a reason.
SELECT throws_ok(
  $q$SELECT public.decline_work_item_transfer((SELECT id FROM pa_items WHERE label = 'covered'), 'no')$q$,
  '22023', NULL, 'declining a transfer requires a documented reason');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a05","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.decline_work_item_transfer((SELECT id FROM pa_items WHERE label = 'covered'),
      'Not my patient this week')$q$,
  '42501', NULL, 'only the recipient can decline the offer');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a03","role":"authenticated","aal":"aal1"}', true);
SELECT throws_ok(
  $q$SELECT public.decline_work_item_transfer((SELECT id FROM pa_items WHERE label = 'covered'),
      'Not my patient this week')$q$,
  '42501', NULL, 'declining a transfer requires AAL2');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a03","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$SELECT public.decline_work_item_transfer((SELECT id FROM pa_items WHERE label = 'covered'),
      'On leave for the rest of the week')$q$,
  'the recipient declines the offer');
RESET ROLE;
SELECT is((SELECT assigned_to FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')),
  '41000000-0000-4000-8000-000000000a04'::uuid, 'after a decline the previous owner still answers');
SELECT ok((SELECT transfer_pending_to IS NULL AND declined_reason IS NOT NULL
  FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')),
  'the decline clears the offer and keeps its reason');
SELECT is((SELECT count(*)::int FROM public.work_item_events
  WHERE work_item_id = (SELECT id FROM pa_items WHERE label = 'covered')
    AND event_type = 'declined'), 1, 'the decline is recorded as an event');

-- Offering again and accepting: the label becomes accepted_transfer and the previous delivery
-- is superseded.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a04","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$SELECT public.offer_work_item_transfer((SELECT id FROM pa_items WHERE label = 'covered'),
      '41000000-0000-4000-8000-000000000a03')$q$,
  'the owner offers the item again');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a05","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.accept_work_item_transfer((SELECT id FROM pa_items WHERE label = 'covered'))$q$,
  '42501', NULL, 'a member who was not offered the item cannot accept it');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a03","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$SELECT public.accept_work_item_transfer((SELECT id FROM pa_items WHERE label = 'covered'))$q$,
  'the recipient accepts the transfer');
-- The concurrent loser's path: FOR UPDATE serializes the two calls and the second finds the
-- offer already cleared, so it raises instead of silently doing nothing.
SELECT throws_ok(
  $q$SELECT public.accept_work_item_transfer((SELECT id FROM pa_items WHERE label = 'covered'))$q$,
  '42501', NULL, 'a second acceptance of the same offer raises 42501');
RESET ROLE;
SELECT is((SELECT assigned_to FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')),
  '41000000-0000-4000-8000-000000000a03'::uuid, 'the accepted transfer moves the item');
SELECT is((SELECT accountability_source FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')),
  'accepted_transfer', 'an accepted transfer is labelled as such');
SELECT ok((SELECT accepted_by = assigned_to AND accepted_at IS NOT NULL
  FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')),
  'the acceptance belongs to the new owner');
SELECT ok((SELECT transfer_pending_to IS NULL AND transfer_offered_at IS NULL
  FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')),
  'accepting the transfer clears the offer');
SELECT is((SELECT count(*)::int FROM public.notification_deliveries
  WHERE work_item_id = (SELECT id FROM pa_items WHERE label = 'covered') AND state = 'superseded'), 1,
  'the previous owner delivery is superseded');

-- Forced reassignment by a manager: labelled, and it never inherits the acceptance.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a04","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.reassign_work_item((SELECT id FROM pa_items WHERE label = 'covered'),
      '41000000-0000-4000-8000-000000000a05', 'Rebalancing the queue')$q$,
  '42501', NULL, 'only a manager reassigns work by force');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a02","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.reassign_work_item((SELECT id FROM pa_items WHERE label = 'covered'),
      '41000000-0000-4000-8000-000000000a05', 'no')$q$,
  '22023', NULL, 'a forced reassignment requires a reason');
SELECT lives_ok(
  $q$SELECT public.reassign_work_item((SELECT id FROM pa_items WHERE label = 'covered'),
      '41000000-0000-4000-8000-000000000a05', 'Designated nurse is on leave')$q$,
  'a manager reassigns the item by force');
RESET ROLE;
SELECT is((SELECT accountability_source FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')),
  'manager_reassigned', 'a forced reassignment is labelled manager_reassigned');
SELECT ok((SELECT accepted_at IS NULL AND accepted_by IS NULL
  FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')),
  'a forced reassignment never inherits the previous acceptance');
SELECT is((SELECT count(*)::int FROM public.work_item_events
  WHERE work_item_id = (SELECT id FROM pa_items WHERE label = 'covered')
    AND event_type = 'assigned'), 1, 'the forced reassignment is recorded as an event');

-- ---------------------------------------------------------------------------
-- F. Absence, revoked membership and the accountability gap
-- ---------------------------------------------------------------------------
-- Suspending a member revokes their designations, cancels their offers, clears the acceptance
-- and records why, without moving the work.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$SELECT public.designate_patient_accountable('41000000-0000-4000-8000-0000000000aa',
      '41000000-0000-4000-8000-000000000d02', '41000000-0000-4000-8000-000000000a04',
      'Second nurse takes over')$q$,
  'a manager designates the accountable member of another patient');
SELECT lives_ok(
  $q$SELECT public.offer_work_item_transfer((SELECT id FROM pa_items WHERE label = 'owner_fallback'),
      '41000000-0000-4000-8000-000000000a04', 'Handing over with the designation')$q$,
  'the manager offers the open item to the new accountable member');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$SELECT public.accept_work_item((SELECT id FROM pa_items WHERE label = 'owner_fallback'))$q$,
  'the current owner accepts its own item');
RESET ROLE;
UPDATE public.organization_memberships SET status = 'suspended'
WHERE id = '41000000-0000-4000-8000-000000001104';
SELECT is((SELECT count(*)::int FROM public.patient_accountability
  WHERE accountable_id = '41000000-0000-4000-8000-000000000a04' AND revoked_at IS NULL), 0,
  'suspending a member revokes their designations');
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE transfer_pending_to = '41000000-0000-4000-8000-000000000a04'), 0,
  'offers pending for a suspended member are cancelled');
SELECT is((SELECT count(*)::int FROM public.work_item_events
  WHERE event_type = 'accountable_unavailable'), 1,
  'the unavailability of an accountable member is recorded');
SELECT ok((SELECT count(*)::int FROM public.patient_accountability
  WHERE accountable_id = '41000000-0000-4000-8000-000000000a04') > 0,
  'the revoked designation is kept as history');

-- The manager sees the gap: legacy items, unaccepted items, and patients who left.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT ok((SELECT count(*)::int FROM public.get_unowned_work('41000000-0000-4000-8000-0000000000aa')
  WHERE reason_code = 'legacy_fan_out') >= 2,
  'the labelled fan-out items appear in the accountability gap');
SELECT ok((SELECT count(*)::int FROM public.get_unowned_work('41000000-0000-4000-8000-0000000000aa')
  WHERE reason_code = 'unaccepted') >= 1,
  'items nobody accepted appear in the accountability gap');
RESET ROLE;
UPDATE public.organization_patient_assignments
SET status = 'revoked', revoked_at = now()
WHERE organization_id = '41000000-0000-4000-8000-0000000000aa'
  AND patient_id = '41000000-0000-4000-8000-000000000d04';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT is((SELECT count(*)::int FROM public.get_unowned_work('41000000-0000-4000-8000-0000000000aa')
  WHERE reason_code = 'patient_unassigned'), 1,
  'an item whose patient left the organization is listed for the manager');
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE patient_id = '41000000-0000-4000-8000-000000000d04'
    AND organization_id = '41000000-0000-4000-8000-0000000000aa'), 0,
  'the same item has already disappeared from the team screens');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a03","role":"authenticated","aal":"aal2"}', true);
SELECT is((SELECT count(*)::int FROM public.get_unowned_work('41000000-0000-4000-8000-0000000000aa')), 0,
  'the accountability gap is a manager report');

-- ---------------------------------------------------------------------------
-- G. Resolving an alert leaves the work open; closing needs a human outcome
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
UPDATE public.alerts SET status = 'acknowledged'
WHERE id = '41000000-0000-4000-8000-000000009003';
SELECT is((SELECT status FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'owner_fallback')),
  'reviewed', 'acknowledging the alert still moves the item to reviewed');
UPDATE public.alerts SET status = 'resolved', resolution_note = 'Patient contacted and stable'
WHERE id = '41000000-0000-4000-8000-000000009003';
SELECT is((SELECT status FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'owner_fallback')),
  'reviewed', 'resolving the alert does not close the work item');
SELECT ok((SELECT underlying_alert_resolved_at IS NOT NULL FROM public.work_items
  WHERE id = (SELECT id FROM pa_items WHERE label = 'owner_fallback')),
  'the item records that the underlying signal stopped');
SELECT is((SELECT count(*)::int FROM public.work_item_events
  WHERE work_item_id = (SELECT id FROM pa_items WHERE label = 'owner_fallback')
    AND event_type = 'underlying_alert_resolved'), 1,
  'the resolution of the signal is recorded once');
SELECT ok((SELECT outcome IS NULL FROM public.work_items
  WHERE id = (SELECT id FROM pa_items WHERE label = 'owner_fallback')),
  'no literal outcome is written on the item by the alert path');
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE outcome = 'Alert resolved in the operational inbox'), 0,
  'the clerical closing text of 00026 is never written again');

-- Closing rules. Text outcome and structured code are complementary, not alternatives.
SELECT throws_ok(
  $q$UPDATE public.work_items SET status = 'closed', outcome = 'ok',
       outcome_code = 'no_action_needed'
     WHERE id = (SELECT id FROM pa_items WHERE label = 'owner_fallback')$q$,
  'P0001', 'closing requires an outcome', 'a two-character outcome is still rejected');
SELECT throws_ok(
  $q$UPDATE public.work_items SET status = 'closed', outcome = 'Reviewed and documented',
       outcome_code = 'teleported'
     WHERE id = (SELECT id FROM pa_items WHERE label = 'owner_fallback')$q$,
  '23514', NULL, 'an outcome code outside the vocabulary is rejected');
-- An administrative close is a manager decision and never dismisses an unresolved alert.
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a03","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$UPDATE public.work_items SET status = 'closed', outcome = 'Closing without review',
       outcome_code = 'administrative_close'
     WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')$q$,
  'P0001', 'an administrative close requires a team manager',
  'a clinician cannot close an item administratively');
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$UPDATE public.work_items SET status = 'closed', outcome = 'Duplicate of the other queue',
       outcome_code = 'administrative_close'
     WHERE id = (SELECT id FROM pa_items WHERE label = 'covered')$q$,
  'P0001', 'an administrative close cannot dismiss an unresolved alert',
  'an administrative close is refused while the alert is still open');
SELECT lives_ok(
  $q$UPDATE public.work_items SET status = 'closed', outcome = 'Superseded by the other queue',
       outcome_code = 'administrative_close'
     WHERE id = (SELECT id FROM pa_items WHERE label = 'owner_fallback')$q$,
  'a manager closes administratively once the alert is resolved');
SELECT is((SELECT count(*)::int FROM public.work_item_events
  WHERE work_item_id = (SELECT id FROM pa_items WHERE label = 'owner_fallback')
    AND event_type = 'administratively_closed'), 1,
  'an administrative close is recorded with its own event');
SELECT throws_ok(
  $q$UPDATE public.work_items SET outcome_code = 'no_action_needed'
     WHERE id = (SELECT id FROM pa_items WHERE label = 'owner_fallback')$q$,
  'P0001', 'closed work items cannot be reopened',
  'the outcome code of a closed item is immutable');
SELECT throws_ok(
  $q$UPDATE public.work_items SET status = 'reviewed'
     WHERE id = (SELECT id FROM pa_items WHERE label = 'owner_fallback')$q$,
  'P0001', 'closed work items cannot be reopened', 'a closed item does not reopen');

-- The grace period: during it, a closing without a code is stamped and audited.
INSERT INTO pa_items(label, id)
SELECT 'fanout_a', id FROM public.work_items
WHERE source_id = '41000000-0000-4000-8000-000000009004'
  AND assigned_to = '41000000-0000-4000-8000-000000000a03';
INSERT INTO pa_items(label, id)
SELECT 'fanout_b', id FROM public.work_items
WHERE source_id = '41000000-0000-4000-8000-000000009004'
  AND assigned_to = '41000000-0000-4000-8000-000000000a04';
SELECT ok((SELECT public.work_item_outcome_grace_until() > now()),
  'the rehearsal runs inside the deploy grace period');
SELECT lives_ok(
  $q$UPDATE public.work_items SET status = 'closed', outcome = 'Closed by the previous client'
     WHERE id = (SELECT id FROM pa_items WHERE label = 'fanout_a')$q$,
  'the old client can still close during the grace period');
SELECT is((SELECT outcome_code FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'fanout_a')),
  'outcome_not_recorded', 'a closing without a code is stamped as not recorded');
SELECT is((SELECT count(*)::int FROM public.work_item_events
  WHERE work_item_id = (SELECT id FROM pa_items WHERE label = 'fanout_a')
    AND event_type = 'closed'), 1, 'the stamped closing is recorded as an event');

-- After the deadline the requirement is strict. The deadline is a single ungranted function,
-- so the suite can move it inside its own transaction and exercise the other branch.
RESET ROLE;
CREATE OR REPLACE FUNCTION public.work_item_outcome_grace_until()
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT timestamptz '2020-01-01 00:00:00+00' $$;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$UPDATE public.work_items SET status = 'closed', outcome = 'Closed by the previous client'
     WHERE id = (SELECT id FROM pa_items WHERE label = 'fanout_b')$q$,
  'P0001', 'closing requires a documented outcome code',
  'after the grace period a labelled item cannot be closed without a code');
SELECT lives_ok(
  $q$UPDATE public.work_items SET status = 'closed', outcome = 'Contacted the patient, no change',
       outcome_code = 'clinical_action_taken'
     WHERE id = (SELECT id FROM pa_items WHERE label = 'fanout_b')$q$,
  'closing with a code and a documented outcome succeeds');
SELECT is((SELECT outcome_code FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'fanout_b')),
  'clinical_action_taken', 'the structured outcome is recorded');

-- ---------------------------------------------------------------------------
-- H. The pre-00041 collection: untouched, and still closable the old way
-- ---------------------------------------------------------------------------
-- Two rows of the legacy fan-out for one alert in one organization, exactly the shape the
-- restored 16/09 collection carries: accountability_source NULL, outside the unique index.
RESET ROLE;
SELECT set_config('request.jwt.claims', NULL, true);
INSERT INTO public.alerts(id, patient_id, severity, flags, status, first_seen_at, last_seen_at) VALUES
 ('41000000-0000-4000-8000-000000009005', '41000000-0000-4000-8000-000000000d03', 'warning',
  ARRAY['weight_gain'], 'open', now(), now());
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009005'), 1,
  'the new model created one item for this alert');
SELECT lives_ok(
  $q$INSERT INTO public.work_items (patient_id, provider_id, assigned_to, organization_id,
       source_type, source_id, title, reason, priority, severity, status)
     VALUES
     ('41000000-0000-4000-8000-000000000d03', '41000000-0000-4000-8000-000000000a03',
      '41000000-0000-4000-8000-000000000a03', '41000000-0000-4000-8000-0000000000aa',
      'alert', '41000000-0000-4000-8000-000000009005', 'Review patient alert',
      'Triggered signals: weight_gain', 'today', 'warning', 'new'),
     ('41000000-0000-4000-8000-000000000d03', '41000000-0000-4000-8000-000000000a05',
      '41000000-0000-4000-8000-000000000a05', '41000000-0000-4000-8000-0000000000aa',
      'alert', '41000000-0000-4000-8000-000000009005', 'Review patient alert',
      'Triggered signals: weight_gain', 'today', 'warning', 'new')$q$,
  'two legacy duplicates of one alert in one organization are accepted');
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009005' AND accountability_source IS NULL), 2,
  'the legacy duplicates keep a NULL accountability label');
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE organization_id = '41000000-0000-4000-8000-0000000000aa'
    AND source_id = '41000000-0000-4000-8000-000000009005'), 3,
  'the unique index leaves the legacy duplicates alone');

INSERT INTO pa_items(label, id)
SELECT 'legacy_a', id FROM public.work_items
WHERE source_id = '41000000-0000-4000-8000-000000009005'
  AND accountability_source IS NULL
  AND assigned_to = '41000000-0000-4000-8000-000000000a03';
INSERT INTO pa_items(label, id)
SELECT 'legacy_b', id FROM public.work_items
WHERE source_id = '41000000-0000-4000-8000-000000009005'
  AND accountability_source IS NULL
  AND assigned_to = '41000000-0000-4000-8000-000000000a05';
INSERT INTO pa_items(label, id)
SELECT 'owner_9005', id FROM public.work_items
WHERE source_id = '41000000-0000-4000-8000-000000009005'
  AND accountability_source = 'org_owner';

-- A forced reassignment of a legacy row does not promote it, so it never collides with the
-- unique index of the new model.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$SELECT public.reassign_work_item((SELECT id FROM pa_items WHERE label = 'legacy_a'),
      '41000000-0000-4000-8000-000000000a02', 'Consolidating the legacy duplicates')$q$,
  'a legacy duplicate can be reassigned by a manager');
RESET ROLE;
SELECT is((SELECT accountability_source FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'legacy_a')),
  NULL, 'reassigning a pre-00041 row never promotes its accountability label');
SELECT is((SELECT assigned_to FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'legacy_a')),
  '41000000-0000-4000-8000-000000000a02'::uuid, 'the forced reassignment moved the legacy item');

-- The old closing rule still applies to the old collection: text only, no code required.
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a05","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$UPDATE public.work_items SET status = 'closed', outcome = 'Reviewed with the patient'
     WHERE id = (SELECT id FROM pa_items WHERE label = 'legacy_b')$q$,
  'a pre-00041 item closes with a text outcome alone');
SELECT is((SELECT outcome_code FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'legacy_b')),
  NULL, 'closing a pre-00041 item stamps no outcome code');

-- Designating an accountable member converts the open legacy rows into offers, never possession.
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$SELECT public.designate_patient_accountable('41000000-0000-4000-8000-0000000000aa',
      '41000000-0000-4000-8000-000000000d03', '41000000-0000-4000-8000-000000000a03',
      'Taking over the legacy queue', true)$q$,
  'designating with p_offer_open_items offers the open items');
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009005'
    AND transfer_pending_to = '41000000-0000-4000-8000-000000000a03'), 2,
  'the two open items of that alert became offers to the new accountable member');
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009005'
    AND assigned_to = '41000000-0000-4000-8000-000000000a03'), 0,
  'no item changed owner by itself: a designation produces offers, never possession');

-- Both offers can be accepted by the same member without colliding in the unique index,
-- because a legacy row is never promoted into the single-accountable model.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-000000000a03","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$SELECT public.accept_work_item_transfer((SELECT id FROM pa_items WHERE label = 'legacy_a'))$q$,
  'the new accountable member accepts the legacy duplicate');
SELECT lives_ok(
  $q$SELECT public.accept_work_item_transfer((SELECT id FROM pa_items WHERE label = 'owner_9005'))$q$,
  'the same member also accepts the single-accountable item of the same alert');
RESET ROLE;
SELECT is((SELECT accountability_source FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'legacy_a')),
  NULL, 'accepting a legacy duplicate does not promote it either');
SELECT is((SELECT accountability_source FROM public.work_items WHERE id = (SELECT id FROM pa_items WHERE label = 'owner_9005')),
  'accepted_transfer', 'the single-accountable item of the same alert is promoted on acceptance');
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE source_id = '41000000-0000-4000-8000-000000009005'
    AND assigned_to = '41000000-0000-4000-8000-000000000a03'), 2,
  'one member holds two items of the same alert without colliding in the unique index');

-- Metrics contract: the two administrative markers are never clinical completions.
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE status = 'closed'
    AND outcome_code IN ('administrative_close', 'outcome_not_recorded')), 2,
  'the collection carries the two administrative closings of this suite');
SELECT is((SELECT count(*)::int FROM public.work_items
  WHERE status = 'closed'
    AND organization_id = '41000000-0000-4000-8000-0000000000aa'
    AND outcome_code IS NOT NULL
    AND outcome_code NOT IN ('administrative_close', 'outcome_not_recorded')), 1,
  'only one closing of this suite counts as a clinical completion');

-- ---------------------------------------------------------------------------
-- I. Coalescence keeps working and never duplicates the item
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT ok((SELECT created FROM public.coalesce_patient_alert(
  '41000000-0000-4000-8000-000000000d01', NULL, 'warning', ARRAY['sodium_high'])),
  'the first observation creates an alert');
SELECT ok(NOT (SELECT created FROM public.coalesce_patient_alert(
  '41000000-0000-4000-8000-000000000d01', NULL, 'warning', ARRAY['sodium_high'])),
  'the second observation is coalesced into the same alert');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.work_items AS item
  JOIN public.alerts AS alert ON alert.id = item.source_id
  WHERE alert.patient_id = '41000000-0000-4000-8000-000000000d01'
    AND alert.flags = ARRAY['sodium_high']), 1,
  'two coalesced observations produce a single work item');
SELECT is((SELECT alert.occurrence_count FROM public.alerts AS alert
  WHERE alert.patient_id = '41000000-0000-4000-8000-000000000d01'
    AND alert.flags = ARRAY['sodium_high']), 2,
  'the coalesced alert counted both observations');
-- coalesce_patient_alert sets last_seen_at = now(), the transaction timestamp, so inside one
-- transaction the refresh trigger sees no change. Moving last_seen_at explicitly exercises it.
UPDATE public.alerts AS alert
SET last_seen_at = alert.last_seen_at + interval '1 minute'
WHERE alert.patient_id = '41000000-0000-4000-8000-000000000d01'
  AND alert.flags = ARRAY['sodium_high'];
SELECT ok((SELECT item.reason LIKE '%observed 2 times%' FROM public.work_items AS item
  JOIN public.alerts AS alert ON alert.id = item.source_id
  WHERE alert.patient_id = '41000000-0000-4000-8000-000000000d01'
    AND alert.flags = ARRAY['sodium_high']),
  'the coalesced work item keeps being refreshed with the observation count');

SELECT * FROM finish();
ROLLBACK;
