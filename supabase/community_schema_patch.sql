-- Defensive patch for the community feature. Safe to run any number of
-- times, in any order relative to community_schema.sql / schema.sql /
-- roles_departments_migration.sql. Fixes:
--   * "Bucket not found" — the 'community' storage bucket never got created.
--   * "Could not find the 'image_url' column of 'community_posts'"
--   * "column community_posts.is_hidden does not exist"
-- These happen when community_posts/community_comments already existed
-- from an earlier, smaller version of the schema — "create table if not
-- exists" in community_schema.sql silently skips tables that already
-- exist, so newer columns never get added. This file uses ALTER TABLE ...
-- ADD COLUMN IF NOT EXISTS instead, which works either way.

create extension if not exists pgcrypto;

create table if not exists public.community_posts(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);
alter table public.community_posts add column if not exists image_url text;
alter table public.community_posts add column if not exists is_hidden boolean not null default false;

create table if not exists public.community_comments(
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);
alter table public.community_comments add column if not exists is_hidden boolean not null default false;

create table if not exists public.community_likes(
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (post_id, user_id)
);

create index if not exists community_posts_created_idx on public.community_posts(created_at desc);
create index if not exists community_comments_post_idx on public.community_comments(post_id, created_at asc);
create index if not exists community_likes_post_idx on public.community_likes(post_id);

alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_likes enable row level security;

drop policy if exists "public read visible posts" on public.community_posts;
create policy "public read visible posts" on public.community_posts for select using (is_hidden = false);
drop policy if exists "users manage own posts" on public.community_posts;
create policy "users manage own posts" on public.community_posts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "public read visible comments" on public.community_comments;
create policy "public read visible comments" on public.community_comments for select using (is_hidden = false);
drop policy if exists "users manage own comments" on public.community_comments;
create policy "users manage own comments" on public.community_comments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "public read likes" on public.community_likes;
create policy "public read likes" on public.community_likes for select using (true);
drop policy if exists "users manage own likes" on public.community_likes;
create policy "users manage own likes" on public.community_likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select on public.community_posts, public.community_comments, public.community_likes to anon, authenticated;
grant insert, update, delete on public.community_posts, public.community_comments, public.community_likes to authenticated;
grant all on public.community_posts, public.community_comments, public.community_likes to service_role;

-- Storage bucket used by /api/community-upload.js
insert into storage.buckets (id, name, public)
values ('community', 'community', true)
on conflict (id) do update set public = true;

drop policy if exists "Public community images" on storage.objects;
create policy "Public community images" on storage.objects for select using (bucket_id = 'community');
