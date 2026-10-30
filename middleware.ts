import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from "@/lib/supabase/config";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isSponsorLoginPage = pathname === "/login/sponsor";
  const isAdminLoginPage = pathname === "/admin/login";
  const isLoginPage = pathname === "/login" || pathname.startsWith("/login/") || isAdminLoginPage;
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAuthCallback = pathname === "/auth/confirm";
  const isPasswordResetPage = pathname === "/passwort-zuruecksetzen";
  const isPasswordResetApi = pathname === "/api/auth/password-reset";
  const publicPages = new Set(["/", "/landing", "/demo", "/agb", "/impressum", "/datenschutz", "/kontakt"]);
  const isPublicPage = publicPages.has(pathname);
  const isPublicContactApi = pathname === "/api/contact";
  const isPublicReferralRoute = pathname.startsWith("/r/");
  const isPublicAsset = pathname === "/splow-icon.svg" || pathname === "/splow-logo.svg" || pathname.startsWith("/downloads/");
  const recoveryPending = request.cookies.get("splow-password-reset-required")?.value === "1";
  const recoverySafePath = isPasswordResetPage || isPasswordResetApi || isAuthCallback || isLoginPage || isPublicPage || isPublicContactApi || isPublicReferralRoute || isPublicAsset;

  if (recoveryPending && !recoverySafePath) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Setze zuerst dein Passwort zurück, um Splow weiter zu nutzen." }, { status: 423, headers: { "Cache-Control": "no-store" } });
    }
    const resetUrl = request.nextUrl.clone();
    resetUrl.pathname = "/passwort-zuruecksetzen";
    resetUrl.search = "";
    return NextResponse.redirect(resetUrl);
  }

  if (isAuthCallback || isPasswordResetPage || isPasswordResetApi || isPublicPage || isPublicContactApi || isPublicReferralRoute || isPublicAsset) {
    return NextResponse.next({ request });
  }
  if (!isSupabaseConfigured) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    global: {
      fetch: (input, init) => {
        const timeout = AbortSignal.timeout(8_000);
        return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
      },
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  let isAuthenticated = false;
  let userMetadata: Record<string, unknown> | undefined;
  try {
    const result = await supabase.auth.getClaims();
    if (result.error?.name === "AuthRetryableFetchError") throw result.error;
    isAuthenticated = Boolean(result.data?.claims.sub);
    userMetadata = result.data?.claims.user_metadata;

    // Refresh user details only where a stale JWT could affect a redirect.
    if (isAuthenticated && (isLoginPage || (userMetadata?.onboarding_completed === false && userMetadata?.account_type !== "sponsor"))) {
      const freshUser = await supabase.auth.getUser();
      if (freshUser.error?.name === "AuthRetryableFetchError") throw freshUser.error;
      isAuthenticated = Boolean(freshUser.data.user);
      userMetadata = freshUser.data.user?.user_metadata;
    }
  } catch (error) {
    console.error("Supabase Auth ist in der Middleware nicht erreichbar:", error);
    return new NextResponse("Die Anmeldung ist gerade nicht erreichbar. Bitte versuche es erneut.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "10" },
    });
  }

  if (!isAuthenticated && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = isAdminPage ? "/admin/login" : "/login";
    if (request.nextUrl.pathname === "/team/join") {
      const token = request.nextUrl.searchParams.get("token") ?? "";
      url.search = new URLSearchParams({ mode: "signup", next: `/team/join?token=${token}` }).toString();
    }
    return NextResponse.redirect(url);
  }

  const isOnboardingEndpoint = request.nextUrl.pathname === "/onboarding" || request.nextUrl.pathname === "/api/onboarding" || request.nextUrl.pathname === "/api/postal-code";
  const isInvitationAcceptance = request.nextUrl.pathname === "/team/join";
  const needsOrganizerOnboarding = isAuthenticated && userMetadata?.onboarding_completed === false && userMetadata?.account_type !== "sponsor";
  if (needsOrganizerOnboarding && !isOnboardingEndpoint && !isInvitationAcceptance && !isAuthCallback) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isAuthenticated && isLoginPage && !isSponsorLoginPage && !isAdminLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|references/|favicon.ico).*)"],
};
