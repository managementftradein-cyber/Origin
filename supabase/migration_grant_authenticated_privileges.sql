-- NestEgg: grant base table privileges to `authenticated`.
--
-- Root cause of the "profiles" permission error: tables created via the
-- Supabase SQL Editor (raw DDL) do NOT automatically receive the table-level
-- GRANTs that the dashboard's Table Editor adds for you. RLS policies only
-- control *which rows* a role can see — the role still needs a base GRANT
-- to touch the table at all. Without it, Postgres rejects the query with
-- "permission denied for table X" before RLS is ever evaluated, which is
-- exactly what we found in the profiles lookup.
--
-- Run this once in the Supabase SQL editor. It does not weaken RLS — every
-- grant here matches an existing RLS policy that already restricts rows to
-- the requesting user; this just lets that policy actually run.

grant usage on schema public to authenticated, anon;

-- profiles: users can read and update their own row (RLS-restricted).
-- No INSERT grant — rows are only ever created by the handle_new_user
-- trigger, which runs as the trigger owner and bypasses grants entirely.
grant select, update on table public.profiles to authenticated;

-- wallets: read-only for the owning user. No insert/update grant — balance
-- changes only happen through the security-definer functions.
grant select on table public.wallets to authenticated;

-- savings_goals: users can view and create their own goals. No update
-- grant — current_amount_kobo/status only change via transfer_to_goal /
-- withdraw_from_goal, which run as security definer and bypass grants.
grant select, insert on table public.savings_goals to authenticated;

-- wallet_transactions: read-only ledger for the owning user.
grant select on table public.wallet_transactions to authenticated;

-- otp_codes: deliberately NO grants to authenticated or anon. It's only
-- ever touched through request_otp() / verify_otp(), which are
-- security-definer and already revoked from authenticated/anon in
-- schema_otp.sql. This line is just documentation of that intent.
-- (no grant statement — this is intentional)
