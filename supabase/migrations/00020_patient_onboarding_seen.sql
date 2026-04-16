-- Migration 00020: Add onboarding_seen_at to profiles
-- Tracks whether a patient has completed the first-use welcome flow.
-- NULL = hasn't seen it. Timestamptz survives device/browser switches.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_seen_at timestamptz;
