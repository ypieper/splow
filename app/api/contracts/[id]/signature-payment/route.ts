import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createStripeCheckoutSession,
  getStripeCheckoutSession,
  recordVerifiedContractSignaturePayment,
} from "@/lib/stripe-checkout";

type Context = { params: Promise<{ id: string }> };
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function publicBaseUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const deployment = process.env.VERCEL_URL;
  if (deployment) return `https://${deployment}`;
  return new URL(request.url).origin;
}

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Ungültiger Vertrag." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data: contract } = await admin.from("contracts").select("event_id").eq("id", id).maybeSingle();
    if (!contract) return NextResponse.json({ error: "Der Vertrag wurde nicht gefunden." }, { status: 404 });
    const { data: ownsEvent, error: ownsError } = await supabase.rpc("owns_event", { target_event_id: contract.event_id });
    if (ownsError) throw ownsError;
    if (!ownsEvent) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });
    const { data: price, error: priceError } = await admin.from("contract_signature_pricing")
      .select("amount_cents, currency").eq("singleton", true).single();
    if (priceError) throw priceError;
    const { data: paidPayment, error: paymentError } = await admin.from("contract_signature_payments")
      .select("signing_document_id").eq("contract_id", id).eq("payment_status", "paid").limit(1).maybeSingle();
    if (paymentError) throw paymentError;
    return NextResponse.json({ amountCents: price.amount_cents, currency: price.currency, paidSigningDocumentId: paidPayment?.signing_document_id ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Der Preis für die Vertragszeichnung konnte nicht geladen werden." }, { status: 503 });
  }
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Ungültiger Vertrag." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data: contract, error: contractError } = await admin.from("contracts")
      .select("id, event_id, sponsor_id, signature_status, signing_document_id")
      .eq("id", id).maybeSingle();
    if (contractError || !contract) return NextResponse.json({ error: "Der Vertrag wurde nicht gefunden." }, { status: 404 });
    const { data: ownsEvent, error: ownsError } = await supabase.rpc("owns_event", { target_event_id: contract.event_id });
    if (ownsError) throw ownsError;
    if (!ownsEvent) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });
    if (!(["draft", "pending_sponsor", "pending_organizer"].includes(contract.signature_status)) || (contract.signature_status !== "draft" && !contract.signing_document_id)) {
      return NextResponse.json({ error: "Der Vertrag ist nicht zur Zahlung bereit." }, { status: 409 });
    }
    const { data: enabled, error: entitlementError } = await admin.rpc("event_signature_addon_enabled", { target_event_id: contract.event_id });
    if (entitlementError) throw entitlementError;
    if (!enabled) return NextResponse.json({ error: "Für dieses Event ist noch kein Vertragspaket freigeschaltet." }, { status: 403 });

    const payload = await request.json().catch(() => ({})) as { returnTo?: string; signingDocumentId?: string };
    if (typeof payload.signingDocumentId !== "string" || !isUuid(payload.signingDocumentId)) {
      return NextResponse.json({ error: "Bitte wähle zuerst eine Vertrags-PDF aus." }, { status: 400 });
    }
    const { data: signingDocument, error: signingDocumentError } = await admin.from("contract_documents")
      .select("id").eq("id", payload.signingDocumentId).eq("contract_id", id)
      .in("kind", ["generated_pdf", "uploaded_pdf"]).maybeSingle();
    if (signingDocumentError) throw signingDocumentError;
    if (!signingDocument) return NextResponse.json({ error: "Die gewählte Vertrags-PDF wurde nicht gefunden." }, { status: 404 });
    const returnTo = typeof payload.returnTo === "string" && payload.returnTo.startsWith("/") && !payload.returnTo.startsWith("//")
      ? payload.returnTo
      : "/dashboard";
    const { data: reservationData, error: reservationError } = await admin.rpc("reserve_contract_signature_payment", {
      target_contract_id: id,
      target_signing_document_id: payload.signingDocumentId,
    });
    if (reservationError) throw reservationError;
    const reservation = Array.isArray(reservationData) ? reservationData[0] : reservationData;
    if (!reservation?.payment_id) throw new Error("Payment reservation could not be created");
    if (reservation.payment_status === "paid") {
      if (reservation.signing_document_id !== payload.signingDocumentId) {
        return NextResponse.json({ error: "Die Gebühr wurde bereits für eine andere PDF dieses Vertrags bezahlt." }, { status: 409 });
      }
      return NextResponse.json({ alreadyPaid: true });
    }

    let sessionId = reservation.stripe_checkout_session_id as string | null;
    let checkoutUrl = reservation.stripe_checkout_url as string | null;
    if (sessionId) {
      const existing = await getStripeCheckoutSession(sessionId);
      if (existing.status === "complete" && existing.payment_status === "paid") {
        await recordVerifiedContractSignaturePayment(existing);
        return NextResponse.json({ alreadyPaid: true });
      }
      if (existing.status === "complete") {
        return NextResponse.json({ error: "Die Zahlung wird noch verarbeitet. Bitte warte auf die Bestätigung von Stripe." }, { status: 409 });
      }
      if (existing.status === "expired") {
        await admin.rpc("expire_contract_signature_payment", { target_checkout_session_id: sessionId });
        const { data: nextData, error: nextError } = await admin.rpc("reserve_contract_signature_payment", {
          target_contract_id: id,
          target_signing_document_id: payload.signingDocumentId,
        });
        if (nextError) throw nextError;
        const next = Array.isArray(nextData) ? nextData[0] : nextData;
        if (!next?.payment_id) throw new Error("Payment reservation could not be created");
        if (next.payment_status === "paid") {
          if (next.signing_document_id !== payload.signingDocumentId) {
            return NextResponse.json({ error: "Die Gebühr wurde bereits für eine andere PDF dieses Vertrags bezahlt." }, { status: 409 });
          }
          return NextResponse.json({ alreadyPaid: true });
        }
        reservation.payment_id = next.payment_id;
        reservation.amount_cents = next.amount_cents;
        reservation.signing_document_id = next.signing_document_id;
        sessionId = next.stripe_checkout_session_id;
        checkoutUrl = next.stripe_checkout_url;
      } else if (existing.status === "open" && checkoutUrl) {
        if (reservation.signing_document_id !== payload.signingDocumentId) {
          return NextResponse.json({ error: "Für diesen Vertrag läuft bereits eine Zahlung für eine andere PDF. Bitte schließe oder beende zuerst diesen Bezahlvorgang." }, { status: 409 });
        }
        return NextResponse.json({ url: checkoutUrl, amountCents: reservation.amount_cents });
      }
    }

    if (reservation.signing_document_id !== payload.signingDocumentId) {
      return NextResponse.json({ error: "Für diesen Vertrag läuft bereits eine Zahlung für eine andere PDF. Bitte schließe oder beende zuerst diesen Bezahlvorgang." }, { status: 409 });
    }

    if (!sessionId || !checkoutUrl) {
      const baseUrl = publicBaseUrl(request);
      const success = new URL(returnTo, baseUrl);
      success.searchParams.set("signature_payment", "success");
      success.searchParams.set("contract_id", id);
      success.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
      const cancel = new URL(returnTo, baseUrl);
      cancel.searchParams.set("signature_payment", "cancelled");
      cancel.searchParams.set("contract_id", id);
      const form = new URLSearchParams();
      form.set("mode", "payment");
      form.set("line_items[0][price_data][currency]", "eur");
      form.set("line_items[0][price_data][unit_amount]", String(reservation.amount_cents));
      form.set("line_items[0][price_data][product_data][name]", "Digitale Vertragszeichnung");
      form.set("line_items[0][price_data][product_data][description]", "Einmalige Zahlung vor Freigabe zur digitalen Vertragszeichnung");
      form.set("line_items[0][quantity]", "1");
      form.set("success_url", success.toString().replace(/%7BCHECKOUT_SESSION_ID%7D/i, "{CHECKOUT_SESSION_ID}"));
      form.set("cancel_url", cancel.toString());
      form.set("client_reference_id", id);
      form.set("metadata[contract_id]", id);
      form.set("metadata[payment_id]", reservation.payment_id);
      form.set("metadata[event_id]", contract.event_id);
      if (user.email) form.set("customer_email", user.email);
      const created = await createStripeCheckoutSession(form, `contract-signature-${reservation.payment_id}`);
      if (!created.id || !created.url) throw new Error("Stripe did not return a Checkout URL");
      const { error: saveError } = await admin.rpc("save_contract_signature_checkout", {
        target_payment_id: reservation.payment_id,
        target_checkout_session_id: created.id,
        target_checkout_url: created.url,
      });
      if (saveError) throw saveError;
      sessionId = created.id;
      checkoutUrl = created.url;
    }
    return NextResponse.json({ url: checkoutUrl, amountCents: reservation.amount_cents });
  } catch (error) {
    if (error instanceof Error && error.message === "STRIPE_SECRET_KEY is not configured") {
      return NextResponse.json({ error: "Stripe ist noch nicht konfiguriert. Bitte hinterlege STRIPE_SECRET_KEY in Vercel." }, { status: 503 });
    }
    console.error("[contracts/signature-payment] Checkout start failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Der Bezahlvorgang konnte nicht gestartet werden. Bitte versuche es erneut." }, { status: 500 });
  }
}
