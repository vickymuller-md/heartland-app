-- Reduce the PostgREST/GraphQL surface available to unauthenticated callers.
-- RLS remains the primary row boundary for signed-in users; anonymous users do
-- not need direct access to application tables or trigger-only functions.

ALTER FUNCTION public.custom_access_token_hook(jsonb)
  SET search_path = '';

REVOKE ALL PRIVILEGES ON TABLE
  public.access_requests,
  public.alert_preferences,
  public.alerts,
  public.consents,
  public.discharge_followups,
  public.discharge_records,
  public.education_progress,
  public.lab_results,
  public.medication_logs,
  public.medication_reminders,
  public.medications,
  public.patients,
  public.profiles,
  public.provider_messages,
  public.provider_notes,
  public.provider_patient_links,
  public.push_subscriptions,
  public.quality_metric_records,
  public.scheduled_followups,
  public.symptoms,
  public.vitals
FROM anon;

-- Trigger and event-trigger functions execute through their owning trigger.
-- Direct RPC execution is unnecessary and expands the attack surface.
DO $revoke_trigger_functions$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT
      namespace.nspname AS schema_name,
      procedure.proname AS function_name,
      pg_get_function_identity_arguments(procedure.oid) AS identity_arguments
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'auto_link_invited_patient',
        'handle_new_user',
        'notify_vitals_insert',
        'rls_auto_enable',
        'set_provider_code'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      target.schema_name,
      target.function_name,
      target.identity_arguments
    );
  END LOOP;
END
$revoke_trigger_functions$;

-- Preserve the only intended caller for the optional JWT enrichment hook.
REVOKE ALL PRIVILEGES ON FUNCTION public.custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  TO supabase_auth_admin;
