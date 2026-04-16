-- ==========================================================================
-- HEARTLAND Protocol App: Migration 00002
-- Phase 2 Plan 02-01: Provider codes, invite columns, triggers, RLS, Realtime
-- ==========================================================================

-- ========== PROVIDER CODE GENERATION ==========
-- No-lookalike alphabet: ABCDEFGHJKMNPQRSTUVWXYZ23456789 (30 chars)
-- Excludes: 0, O, 1, I, L

CREATE OR REPLACE FUNCTION public.generate_provider_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(chars, floor(random() * 30 + 1)::int, 1);
    END LOOP;
    -- Check uniqueness
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE provider_code = code);
  END LOOP;
  RETURN code;
END;
$$;

-- ========== PROVIDER CODE COLUMN ==========
ALTER TABLE public.profiles ADD COLUMN provider_code text UNIQUE;
CREATE INDEX idx_profiles_provider_code ON public.profiles(provider_code);

-- ========== AUTO-SET PROVIDER CODE ON INSERT ==========
CREATE OR REPLACE FUNCTION public.set_provider_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'provider' AND NEW.provider_code IS NULL THEN
    NEW.provider_code := public.generate_provider_code();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_provider_profile_set_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_provider_code();

-- ========== INVITE COLUMNS ON PROVIDER_PATIENT_LINKS ==========
ALTER TABLE public.provider_patient_links
  ADD COLUMN invite_email text,
  ADD COLUMN invite_sent_at timestamptz;

-- ========== STATUS CONSTRAINT UPDATE ==========
-- Drop and re-add to include 'invited' and 'rejected'
ALTER TABLE public.provider_patient_links
  DROP CONSTRAINT IF EXISTS provider_patient_links_status_check;

ALTER TABLE public.provider_patient_links
  ADD CONSTRAINT provider_patient_links_status_check
  CHECK (status IN ('invited', 'pending', 'active', 'revoked', 'rejected'));

-- ========== ALLOW INVITE ROWS WITHOUT PATIENT ==========
ALTER TABLE public.provider_patient_links
  ALTER COLUMN patient_id DROP NOT NULL;

-- ========== AUTO-LINK INVITED PATIENT TRIGGER ==========
CREATE OR REPLACE FUNCTION public.auto_link_invited_patient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'patient' THEN
    UPDATE public.provider_patient_links
    SET patient_id = NEW.id,
        status = 'active',
        linked_at = now()
    WHERE invite_email = NEW.email
      AND status = 'invited';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_auto_link_invited_patient
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.auto_link_invited_patient();

-- ========== REALTIME ==========
ALTER PUBLICATION supabase_realtime ADD TABLE public.provider_patient_links;
ALTER TABLE public.provider_patient_links REPLICA IDENTITY FULL;

-- ========== ADDITIONAL RLS POLICIES ==========
-- These ADD to Phase 1 policies (providers_manage_own_links, patients_read_own_links)

-- Providers can insert invite rows (where they are the provider_id)
CREATE POLICY "providers_insert_invites"
  ON public.provider_patient_links
  FOR INSERT TO authenticated
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND (SELECT auth.jwt() ->> 'user_role') = 'provider'
  );

-- Patients can insert linkage requests (where they are the patient_id, status must be pending)
CREATE POLICY "patients_insert_linkage_requests"
  ON public.provider_patient_links
  FOR INSERT TO authenticated
  WITH CHECK (
    patient_id = (SELECT auth.uid())
    AND (SELECT auth.jwt() ->> 'user_role') = 'patient'
    AND status = 'pending'
  );

-- Providers can update link status for their own links
CREATE POLICY "providers_update_link_status"
  ON public.provider_patient_links
  FOR UPDATE TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND (SELECT auth.jwt() ->> 'user_role') = 'provider'
  )
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND (SELECT auth.jwt() ->> 'user_role') = 'provider'
  );

-- Patients can read provider profiles (for code lookup)
CREATE POLICY "patients_read_provider_codes"
  ON public.profiles
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.jwt() ->> 'user_role') = 'patient'
    AND role = 'provider'
  );
