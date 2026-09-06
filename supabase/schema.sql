-- Nestegg: auth + onboarding schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.
-- Supabase's built-in `auth.users` table already handles signup, login, and OTP
-- verification (email/phone) — this file adds the app-facing profile on top of it.

-- 1. Profiles table -----------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  date_of_birth date,
  kyc_status text not null default 'not_started'
    check (kyc_status in ('not_started', 'pending', 'verified', 'rejected')),
  bvn_last4 text, -- store only last 4 digits; full BVN goes to a KYC provider, not this table
  avatar_url text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per auth.users, holds app-facing profile + KYC status.';

-- 2. Keep updated_at fresh ----------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 3. Auto-create a profile row when a new user verifies signup ----------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.phone
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. Row Level Security ---------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Profiles are only ever inserted by the handle_new_user trigger (security definer),
-- so no insert policy is granted to regular users.

-- Tables created via the SQL Editor (as opposed to the dashboard Table
-- Editor) don't automatically receive base GRANTs for authenticated/anon —
-- RLS policies alone aren't enough; the role also needs table-level
-- privileges or Postgres rejects the query before RLS is even evaluated.
grant usage on schema public to authenticated, anon;
-- SELECT is fine at the table level — RLS already restricts it to the
-- caller's own row. UPDATE is intentionally column-restricted: a
-- table-wide grant here would apply to every column added later too
-- (role, kyc_status, email_verified, phone_verified), letting a user
-- update those on themselves directly — e.g. granting themselves admin.
-- Only these fields are ever safe for a user to change about themselves;
-- everything else changes only through security-definer functions or
-- service-role API routes.
grant select on table public.profiles to authenticated;
grant update (full_name, phone, date_of_birth, avatar_url) on table public.profiles to authenticated;

-- 5. Helpful index --------------------------------------------------------
create index if not exists profiles_kyc_status_idx on public.profiles (kyc_status);
