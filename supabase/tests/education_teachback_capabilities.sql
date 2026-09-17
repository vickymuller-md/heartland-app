-- Professional teach-back records and per-member capabilities (00040).
-- All fixtures are synthetic and rolled back. Proves: the capability table carries no
-- credential strings and no write grant; the capability lookup is not an oracle for other
-- teams; credential evidence is manager-only; recording a teach-back needs AAL2, a link,
-- an assignment and the `educate` authorization in the organization it is recorded against;
-- teach-back history is append-only; and education_progress is untouched by the migration.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- ---------------------------------------------------------------------------
-- A. Shape, RLS and privileges
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'member_authorizations', 'member capability table exists');
SELECT has_table('public', 'member_authorization_evidence', 'credential evidence table exists');
SELECT has_table('public', 'education_teachbacks', 'verified teach-back table exists');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.member_authorizations'::regclass),
  'member_authorizations has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.member_authorization_evidence'::regclass),
  'member_authorization_evidence has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.education_teachbacks'::regclass),
  'education_teachbacks has RLS enabled');

SELECT has_function('public', 'member_capability_granted', ARRAY['text', 'uuid', 'uuid'], 'internal capability check exists');
SELECT has_function('public', 'member_has_capability', ARRAY['text', 'uuid', 'uuid'], 'client capability check exists');
SELECT has_function('public', 'grant_member_capability', ARRAY['uuid', 'text', 'text', 'timestamptz'], 'capability grant RPC exists');
SELECT has_function('public', 'revoke_member_capability', ARRAY['uuid'], 'capability revocation RPC exists');
SELECT has_function('public', 'record_education_teachback',
  ARRAY['uuid', 'text', 'text', 'text', 'text', 'text', 'boolean', 'timestamptz'], 'teach-back RPC exists');
SELECT has_function('public', 'get_education_teachback_state', ARRAY['uuid'], 'derived teach-back state RPC exists');

-- No credential string lives in the member-readable table.
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'member_authorizations' AND column_name = 'evidence_ref'
), 'member_authorizations carries no evidence_ref column');
SELECT has_column('public', 'member_authorization_evidence', 'evidence_ref', 'evidence lives in the manager-only table');

-- Writes to all three tables go through definer functions only.
SELECT ok(NOT has_table_privilege('authenticated', 'public.member_authorizations', 'INSERT'),
  'members cannot self-grant capabilities');
SELECT ok(NOT has_table_privilege('authenticated', 'public.member_authorizations', 'UPDATE'),
  'members cannot edit capability grants');
SELECT ok(NOT has_table_privilege('service_role', 'public.member_authorizations', 'INSERT'),
  'service role cannot forge capability grants directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.member_authorization_evidence', 'INSERT'),
  'members cannot forge credential evidence');
SELECT ok(NOT has_table_privilege('authenticated', 'public.education_teachbacks', 'INSERT'),
  'clients cannot insert teach-backs outside the RPC');
SELECT ok(NOT has_table_privilege('service_role', 'public.education_teachbacks', 'INSERT'),
  'service role cannot insert teach-backs directly');
SELECT ok(has_table_privilege('authenticated', 'public.education_teachbacks', 'SELECT'),
  'teach-backs are readable through RLS');

-- The internal capability check is not reachable from a client; the gated one is.
SELECT ok(NOT has_function_privilege('authenticated', 'public.member_capability_granted(text,uuid,uuid)', 'EXECUTE'),
  'the ungated capability check is not callable by clients');
SELECT ok(has_function_privilege('authenticated', 'public.member_has_capability(text,uuid,uuid)', 'EXECUTE'),
  'the gated capability check is callable by members');
SELECT ok(NOT has_function_privilege('anon', 'public.record_education_teachback(uuid,text,text,text,text,text,boolean,timestamptz)', 'EXECUTE'),
  'anonymous callers cannot record teach-backs');
SELECT ok(NOT has_function_privilege('anon', 'public.grant_member_capability(uuid,text,text,timestamptz)', 'EXECUTE'),
  'anonymous callers cannot grant capabilities');

