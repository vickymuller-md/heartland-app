-- Add contact fields to profiles table for patient directory
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS patient_code text UNIQUE;

-- Index for patient code search
CREATE INDEX IF NOT EXISTS idx_profiles_patient_code ON public.profiles(patient_code) WHERE patient_code IS NOT NULL;
