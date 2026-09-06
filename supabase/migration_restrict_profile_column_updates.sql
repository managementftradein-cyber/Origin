-- Nestegg: restrict which profile columns a user can update themselves.
-- Run this NOW in the Supabase SQL editor — this closes a real privilege
-- escalation hole.
--
-- The original grant in schema.sql was `grant update on table
-- public.profiles`, which — unlike an RLS policy — applies to every
-- column, not just the ones that existed when it was written. Once
-- `role`, `kyc_status`, `email_verified`, and `phone_verified` were added
-- by later migrations, that same broad grant silently covered them too.
-- Concretely: any authenticated user could currently run
--   supabase.from('profiles').update({ role: 'admin' }).eq('id', <self>)
-- from the browser console and grant themselves admin access, or set
-- their own `kyc_status` to 'verified' / `phone_verified` to true without
-- ever actually verifying anything.
--
-- The fix: revoke the blanket UPDATE grant and re-grant it on only the
-- columns a user should be able to change about themselves. Every other
-- column (role, kyc_status, email_verified, phone_verified) can only be
-- changed by security-definer functions or service-role API routes going
-- forward — never by a direct client-side update.

revoke update on table public.profiles from authenticated;

grant update (full_name, phone, date_of_birth, avatar_url) on table public.profiles to authenticated;

-- Note: this does NOT affect existing security-definer functions
-- (handle_new_user, verify_otp, etc.) or service-role API routes — those
-- run as the function owner / a role with its own full grant, and are
-- unaffected by column-level restrictions on `authenticated`.
