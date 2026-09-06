-- Nestegg: Admin role
-- Run this AFTER schema.sql, schema_savings_wallet.sql, schema_otp.sql, and
-- schema_community.sql.
--
-- There is deliberately no signup flow, API route, or UI button that can
-- ever set role = 'admin' — the only way to grant it is running the UPDATE
-- at the bottom of this file yourself in the SQL editor. Admin access to
-- other users' data goes through the service-role client in API routes
-- (after checking this role via the caller's own session), NOT through new
-- RLS policies that would let the authenticated role read everyone's rows
-- directly — keeping the blast radius of a compromised session small.

alter table public.profiles
  add column if not exists role text not null default 'user' check (role in ('user', 'admin'));

-- Users can already read their own profile row (existing policy from
-- schema.sql covers `role` too, since it's a column on the same row) — no
-- new RLS policy is needed for a user to see their own role.

-- To make an existing account an admin, find their id and run:
--   update public.profiles set role = 'admin' where id = '<user-uuid>';
-- Find the id via:
--   select p.id, p.full_name, u.email
--   from public.profiles p join auth.users u on u.id = p.id
--   where u.email = 'you@example.com';

-- The admin panel queries several tables DIRECTLY through the service-role
-- client (lib/supabase/admin.ts), rather than through the security-definer
-- functions the rest of the app uses. BYPASSRLS (which service_role has)
-- only exempts a role from row-level security — it does NOT exempt it from
-- needing a base table GRANT, and tables created via the SQL Editor don't
-- get one automatically for any role, service_role included. This is the
-- exact "permission denied" issue found earlier, just for a different role
-- — granting it now, upfront, rather than rediscovering it per table.
grant usage on schema public to service_role;
grant select, update on table public.profiles to service_role;
grant select on table public.wallets to service_role;
grant select, update, delete on table public.savings_goals to service_role;
grant select on table public.wallet_transactions to service_role;
grant select, delete on table public.community_posts to service_role;
grant select, delete on table public.community_comments to service_role;
grant select, delete on table public.community_likes to service_role;
grant select on table public.community_groups to service_role;
grant select, delete on table public.community_group_members to service_role;
