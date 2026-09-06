-- Community social platform: profiles, posts, comments, likes.
-- Safe to run more than once. All data access from the app goes through the
-- /api/community serverless functions using the service-role key (same
-- pattern as the rest of the site), so these RLS policies are a defense in
-- depth layer in case a client ever queries Supabase directly.
create extension if not exists pgcrypto;

create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  bio text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.community_posts(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  image_url text,
  is_hidden boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.community_comments(
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  is_hidden boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.community_likes(
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key(post_id, user_id)
);

create index if not exists community_posts_created_idx on public.community_posts(created_at desc);
create index if not exists community_comments_post_idx on public.community_comments(post_id, created_at asc);
create index if not exists community_likes_post_idx on public.community_likes(post_id);

alter table public.profiles enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_likes enable row level security;

drop policy if exists "public read profiles" on public.profiles;
create policy "public read profiles" on public.profiles for select using(true);
drop policy if exists "users manage own profile" on public.profiles;
create policy "users manage own profile" on public.profiles for all using(auth.uid() = id) with check(auth.uid() = id);

drop policy if exists "public read visible posts" on public.community_posts;
create policy "public read visible posts" on public.community_posts for select using(is_hidden = false);
drop policy if exists "users manage own posts" on public.community_posts;
create policy "users manage own posts" on public.community_posts for all using(auth.uid() = user_id) with check(auth.uid() = user_id);

drop policy if exists "public read visible comments" on public.community_comments;
create policy "public read visible comments" on public.community_comments for select using(is_hidden = false);
drop policy if exists "users manage own comments" on public.community_comments;
create policy "users manage own comments" on public.community_comments for all using(auth.uid() = user_id) with check(auth.uid() = user_id);

drop policy if exists "public read likes" on public.community_likes;
create policy "public read likes" on public.community_likes for select using(true);
drop policy if exists "users manage own likes" on public.community_likes;
create policy "users manage own likes" on public.community_likes for all using(auth.uid() = user_id) with check(auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.community_posts, public.community_comments, public.community_likes to anon, authenticated;
grant insert, update, delete on public.profiles, public.community_posts, public.community_comments, public.community_likes to authenticated;
grant all on public.profiles, public.community_posts, public.community_comments, public.community_likes to service_role;

-- Storage bucket for member-uploaded post photos (public read; uploads go
-- through the authenticated /api/community-upload endpoint using the
-- service-role key, so no extra storage policies are required for writes).
insert into storage.buckets (id, name, public)
values ('community', 'community', true)
on conflict (id) do update set public = true;

drop policy if exists "Public community images" on storage.objects;
create policy "Public community images" on storage.objects for select using(bucket_id = 'community');
