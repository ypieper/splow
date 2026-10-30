import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { downloadFirmaSignedPdf } from "@/lib/firma-signing";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type FirmaRecipientEvent = { order?: number; designation?: string; signed_at?: string | null };
type FirmaEvent = {
  id?: string;
  type?: string;
  data?: {
    signing_request?: { id?: string; completed_at?: string | null };
    signing_request_id?: string;
    recipient?: FirmaRecipientEvent;
    recipients?: FirmaRecipientEvent[];
  };
};

function signatureMatches(rawBody: string, header: string | null, secret: string) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? ["", ""] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !/^\d+$/.test(timestamp) || !signature || !/^[a-f\d]{64}$/i.test(signature)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function saveFirmaPdf(admin: ReturnType<typeof createAdminClient>, contract: { id: string; signing_request_id: string }, source: { file_name: string; storage_path: string }, organizationId: string) {
  const { data: existing, error: existingError } = await admin.from("contract_documents")
    .select("id").eq("contract_id", contract.id).eq("kind", "signed").maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) {
    await admin.from("contracts").update({ signing_document_id: existing.id }).eq("id", contract.id).eq("signature_status", "signed");
    return;
  }

  const signedPdf = await downloadFirmaSignedPdf(contract.signing_request_id);
  const baseName = source.file_name.replace(/\.pdf$/i, "");
  const fileName = `${baseName}_gezeichnet.pdf`;
  const storagePath = `${organizationId}/contracts/${contract.id}/signed-firma-${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
  const { error: uploadError } = await admin.storage.from("sponsorproof-files").upload(storagePath, signedPdf, { contentType: "application/pdf", upsert: false });
  if (uploadError) throw uploadError;
  const { data: inserted, error: insertError } = await admin.from("contract_documents").insert({
    organization_id: organizationId,
    contract_id: contract.id,
    kind: "signed",
    storage_path: storagePath,
    file_name: fileName,
    content_type: "application/pdf",
  }).select("id").single();
  if (insertError || !inserted) {
    await admin.storage.from("sponsorproof-files").remove([storagePath]);
    throw insertError ?? new Error("Die gezeichnete PDF konnte nicht gespeichert werden.");
  }
  const { error: updateError } = await admin.from("contracts").update({ signing_document_id: inserted.id })
    .eq("id", contract.id).eq("signature_status", "signed");
  if (updateError) throw updateError;
}

export async function POST(request: Request) {
  const secret = process.env.FIRMA_WEBHOOK_SECRET?.trim();
  const previousSecret = process.env.FIRMA_WEBHOOK_SECRET_OLD?.trim();
  if (!secret) return NextResponse.json({ error: "Webhook ist nicht konfiguriert." }, { status: 503 });

  const rawBody = await request.text();
  const signature = request.headers.get("x-firma-signature");
  const previousSignature = request.headers.get("x-firma-signature-old");
  const validSignature = signatureMatches(rawBody, signature, secret)
    || signatureMatches(rawBody, previousSignature, secret)
    || Boolean(previousSecret && (signatureMatches(rawBody, signature, previousSecret) || signatureMatches(rawBody, previousSignature, previousSecret)));
  if (!validSignature) {
    return NextResponse.json({ error: "Ungültige Webhook-Signatur." }, { status: 401 });
  }

  let event: FirmaEvent;
  try { event = JSON.parse(rawBody) as FirmaEvent; }
  catch { return NextResponse.json({ error: "Ungültiges Webhook-Format." }, { status: 400 }); }
  if (event.type === "webhook.test" || !event.id) return NextResponse.json({ received: true });
  if (!["signing_request.recipient.signed", "signing_request.completed"].includes(event.type ?? "")) return NextResponse.json({ received: true });

  try {
    const requestId = event.data?.signing_request?.id ?? event.data?.signing_request_id;
    if (!requestId) return NextResponse.json({ received: true });
    const admin = createAdminClient();
    const { data: contract, error: contractError } = await admin.from("contracts")
      .select("id, event_id, sponsor_id, signature_status, signing_document_id, signing_request_id")
      .eq("signing_provider", "firma").eq("signing_request_id", requestId).maybeSingle();
    if (contractError) throw contractError;
    if (!contract || contract.signature_status === "draft") return NextResponse.json({ received: true });
    const { data: paidPayment, error: paymentError } = await admin.from("contract_signature_payments")
      .select("id").eq("contract_id", contract.id).eq("payment_status", "paid").limit(1).maybeSingle();
    if (paymentError) throw paymentError;
    if (!paidPayment) return NextResponse.json({ received: true });

    let recipients = event.data?.recipients ?? [];
    if (event.type === "signing_request.recipient.signed" && event.data?.recipient) recipients = [...recipients, event.data.recipient];
    if (event.type === "signing_request.completed" && recipients.length === 0) {
      recipients = [{ order: 1, designation: "Signer", signed_at: event.data?.signing_request?.completed_at }, { order: 2, designation: "Signer", signed_at: event.data?.signing_request?.completed_at }];
    }
    for (const recipient of recipients.filter((item) => item.designation?.toLowerCase() === "signer" && item.signed_at).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      const signerRole = recipient.order === 1 ? "sponsor" : recipient.order === 2 ? "organizer" : null;
      if (!signerRole) continue;
      const { error: recordError } = await admin.rpc("record_contract_signature", {
        target_contract_id: contract.id,
        signer_role: signerRole,
        occurred_at: recipient.signed_at,
      });
      if (recordError) throw recordError;
    }

    if (event.type === "signing_request.completed") {
      after(async () => {
        try {
          const [{ data: currentContract, error: currentError }, { data: eventData, error: eventError }, { data: source, error: sourceError }] = await Promise.all([
            admin.from("contracts").select("id, event_id, signature_status, signing_document_id").eq("id", contract.id).maybeSingle(),
            admin.from("events").select("organization_id").eq("id", contract.event_id).maybeSingle(),
            contract.signing_document_id ? admin.from("contract_documents").select("file_name, storage_path").eq("id", contract.signing_document_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
          ]);
          if (currentError || eventError || sourceError) throw currentError ?? eventError ?? sourceError;
          if (currentContract?.signature_status === "signed" && eventData?.organization_id && source) {
            await saveFirmaPdf(admin, { id: currentContract.id, signing_request_id: requestId }, source, eventData.organization_id);
          }
        } catch (error) {
          console.error("Firma signed PDF storage failed", error);
        }
      });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Firma webhook processing failed", error);
    return NextResponse.json({ error: "Webhook-Verarbeitung fehlgeschlagen." }, { status: 500 });
  }
}
