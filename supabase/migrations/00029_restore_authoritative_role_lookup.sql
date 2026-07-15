-- Restore the authoritative database-backed role lookup. The hosted Auth Hook
-- is optional and may not add user_role to a token; authorization must neither
-- trust user metadata nor fail legitimate provider/tester sessions in that
-- configuration.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE
    WHEN profile.role IN ('provider', 'patient', 'tester') THEN profile.role
    ELSE 'unknown'
  END
  FROM (SELECT (SELECT auth.uid()) AS user_id) AS identity
  LEFT JOIN public.profiles AS profile ON profile.id = identity.user_id
$$;

REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
