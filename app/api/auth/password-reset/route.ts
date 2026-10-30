import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/config";

const recoveryCookieName = "splow-password-recovery";

function clearRecoveryCookie(response: NextResponse, request: NextRequest) {
  response.cookies.set(recoveryCookieName, "", {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "strict",
    path: "/api/auth/password-reset",
    maxAge: 0,
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 403 });
  }

  const proof = request.cookies.get(recoveryCookieName)?.value ?? "";
  const proofKind = proof.slice(0, 2);
  let proofValue = "";
  try {
    if (proofKind === "c.") proofValue = decodeURIComponent(proof.slice(2));
    if (proofKind === "t.") proofValue = decodeURIComponent(proof.slice(2));
  } catch {
    proofValue = "";
  }
  if (!proofValue || !supabaseUrl || !supabasePublishableKey) {
    return NextResponse.json({ error: "Der Reset-Link ist ungültig oder abgelaufen. Fordere bitte einen neuen an." }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({})) as { password?: unknown };
  if (typeof payload.password !== "string" || payload.password.length < 8) {
    return NextResponse.json({ error: "Das Passwort muss mindestens 8 Zeichen lang sein." }, { status: 400 });
  }

  const cookieJar = new Map(request.cookies.getAll().map(({ name, value }) => [name, value]));
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => {
          if (value) cookieJar.set(name, value);
          else cookieJar.delete(name);
        });
      },
    },
  });

  const verification = proofKind === "c."
    ? await supabase.auth.exchangeCodeForSession(proofValue)
    : await supabase.auth.verifyOtp({ token_hash: proofValue, type: "recovery" });
  if (verification.error) {
    const response = NextResponse.json({ error: "Der Reset-Link ist ungültig oder abgelaufen. Fordere bitte einen neuen an." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    clearRecoveryCookie(response, request);
    return response;
  }

  const { error } = await supabase.auth.updateUser({ password: payload.password });
  if (error) {
    const response = NextResponse.json({ error: "Das Passwort konnte nicht geändert werden. Fordere bitte einen neuen Reset-Link an." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    clearRecoveryCookie(response, request);
    return response;
  }

  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  clearRecoveryCookie(response, request);
  return response;
}
