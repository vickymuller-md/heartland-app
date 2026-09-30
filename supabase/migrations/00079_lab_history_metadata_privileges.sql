-- The evaluation-history embed needs only original identity and collection time.
-- Effective values still come from the observation projection; retain all RLS.
-- Do not widen raw-value access or revoke pre-existing installation privileges.
GRANT SELECT (id, collected_at) ON public.lab_results TO authenticated;
