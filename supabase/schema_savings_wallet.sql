-- Nestegg: Savings + Wallet schema
-- Run this AFTER supabase/schema.sql (which creates profiles).
-- All amounts are stored in kobo (smallest NGN unit, matches Paystack's API)
-- to avoid floating-point rounding issues with money.

-- 1. Wallets ---------------------------------------------------------------
create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_kobo bigint not null default 0 check (balance_kobo >= 0),
  currency text not null default 'NGN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.wallets is 'One wallet per user. Balance is only ever changed by the security-definer functions below — never updated directly by client code.';

-- 2. Savings goals -----------------------------------------------------
create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  target_amount_kobo bigint not null check (target_amount_kobo > 0),
  current_amount_kobo bigint not null default 0 check (current_amount_kobo >= 0),
  duration_months int,
  auto_save_frequency text not null default 'none'
    check (auto_save_frequency in ('none', 'daily', 'weekly', 'monthly')),
  lock_period_days int not null default 0,
  status text not null default 'active'
    check (status in ('active', 'completed', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Wallet transaction ledger -------------------------------------------
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null
    check (type in ('deposit', 'withdrawal', 'transfer_to_goal', 'transfer_from_goal')),
  amount_kobo bigint not null check (amount_kobo > 0),
  status text not null default 'success'
    check (status in ('pending', 'success', 'failed')),
  paystack_reference text unique, -- null for internal transfers (goal <-> wallet)
  goal_id uuid references public.savings_goals(id) on delete set null,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists wallet_transactions_user_idx on public.wallet_transactions (user_id, created_at desc);
create index if not exists savings_goals_user_idx on public.savings_goals (user_id, status);

-- 4. Keep updated_at fresh -------------------------------------------------
drop trigger if exists wallets_set_updated_at on public.wallets;
create trigger wallets_set_updated_at
  before update on public.wallets
  for each row execute function public.set_updated_at();

drop trigger if exists savings_goals_set_updated_at on public.savings_goals;
create trigger savings_goals_set_updated_at
  before update on public.savings_goals
  for each row execute function public.set_updated_at();

-- 5. Extend the signup trigger to also create a wallet ---------------------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.phone)
  on conflict (id) do nothing;

  insert into public.wallets (user_id, balance_kobo)
  values (new.id, 0)
  on conflict (user_id) do nothing;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- 6. Money-moving functions (security definer — bypass RLS, are the ONLY
--    way balances change). Client code and API routes call these via
--    supabase.rpc(), never update balance columns directly. -------------

-- 6a. Credit a wallet after a verified Paystack deposit. Idempotent on
--     paystack_reference so a webhook retry or a duplicate callback
--     verification never double-credits.
create or replace function public.credit_wallet(
  p_user_id uuid,
  p_amount_kobo bigint,
  p_reference text,
  p_description text default 'Wallet deposit'
) returns void as $$
begin
  if exists (select 1 from public.wallet_transactions where paystack_reference = p_reference) then
    return; -- already processed
  end if;

  insert into public.wallet_transactions (user_id, type, amount_kobo, status, paystack_reference, description)
  values (p_user_id, 'deposit', p_amount_kobo, 'success', p_reference, p_description);

  update public.wallets
  set balance_kobo = balance_kobo + p_amount_kobo
  where user_id = p_user_id;
end;
$$ language plpgsql security definer set search_path = public;

-- 6b. Move money from wallet into a savings goal. Uses auth.uid() rather
--     than a client-supplied user id so a caller can never move funds on
--     someone else's behalf.
create or replace function public.transfer_to_goal(
  p_goal_id uuid,
  p_amount_kobo bigint
) returns void as $$
declare
  v_user_id uuid := auth.uid();
  v_balance bigint;
  v_goal_owner uuid;
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

  select user_id into v_goal_owner from public.savings_goals where id = p_goal_id for update;
  if v_goal_owner is null or v_goal_owner <> v_user_id then
    raise exception 'Goal not found';
  end if;

  update public.wallets set balance_kobo = balance_kobo - p_amount_kobo where user_id = v_user_id;
  update public.savings_goals set current_amount_kobo = current_amount_kobo + p_amount_kobo where id = p_goal_id;

  insert into public.wallet_transactions (user_id, type, amount_kobo, status, goal_id, description)
  values (v_user_id, 'transfer_to_goal', p_amount_kobo, 'success', p_goal_id, 'Transfer to savings goal');
end;
$$ language plpgsql security definer set search_path = public;

-- 6c. Move money from a savings goal back into the wallet. Applies a flat
--     5% early-withdrawal penalty if the goal's lock period hasn't elapsed.
--     Uses auth.uid() so a caller can only withdraw their own goals.
create or replace function public.withdraw_from_goal(
  p_goal_id uuid,
  p_amount_kobo bigint
) returns void as $$
declare
  v_user_id uuid := auth.uid();
  v_goal public.savings_goals%rowtype;
  v_penalty_kobo bigint := 0;
  v_net_kobo bigint;
  v_days_held int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_goal from public.savings_goals
    where id = p_goal_id and user_id = v_user_id for update;

  if v_goal.id is null then
    raise exception 'Goal not found';
  end if;
  if p_amount_kobo <= 0 or p_amount_kobo > v_goal.current_amount_kobo then
    raise exception 'Invalid withdrawal amount';
  end if;

  v_days_held := extract(day from now() - v_goal.created_at);
  if v_goal.lock_period_days > 0 and v_days_held < v_goal.lock_period_days then
    v_penalty_kobo := (p_amount_kobo * 0.05)::bigint;
  end if;
  v_net_kobo := p_amount_kobo - v_penalty_kobo;

  update public.savings_goals
    set current_amount_kobo = current_amount_kobo - p_amount_kobo,
        status = case when current_amount_kobo - p_amount_kobo <= 0 then 'withdrawn' else status end
    where id = p_goal_id;

  update public.wallets set balance_kobo = balance_kobo + v_net_kobo where user_id = v_user_id;

  insert into public.wallet_transactions (user_id, type, amount_kobo, status, goal_id, description)
  values (
    v_user_id, 'transfer_from_goal', v_net_kobo, 'success', p_goal_id,
    case when v_penalty_kobo > 0
      then 'Early withdrawal — 5% penalty applied (locked for ' || v_goal.lock_period_days || ' days)'
      else 'Withdrawal from savings goal'
    end
  );
end;
$$ language plpgsql security definer set search_path = public;

-- 7. Row Level Security ----------------------------------------------------
alter table public.wallets enable row level security;
alter table public.savings_goals enable row level security;
alter table public.wallet_transactions enable row level security;

-- Wallets: users may only ever READ their own row. No insert/update policy
-- is granted — balance changes exclusively through the functions above,
-- which run as the function owner and bypass RLS.
drop policy if exists "Users can view their own wallet" on public.wallets;
create policy "Users can view their own wallet"
  on public.wallets for select
  using (auth.uid() = user_id);

-- Savings goals: users can create and view their own goals. Deliberately no
-- UPDATE policy — current_amount_kobo and status only change via the
-- transfer/withdraw functions, never a direct PATCH from the client.
drop policy if exists "Users can view their own goals" on public.savings_goals;
create policy "Users can view their own goals"
  on public.savings_goals for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own goals" on public.savings_goals;
create policy "Users can create their own goals"
  on public.savings_goals for insert
  with check (auth.uid() = user_id);

-- Wallet transactions: read-only ledger for the owning user. All rows are
-- inserted by the security-definer functions or the Paystack webhook
-- (service role), never directly by client code.
drop policy if exists "Users can view their own transactions" on public.wallet_transactions;
create policy "Users can view their own transactions"
  on public.wallet_transactions for select
  using (auth.uid() = user_id);

-- 8. Grant execute on the money functions -----------------------------------
-- credit_wallet takes a trusted user id, so it must ONLY ever be callable
-- from the service role (used by the Paystack webhook), never from a
-- logged-in user's session.
grant execute on function public.credit_wallet(uuid, bigint, text, text) to service_role;
revoke execute on function public.credit_wallet(uuid, bigint, text, text) from authenticated, anon;

grant execute on function public.transfer_to_goal(uuid, bigint) to authenticated;
grant execute on function public.withdraw_from_goal(uuid, bigint) to authenticated;

-- 9. Base table grants -------------------------------------------------------
-- Same gotcha as profiles: tables created via the SQL Editor don't
-- automatically get GRANTs for authenticated/anon the way dashboard-created
-- tables do. Without these, Postgres rejects the query with "permission
-- denied" before RLS is ever evaluated.
grant select on table public.wallets to authenticated;
grant select, insert on table public.savings_goals to authenticated;
grant select on table public.wallet_transactions to authenticated;
