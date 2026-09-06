import { createBrowserClient } from "@supabase/ssr";

// Client used in Client Components ("use client" files).
// Reads the public env vars — safe to expose to the browser.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
