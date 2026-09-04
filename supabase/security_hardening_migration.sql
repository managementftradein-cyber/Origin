-- ============================================================
-- ORIGIN SECURITY HARDENING MIGRATION
-- Run this AFTER the existing Origin migrations. Safe to re-run.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. PROFILES: prevent self-promotion / self-assignment
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "public read profiles" on public.profiles;
drop policy if exists "users manage own profile" on public.profiles;
drop policy if exists "users read own profile" on public.profiles;
drop policy if exists "users insert own profile" on public.profiles;
drop policy if exists "users update own profile" on public.profiles;

create policy "users read own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);

create policy "users insert own profile"
on public.profiles for insert to authenticated
with check (
  auth.uid() = id
  and role = 'member'
  and department_id is null
  and is_suspended = false
  and suspended_at is null
  and suspended_by is null
);

create policy "users update own profile"
on public.profiles for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security invoker
as $$
begin
  if auth.role() is distinct from 'service_role' then
    if tg_op = 'INSERT' then
      new.role := 'member';
      new.department_id := null;
      new.is_suspended := false;
      new.suspended_at := null;
      new.suspended_by := null;
    else
      new.role := old.role;
      new.department_id := old.department_id;
      new.is_suspended := old.is_suspended;
      new.suspended_at := old.suspended_at;
      new.suspended_by := old.suspended_by;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_columns on public.profiles;
create trigger protect_profile_privileged_columns
before insert or update on public.profiles
for each row execute function public.protect_profile_privileged_columns();

-- ------------------------------------------------------------
-- 2. Remove blanket direct database access from browser roles
-- ------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- ------------------------------------------------------------
-- 3. Storage: browser writes are not needed; API routes use service_role
-- ------------------------------------------------------------
drop policy if exists "Authenticated community uploads" on storage.objects;
drop policy if exists "Users update community images" on storage.objects;
drop policy if exists "Users delete community images" on storage.objects;

-- Keep public reads for the two public image buckets.

-- ------------------------------------------------------------
-- 4. Cron endpoint must have a real secret
-- ------------------------------------------------------------
-- CRON_SECRET is a Vercel environment variable, not a SQL setting.
-- The corresponding api/cron-backup.js now rejects requests when it is absent
-- or shorter than 32 characters; it never trusts a User-Agent header.

notify pgrst, 'reload schema';
