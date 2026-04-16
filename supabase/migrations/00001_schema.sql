-- ==========================================================================
-- HEARTLAND Protocol App: Initial Schema Migration
-- Phase 1 Plan 01-01: All 9 tables with RLS, triggers, Auth Hook, indexes
-- ==========================================================================

-- ========== PROFILES ==========
create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  role        text not null check (role in ('provider', 'patient')),
  full_name   text,
  email       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "users_read_own_profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "users_update_own_profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ========== PATIENTS (clinical profile extension) ==========
create table public.patients (
  id                uuid primary key references public.profiles(id) on delete cascade,
  date_of_birth     date,
  risk_tier         text check (risk_tier in ('low', 'moderate', 'high', 'very_high')),
  track_assignment  text check (track_assignment in ('A', 'B', 'hybrid')),
  facility_tier     int check (facility_tier in (1, 2, 3)),
  created_at        timestamptz default now()
);

alter table public.patients enable row level security;

create policy "patients_read_own"
  on public.patients for select to authenticated
  using ((select auth.uid()) = id);

create policy "patients_update_own"
  on public.patients for update to authenticated
  using ((select auth.uid()) = id);

-- ========== PROVIDER-PATIENT LINKS ==========
-- NOTE: providers_read_linked_patients policy for patients table is created AFTER provider_patient_links table
create table public.provider_patient_links (
  id          uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles(id) on delete cascade,
  patient_id  uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  linked_at   timestamptz,
  created_at  timestamptz default now(),
  unique(provider_id, patient_id)
);

alter table public.provider_patient_links enable row level security;

create policy "providers_manage_own_links"
  on public.provider_patient_links for all to authenticated
  using (provider_id = (select auth.uid()));

create policy "patients_read_own_links"
  on public.provider_patient_links for select to authenticated
  using (patient_id = (select auth.uid()));

-- Deferred policy: requires provider_patient_links to exist
create policy "providers_read_linked_patients"
  on public.patients for select to authenticated
  using (
    id in (
      select patient_id from public.provider_patient_links
      where provider_id = (select auth.uid()) and status = 'active'
    )
  );

-- ========== VITALS ==========
create table public.vitals (
  id                   uuid primary key default gen_random_uuid(),
  patient_id           uuid not null references public.patients(id) on delete cascade,
  recorded_at          timestamptz not null,
  weight_lbs           numeric(5,1),
  sbp                  int,
  dbp                  int,
  heart_rate           int,
  spo2                 int,
  source               text default 'patient_app' check (source in ('patient_app', 'provider_entry')),
  synced_from_offline  boolean default false,
  created_at           timestamptz default now()
);

alter table public.vitals enable row level security;

create policy "vitals_access"
  on public.vitals for all to authenticated
  using (
    (
      (select auth.jwt() ->> 'user_role') = 'patient'
      and patient_id = (select auth.uid())
    )
    or
    (
      (select auth.jwt() ->> 'user_role') = 'provider'
      and patient_id in (
        select patient_id from public.provider_patient_links
        where provider_id = (select auth.uid()) and status = 'active'
      )
    )
  );

-- ========== SYMPTOMS ==========
create table public.symptoms (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id) on delete cascade,
  recorded_at timestamptz not null,
  dyspnea     int check (dyspnea between 0 and 3),
  edema       int check (edema between 0 and 3),
  orthopnea   boolean,
  fatigue     int check (fatigue between 0 and 3),
  red_flag    boolean default false,
  created_at  timestamptz default now()
);

alter table public.symptoms enable row level security;

create policy "symptoms_access"
  on public.symptoms for all to authenticated
  using (
    (
      (select auth.jwt() ->> 'user_role') = 'patient'
      and patient_id = (select auth.uid())
    )
    or
    (
      (select auth.jwt() ->> 'user_role') = 'provider'
      and patient_id in (
        select patient_id from public.provider_patient_links
        where provider_id = (select auth.uid()) and status = 'active'
      )
    )
  );

-- ========== MEDICATIONS ==========
create table public.medications (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id) on delete cascade,
  name        text not null,
  dosage      text,
  frequency   text,
  timing      text,
  active      boolean default true,
  created_at  timestamptz default now()
);

alter table public.medications enable row level security;

create policy "medications_access"
  on public.medications for all to authenticated
  using (
    (
      (select auth.jwt() ->> 'user_role') = 'patient'
      and patient_id = (select auth.uid())
    )
    or
    (
      (select auth.jwt() ->> 'user_role') = 'provider'
      and patient_id in (
        select patient_id from public.provider_patient_links
        where provider_id = (select auth.uid()) and status = 'active'
      )
    )
  );

-- ========== ALERTS ==========
create table public.alerts (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.patients(id) on delete cascade,
  vitals_id        uuid references public.vitals(id),
  flags            text[] not null,
  severity         text not null check (severity in ('warning', 'critical')),
  status           text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  resolved_by      uuid references public.profiles(id),
  resolved_at      timestamptz,
  created_at       timestamptz default now()
);

alter table public.alerts enable row level security;

create policy "providers_manage_alerts"
  on public.alerts for all to authenticated
  using (
    (select auth.jwt() ->> 'user_role') = 'provider'
    and patient_id in (
      select patient_id from public.provider_patient_links
      where provider_id = (select auth.uid()) and status = 'active'
    )
  );

-- ========== PUSH SUBSCRIPTIONS ==========
create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null,
  keys        jsonb not null,
  created_at  timestamptz default now()
);

alter table public.push_subscriptions enable row level security;

create policy "users_manage_own_subscriptions"
  on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()));

-- ========== CONSENTS ==========
create table public.consents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  consent_version text not null default 'v1.0',
  consent_type    text not null default 'registration' check (consent_type in ('registration', 'data_processing', 'research')),
  accepted        boolean not null default true,
  accepted_at     timestamptz not null default now(),
  ip_address      inet,
  user_agent      text
);

alter table public.consents enable row level security;

create policy "users_read_own_consents"
  on public.consents for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users_insert_own_consents"
  on public.consents for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ========== INDEXES FOR RLS PERFORMANCE ==========
create index idx_vitals_patient_id on public.vitals(patient_id);
create index idx_vitals_recorded_at on public.vitals(recorded_at);
create index idx_symptoms_patient_id on public.symptoms(patient_id);
create index idx_medications_patient_id on public.medications(patient_id);
create index idx_alerts_patient_id on public.alerts(patient_id);
create index idx_alerts_status on public.alerts(status);
create index idx_provider_patient_links_provider on public.provider_patient_links(provider_id);
create index idx_provider_patient_links_patient on public.provider_patient_links(patient_id);
create index idx_push_subscriptions_user on public.push_subscriptions(user_id);
create index idx_consents_user on public.consents(user_id);

-- ========== TRIGGERS ==========
-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'role', 'patient'),
    new.raw_user_meta_data ->> 'full_name',
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ========== AUTH HOOK: Inject role into JWT ==========
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  user_role text;
begin
  -- Read role from profiles table
  select role into user_role
  from public.profiles
  where id = (event->>'user_id')::uuid;

  claims := event->'claims';

  if user_role is not null then
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
  else
    claims := jsonb_set(claims, '{user_role}', '"patient"');
    -- Default to patient if profile not yet created (race condition safety)
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- Permissions for auth hook
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant select on table public.profiles to supabase_auth_admin;
