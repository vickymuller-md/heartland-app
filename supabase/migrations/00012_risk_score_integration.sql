-- Phase 12: Tool Integration -- Save Results to Patient Profile
-- Adds risk score columns and provider UPDATE policy

alter table public.patients
  add column if not exists risk_score      int,
  add column if not exists risk_scored_at  timestamptz;

-- Providers need UPDATE rights on linked patients to save tool results
create policy "providers_update_linked_patients"
  on public.patients for update to authenticated
  using (
    (select auth.jwt() ->> 'user_role') = 'provider'
    and id in (
      select patient_id from public.provider_patient_links
      where provider_id = (select auth.uid()) and status = 'active'
    )
  )
  with check (
    (select auth.jwt() ->> 'user_role') = 'provider'
    and id in (
      select patient_id from public.provider_patient_links
      where provider_id = (select auth.uid()) and status = 'active'
    )
  );
