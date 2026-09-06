-- NestEgg: fix service_role privileges for server-side profile writes
-- Run this in Supabase SQL Editor after schema.sql.
-- This does NOT disable RLS for normal users. It only grants the
-- service_role used by trusted Next.js server routes the table privileges
-- required for those server-side writes.

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO service_role;

-- Keep RLS enabled. The service_role is used only by server-side code and
-- remains separate from the browser's anon/authenticated roles.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Ensure the trigger function remains executable by the auth trigger owner.
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
