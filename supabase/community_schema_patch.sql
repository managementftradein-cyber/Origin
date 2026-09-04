-- ============================================================
-- TCC DEFENSIVE REPAIR + GIVING ACCOUNTS + ONE-TIME INVITES
-- Safe to run repeatedly and after older schema versions.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- COMMUNITY: departments safety net
-- ------------------------------------------------------------
create table if not exists public.departments(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  icon text default '✦',
  contact_email text,
  display_order integer default 0,
  is_active boolean default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- COMMUNITY: profiles
-- ------------------------------------------------------------
create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  bio text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists role text not null default 'member';
alter table public.profiles add column if not exists department_id uuid;
alter table public.profiles add column if not exists is_suspended boolean not null default false;
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles add column if not exists suspended_by uuid;

-- Add the FK only when the target table/constraint is available.
do $$
begin
  if to_regclass('public.departments') is not null then
    begin
      alter table public.profiles
        add constraint profiles_department_id_fkey
        foreign key (department_id) references public.departments(id) on delete set null;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- ------------------------------------------------------------
-- COMMUNITY: posts
-- ------------------------------------------------------------
create table if not exists public.community_posts(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.community_posts add column if not exists image_url text;
alter table public.community_posts add column if not exists is_hidden boolean not null default false;

-- ------------------------------------------------------------
-- COMMUNITY: comments
-- ------------------------------------------------------------
create table if not exists public.community_comments(
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.community_comments add column if not exists is_hidden boolean not null default false;

-- ------------------------------------------------------------
-- COMMUNITY: likes
-- ------------------------------------------------------------
create table if not exists public.community_likes(
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists community_posts_created_idx on public.community_posts(created_at desc);
create index if not exists community_comments_post_idx on public.community_comments(post_id, created_at asc);
create index if not exists community_likes_post_idx on public.community_likes(post_id);

alter table public.profiles enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_likes enable row level security;

drop policy if exists "public read profiles" on public.profiles;
create policy "public read profiles" on public.profiles for select to anon, authenticated using (true);

drop policy if exists "users manage own profile" on public.profiles;
create policy "users manage own profile" on public.profiles for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "public read visible posts" on public.community_posts;
create policy "public read visible posts" on public.community_posts for select to anon, authenticated using (is_hidden = false);

drop policy if exists "users manage own posts" on public.community_posts;
create policy "users manage own posts" on public.community_posts for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "public read visible comments" on public.community_comments;
create policy "public read visible comments" on public.community_comments for select to anon, authenticated using (is_hidden = false);

drop policy if exists "users manage own comments" on public.community_comments;
create policy "users manage own comments" on public.community_comments for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "public read likes" on public.community_likes;
create policy "public read likes" on public.community_likes for select to anon, authenticated using (true);

drop policy if exists "users manage own likes" on public.community_likes;
create policy "users manage own likes" on public.community_likes for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.community_posts, public.community_comments, public.community_likes to anon, authenticated;
grant insert, update, delete on public.profiles, public.community_posts, public.community_comments, public.community_likes to authenticated;
grant all on public.profiles, public.community_posts, public.community_comments, public.community_likes to service_role;

-- ------------------------------------------------------------
-- COMMUNITY STORAGE
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('community', 'community', true)
on conflict (id) do update set public = true;

drop policy if exists "Public community images" on storage.objects;
drop policy if exists "Authenticated community uploads" on storage.objects;
drop policy if exists "Users update community images" on storage.objects;
drop policy if exists "Users delete community images" on storage.objects;

create policy "Public community images"
on storage.objects for select to anon, authenticated
using (bucket_id = 'community');

create policy "Authenticated community uploads"
on storage.objects for insert to authenticated
with check (bucket_id = 'community');

create policy "Users update community images"
on storage.objects for update to authenticated
using (bucket_id = 'community' and owner_id = auth.uid()::text)
with check (bucket_id = 'community' and owner_id = auth.uid()::text);

create policy "Users delete community images"
on storage.objects for delete to authenticated
using (bucket_id = 'community' and owner_id = auth.uid()::text);

-- ------------------------------------------------------------
-- GIVING / OFFERING: public bank/account details managed in Admin
-- ------------------------------------------------------------
create table if not exists public.giving_accounts(
  id uuid primary key default gen_random_uuid(),
  label text not null default 'Offering',
  bank_name text not null,
  account_name text not null,
  account_number text not null,
  sort_code text,
  instructions text,
  currency text not null default 'NGN',
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.giving_accounts enable row level security;
drop policy if exists "public read active giving accounts" on public.giving_accounts;
create policy "public read active giving accounts"
on public.giving_accounts for select to anon, authenticated
using (is_active = true);

grant select on public.giving_accounts to anon, authenticated;
grant all on public.giving_accounts to service_role;
create index if not exists giving_accounts_order_idx on public.giving_accounts(display_order asc, created_at asc);

-- ------------------------------------------------------------
-- ONE-TIME INVITE LINKS: make redemption race-safe
-- ------------------------------------------------------------
create table if not exists public.department_invites(
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  department_id uuid not null references public.departments(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  applicant_name text,
  applicant_email text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz,
  used_by uuid references auth.users(id)
);

alter table public.department_invites add column if not exists used_at timestamptz;
alter table public.department_invites add column if not exists used_by uuid;

-- Replace an older check constraint so the temporary 'processing' state is legal.
alter table public.department_invites drop constraint if exists department_invites_status_check;
alter table public.department_invites add constraint department_invites_status_check
  check (status in ('pending','processing','used','revoked'));

create unique index if not exists department_invites_token_idx on public.department_invites(token);
create index if not exists department_invites_department_idx on public.department_invites(department_id);

alter table public.department_invites enable row level security;
grant all on public.department_invites to service_role;

-- Ask PostgREST/Supabase to refresh its schema cache immediately after DDL.
notify pgrst, 'reload schema';
