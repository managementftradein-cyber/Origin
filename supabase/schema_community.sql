-- Nestegg: Community forum schema
-- Run this AFTER schema.sql, schema_savings_wallet.sql, and schema_otp.sql.

-- 1. Community groups (e.g. "Students", "Family Savings", "Challenges") ----
create table if not exists public.community_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.community_group_members (
  group_id uuid not null references public.community_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- 2. Posts -------------------------------------------------------------------
create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.community_groups(id) on delete set null,
  kind text not null default 'text' check (kind in ('text', 'image', 'poll', 'question')),
  body text not null check (char_length(body) between 1 and 2000),
  image_url text,
  like_count int not null default 0,
  comment_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_posts_created_idx on public.community_posts (created_at desc);
create index if not exists community_posts_group_idx on public.community_posts (group_id, created_at desc);

-- 3. Comments -----------------------------------------------------------------
create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists community_comments_post_idx on public.community_comments (post_id, created_at asc);

-- 4. Likes ---------------------------------------------------------------------
create table if not exists public.community_likes (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- 5. Keep counters accurate with triggers, not app-level increments ----------
-- (avoids race conditions from two people liking/commenting at once)
create or replace function public.bump_post_like_count()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update public.community_posts set like_count = like_count + 1 where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.community_posts set like_count = greatest(0, like_count - 1) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists community_likes_bump on public.community_likes;
create trigger community_likes_bump
  after insert or delete on public.community_likes
  for each row execute function public.bump_post_like_count();

create or replace function public.bump_post_comment_count()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update public.community_posts set comment_count = comment_count + 1 where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.community_posts set comment_count = greatest(0, comment_count - 1) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists community_comments_bump on public.community_comments;
create trigger community_comments_bump
  after insert or delete on public.community_comments
  for each row execute function public.bump_post_comment_count();

drop trigger if exists community_posts_set_updated_at on public.community_posts;
create trigger community_posts_set_updated_at
  before update on public.community_posts
  for each row execute function public.set_updated_at();

-- 6. Leaderboard view — total saved per user this week -----------------------
-- Reads from wallet_transactions (already exists from schema_savings_wallet.sql).
create or replace view public.weekly_savings_leaderboard as
select
  p.id as user_id,
  p.full_name,
  coalesce(sum(wt.amount_kobo) filter (
    where wt.type = 'transfer_to_goal' and wt.created_at > now() - interval '7 days'
  ), 0) as saved_this_week_kobo
from public.profiles p
left join public.wallet_transactions wt on wt.user_id = p.id
group by p.id, p.full_name
order by saved_this_week_kobo desc;

-- 7. Row Level Security --------------------------------------------------------
alter table public.community_groups enable row level security;
alter table public.community_group_members enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_likes enable row level security;

-- Groups: anyone signed in can browse and join groups.
drop policy if exists "Anyone can view groups" on public.community_groups;
create policy "Anyone can view groups"
  on public.community_groups for select
  to authenticated
  using (true);

drop policy if exists "Users can view group memberships" on public.community_group_members;
create policy "Users can view group memberships"
  on public.community_group_members for select
  to authenticated
  using (true);

drop policy if exists "Users can join groups themselves" on public.community_group_members;
create policy "Users can join groups themselves"
  on public.community_group_members for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can leave groups themselves" on public.community_group_members;
create policy "Users can leave groups themselves"
  on public.community_group_members for delete
  to authenticated
  using (auth.uid() = user_id);

-- Posts: anyone signed in can read; only the author can create/edit/delete
-- their own post.
drop policy if exists "Anyone can view posts" on public.community_posts;
create policy "Anyone can view posts"
  on public.community_posts for select
  to authenticated
  using (true);

drop policy if exists "Users can create their own posts" on public.community_posts;
create policy "Users can create their own posts"
  on public.community_posts for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own posts" on public.community_posts;
create policy "Users can delete their own posts"
  on public.community_posts for delete
  to authenticated
  using (auth.uid() = user_id);

-- Deliberately no UPDATE policy on posts — like_count/comment_count are
-- only ever changed by the trigger functions above (security definer),
-- never directly by a client PATCH.

-- Comments: anyone signed in can read; only the author can create/delete
-- their own comment.
drop policy if exists "Anyone can view comments" on public.community_comments;
create policy "Anyone can view comments"
  on public.community_comments for select
  to authenticated
  using (true);

drop policy if exists "Users can create their own comments" on public.community_comments;
create policy "Users can create their own comments"
  on public.community_comments for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own comments" on public.community_comments;
create policy "Users can delete their own comments"
  on public.community_comments for delete
  to authenticated
  using (auth.uid() = user_id);

-- Likes: anyone signed in can read; users can like/unlike as themselves.
drop policy if exists "Anyone can view likes" on public.community_likes;
create policy "Anyone can view likes"
  on public.community_likes for select
  to authenticated
  using (true);

drop policy if exists "Users can like posts themselves" on public.community_likes;
create policy "Users can like posts themselves"
  on public.community_likes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can unlike posts themselves" on public.community_likes;
create policy "Users can unlike posts themselves"
  on public.community_likes for delete
  to authenticated
  using (auth.uid() = user_id);

-- 8. Base table grants ----------------------------------------------------------
-- The lesson from last time: RLS policies alone are not enough. Tables
-- created via the SQL Editor need an explicit GRANT for `authenticated`
-- or every query fails with "permission denied" before RLS is evaluated.
grant select on table public.community_groups to authenticated;
grant select, insert, delete on table public.community_group_members to authenticated;
grant select, insert, delete on table public.community_posts to authenticated;
grant select, insert, delete on table public.community_comments to authenticated;
grant select, insert, delete on table public.community_likes to authenticated;
grant select on public.weekly_savings_leaderboard to authenticated;

-- 9. Seed a few starter groups, matching the flowchart's "Join Communities" list
insert into public.community_groups (name, description) values
  ('Students', 'Savings tips and challenges for students'),
  ('Business', 'For entrepreneurs building savings discipline'),
  ('Investment', 'Discuss investment strategy alongside saving'),
  ('Family Savings', 'Save together with family goals'),
  ('Challenges', 'Community-wide savings challenges')
on conflict (name) do nothing;
