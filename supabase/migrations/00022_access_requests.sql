-- 00022_access_requests.sql
-- Professional access-request inbox.
-- Public anon clients may INSERT via the landing-page form; only service_role
-- may SELECT / UPDATE. Each request represents a prospective professional user
-- awaiting manual approval (invite code issuance).

create extension if not exists "pgcrypto";

create type access_request_status as enum ('pending', 'approved', 'denied');

create table public.access_requests (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null,
  email        text not null,
  npi          text,                 -- optional; US National Provider Identifier
  state        text,                 -- two-letter US state code (matches profiles.state)
  facility     text,                 -- institution / Critical Access Hospital name
  role_claim   text,                 -- e.g. "MD", "NP", "PA", "PharmD", "RN", "QI"
  message      text,
  status       access_request_status not null default 'pending',
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references auth.users(id) on delete set null
);

create index access_requests_status_idx on public.access_requests (status, created_at desc);
create index access_requests_email_idx  on public.access_requests (lower(email));

alter table public.access_requests enable row level security;

-- Anon clients may INSERT, but never read anything back.
create policy "Anyone may submit an access request"
  on public.access_requests
  for insert
  to anon, authenticated
  with check (true);

-- Only service_role / admins can SELECT or mutate. The default RLS denial
-- covers all other roles; we explicitly allow service_role for completeness.
create policy "Service role full read"
  on public.access_requests
  for select
  to service_role
  using (true);

create policy "Service role full update"
  on public.access_requests
  for update
  to service_role
  using (true)
  with check (true);

comment on table public.access_requests is
  'Professional-access requests submitted via the public landing page. Approval = issuance of a provider invite code in provider_codes. Source: NIW_INTEGRATION.md.';
