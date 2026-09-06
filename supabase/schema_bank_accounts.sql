-- Nestegg: Bank account linking + real payouts via Paystack Transfers
-- Run this AFTER all previous schema files.
--
-- This is the first flow where money actually LEAVES the platform, so the
-- pattern is deliberately conservative: reserve (deduct) the funds and
-- create a 'pending' ledger row FIRST, then attempt the Paystack transfer.
-- If the transfer fails at any point — the API call itself, or later via
-- webhook — the reservation is refunded. The wallet balance can never
-- reflect money that both left the wallet AND never left the platform.

-- 1. Bank accounts -----------------------------------------------------------
create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bank_name text not null,
  bank_code text not null,
  account_number text not null,
  account_name text not null, -- resolved from Paystack, not user-typed — confirms it's a real account
  paystack_recipient_code text not null unique,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists bank_accounts_user_idx on public.bank_accounts (user_id);

-- 2. Extend wallet_transactions to reference a bank account on withdrawals --
alter table public.wallet_transactions
  add column if not exists bank_account_id uuid references public.bank_accounts(id) on delete set null;

-- 3. Reserve a withdrawal ------------------------------------------------------
-- Called by the authenticated user via RPC. Deducts the wallet balance
-- immediately and creates a 'pending' ledger row — the debit happens here,
-- BEFORE any Paystack API call, so the balance always reflects "this money
-- is either gone or in-flight," never double-counted.
create or replace function public.reserve_withdrawal(
  p_bank_account_id uuid,
  p_amount_kobo bigint
) returns uuid as $$
declare
  v_user_id uuid := auth.uid();
  v_balance bigint;
  v_kyc_status text;
  v_bank_owner uuid;
  v_transaction_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount_kobo <= 0 then
    raise exception 'Amount must be positive';
  end if;

  select kyc_status into v_kyc_status from public.profiles where id = v_user_id;
  if v_kyc_status is distinct from 'verified' then
    raise exception 'KYC verification is required before withdrawing to a bank account';
  end if;

  select user_id into v_bank_owner from public.bank_accounts where id = p_bank_account_id;
  if v_bank_owner is null or v_bank_owner <> v_user_id then
    raise exception 'Bank account not found';
  end if;

  select balance_kobo into v_balance from public.wallets where user_id = v_user_id for update;
  if v_balance is null or v_balance < p_amount_kobo then
    raise exception 'Insufficient wallet balance';
  end if;

  update public.wallets set balance_kobo = balance_kobo - p_amount_kobo where user_id = v_user_id;

  insert into public.wallet_transactions (user_id, type, amount_kobo, status, bank_account_id, description)
  values (v_user_id, 'withdrawal', p_amount_kobo, 'pending', p_bank_account_id, 'Withdrawal to bank account')
  returning id into v_transaction_id;

  return v_transaction_id;
end;
$$ language plpgsql security definer set search_path = public;

-- 4. Resolve a reserved withdrawal ---------------------------------------------
-- Service-role only — called from the API route (if the Paystack transfer
-- call fails synchronously) or the webhook (once Paystack confirms success
-- or failure asynchronously). Idempotent: a transaction that's already
-- resolved is left alone, so a webhook retry can't double-refund or
-- double-confirm.
create or replace function public.resolve_withdrawal(
  p_transaction_id uuid,
  p_success boolean,
  p_paystack_reference text default null
) returns void as $$
declare
  v_txn public.wallet_transactions%rowtype;
begin
  select * into v_txn from public.wallet_transactions
    where id = p_transaction_id and type = 'withdrawal' for update;

  if v_txn.id is null or v_txn.status <> 'pending' then
    return; -- already resolved, or not a withdrawal — no-op
  end if;

  if p_success then
    update public.wallet_transactions
      set status = 'success', paystack_reference = coalesce(p_paystack_reference, paystack_reference)
      where id = p_transaction_id;
  else
    -- Refund: the transfer never left the platform, so the money goes
    -- back into the wallet exactly as it was deducted.
    update public.wallets set balance_kobo = balance_kobo + v_txn.amount_kobo
      where user_id = v_txn.user_id;
    update public.wallet_transactions set status = 'failed' where id = p_transaction_id;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

-- 5. RLS -----------------------------------------------------------------------
alter table public.bank_accounts enable row level security;

drop policy if exists "Users can view their own bank accounts" on public.bank_accounts;
create policy "Users can view their own bank accounts"
  on public.bank_accounts for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can add their own bank accounts" on public.bank_accounts;
create policy "Users can add their own bank accounts"
  on public.bank_accounts for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their own bank accounts" on public.bank_accounts;
create policy "Users can remove their own bank accounts"
  on public.bank_accounts for delete
  to authenticated
  using (auth.uid() = user_id);

-- 6. Grants -------------------------------------------------------------------
grant select, insert, delete on table public.bank_accounts to authenticated;
grant select on table public.bank_accounts to service_role;

grant execute on function public.reserve_withdrawal(uuid, bigint) to authenticated;
revoke execute on function public.resolve_withdrawal(uuid, boolean, text) from authenticated, anon;
grant execute on function public.resolve_withdrawal(uuid, boolean, text) to service_role;

-- 7. Notify on withdrawal resolution -------------------------------------------
-- The existing wallet_transactions_notify trigger (schema_notifications.sql)
-- only fires on INSERT — a bank withdrawal starts 'pending' at insert time
-- and only becomes 'success'/'failed' via resolve_withdrawal()'s UPDATE, so
-- it needs its own trigger on that transition.
create or replace function public.notify_on_withdrawal_resolved()
returns trigger as $$
begin
  if new.type = 'withdrawal' and old.status = 'pending' and new.status = 'success' then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      new.user_id, 'withdrawal_successful', 'Withdrawal sent',
      'Your withdrawal has been sent to your bank account.', '/dashboard/wallet'
    );
  elsif new.type = 'withdrawal' and old.status = 'pending' and new.status = 'failed' then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      new.user_id, 'withdrawal_successful', 'Withdrawal failed — refunded',
      'Your withdrawal could not be completed. The amount has been returned to your wallet.',
      '/dashboard/wallet'
    );
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists wallet_transactions_notify_resolved on public.wallet_transactions;
create trigger wallet_transactions_notify_resolved
  after update on public.wallet_transactions
  for each row execute function public.notify_on_withdrawal_resolved();
