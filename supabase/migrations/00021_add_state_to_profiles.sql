-- Migration 00021: Add state field to profiles for geographic NIW evidence capture
-- State values must match us-atlas properties.name (full names: "California", "New York", etc.)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS state text;

CREATE INDEX IF NOT EXISTS idx_profiles_state
  ON public.profiles(state) WHERE state IS NOT NULL;
