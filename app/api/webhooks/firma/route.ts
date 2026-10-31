import { after, NextResponse } from "next/server";
import { processFirmaWebhookQueue, type FirmaRecipientEvent, type FirmaWebhookPayload } from "@/lib/firma-webhook-jobs";
import { verifyFirmaWebhookSignature } from "@/lib/firma-webhook-signature";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

function normalizeRecipient(value: FirmaRecipientEvent): FirmaRecipientEvent {
  const text = (input: unknown, max: number) => typeof input === "string" ? input.slice(0, max) : undefined;
  return {
    email: text(value.email, 254),
    order: typeof value.order === "number" && Number.isInteger(value.order) ? value.order : undefined,
    designation: text(value.designation, 80),
    signed_at: text(value.signed_at, 80) ?? null,
    finished_on: text(value.finished_on, 80) ?? null,
    declined_on: text(value.declined_on, 80) ?? null,
    decline_reason: text(value.decline_reason, 1000) ?? null,
  };
}

function normalizedPayload(event: FirmaWebhookPayload, requestId: string): FirmaWebhookPayload {
  const recipients = Array.isArray(event.data?.recipients)
    ? event.data.recipients.filter((item): item is FirmaRecipientEvent => Boolean(item) && typeof item === "object").map(normalizeRecipient)
    : [];
  const recipient = event.data?.recipient && typeof event.data.recipient === "object"
    ? normalizeRecipient(event.data.recipient)
    : undefined;
  return {
    id: event.id,
    type: event.type,
    ...(typeof event.created_at === "string" ? { created_at: event.created_at.slice(0, 80) } : {}),
    data: {
      signing_request_id: requestId,
      signing_request: {
        id: requestId,
        completed_at: typeof event.data?.signing_request?.completed_at === "string" ? event.data.signing_request.completed_at.slice(0, 80) : null,
        cancelled_at: typeof event.data?.signing_request?.cancelled_at === "string" ? event.data.signing_request.cancelled_at.slice(0, 80) : null,
      },
      ...(recipient ? { recipient } : {}),
      recipients,
    },
  };
}

const supportedEvents = new Set([
  "signing_request.recipient.signed",
  "signing_request.completed",
  "signing_request.certificate.generated",
  "signing_request.recipient.declined",
  "signing_request.declined",
  "signing_request.cancelled",
]);

export async function POST(request: Request) {
  const secret = process.env.FIRMA_WEBHOOK_SECRET?.trim();
  const previousSecret = process.env.FIRMA_WEBHOOK_SECRET_OLD?.trim();
  if (!secret) return NextResponse.json({ error: "Webhook ist nicht konfiguriert." }, { status: 503 });

  const rawBody = await request.text();
  const signature = request.headers.get("x-firma-signature");
  const previousSignature = request.headers.get("x-firma-signature-old");
  const validSignature = verifyFirmaWebhookSignature(rawBody, signature, secret)
    || verifyFirmaWebhookSignature(rawBody, previousSignature, secret)
    || Boolean(previousSecret && (verifyFirmaWebhookSignature(rawBody, signature, previousSecret) || verifyFirmaWebhookSignature(rawBody, previousSignature, previousSecret)));
  if (!validSignature) {
    return NextResponse.json({ error: "Ungültige Webhook-Signatur." }, { status: 401 });
  }

  let event: FirmaWebhookPayload;
  try { event = JSON.parse(rawBody) as FirmaWebhookPayload; }
  catch { return NextResponse.json({ error: "Ungültiges Webhook-Format." }, { status: 400 }); }
  if (event.type === "webhook.test" || !event.id) return NextResponse.json({ received: true });
  if (!supportedEvents.has(event.type ?? "")) return NextResponse.json({ received: true });

  const requestId = event.data?.signing_request?.id ?? event.data?.signing_request_id;
  if (!requestId) return NextResponse.json({ received: true });

  try {
    const admin = createAdminClient();
    const { data: contract, error: contractError } = await admin.from("contracts")
      .select("id, signature_status").eq("signing_provider", "firma").eq("signing_request_id", requestId).maybeSingle();
    if (contractError) throw contractError;
    if (!contract || contract.signature_status === "draft") return NextResponse.json({ received: true });

    const { data: jobRows, error: enqueueError } = await admin.rpc("enqueue_firma_webhook_job", {
      target_event_id: event.id,
      target_signing_request_id: requestId,
      target_event_type: event.type,
      target_event_payload: normalizedPayload(event, requestId),
    });
    if (enqueueError) throw enqueueError;
    const job = Array.isArray(jobRows) ? jobRows[0] as { job_id?: string; job_status?: string } | undefined : undefined;
    if (!job?.job_id) throw new Error("Der Firma-Webhook konnte nicht dauerhaft vorgemerkt werden.");

    if (job.job_status !== "completed") {
      after(async () => {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const result = await processFirmaWebhookQueue({ jobId: job.job_id });
            if (result.claimed === 0 || result.completed > 0 || result.failed > 0 || result.pending === 0) return;
          } catch (error) {
            console.error("Firma webhook queue processing failed", { eventId: event.id, attempt, error });
            return;
          }
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Firma webhook queue submission failed", { eventId: event.id, error });
    return NextResponse.json({ error: "Webhook konnte nicht sicher vorgemerkt werden." }, { status: 500 });
  }
}
