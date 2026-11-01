import { NextResponse } from "next/server";
import { createStripeCheckoutSession, getStripeCheckoutSession } from "@/lib/stripe-checkout";
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

  const body = await request.json().catch(() => null) as {
    paymentType?: unknown;
    packageCode?: unknown;
    sponsorSlots?: unknown;
  } | null;
  const paymentType = body?.paymentType === "upgrade" || body?.paymentType === "sponsor_slots"
    ? body.paymentType
    : "initial";
  const packageCode = typeof body?.packageCode === "string" ? body.packageCode : null;
  const sponsorSlots = Number.isInteger(body?.sponsorSlots) ? Number(body?.sponsorSlots) : 0;
  if ((paymentType === "initial" || paymentType === "upgrade") && !["starter", "professional", "business"].includes(packageCode ?? "")) {
    return NextResponse.json({ error: "Bitte wähle ein gültiges Eventpaket aus." }, { status: 400 });
  }
  if (paymentType === "sponsor_slots" && (sponsorSlots < 1 || sponsorSlots > 500)) {
    return NextResponse.json({ error: "Bitte wähle eine gültige Anzahl zusätzlicher Sponsorenplätze aus." }, { status: 400 });
  }

  try {
    const { data: reservationRows, error: reservationError } = await supabase.rpc("reserve_event_product_payment", {
      target_event_id: eventId,
      target_payment_type: paymentType,
      target_plan_code: packageCode,
      target_sponsor_slots: sponsorSlots,
    });
    if (reservationError) {
      if (reservationError.message.includes("EVENT_ACCESS_DENIED")) return NextResponse.json({ error: "Du hast keinen Zugriff auf dieses Event." }, { status: 403 });
      if (reservationError.message.includes("EVENT_PAYMENT_ALREADY_PENDING")) return NextResponse.json({ error: "Für dieses Event läuft bereits ein Bezahlvorgang. Schließe ihn ab oder warte, bis er abgelaufen ist." }, { status: 409 });
      if (reservationError.message.includes("Upgrade must move")) return NextResponse.json({ error: "Bitte wähle ein höheres Paket für das Upgrade." }, { status: 409 });
      if (reservationError.message.includes("SPONSOR") || reservationError.message.includes("paid product")) return NextResponse.json({ error: reservationError.message }, { status: 409 });
      throw reservationError;
    }
    const reservation = Array.isArray(reservationRows) ? reservationRows[0] : reservationRows;
    if (!reservation?.payment_id || !reservation.amount_cents) throw new Error("Payment reservation missing");

    const admin = createAdminClient();
    const { data: paymentRow, error: paymentError } = await admin.from("event_product_payments")
      .select("stripe_checkout_session_id, amount_cents, payment_type, to_plan_code, sponsor_slots")
      .eq("id", reservation.payment_id)
      .single();
    if (paymentError) throw paymentError;

    let session = paymentRow.stripe_checkout_session_id
      ? await getStripeCheckoutSession(paymentRow.stripe_checkout_session_id)
      : null;
    if (!session) {
      const planNames: Record<string, string> = { starter: "Starter", professional: "Professional", business: "Business" };
      const description = paymentRow.payment_type === "upgrade"
        ? `Paketupgrade auf ${planNames[paymentRow.to_plan_code ?? ""] ?? "Splow"}`
        : paymentRow.payment_type === "sponsor_slots"
          ? `${paymentRow.sponsor_slots} zusätzliche Sponsorenplätze`
          : `Einmaliges Eventpaket${paymentRow.sponsor_slots ? ` mit ${paymentRow.sponsor_slots} zusätzlich berechneten Sponsorenplätzen` : ""}`;
      const baseUrl = publicBaseUrl(request);
      const returnUrl = new URL(`/events/${eventId}?tab=sponsoren`, baseUrl);
      returnUrl.searchParams.set("package_payment", "success");
      returnUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

      const form = new URLSearchParams();
      form.set("mode", "payment");
      form.set("ui_mode", "embedded_page");
      form.set("redirect_on_completion", "if_required");
      form.set("line_items[0][price_data][currency]", "eur");
      form.set("line_items[0][price_data][unit_amount]", String(paymentRow.amount_cents));
      form.set("line_items[0][price_data][product_data][name]", `Splow ${description}`);
      form.set("line_items[0][quantity]", "1");
      form.set("return_url", returnUrl.toString().replace(/%7BCHECKOUT_SESSION_ID%7D/i, "{CHECKOUT_SESSION_ID}"));
      form.set("client_reference_id", eventId);
      form.set("metadata[checkout_type]", "event_product_payment");
      form.set("metadata[event_id]", eventId);
      form.set("metadata[payment_id]", reservation.payment_id);
      session = await createStripeCheckoutSession(form, `event-product-${reservation.payment_id}`);
      if (!session.id || !session.client_secret) throw new Error("Stripe did not return an embedded Checkout client secret");
      const { error: saveError } = await admin.rpc("save_event_product_checkout", {
        target_payment_id: reservation.payment_id,
        target_session_id: session.id,
      });
      if (saveError) throw saveError;
    }

    if (!session?.id || !session.client_secret) throw new Error("Stripe did not return an embedded Checkout client secret");
    return NextResponse.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
      paymentId: reservation.payment_id,
      amountCents: paymentRow.amount_cents,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "STRIPE_SECRET_KEY is not configured") {
      return NextResponse.json({ error: "Stripe ist noch nicht konfiguriert. Bitte hinterlege STRIPE_SECRET_KEY in Vercel." }, { status: 503 });
    }
    console.error("[events/package-payment] Checkout start failed", error);
    return NextResponse.json({ error: "Der Bezahlvorgang konnte nicht gestartet werden. Bitte versuche es erneut." }, { status: 500 });
  }
}
