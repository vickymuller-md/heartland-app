-- Auth's invoker cannot read profiles through policies restricted to authenticated.
-- Read the authoritative profile as the trusted owner, not signup/JWT metadata.
-- Keep this narrowly scoped hook inaccessible to all API callers.
ALTER FUNCTION public.custom_access_token_hook(jsonb) OWNER TO postgres;
ALTER FUNCTION public.custom_access_token_hook(jsonb) SECURITY DEFINER;
ALTER FUNCTION public.custom_access_token_hook(jsonb) SET search_path = '';
REVOKE ALL PRIVILEGES ON FUNCTION public.custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  TO supabase_auth_admin;
