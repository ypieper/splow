import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const next = request.nextUrl.searchParams.get("next");
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const flow = request.nextUrl.searchParams.get("flow");
  const authType = request.nextUrl.searchParams.get("type");
  const isRecovery = flow === "recovery" || authType === "recovery" || destination.split("?")[0] === "/passwort-zuruecksetzen";

  if (isRecovery) {
    if (!code && !tokenHash) {
      return NextResponse.redirect(new URL("/passwort-zuruecksetzen?link=invalid", request.url));
    }
    const proof = code ? `c.${encodeURIComponent(code)}` : `t.${encodeURIComponent(tokenHash!)}`;
    const response = NextResponse.redirect(new URL("/passwort-zuruecksetzen", request.url));
    response.cookies.set("splow-password-recovery", proof, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "strict",
      path: "/api/auth/password-reset",
      maxAge: 10 * 60,
    });
    return response;
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (destination === "/login/sponsor?setup=1") {
        const { data: { user } } = await supabase.auth.getUser();
        const companyName = typeof user?.user_metadata?.sponsor_company_name === "string"
          ? user.user_metadata.sponsor_company_name.trim()
          : "";
        const isSponsorRegistration = user?.user_metadata?.account_type === "sponsor" && companyName.length > 0;
        if (!isSponsorRegistration) {
          return NextResponse.redirect(new URL("/login/sponsor?registration=setup-failed", request.url));
        }
        const { error: accountError } = await supabase.rpc("create_sponsor_account", { account_name: companyName });
        if (accountError) return NextResponse.redirect(new URL("/login/sponsor?registration=setup-failed", request.url));
        return NextResponse.redirect(new URL("/sponsor", request.url));
      }
      return NextResponse.redirect(new URL(destination, request.url));
    }
  }

  const failurePath = destination === "/login/sponsor?setup=1"
    ? "/login/sponsor?registration=confirmation-failed"
    : "/login/veranstalter?confirmation=failed";
  return NextResponse.redirect(new URL(failurePath, request.url));
}
