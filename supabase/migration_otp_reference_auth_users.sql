-- Migration: point otp_codes.user_id at auth.users instead of profiles.
-- Run this once in the Supabase SQL editor.
--
-- Why: otp_codes.user_id previously referenced public.profiles(id), which
-- only exists because the on_auth_user_created trigger creates it. That's
-- an unnecessary extra hop — auth.users is the row that's guaranteed to
-- exist the instant supabase.auth.signUp() succeeds, so referencing it
-- directly removes any dependency on the trigger having already run.

alter table public.otp_codes
  drop constraint if exists otp_codes_user_id_fkey;

alter table public.otp_codes
  add constraint otp_codes_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
