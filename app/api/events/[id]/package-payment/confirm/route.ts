import { NextResponse } from "next/server";
import { getStripeCheckoutSession, recordVerifiedEventProductPayment } from "@/lib/stripe-checkout";
import { createClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string }> };
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function POST(request: Request, context: Context) {
  const { id: eventId } = await context.params;
  if (!isUuid(eventId)) return NextResponse.json({ error: "Ungültiges Event." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });
  const { data: ownsEvent, error: accessError } = await supabase.rpc("owns_event", { target_event_id: eventId });
  if (accessError) return NextResponse.json({ error: "Der Zugriff auf das Event konnte nicht geprüft werden." }, { status: 503 });
  if (!ownsEvent) return NextResponse.json({ error: "Du hast keinen Zugriff auf dieses Event." }, { status: 403 });

  const body = await request.json().catch(() => null) as { sessionId?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return NextResponse.json({ error: "Die Stripe-Zahlung konnte nicht zugeordnet werden." }, { status: 400 });

  try {
    const session = await getStripeCheckoutSession(sessionId);
    if (session.metadata?.event_id !== eventId || session.metadata?.checkout_type !== "event_product_payment") {
      return NextResponse.json({ error: "Die Zahlung gehört nicht zu diesem Event." }, { status: 400 });
    }
    if (session.status !== "complete" || session.payment_status !== "paid") {
      return NextResponse.json({ error: "Die Zahlung wird noch von Stripe bestätigt." }, { status: 409 });
    }
    await recordVerifiedEventProductPayment(session, `checkout-confirm:${session.id}`);
    return NextResponse.json({ confirmed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[events/package-payment] Return confirmation failed", error);
    return NextResponse.json({ error: "Das Eventpaket konnte noch nicht freigeschaltet werden. Bitte lade die Eventseite erneut." }, { status: 503 });
  }
}
