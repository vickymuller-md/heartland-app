BEGIN;
SELECT plan(18);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.work_items'::regclass),
  'work_items has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.organization_memberships'::regclass),
  'organization_memberships has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_deliveries'::regclass),
  'notification_deliveries has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.access_request_rate_limits'::regclass),
  'access_request_rate_limits has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.linkage_lookup_rate_limits'::regclass),
  'linkage lookup rate limits have RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.security_posture_snapshots'::regclass),
  'security posture snapshots have RLS enabled'
);
SELECT has_function('public', 'provider_aal2', ARRAY[]::text[], 'provider AAL2 helper exists');
SELECT has_function('public', 'complete_access_review', ARRAY['uuid', 'text'], 'access review RPC exists');
SELECT has_function(
  'public',
  'request_provider_linkage',
  ARRAY['text'],
  'atomic linkage RPC exists'
);
SELECT has_function(
  'public',
  'submit_access_request',
  ARRAY['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text'],
  'controlled access request RPC exists'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.access_requests', 'INSERT'),
  'anon cannot insert access requests directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_memberships', 'INSERT'),
  'authenticated users cannot self-create memberships'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.notification_deliveries', 'INSERT'),
  'clients cannot forge delivery evidence'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.access_reviews', 'INSERT'),
  'clients cannot forge access review counts'
);
SELECT ok(
  has_column_privilege('authenticated', 'public.work_items', 'assigned_to', 'UPDATE'),
  'governed work assignment column is available through RLS'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.submit_access_request(text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'anon cannot invoke server-only access intake RPC'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.lookup_provider_by_code(text)',
    'EXECUTE'
  ),
  'authenticated users cannot brute-force the legacy lookup RPC'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'provider_patient_links'
      AND policyname = 'patients_insert_linkage_requests'
  ),
  'patients cannot insert linkage rows directly'
);

SELECT * FROM finish();
ROLLBACK;
