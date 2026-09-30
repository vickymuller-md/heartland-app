-- Real RLS and column privileges; synthetic fixtures roll back.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
CREATE FUNCTION pg_temp.lh(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('79000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
SELECT ok(has_column_privilege('authenticated','public.lab_results','id','SELECT'),'history can join the original lab identity');
SELECT ok(has_column_privilege('authenticated','public.lab_results','collected_at','SELECT'),'history can read the original collection time');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.lab_results'::regclass),'lab metadata keeps RLS');
SELECT ok(NOT has_any_column_privilege('anon','public.lab_results','SELECT'),'anonymous metadata remains private');
SELECT ok(NOT has_any_column_privilege('authenticated','public.lab_results','INSERT,UPDATE')
 AND NOT has_table_privilege('authenticated','public.lab_results','DELETE'),'metadata grant does not reopen raw writes');

-- Installations may retain earlier full-table reads. Test the minimum contract
-- separately without asserting that 00079 revoked unrelated historical grants.
SAVEPOINT minimum_metadata;
REVOKE SELECT ON public.lab_results FROM authenticated;
\ir ../migrations/00079_lab_history_metadata_privileges.sql
SELECT ok(has_column_privilege('authenticated','public.lab_results','id','SELECT'),'identity has an explicit column grant');
SELECT ok(has_column_privilege('authenticated','public.lab_results','collected_at','SELECT'),'collection has an explicit column grant');
SELECT ok(NOT has_column_privilege('authenticated','public.lab_results','potassium','SELECT'),'minimum contract does not grant raw potassium');
ROLLBACK TO SAVEPOINT minimum_metadata;

INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT pg_temp.lh(n),'history-'||n||'@example.invalid','{"consent_accepted":true}'::jsonb FROM unnest(ARRAY[1,2,3,11,12]) n;
UPDATE public.profiles SET role='provider' WHERE id IN(pg_temp.lh(1),pg_temp.lh(2),pg_temp.lh(3));
UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.lh(3);
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 VALUES(pg_temp.lh(1),pg_temp.lh(11),'active',now()),(pg_temp.lh(3),pg_temp.lh(11),'active',now());
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium)
 SELECT pg_temp.lh(100+n),pg_temp.lh(n),'2015-01-01T12:13:14.123456Z',4.5 FROM unnest(ARRAY[11,12]) n;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.lh(1),'role','authenticated','aal','aal2')::text,true);
SELECT is((SELECT count(id) FROM public.lab_results),1::bigint,'linked AAL2 provider sees only linked metadata');
SELECT is((SELECT collected_at FROM public.lab_results WHERE id=pg_temp.lh(111)),'2015-01-01T12:13:14.123456Z'::timestamptz,'historical collection keeps original precision');
SELECT is((SELECT count(l.id) FROM public.lab_alert_evaluations e JOIN public.lab_results l ON l.id=e.lab_result_id),1::bigint,'evaluation joins the original lab under the caller RLS');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.lh(1),'role','authenticated','aal','aal1')::text,true);
SELECT is((SELECT count(id) FROM public.lab_results),0::bigint,'provider AAL1 sees no metadata');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.lh(2),'role','authenticated','aal','aal2')::text,true);
SELECT is((SELECT count(id) FROM public.lab_results),0::bigint,'unlinked provider sees no metadata');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.lh(3),'role','authenticated','aal','aal2')::text,true);
SELECT is((SELECT count(id) FROM public.lab_results),0::bigint,'provider without consent sees no metadata');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.lh(11),'role','authenticated','aal','aal1')::text,true);
SELECT is((SELECT count(id) FROM public.lab_results),1::bigint,'patient reads only their own metadata at AAL1');
SELECT is((SELECT count(id) FROM public.lab_results WHERE id=pg_temp.lh(112)),0::bigint,'patient cannot read another patient collection');
RESET ROLE;
UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.lh(1);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.lh(1),'role','authenticated','aal','aal2')::text,true);
SELECT is((SELECT count(id) FROM public.lab_results),0::bigint,'revoked link loses metadata access');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok('SELECT id,collected_at FROM public.lab_results','42501',NULL,'anonymous query is denied');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
