-- Nestegg: Notifications
-- Run this AFTER schema.sql, schema_savings_wallet.sql, schema_otp.sql,
-- schema_community.sql, and schema_admin.sql.

-- 1. Notifications table -----------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in (
    'deposit_successful', 'withdrawal_successful', 'transfer_to_goal',
    'community_reply', 'community_like', 'savings_reminder'
  )),
  title text not null,
  body text,
  link text, -- relative path to deep-link to, e.g. /dashboard/wallet
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- 2. RLS -----------------------------------------------------------------------
alter table public.notifications enable row level security;

-- Users can read and mark-as-read their own notifications. No insert
-- policy — every row is created by a trigger (security definer) or a
-- service-role cron route, never directly by a client.
drop policy if exists "Users can view their own notifications" on public.notifications;
create policy "Users can view their own notifications"
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can mark their own notifications read" on public.notifications;
create policy "Users can mark their own notifications read"
  on public.notifications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. Base table grants -----------------------------------------------------
-- Column-restricted, same reasoning as profiles: a user marking their own
-- notification read should only ever be able to touch read_at, never
-- rewrite the title/body/type of a notification.
grant usage on schema public to authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;
grant select, insert on table public.notifications to service_role;

-- 4. Triggers on existing tables ---------------------------------------------
-- Deposits: fires from wallet_transactions rows created by credit_wallet().
create or replace function public.notify_on_wallet_transaction()
returns trigger as $$
begin
  if new.type = 'deposit' then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      new.user_id, 'deposit_successful', 'Deposit successful',
      new.description, '/dashboard/wallet'
    );
  elsif new.type = 'transfer_from_goal' then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      new.user_id, 'withdrawal_successful', 'Withdrawal successful',
      new.description, '/dashboard/wallet'
    );
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists wallet_transactions_notify on public.wallet_transactions;
create trigger wallet_transactions_notify
  after insert on public.wallet_transactions
  for each row execute function public.notify_on_wallet_transaction();

-- Comments: notify the post's author when someone else comments.
create or replace function public.notify_on_comment()
returns trigger as $$
declare
  v_post_owner uuid;
  v_commenter_name text;
begin
  select user_id into v_post_owner from public.community_posts where id = new.post_id;

  if v_post_owner is not null and v_post_owner <> new.user_id then
    select full_name into v_commenter_name from public.profiles where id = new.user_id;

    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_post_owner, 'community_reply',
      coalesce(v_commenter_name, 'Someone') || ' replied to your post',
      left(new.body, 140),
      '/dashboard/community/' || new.post_id
    );
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists community_comments_notify on public.community_comments;
create trigger community_comments_notify
  after insert on public.community_comments
  for each row execute function public.notify_on_comment();

-- Likes: notify the post's author (skip self-likes).
create or replace function public.notify_on_like()
returns trigger as $$
declare
  v_post_owner uuid;
  v_liker_name text;
begin
  select user_id into v_post_owner from public.community_posts where id = new.post_id;

  if v_post_owner is not null and v_post_owner <> new.user_id then
    select full_name into v_liker_name from public.profiles where id = new.user_id;

    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_post_owner, 'community_like',
      coalesce(v_liker_name, 'Someone') || ' liked your post',
      null,
      '/dashboard/community/' || new.post_id
    );
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists community_likes_notify on public.community_likes;
create trigger community_likes_notify
  after insert on public.community_likes
  for each row execute function public.notify_on_like();
