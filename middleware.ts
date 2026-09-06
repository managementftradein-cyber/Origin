import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes that require a signed-in, verified user.
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding"];
// Routes that additionally require role = 'admin'.
const ADMIN_PREFIXES = ["/admin"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
      global: {
        // Next.js patches the global fetch() to cache responses by default.
        // Supabase's client uses fetch() internally for every query,
        // including this one — without this, a profiles lookup right after
        // an update can silently return a stale cached result.
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: "no-store" }),
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // IMPORTANT: getUser() can refresh the session and attach the new
  // cookies onto `response` (via the setAll callback above). A bare
  // NextResponse.redirect(url) creates a brand-new response object that
  // does NOT carry those cookies — if a refresh just happened, the browser
  // is left holding a now-stale/rotated token, breaking the session
  // entirely on the very next request. Every redirect below must copy
  // `response`'s cookies onto itself.
  function redirect(url: URL) {
    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  const isProtected = PROTECTED_PREFIXES.some((p) =>
    request.nextUrl.pathname.startsWith(p)
  );
  const isAdminRoute = ADMIN_PREFIXES.some((p) =>
    request.nextUrl.pathname.startsWith(p)
  );

  if ((isProtected || isAdminRoute) && !user) {
    const redirectUrl = new URL("/auth/login", request.url);
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return redirect(redirectUrl);
  }

  // With Supabase's own "Confirm email" turned off, signUp() returns an
  // active session immediately — so a session alone doesn't mean the user
  // has actually confirmed their email via our own OTP flow. Check the
  // profile flag before letting them past onboarding/dashboard/admin.
  if ((isProtected || isAdminRoute) && user) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("email_verified, role")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("middleware profile lookup failed:", profileError.message);
    }

    if (!profile?.email_verified) {
      const redirectUrl = new URL("/auth/verify", request.url);
      redirectUrl.searchParams.set("email", user.email ?? "");
      redirectUrl.searchParams.set("userId", user.id);
      return redirect(redirectUrl);
    }

    // Admin routes need the role check too — a verified but ordinary user
    // gets bounced to their own dashboard, not shown an admin-specific error
    // page that would confirm the route even exists.
    if (isAdminRoute && profile.role !== "admin") {
      return redirect(new URL("/dashboard", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
