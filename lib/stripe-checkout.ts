import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const stripeApi = "https://api.stripe.com/v1";
const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? "";

export type StripeCheckoutSession = {
  id: string;
  client_secret?: string | null;
  url: string | null;
  status: "open" | "complete" | "expired" | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  payment_intent: string | { id: string } | null;
  amount_total: number | null;
  currency: string | null;
  mode: string;
  metadata: Record<string, string>;
};

export async function stripeApiRequest<T>(path: string, init: RequestInit = {}) {
  if (!stripeSecretKey) throw new Error("STRIPE_SECRET_KEY is not configured");
  const response = await fetch(`${stripeApi}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  const result = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message ?? "Stripe request failed");
  return result;
}

export function createStripeCheckoutSession(body: URLSearchParams, idempotencyKey: string) {
  return stripeApiRequest<StripeCheckoutSession>("/checkout/sessions", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body,
  });
}

export function getStripeCheckoutSession(sessionId: string) {
  return stripeApiRequest<StripeCheckoutSession>(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

export async function recordVerifiedContractSignaturePayment(session: StripeCheckoutSession) {
  if (session.mode !== "payment" || session.payment_status !== "paid" || !session.amount_total || !session.currency) {
    throw new Error("Stripe payment is not complete");
  }
  const contractId = session.metadata?.contract_id;
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!contractId || !paymentIntentId) throw new Error("Stripe payment metadata is incomplete");

  const admin = createAdminClient();
  const { error } = await admin.rpc("record_contract_signature_payment", {
    target_checkout_session_id: session.id,
    target_payment_intent_id: paymentIntentId,
    target_paid_amount_cents: session.amount_total,
    target_currency: session.currency,
  });
  if (error) throw error;
  return contractId;
}

export async function recordVerifiedEventPackagePayment(session: StripeCheckoutSession, providerEventId: string) {
  if (session.mode !== "payment" || session.payment_status !== "paid" || !session.amount_total || session.currency !== "eur") {
    throw new Error("Stripe event package payment is not complete");
  }
  const eventId = session.metadata?.event_id;
  const packageCode = session.metadata?.package_code;
  if (session.metadata?.checkout_type !== "event_package" || !eventId || !packageCode) {
    throw new Error("Stripe event package metadata is incomplete");
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("record_confirmed_event_package_payment", {
    target_event_id: eventId,
    target_package_code: packageCode,
    target_signature_addon: false,
    target_paid_amount_cents: session.amount_total,
    target_payment_reference: session.id,
    target_provider_event_id: providerEventId,
  });
  if (error) throw error;
  return eventId;
}

export async function recordVerifiedEventProductPayment(session: StripeCheckoutSession, providerEventId: string) {
  if (session.mode !== "payment" || session.payment_status !== "paid" || session.amount_total === null || session.currency !== "eur") {
    throw new Error("Stripe event product payment is not complete");
  }
  const paymentId = session.metadata?.payment_id;
  const eventId = session.metadata?.event_id;
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (session.metadata?.checkout_type !== "event_product_payment" || !paymentId || !eventId || !paymentIntentId) {
    throw new Error("Stripe event product payment metadata is incomplete");
  }

  const admin = createAdminClient();
  const { data: payment, error: paymentError } = await admin.from("event_product_payments")
    .select("event_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (paymentError) throw paymentError;
  if (!payment || payment.event_id !== eventId) throw new Error("Stripe event product payment does not match its reservation");

  const { error } = await admin.rpc("record_event_product_payment", {
    target_payment_id: paymentId,
    target_session_id: session.id,
    target_payment_intent_id: paymentIntentId,
    target_paid_amount_cents: session.amount_total,
    target_currency: session.currency,
    target_provider_event_id: providerEventId,
  });
  if (error) throw error;
  return eventId;
}

export function verifyStripeWebhookSignature(payload: string, header: string, secret: string) {
  const parts = header.split(",").map((part) => part.split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value).filter(Boolean);
  if (!timestamp || !signatures.length || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest();
  return signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}
