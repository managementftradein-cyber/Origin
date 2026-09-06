-- Nestegg: Referral program
-- Run this AFTER all previous schema files.
--
-- Design choice: the referral reward fires on the REFERRED user's first
-- successful deposit, not on signup. Rewarding signup alone is trivially
-- gameable (create accounts, refer yourself); requiring real money to move
-- means the referred person actually became a user, not just a row.

-- 1. Referral columns on profiles -------------------------------------------
alter table public.profiles
  add column if not exists referral_code text unique,
  add column if not exists referred_by uuid references public.profiles(id) on delete set null;

-- Backfill + auto-generate codes for future signups. Short, uppercase,
-- based on part of the user's id — unique by construction, no collision
-- retry loop needed.
create or replace function public.generate_referral_code(p_user_id uuid)
returns text as $$
begin
  return upper(substr(replace(p_user_id::text, '-', ''), 1, 7));
end;
$$ language sql immutable;

update public.profiles
set referral_code = public.generate_referral_code(id)
where referral_code is null;

-- 2. Extend the signup trigger to set referral_code and referred_by --------
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_referrer_id uuid;
  v_ref_code_used text;
begin
  v_ref_code_used := upper(nullif(trim(new.raw_user_meta_data ->> 'referral_code_used'), ''));

  if v_ref_code_used is not null then
    select id into v_referrer_id from public.profiles where referral_code = v_ref_code_used;
  end if;

  insert into public.profiles (id, full_name, phone, referral_code, referred_by)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.phone,
    public.generate_referral_code(new.id),
    v_referrer_id
  )
  on conflict (id) do nothing;

  insert into public.wallets (user_id, balance_kobo)
  values (new.id, 0)
  on conflict (user_id) do nothing;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- 3. Referral rewards ledger --------------------------------------------------
create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_id uuid not null references public.profiles(id) on delete cascade,
  reward_kobo bigint not null,
  created_at timestamptz not null default now(),
  unique (referred_id) -- one reward per referred person, ever
);

-- 4. Award the reward on the referred user's FIRST successful deposit ------
create or replace function public.notify_and_reward_referral()
returns trigger as $$
declare
  v_referrer_id uuid;
  v_is_first_deposit boolean;
  v_reward_kobo bigint := 50000; -- NGN 500, flat referral bonus
begin
  if new.type <> 'deposit' or new.status <> 'success' then
    return new;
  end if;

  -- Without this guard, crediting the referrer below would insert a new
  -- 'deposit' row, re-firing this same trigger for THEM — and if they were
  -- also referred by someone, that could cascade a bonus up an entire
  -- referral chain. This description is only ever used by this function.
  if new.description = 'Referral bonus' then
    return new;
  end if;

  select count(*) = 1 into v_is_first_deposit
    from public.wallet_transactions
    where user_id = new.user_id and type = 'deposit' and status = 'success';

  if not v_is_first_deposit then
    return new; -- only the FIRST deposit ever triggers a referral reward
  end if;

  select referred_by into v_referrer_id from public.profiles where id = new.user_id;
  if v_referrer_id is null then
    return new; -- this user wasn't referred by anyone
  end if;

  insert into public.referral_rewards (referrer_id, referred_id, reward_kobo)
  values (v_referrer_id, new.user_id, v_reward_kobo)
  on conflict (referred_id) do nothing;

  if found then
    update public.wallets set balance_kobo = balance_kobo + v_reward_kobo where user_id = v_referrer_id;

    insert into public.wallet_transactions (user_id, type, amount_kobo, status, description)
    values (v_referrer_id, 'deposit', v_reward_kobo, 'success', 'Referral bonus');

    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_referrer_id, 'deposit_successful', 'Referral bonus earned!',
      'Someone you referred made their first deposit — ₦500 has been added to your wallet.',
      '/dashboard/referral'
    );
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists wallet_transactions_referral_reward on public.wallet_transactions;
create trigger wallet_transactions_referral_reward
  after insert on public.wallet_transactions
  for each row execute function public.notify_and_reward_referral();

-- 5. RLS + grants ---------------------------------------------------------
alter table public.referral_rewards enable row level security;

drop policy if exists "Users can view referrals they made" on public.referral_rewards;
create policy "Users can view referrals they made"
  on public.referral_rewards for select
  to authenticated
  using (auth.uid() = referrer_id);

grant select on table public.referral_rewards to authenticated;
grant select, insert on table public.referral_rewards to service_role;
