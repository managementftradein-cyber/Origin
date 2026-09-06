-- Nestegg: Rewards & badges
-- Run this AFTER all previous schema files, including schema_referral.sql
-- (goal-completion detection here also needs transfer_to_goal updated).

-- 1. Badge definitions ---------------------------------------------------------
create table if not exists public.badges (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  icon text not null -- an emoji, kept simple rather than an icon asset pipeline
);

insert into public.badges (code, name, description, icon) values
  ('first_deposit', 'First Deposit', 'Made your first deposit into your wallet', '💰'),
  ('first_goal', 'Goal Setter', 'Created your first savings goal', '🎯'),
  ('goal_completed', 'Goal Crusher', 'Fully funded a savings goal', '🏆'),
  ('kyc_verified', 'Verified', 'Completed KYC verification', '✅'),
  ('first_post', 'Community Voice', 'Made your first post in the community', '💬'),
  ('first_referral', 'Connector', 'Referred your first friend to Nestegg', '🔗')
on conflict (code) do nothing;

-- 2. Earned badges --------------------------------------------------------------
create table if not exists public.user_badges (
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_id uuid not null references public.badges(id) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

-- Extend the notifications type check to include badge_earned — the
-- original list in schema_notifications.sql didn't anticipate this.
alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'deposit_successful', 'withdrawal_successful', 'transfer_to_goal',
    'community_reply', 'community_like', 'savings_reminder', 'badge_earned'
  ));

-- 3. Award a badge (idempotent helper, shared by every trigger below) --------
create or replace function public.award_badge(p_user_id uuid, p_badge_code text)
returns void as $$
declare
  v_badge_id uuid;
begin
  select id into v_badge_id from public.badges where code = p_badge_code;
  if v_badge_id is null then
    return;
  end if;

  insert into public.user_badges (user_id, badge_id)
  values (p_user_id, v_badge_id)
  on conflict (user_id, badge_id) do nothing;

  if found then
    insert into public.notifications (user_id, type, title, body, link)
    select p_user_id, 'badge_earned', 'Badge earned: ' || name, description, '/dashboard/rewards'
    from public.badges where id = v_badge_id;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

-- 4. Wire badge triggers into existing tables -----------------------------------

-- First deposit (reuses the same wallet_transactions insert everything else hooks into).
create or replace function public.badge_on_wallet_transaction()
returns trigger as $$
begin
  if new.type = 'deposit' and new.status = 'success' and new.description is distinct from 'Referral bonus' then
    perform public.award_badge(new.user_id, 'first_deposit');
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists wallet_transactions_badge on public.wallet_transactions;
create trigger wallet_transactions_badge
  after insert on public.wallet_transactions
  for each row execute function public.badge_on_wallet_transaction();

-- First goal created.
create or replace function public.badge_on_goal_created()
returns trigger as $$
begin
  perform public.award_badge(new.user_id, 'first_goal');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists savings_goals_badge_created on public.savings_goals;
create trigger savings_goals_badge_created
  after insert on public.savings_goals
  for each row execute function public.badge_on_goal_created();

-- Goal fully funded. transfer_to_goal() doesn't currently flip status to
-- 'completed' when a goal is fully funded — add that here, and award the
-- badge on that transition.
create or replace function public.transfer_to_goal(
  p_goal_id uuid,
  p_amount_kobo bigint
) returns void as $$
declare
  v_user_id uuid := auth.uid();
  v_balance bigint;
  v_goal_owner uuid;
  v_new_amount bigint;
  v_target bigint;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount_kobo <= 0 then
    raise exception 'Amount must be positive';
  end if;

  select balance_kobo into v_balance from public.wallets where user_id = v_user_id for update;
  if v_balance is null or v_balance < p_amount_kobo then
    raise exception 'Insufficient wallet balance';
  end if;

  select user_id, target_amount_kobo into v_goal_owner, v_target
    from public.savings_goals where id = p_goal_id for update;
  if v_goal_owner is null or v_goal_owner <> v_user_id then
    raise exception 'Goal not found';
  end if;

  update public.wallets set balance_kobo = balance_kobo - p_amount_kobo where user_id = v_user_id;

  update public.savings_goals
    set current_amount_kobo = current_amount_kobo + p_amount_kobo
    where id = p_goal_id
    returning current_amount_kobo into v_new_amount;

  if v_new_amount >= v_target then
    update public.savings_goals set status = 'completed' where id = p_goal_id and status = 'active';
  end if;

  insert into public.wallet_transactions (user_id, type, amount_kobo, status, goal_id, description)
  values (v_user_id, 'transfer_to_goal', p_amount_kobo, 'success', p_goal_id, 'Transfer to savings goal');
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.badge_on_goal_completed()
returns trigger as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform public.award_badge(new.user_id, 'goal_completed');
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists savings_goals_badge_completed on public.savings_goals;
create trigger savings_goals_badge_completed
  after update on public.savings_goals
  for each row execute function public.badge_on_goal_completed();

-- KYC verified.
create or replace function public.badge_on_kyc_verified()
returns trigger as $$
begin
  if new.kyc_status = 'verified' and old.kyc_status is distinct from 'verified' then
    perform public.award_badge(new.id, 'kyc_verified');
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists profiles_badge_kyc on public.profiles;
create trigger profiles_badge_kyc
  after update on public.profiles
  for each row execute function public.badge_on_kyc_verified();

-- First community post.
create or replace function public.badge_on_first_post()
returns trigger as $$
begin
  perform public.award_badge(new.user_id, 'first_post');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists community_posts_badge on public.community_posts;
create trigger community_posts_badge
  after insert on public.community_posts
  for each row execute function public.badge_on_first_post();

-- First successful referral.
create or replace function public.badge_on_first_referral()
returns trigger as $$
begin
  perform public.award_badge(new.referrer_id, 'first_referral');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists referral_rewards_badge on public.referral_rewards;
create trigger referral_rewards_badge
  after insert on public.referral_rewards
  for each row execute function public.badge_on_first_referral();

-- 5. RLS + grants ----------------------------------------------------------------
alter table public.badges enable row level security;
alter table public.user_badges enable row level security;

drop policy if exists "Anyone can view badge definitions" on public.badges;
create policy "Anyone can view badge definitions"
  on public.badges for select
  to authenticated
  using (true);

drop policy if exists "Users can view their own earned badges" on public.user_badges;
create policy "Users can view their own earned badges"
  on public.user_badges for select
  to authenticated
  using (auth.uid() = user_id);

grant select on table public.badges to authenticated;
grant select on table public.user_badges to authenticated;
