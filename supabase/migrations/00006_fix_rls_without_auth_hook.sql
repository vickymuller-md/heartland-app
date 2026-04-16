-- Fix RLS policies to work without Auth Hook enabled
-- Fallback: read role from auth.jwt() -> raw_user_meta_data -> role
-- when custom_access_token_hook has not injected user_role into JWT

-- Helper function to extract user role from JWT (with fallback)
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    -- Primary: custom claim from Auth Hook
    auth.jwt() ->> 'user_role',
    -- Fallback: raw_user_meta_data set at signup
    auth.jwt() -> 'user_metadata' ->> 'role',
    -- Default
    'patient'
  )
$$;

-- ========== VITALS: drop and recreate ==========
DROP POLICY IF EXISTS "vitals_access" ON public.vitals;
CREATE POLICY "vitals_access"
  ON public.vitals FOR ALL TO authenticated
  USING (
    (
      public.get_user_role() = 'patient'
      AND patient_id = (SELECT auth.uid())
    )
    OR
    (
      public.get_user_role() = 'provider'
      AND patient_id IN (
        SELECT patient_id FROM public.provider_patient_links
        WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
      )
    )
  );

-- ========== SYMPTOMS: drop and recreate ==========
DROP POLICY IF EXISTS "symptoms_access" ON public.symptoms;
CREATE POLICY "symptoms_access"
  ON public.symptoms FOR ALL TO authenticated
  USING (
    (
      public.get_user_role() = 'patient'
      AND patient_id = (SELECT auth.uid())
    )
    OR
    (
      public.get_user_role() = 'provider'
      AND patient_id IN (
        SELECT patient_id FROM public.provider_patient_links
        WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
      )
    )
  );

-- ========== MEDICATIONS: drop and recreate ==========
DROP POLICY IF EXISTS "medications_access" ON public.medications;
CREATE POLICY "medications_access"
  ON public.medications FOR ALL TO authenticated
  USING (
    (
      public.get_user_role() = 'patient'
      AND patient_id = (SELECT auth.uid())
    )
    OR
    (
      public.get_user_role() = 'provider'
      AND patient_id IN (
        SELECT patient_id FROM public.provider_patient_links
        WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
      )
    )
  );

-- ========== ALERTS: drop and recreate ==========
DROP POLICY IF EXISTS "providers_manage_alerts" ON public.alerts;
CREATE POLICY "providers_manage_alerts"
  ON public.alerts FOR ALL TO authenticated
  USING (
    public.get_user_role() = 'provider'
    AND patient_id IN (
      SELECT patient_id FROM public.provider_patient_links
      WHERE provider_id = (SELECT auth.uid()) AND status = 'active'
    )
  );
