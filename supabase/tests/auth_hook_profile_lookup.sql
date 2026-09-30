-- Synthetic fixtures only; all changes roll back. The actual GoTrue caller is
-- checked separately: hosted-like postgres cannot SET ROLE supabase_auth_admin.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();

SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid='public.custom_access_token_hook(jsonb)'::regprocedure),
 'profile lookup runs with trusted owner privileges');
SELECT is((SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.custom_access_token_hook(jsonb)'::regprocedure),
 'postgres','hook owner is the trusted migration role');
SELECT ok((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.custom_access_token_hook(jsonb)'::regprocedure),
 'hook retains an empty search path');
SELECT ok(has_function_privilege('supabase_auth_admin','public.custom_access_token_hook(jsonb)','EXECUTE'),
 'Auth caller can execute the hook');
SELECT ok(NOT has_function_privilege(r,'public.custom_access_token_hook(jsonb)','EXECUTE'),r||' cannot execute hook')
 FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_proc p,
 LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid='public.custom_access_token_hook(jsonb)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'),
 'PUBLIC has no inherited hook execution');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.profiles'::regclass),
 'profile RLS remains enabled');
SELECT ok(NOT (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname='supabase_auth_admin'),
 'Auth role has not been globally elevated');

CREATE FUNCTION pg_temp.hook_user(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('78000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.hook_user(n),'hook-fixture-'||n||'@example.invalid',
 '{"consent_accepted":true,"role":"provider","user_role":"provider"}'::jsonb
 FROM generate_series(1,3) n;
UPDATE public.profiles SET role='provider' WHERE id=pg_temp.hook_user(1);
UPDATE public.profiles SET role='tester',sandbox_expires_at=now()+interval '1 day' WHERE id=pg_temp.hook_user(3);
CREATE FUNCTION pg_temp.hook_event(n integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('user_id',pg_temp.hook_user(n),'authentication_method','password',
  'claims',jsonb_build_object('sub',pg_temp.hook_user(n),'role','authenticated','aal','aal1',
   'user_role','provider','user_metadata',jsonb_build_object('role','provider'),
   'app_metadata',jsonb_build_object('user_role','provider'),'exp',2000000000))
$$;
SELECT is(public.custom_access_token_hook(pg_temp.hook_event(n))#>>'{claims,user_role}',expected,
 'authoritative hook role: '||expected||' (fixture '||n||')')
 FROM (VALUES(1,'provider'),(2,'patient'),(3,'tester'),(4,'patient')) roles(n,expected);
SELECT is(public.custom_access_token_hook(pg_temp.hook_event(1))-'claims',pg_temp.hook_event(1)-'claims',
 'hook preserves other event fields');
SELECT is((public.custom_access_token_hook(pg_temp.hook_event(2))->'claims')-'user_role',
 (pg_temp.hook_event(2)->'claims')-'user_role','hook preserves unrelated claims');
SELECT is((SELECT role FROM public.profiles WHERE id=pg_temp.hook_user(2)),'patient',
 'forged signup metadata does not promote the profile');
SELECT is((SELECT count(*)::integer FROM public.profiles WHERE id=pg_temp.hook_user(4)),0,
 'missing-profile fallback creates no profile');

SET LOCAL ROLE anon;
SELECT throws_ok($q$SELECT public.custom_access_token_hook('{}'::jsonb)$q$,'42501',
 'permission denied for function custom_access_token_hook','anonymous caller denied at execution boundary');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT public.custom_access_token_hook('{}'::jsonb)$q$,'42501',
 'permission denied for function custom_access_token_hook','signed-in caller cannot mint hook claims');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT public.custom_access_token_hook('{}'::jsonb)$q$,'42501',
 'permission denied for function custom_access_token_hook','service caller cannot invoke Auth hook');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
