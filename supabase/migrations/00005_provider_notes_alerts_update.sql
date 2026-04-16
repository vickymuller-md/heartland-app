-- ==========================================================================
-- HEARTLAND Protocol App: Provider Notes, Alerts Updates, DB Webhook
-- Phase 10 Plan 10-01: provider_notes table, alerts acknowledge columns,
--   REPLICA IDENTITY FULL, DB webhook trigger, deduplication function
-- ==========================================================================

-- ========== PROVIDER NOTES TABLE ==========
create table public.provider_notes (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id) on delete cascade,
  provider_id uuid not null references public.profiles(id) on delete cascade,
  content     text not null,
  created_at  timestamptz default now()
);

alter table public.provider_notes enable row level security;

-- RLS: Providers can insert notes for linked patients
create policy "providers_insert_notes"
  on public.provider_notes for insert to authenticated
  with check (
    (select auth.jwt() ->> 'user_role') = 'provider'
    and provider_id = (select auth.uid())
    and patient_id in (
      select patient_id from public.provider_patient_links
      where provider_id = (select auth.uid()) and status = 'active'
    )
  );

-- RLS: Providers can read notes for linked patients
create policy "providers_read_notes"
  on public.provider_notes for select to authenticated
  using (
    (select auth.jwt() ->> 'user_role') = 'provider'
    and patient_id in (
      select patient_id from public.provider_patient_links
      where provider_id = (select auth.uid()) and status = 'active'
    )
  );

-- Performance index for patient notes query
create index idx_provider_notes_patient_created
  on public.provider_notes(patient_id, created_at desc);

-- ========== ALERTS TABLE UPDATES ==========

-- Add acknowledge tracking columns
alter table public.alerts
  add column if not exists acknowledged_by uuid references public.profiles(id),
  add column if not exists acknowledged_at timestamptz;

-- REPLICA IDENTITY FULL required for Supabase Realtime UPDATE events
-- (Pitfall 2 from RESEARCH: without this, UPDATE payloads only contain PK)
alter table public.alerts replica identity full;

-- Composite index for alert inbox queries (status filter + chronological order)
create index if not exists idx_alerts_status_created
  on public.alerts(status, created_at desc);

-- ========== DB WEBHOOK TRIGGER: vitals INSERT -> alert-eval Edge Function ==========
-- Uses pg_net extension to POST to the alert-eval Edge Function
-- NOTE: pg_net must be enabled in Supabase Dashboard before running this migration

create or replace function public.notify_vitals_insert()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  perform net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/alert-eval',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'vitals',
      'schema', 'public',
      'record', row_to_json(NEW)
    )
  );
  return NEW;
end;
$$;

create trigger on_vitals_insert
  after insert on public.vitals
  for each row
  execute function public.notify_vitals_insert();

-- ========== ALERT DEDUPLICATION HELPER ==========
-- Returns true if an open alert with the same flag exists for this patient
-- within the specified time window (default 24 hours)

create or replace function public.check_duplicate_alert(
  p_patient_id uuid,
  p_flag text,
  p_hours int default 24
)
returns boolean
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.alerts
    where patient_id = p_patient_id
      and status in ('open', 'acknowledged')
      and p_flag = any(flags)
      and created_at > (now() - make_interval(hours => p_hours))
  );
end;
$$;
