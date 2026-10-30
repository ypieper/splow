import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordVerifiedContractSignaturePayment, recordVerifiedEventPackagePayment, verifyStripeWebhookSignature, type StripeCheckoutSession } from "@/lib/stripe-checkout";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  if (!verifyStripeWebhookSignature(payload, signature, secret)) {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  try {
    const event = JSON.parse(payload) as { id: string; type: string; data?: { object?: StripeCheckoutSession } };
    const session = event.data?.object;
    if (!session?.id) return NextResponse.json({ received: true });
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      if (session.payment_status === "paid") {
        if (session.metadata?.checkout_type === "event_package") {
          await recordVerifiedEventPackagePayment(session, event.id);
        } else {
          await recordVerifiedContractSignaturePayment(session);
        }
      }
    } else if (event.type === "checkout.session.expired") {
      const admin = createAdminClient();
      const { error } = await admin.rpc("expire_contract_signature_payment", { target_checkout_session_id: session.id });
      if (error) throw error;
    }
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
