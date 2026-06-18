-- ════════════════════════════════════════════════════════════════════════════
-- PINIT — HOID identity store
-- Run ONCE in the Supabase SQL editor for project kqdqmimdqecensurjplh:
--   Dashboard → SQL Editor → New query → paste → Run
-- This creates the table that the app writes face/biometric registration data to.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.hoid_identities (
  id                      uuid primary key default gen_random_uuid(),
  hoid                    text not null,
  short_id                text not null,
  device_fp               text,
  face_image              text,           -- base64 JPEG data URL of the enrolment frame
  face_enrolled           boolean default false,
  webauthn_credential_id  text,           -- FIDO2 / platform authenticator credential id
  webauthn_simulated      boolean default false,
  voice_enrolled          boolean default false,
  liveness_passed         boolean default false,
  trust_score             numeric default 99.8,
  user_agent              text,
  created_at              timestamptz default now(),
  last_login_at           timestamptz
);

create index if not exists hoid_identities_short_id_idx on public.hoid_identities (short_id);
create index if not exists hoid_identities_hoid_idx     on public.hoid_identities (hoid);

-- Row Level Security: allow the public anon key (used by the app/APK) to write
-- and read identity rows. Tighten these policies before a production launch.
alter table public.hoid_identities enable row level security;

drop policy if exists "hoid anon insert" on public.hoid_identities;
create policy "hoid anon insert" on public.hoid_identities
  for insert to anon with check (true);

drop policy if exists "hoid anon select" on public.hoid_identities;
create policy "hoid anon select" on public.hoid_identities
  for select to anon using (true);

drop policy if exists "hoid anon update" on public.hoid_identities;
create policy "hoid anon update" on public.hoid_identities
  for update to anon using (true) with check (true);
