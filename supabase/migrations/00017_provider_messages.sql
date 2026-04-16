-- Migration: 00017_provider_messages.sql
-- Phase 19: Structured Provider Messages
-- One-way provider-to-patient messaging with read receipts

create table public.provider_messages (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients(id) on delete cascade,
  provider_id   uuid not null references public.profiles(id) on delete cascade,
  template_type text not null check (template_type in ('dose_change', 'appointment', 'lab_order', 'general')),
  subject       text not null,
  body          text not null,
  read_at       timestamptz,
  created_at    timestamptz default now()
);

alter table public.provider_messages enable row level security;

-- Provider: insert messages for actively linked patients
create policy "providers_insert_messages"
  on public.provider_messages for insert to authenticated
  with check (
    (select auth.jwt() ->> 'user_role') = 'provider'
    and provider_id = (select auth.uid())
    and patient_id in (
      select patient_id from public.provider_patient_links
      where provider_id = (select auth.uid()) and status = 'active'
    )
  );

-- Provider: read messages for actively linked patients
create policy "providers_read_messages"
  on public.provider_messages for select to authenticated
  using (
    (select auth.jwt() ->> 'user_role') = 'provider'
    and patient_id in (
      select patient_id from public.provider_patient_links
      where provider_id = (select auth.uid()) and status = 'active'
    )
  );

-- Patient: read own messages only
create policy "patients_read_own_messages"
  on public.provider_messages for select to authenticated
  using (
    (select auth.jwt() ->> 'user_role') = 'patient'
    and patient_id = (select auth.uid())
  );

-- Patient: update read_at on own messages only (USING + WITH CHECK required)
create policy "patients_update_read_at"
  on public.provider_messages for update to authenticated
  using (
    (select auth.jwt() ->> 'user_role') = 'patient'
    and patient_id = (select auth.uid())
  )
  with check (
    (select auth.jwt() ->> 'user_role') = 'patient'
    and patient_id = (select auth.uid())
  );

-- Index: chronological queries per patient
create index idx_provider_messages_patient_created
  on public.provider_messages(patient_id, created_at desc);

-- Partial index: unread message queries
create index idx_provider_messages_patient_unread
  on public.provider_messages(patient_id, read_at)
  where read_at is null;
