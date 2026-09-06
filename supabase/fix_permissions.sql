-- Least-privilege permissions for the Origin application.
-- The web app uses server-side service-role API routes for database access,
-- so anon/authenticated do not need blanket table SELECT/WRITE privileges.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Community clients talk to /api/community rather than Supabase tables directly.
-- Keep only the minimum profile access needed for an authenticated user's own row.
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- Public content is served through /api/content; no direct table access is required.

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
