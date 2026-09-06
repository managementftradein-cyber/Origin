import { createClient } from "@/lib/supabase/server";

/**
 * Checks the CALLER's own session (via the regular RLS-respecting client —
 * a user can always read their own `role` column) to confirm they're an
 * admin. Returns the user if so, or null otherwise. Callers should redirect
 * or return 403 when this returns null — it never throws.
 *
 * This is intentionally the only gate. Admin routes then use the
 * service-role client (lib/supabase/admin.ts) for the actual privileged
 * read/write on OTHER users' data, rather than adding RLS policies that
 * would let the `authenticated` role query everyone's rows directly.
 */
export async function requireAdminUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") return null;

  return user;
}
