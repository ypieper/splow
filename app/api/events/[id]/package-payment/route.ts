import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createStripeCheckoutSession } from "@/lib/stripe-checkout";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string }> };
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function publicBaseUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const deployment = process.env.VERCEL_URL;
  if (deployment) return `https://${deployment}`;
  return new URL(request.url).origin;
}

export async function POST(request: Request, context: Context) {
  const { id: eventId } = await context.params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "Ungültiges Event." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  const body = await request.json().catch(() => null) as { packageCode?: unknown } | null;
  const packageCode = typeof body?.packageCode === "string" ? body.packageCode : "";
  if (!/^contracts_(5|7|10|15)$/.test(packageCode)) {
    return NextResponse.json({ error: "Bitte wähle ein gültiges Eventpaket aus." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { data: ownsEvent, error: accessError } = await supabase.rpc("owns_event", { target_event_id: eventId });
    if (accessError) throw accessError;
    if (!ownsEvent) return NextResponse.json({ error: "Du hast keinen Zugriff auf dieses Event." }, { status: 403 });

    const [{ data: event, error: eventError }, { data: packageRow, error: packageError }, { data: existingBooking, error: bookingError }, { data: entitlement, error: entitlementError }] = await Promise.all([
      admin.from("events").select("organization_id").eq("id", eventId).maybeSingle(),
      admin.from("event_contract_packages").select("code, name, max_contracts, base_amount_cents").eq("code", packageCode).eq("is_active", true).maybeSingle(),
      admin.from("event_contract_package_bookings").select("event_id").eq("event_id", eventId).maybeSingle(),
      admin.from("event_entitlements").select("plan_code, entitlement_status").eq("event_id", eventId).maybeSingle(),
    ]);
    if (eventError) throw eventError;
    if (packageError) throw packageError;
    if (bookingError) throw bookingError;
    if (entitlementError) throw entitlementError;
    if (!event || !packageRow) return NextResponse.json({ error: "Das Event oder das Paket wurde nicht gefunden." }, { status: 404 });
    if (existingBooking) return NextResponse.json({ error: "Für dieses Event ist bereits ein Paket gebucht." }, { status: 409 });
    if (entitlement?.entitlement_status === "active" && ["event", "event_pro"].includes(entitlement.plan_code)) {
      return NextResponse.json({ error: "Für dieses Event ist bereits ein Tarif freigeschaltet." }, { status: 409 });
    }

    const { data: organizationEntitlement, error: organizationError } = await admin.from("organization_entitlements")
      .select("is_active, expires_at").eq("organization_id", event.organization_id).maybeSingle();
    if (organizationError) throw organizationError;
    if (organizationEntitlement?.is_active && new Date(organizationEntitlement.expires_at).getTime() > Date.now()) {
      return NextResponse.json({ error: "Für deinen Veranstalterbereich ist bereits Enterprise freigeschaltet." }, { status: 409 });
    }

    const [{ count: sponsorCount, error: sponsorsError }, { count: contractCount, error: contractsError }] = await Promise.all([
      admin.from("event_sponsors").select("sponsor_id", { count: "exact", head: true }).eq("event_id", eventId),
      admin.from("contracts").select("id", { count: "exact", head: true }).eq("event_id", eventId),
    ]);
    if (sponsorsError) throw sponsorsError;
    if (contractsError) throw contractsError;
    if ((sponsorCount ?? 0) > packageRow.max_contracts || (contractCount ?? 0) > packageRow.max_contracts) {
      return NextResponse.json({ error: "Das gewählte Paket ist kleiner als die Anzahl der bereits angelegten Sponsoren oder Verträge." }, { status: 409 });
    }

    const baseUrl = publicBaseUrl(request);
    const returnPath = `/events/${eventId}?tab=sponsoren`;
    const returnUrl = new URL(returnPath, baseUrl);
    returnUrl.searchParams.set("package_payment", "success");
    returnUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("ui_mode", "embedded_page");
    form.set("redirect_on_completion", "if_required");
    form.set("line_items[0][price_data][currency]", "eur");
    form.set("line_items[0][price_data][unit_amount]", String(packageRow.base_amount_cents));
    form.set("line_items[0][price_data][product_data][name]", `Splow ${packageRow.name}`);
    form.set("line_items[0][price_data][product_data][description]", `Einmaliges Paket für dieses Event, bis zu ${packageRow.max_contracts} Sponsoren`);
    form.set("line_items[0][quantity]", "1");
    form.set("return_url", returnUrl.toString().replace(/%7BCHECKOUT_SESSION_ID%7D/i, "{CHECKOUT_SESSION_ID}"));
    form.set("client_reference_id", eventId);
    form.set("metadata[checkout_type]", "event_package");
    form.set("metadata[event_id]", eventId);
    form.set("metadata[package_code]", packageRow.code);
    form.set("metadata[organization_id]", event.organization_id);
    if (user.email) form.set("customer_email", user.email);

    const session = await createStripeCheckoutSession(form, `event-package-${eventId}-${randomUUID()}`);
    if (!session.id || !session.client_secret) throw new Error("Stripe did not return an embedded Checkout client secret");
    return NextResponse.json({ clientSecret: session.client_secret, sessionId: session.id, amountCents: packageRow.base_amount_cents }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "STRIPE_SECRET_KEY is not configured") {
      return NextResponse.json({ error: "Stripe ist noch nicht konfiguriert. Bitte hinterlege STRIPE_SECRET_KEY in Vercel." }, { status: 503 });
    }
    console.error("[events/package-payment] Checkout start failed", error);
    return NextResponse.json({ error: "Der Bezahlvorgang konnte nicht gestartet werden. Bitte versuche es erneut." }, { status: 500 });
  }
}