-- Every new function isolates its search_path.
SELECT is((SELECT count(*)::int FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('member_capability_granted', 'member_has_capability', 'grant_member_capability',
                    'revoke_member_capability', 'record_education_teachback',
                    'get_education_teachback_state', 'reject_education_teachback_mutation')
    AND pg_get_functiondef(oid) NOT LIKE '%SET search_path TO ''''%'
), 0, 'every new function pins an empty search_path');
SELECT is((SELECT count(*)::int FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('member_capability_granted', 'member_has_capability', 'grant_member_capability',
                    'revoke_member_capability', 'record_education_teachback',
                    'get_education_teachback_state')
), 6, 'the six new functions of 00040 are present');

-- PGRST201 rule: no new table references patients at all, so no new patients/profiles junction.
SELECT is((SELECT count(*)::int FROM pg_constraint
  WHERE contype = 'f' AND confrelid = 'public.patients'::regclass
    AND conrelid IN ('public.member_authorizations'::regclass,
                     'public.member_authorization_evidence'::regclass,
                     'public.education_teachbacks'::regclass)
), 0, 'no new table carries a patients foreign key');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.education_teachbacks'::regclass
    AND tgname = 'immutable_education_teachbacks' AND NOT tgisinternal
), 'teach-back history is append-only by trigger');

-- ---------------------------------------------------------------------------
-- B. Fixtures: organization A (owner, admin, clinician, coordinator), organization B
--    (owner, plus the same clinician), one outsider provider and one patient assigned
--    to A first and to B second.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
 ('40000000-0000-4000-8000-000000000a01', 'tb-owner-a@example.invalid', '{"consent_accepted":true}'),
 ('40000000-0000-4000-8000-000000000a04', 'tb-admin-a@example.invalid', '{"consent_accepted":true}'),
 ('40000000-0000-4000-8000-000000000a02', 'tb-clinician@example.invalid', '{"consent_accepted":true}'),
 ('40000000-0000-4000-8000-000000000a03', 'tb-coordinator-a@example.invalid', '{"consent_accepted":true}'),
 ('40000000-0000-4000-8000-000000000b01', 'tb-owner-b@example.invalid', '{"consent_accepted":true}'),
 ('40000000-0000-4000-8000-000000000c01', 'tb-outsider@example.invalid', '{"consent_accepted":true}'),
 ('40000000-0000-4000-8000-000000000d01', 'tb-patient-x@example.invalid', '{"consent_accepted":true}');
UPDATE public.profiles SET role = 'provider', full_name = 'Fixture Provider'
WHERE id IN ('40000000-0000-4000-8000-000000000a01', '40000000-0000-4000-8000-000000000a04',
             '40000000-0000-4000-8000-000000000a02', '40000000-0000-4000-8000-000000000a03',
             '40000000-0000-4000-8000-000000000b01', '40000000-0000-4000-8000-000000000c01');

-- Promoting a profile to provider provisions a personal organization with an owner
-- membership (00027). Left alone, every fixture provider would own a team of its own and
-- the seed would grant it `educate` there, so the capability tests would never bind.
-- Suspending those organizations and revoking their memberships leaves only the explicit
-- memberships below in force.
UPDATE public.organization_memberships AS membership SET status = 'revoked'
WHERE membership.user_id IN ('40000000-0000-4000-8000-000000000a01', '40000000-0000-4000-8000-000000000a04',
                             '40000000-0000-4000-8000-000000000a02', '40000000-0000-4000-8000-000000000a03',
                             '40000000-0000-4000-8000-000000000b01', '40000000-0000-4000-8000-000000000c01')
  AND EXISTS (SELECT 1 FROM public.organizations AS organization
              WHERE organization.id = membership.organization_id AND organization.is_personal);
UPDATE public.organizations SET status = 'suspended'
WHERE is_personal
  AND created_by IN ('40000000-0000-4000-8000-000000000a01', '40000000-0000-4000-8000-000000000a04',
                     '40000000-0000-4000-8000-000000000a02', '40000000-0000-4000-8000-000000000a03',
                     '40000000-0000-4000-8000-000000000b01', '40000000-0000-4000-8000-000000000c01');

INSERT INTO public.organizations(id, name, created_by) VALUES
 ('40000000-0000-4000-8000-00000000000a', 'Teach-back fixture A', '40000000-0000-4000-8000-000000000a01'),
 ('40000000-0000-4000-8000-00000000000b', 'Teach-back fixture B', '40000000-0000-4000-8000-000000000b01');

INSERT INTO public.organization_memberships(id, organization_id, user_id, role, status, joined_at, created_by) VALUES
 ('40000000-0000-4000-8000-000000001101', '40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000a01', 'owner', 'active', now(), '40000000-0000-4000-8000-000000000a01'),
 ('40000000-0000-4000-8000-000000001104', '40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000a04', 'admin', 'active', now(), '40000000-0000-4000-8000-000000000a01'),
 ('40000000-0000-4000-8000-000000001102', '40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000a02', 'clinician', 'active', now(), '40000000-0000-4000-8000-000000000a01'),
 ('40000000-0000-4000-8000-000000001103', '40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000a03', 'coordinator', 'active', now(), '40000000-0000-4000-8000-000000000a01'),
 ('40000000-0000-4000-8000-000000002101', '40000000-0000-4000-8000-00000000000b', '40000000-0000-4000-8000-000000000b01', 'owner', 'active', now(), '40000000-0000-4000-8000-000000000b01'),
 ('40000000-0000-4000-8000-000000002102', '40000000-0000-4000-8000-00000000000b', '40000000-0000-4000-8000-000000000a02', 'clinician', 'active', now(), '40000000-0000-4000-8000-000000000b01');

INSERT INTO public.organization_patient_assignments(organization_id, patient_id, assigned_by, assigned_at) VALUES
 ('40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000d01', '40000000-0000-4000-8000-000000000a01', now() - interval '2 days'),
 ('40000000-0000-4000-8000-00000000000b', '40000000-0000-4000-8000-000000000d01', '40000000-0000-4000-8000-000000000b01', now() - interval '1 day');

INSERT INTO public.provider_patient_links(provider_id, patient_id, status, linked_at) VALUES
 ('40000000-0000-4000-8000-000000000a01', '40000000-0000-4000-8000-000000000d01', 'active', now()),
 ('40000000-0000-4000-8000-000000000a02', '40000000-0000-4000-8000-000000000d01', 'active', now()),
 ('40000000-0000-4000-8000-000000000a03', '40000000-0000-4000-8000-000000000d01', 'active', now());

-- ---------------------------------------------------------------------------
-- C. The bootstrap rule: owner, admin and clinician only.
--    The seed in the migration ran before these fixtures existed, so the exact statement
--    is replayed here against them to assert the rule itself, not a past run.
-- ---------------------------------------------------------------------------
INSERT INTO public.member_authorizations (membership_id, capability, granted_by, grant_source)
SELECT membership.id, 'educate',
       COALESCE(owner.user_id, membership.created_by),
       'bootstrap_00040'
FROM public.organization_memberships AS membership
LEFT JOIN LATERAL (
  SELECT m2.user_id FROM public.organization_memberships AS m2
  WHERE m2.organization_id = membership.organization_id
    AND m2.role = 'owner' AND m2.status = 'active'
  ORDER BY m2.created_at ASC LIMIT 1
) AS owner ON true
WHERE membership.status = 'active'
  AND membership.role IN ('owner', 'admin', 'clinician')
ON CONFLICT DO NOTHING;

-- A plain temp table of the fixture membership ids, so the RLS assertions below can scope
-- their counts without a view (a view owned by postgres would evaluate RLS as its owner).
CREATE TEMP TABLE fixture_memberships(id uuid PRIMARY KEY);
INSERT INTO fixture_memberships(id) VALUES
 ('40000000-0000-4000-8000-000000001101'), ('40000000-0000-4000-8000-000000001104'),
 ('40000000-0000-4000-8000-000000001102'), ('40000000-0000-4000-8000-000000001103'),
 ('40000000-0000-4000-8000-000000002101'), ('40000000-0000-4000-8000-000000002102');
GRANT SELECT ON fixture_memberships TO anon, authenticated, service_role;

CREATE TEMP VIEW fixture_grants AS
SELECT grant_row.*, membership.role AS membership_role, membership.organization_id
FROM public.member_authorizations AS grant_row
JOIN public.organization_memberships AS membership ON membership.id = grant_row.membership_id
WHERE membership.organization_id IN ('40000000-0000-4000-8000-00000000000a',
                                     '40000000-0000-4000-8000-00000000000b');

SELECT is((SELECT count(*)::int FROM fixture_grants), 5,
  'the seed grants educate to the five owner/admin/clinician memberships');
SELECT is((SELECT count(*)::int FROM fixture_grants WHERE membership_role = 'coordinator'), 0,
  'coordinators are not seeded with educate');
SELECT is((SELECT count(DISTINCT capability)::int FROM fixture_grants), 1,
  'no capability other than educate is seeded');
SELECT is((SELECT count(*)::int FROM fixture_grants WHERE grant_source = 'bootstrap_00040'), 5,
  'seeded grants are marked as role-derived');
SELECT is((SELECT granted_by FROM public.member_authorizations
  WHERE membership_id = '40000000-0000-4000-8000-000000001102'),
  '40000000-0000-4000-8000-000000000a01'::uuid, 'the seed attributes the grant to the organization owner');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.member_authorization_evidence
  WHERE organization_id IN ('40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-00000000000b')),
  'the bootstrap records no credential evidence');

-- ---------------------------------------------------------------------------
-- D. The capability lookup is not an oracle for other teams
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000c01","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.member_has_capability('educate', '40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000a02')$q$,
  '42501', NULL, 'a non-member cannot probe another team''s capabilities');
SELECT throws_ok(
  $q$SELECT public.member_capability_granted('educate', '40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000a02')$q$,
  '42501', NULL, 'the ungated check is not callable by a client');
SELECT is((SELECT count(*)::int FROM public.member_authorizations
  WHERE membership_id IN (SELECT id FROM fixture_memberships)), 0,
  'a non-member reads no capability rows through RLS');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a02","role":"authenticated","aal":"aal2"}', true);
SELECT ok((SELECT public.member_has_capability('educate', '40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000a01')),
  'a member may check a teammate in its own organization');
SELECT ok(NOT (SELECT public.member_has_capability('change_medication', '40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000a01')),
  'an unseeded capability reads false');
SELECT is((SELECT count(*)::int FROM public.member_authorizations
  WHERE membership_id IN (SELECT id FROM fixture_memberships)), 5,
  'a member of both organizations reads both teams'' grants');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a02","role":"authenticated","aal":"aal1"}', true);
SELECT throws_ok(
  $q$SELECT public.member_has_capability('educate', '40000000-0000-4000-8000-00000000000a')$q$,
  '42501', NULL, 'the capability lookup requires AAL2');
SELECT is((SELECT count(*)::int FROM public.member_authorizations
  WHERE membership_id IN (SELECT id FROM fixture_memberships)), 0,
  'an AAL1 session reads no capability rows');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000d01","role":"authenticated"}', true);
SELECT throws_ok(
  $q$SELECT public.member_has_capability('educate', '40000000-0000-4000-8000-00000000000a')$q$,
  '42501', NULL, 'a patient cannot query team capabilities');

-- ---------------------------------------------------------------------------
-- E. Granting and revoking: manager of the same organization only
-- ---------------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a02","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.grant_member_capability('40000000-0000-4000-8000-000000001102', 'monitor')$q$,
  '42501', NULL, 'a clinician cannot grant itself a capability');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000b01","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.grant_member_capability('40000000-0000-4000-8000-000000001102', 'monitor')$q$,
  '42501', NULL, 'a manager of another organization cannot grant in this one');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$SELECT public.grant_member_capability('40000000-0000-4000-8000-000000001102', 'monitor')$q$,
  'a manager grants a capability without evidence when none is required');
SELECT throws_ok(
  $q$SELECT public.grant_member_capability('40000000-0000-4000-8000-000000001102', 'change_medication')$q$,
  '22023', NULL, 'medication change cannot be granted without credential evidence');
SELECT throws_ok(
  $q$SELECT public.grant_member_capability('40000000-0000-4000-8000-000000001102', 'clinical_disposition', '  ')$q$,
  '22023', NULL, 'blank evidence does not satisfy the credential requirement');
SELECT throws_ok(
  $q$SELECT public.grant_member_capability('40000000-0000-4000-8000-000000001102', 'teleport')$q$,
  '22023', NULL, 'an unknown capability is rejected');
SELECT throws_ok(
  $q$SELECT public.grant_member_capability('40000000-0000-4000-8000-000000001102', 'monitor', NULL, now() - interval '1 day')$q$,
  '22023', NULL, 'an expiry in the past is rejected');
SELECT lives_ok(
  $q$SELECT public.grant_member_capability('40000000-0000-4000-8000-000000001102', 'change_medication', 'RN license IL-4417726')$q$,
  'medication change is granted with recorded evidence');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.member_authorizations
  WHERE membership_id = '40000000-0000-4000-8000-000000001102' AND revoked_at IS NULL), 3,
  'the clinician now holds educate, monitor and change_medication');
SELECT is((SELECT count(*)::int FROM public.member_authorization_evidence
  WHERE organization_id IN ('40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-00000000000b')), 1,
  'exactly one evidence row was recorded');
SELECT is((SELECT evidence_ref FROM public.member_authorization_evidence
  WHERE organization_id IN ('40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-00000000000b')), 'RN license IL-4417726',
  'the credential string is stored in the evidence table');
SELECT is((SELECT organization_id FROM public.member_authorization_evidence
  WHERE organization_id IN ('40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-00000000000b')),
  '40000000-0000-4000-8000-00000000000a'::uuid, 'evidence is scoped to the granting organization');

-- Evidence is hidden from members who are not managers, and from other teams.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a02","role":"authenticated","aal":"aal2"}', true);
SELECT is((SELECT count(*)::int FROM public.member_authorization_evidence
  WHERE organization_id IN ('40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-00000000000b')), 0,
  'a clinician cannot read credential evidence, not even its own');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000b01","role":"authenticated","aal":"aal2"}', true);
SELECT is((SELECT count(*)::int FROM public.member_authorization_evidence
  WHERE organization_id IN ('40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-00000000000b')), 0,
  'a manager of another organization cannot read this evidence');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a04","role":"authenticated","aal":"aal2"}', true);
SELECT is((SELECT count(*)::int FROM public.member_authorization_evidence
  WHERE organization_id IN ('40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-00000000000b')), 1,
  'an admin of the same organization reads the evidence');
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a04","role":"authenticated","aal":"aal1"}', true);
SELECT is((SELECT count(*)::int FROM public.member_authorization_evidence
  WHERE organization_id IN ('40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-00000000000b')), 0,
  'an AAL1 manager session reads no evidence');

-- Revocation: manager only, and it does not delete history.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a02","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.revoke_member_capability((SELECT id FROM public.member_authorizations
    WHERE membership_id = '40000000-0000-4000-8000-000000001102' AND capability = 'monitor'))$q$,
  '42501', NULL, 'a clinician cannot revoke its own capability');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$SELECT public.revoke_member_capability((SELECT id FROM public.member_authorizations
    WHERE membership_id = '40000000-0000-4000-8000-000000001102' AND capability = 'monitor'))$q$,
  'a manager revokes a capability');
-- Revoke the clinician's educate in organization A only; B keeps it.
SELECT lives_ok(
  $q$SELECT public.revoke_member_capability((SELECT id FROM public.member_authorizations
    WHERE membership_id = '40000000-0000-4000-8000-000000001102' AND capability = 'educate'))$q$,
  'a manager revokes educate in its own organization');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.member_authorizations
  WHERE membership_id = '40000000-0000-4000-8000-000000001102'), 3,
  'revocation keeps the history rows');
SELECT ok(NOT (SELECT public.member_capability_granted('educate', '40000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-000000000a02')),
  'the clinician no longer holds educate in organization A');
SELECT ok((SELECT public.member_capability_granted('educate', '40000000-0000-4000-8000-00000000000b', '40000000-0000-4000-8000-000000000a02')),
  'the clinician still holds educate in organization B');

-- ---------------------------------------------------------------------------
-- F. Recording a teach-back: negatives
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT throws_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'sodium', 'verified')$q$,
  '42501', NULL, 'an anonymous caller cannot record a teach-back');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000d01","role":"authenticated"}', true);
SELECT throws_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'sodium', 'verified')$q$,
  '42501', NULL, 'a patient cannot verify its own teach-back');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000c01","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'sodium', 'verified')$q$,
  '42501', NULL, 'a provider with no link to the patient cannot record');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal1"}', true);
SELECT throws_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'sodium', 'verified')$q$,
  '42501', NULL, 'recording a teach-back requires AAL2');

-- The coordinator is linked and assigned but was never granted `educate`.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a03","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'sodium', 'verified')$q$,
  '42501', NULL, 'a linked member without educate cannot record');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT throws_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'sodium', 'deferred')$q$,
  '22023', NULL, 'a deferral without a reason is rejected');
SELECT throws_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'sodium', 'not_applicable', 'no')$q$,
  '22023', NULL, 'a two-character reason is rejected');
SELECT throws_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'sodium', 'not_applicable', '   ')$q$,
  '22023', NULL, 'a whitespace-only reason is rejected');
SELECT throws_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'sodium', 'documented')$q$,
  '22023', NULL, 'an unknown outcome is rejected');
SELECT throws_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'sodium', 'verified',
      NULL, NULL, NULL, NULL, now() + interval '10 minutes')$q$,
  '22023', NULL, 'a future timestamp is rejected');

-- ---------------------------------------------------------------------------
-- G. Recording a teach-back: positives, and the organization that gets recorded
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'sodium', 'verified',
      NULL, 'telephone', 'en', true)$q$,
  'the owner records a verified teach-back');
SELECT lives_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'weight', 'not_verified')$q$,
  'not_verified needs no reason');
SELECT lives_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'fluid', 'deferred', 'yes')$q$,
  'a three-character reason is accepted');
SELECT lives_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'sodium', 'not_applicable',
      'Patient is on a renal diet managed by nephrology.')$q$,
  'a second event on the same domain is appended, not merged');

RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.education_teachbacks WHERE patient_id = '40000000-0000-4000-8000-000000000d01'), 4, 'four teach-back events exist');
SELECT is((SELECT count(DISTINCT organization_id)::int FROM public.education_teachbacks WHERE patient_id = '40000000-0000-4000-8000-000000000d01'), 1,
  'the owner''s records all name one organization');
SELECT is((SELECT organization_id FROM public.education_teachbacks WHERE patient_id = '40000000-0000-4000-8000-000000000d01' AND domain_id = 'weight'),
  '40000000-0000-4000-8000-00000000000a'::uuid, 'the owner records against organization A');
SELECT is((SELECT method FROM public.education_teachbacks WHERE patient_id = '40000000-0000-4000-8000-000000000d01' AND domain_id = 'sodium' AND outcome = 'verified'),
  'telephone', 'the method is persisted');
SELECT ok((SELECT caregiver_present FROM public.education_teachbacks WHERE patient_id = '40000000-0000-4000-8000-000000000d01' AND domain_id = 'sodium' AND outcome = 'verified'),
  'caregiver presence is persisted');

-- The clinician holds educate only in organization B, although A is the older assignment:
-- the record must name B, not the oldest assignment.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a02","role":"authenticated","aal":"aal2"}', true);
SELECT lives_ok(
  $q$SELECT public.record_education_teachback('40000000-0000-4000-8000-000000000d01', 'medications', 'verified')$q$,
  'a member records through the organization where it holds educate');
RESET ROLE;
SELECT is((SELECT organization_id FROM public.education_teachbacks WHERE patient_id = '40000000-0000-4000-8000-000000000d01' AND domain_id = 'medications'),
  '40000000-0000-4000-8000-00000000000b'::uuid,
  'the recorded organization is the one holding educate, not the oldest assignment');
SELECT is((SELECT verified_by FROM public.education_teachbacks WHERE patient_id = '40000000-0000-4000-8000-000000000d01' AND domain_id = 'medications'),
  '40000000-0000-4000-8000-000000000a02'::uuid, 'the author is taken from the session, not the client');

-- ---------------------------------------------------------------------------
-- H. Derived state and reader boundaries
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000a01","role":"authenticated","aal":"aal2"}', true);
SELECT is((SELECT count(*)::int FROM public.get_education_teachback_state('40000000-0000-4000-8000-000000000d01')), 4,
  'the derived state has one row per domain with an event');
-- Both sodium events were recorded in this one transaction, so their occurred_at (now())
-- is identical: the tiebreak must be created_at (clock_timestamp()), never the random id.
SELECT is((SELECT outcome FROM public.get_education_teachback_state('40000000-0000-4000-8000-000000000d01')
  WHERE domain_id = 'sodium'), 'not_applicable', 'the newest event wins for a domain');
SELECT is((SELECT event_count FROM public.get_education_teachback_state('40000000-0000-4000-8000-000000000d01')
  WHERE domain_id = 'sodium'), 2, 'the derived state reports how many times the domain was assessed');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.get_education_teachback_state('40000000-0000-4000-8000-000000000d01')
  WHERE domain_id = 'diuretics'), 'a domain with no event is absent, never reported as completed');
SELECT is((SELECT count(*)::int FROM public.education_teachbacks WHERE patient_id = '40000000-0000-4000-8000-000000000d01'), 5,
  'a linked provider reads the patient''s teach-backs');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000d01","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.education_teachbacks WHERE patient_id = '40000000-0000-4000-8000-000000000d01'), 5, 'the patient reads its own teach-backs');
SELECT is((SELECT count(*)::int FROM public.get_education_teachback_state('40000000-0000-4000-8000-000000000d01')), 4,
  'the patient reads its own derived state');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000c01","role":"authenticated","aal":"aal2"}', true);
SELECT is((SELECT count(*)::int FROM public.education_teachbacks WHERE patient_id = '40000000-0000-4000-8000-000000000d01'), 0,
  'an unlinked provider reads no teach-backs');
SELECT is((SELECT count(*)::int FROM public.get_education_teachback_state('40000000-0000-4000-8000-000000000d01')), 0,
  'an unlinked provider gets no derived state');

-- ---------------------------------------------------------------------------
-- I. Append-only
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT throws_ok(
  $q$UPDATE public.education_teachbacks SET outcome = 'verified' WHERE domain_id = 'weight'$q$,
  'P0001', 'Education teach-back records are append-only',
  'a teach-back cannot be rewritten, even by the owner');
SELECT throws_ok(
  $q$DELETE FROM public.education_teachbacks WHERE patient_id = '40000000-0000-4000-8000-000000000d01' AND domain_id = 'weight'$q$,
  'P0001', 'Education teach-back records are append-only',
  'a teach-back cannot be deleted, even by the owner');

-- ---------------------------------------------------------------------------
-- J. education_progress is untouched by this migration
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT array_agg(column_name::text ORDER BY column_name) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'education_progress'),
  ARRAY['attempts', 'completed', 'completed_at', 'created_at', 'domain_id', 'id', 'patient_id'],
  'education_progress keeps exactly its 00004 columns');
SELECT is(
  (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint
   WHERE conrelid = 'public.education_progress'::regclass AND contype IN ('p', 'u', 'f', 'c')),
  ARRAY['education_progress_patient_id_domain_id_key', 'education_progress_patient_id_fkey', 'education_progress_pkey'],
  'education_progress keeps exactly its 00004 constraints');
SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'education_progress'),
  ARRAY['patients_insert_own_education_progress', 'patients_read_own_education_progress',
        'patients_update_own_education_progress', 'providers_read_linked_education_progress'],
  'education_progress keeps exactly its 00025 policies');
SELECT is(
  (SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
   WHERE tgrelid = 'public.education_progress'::regclass AND NOT tgisinternal),
  ARRAY['audit_row_change'],
  'education_progress keeps only its 00025 audit trigger');
SELECT ok(has_column_privilege('authenticated', 'public.education_progress', 'completed', 'UPDATE'),
  'the patient self-assessment write path is intact');
SELECT ok(NOT has_table_privilege('authenticated', 'public.education_progress', 'DELETE'),
  'education_progress still grants no delete');

-- The two records stay independent: the patient still writes its own completion.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000d01","role":"authenticated"}', true);
SELECT lives_ok(
  $q$INSERT INTO public.education_progress (patient_id, domain_id, completed, completed_at, attempts)
     VALUES ('40000000-0000-4000-8000-000000000d01', 'sodium', true, now(), 1)$q$,
  'the patient still records its own self-assessment');
RESET ROLE;
SELECT is((SELECT completed FROM public.education_progress
  WHERE patient_id = '40000000-0000-4000-8000-000000000d01' AND domain_id = 'sodium'), true,
  'the self-assessment says completed');
SELECT is((SELECT outcome FROM public.get_education_teachback_state('40000000-0000-4000-8000-000000000d01')
  WHERE domain_id = 'sodium'), 'not_applicable',
  'the verified record is unaffected by the self-assessment');

SELECT * FROM finish();
ROLLBACK;
