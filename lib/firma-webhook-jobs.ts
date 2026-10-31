import "server-only";

import { randomUUID } from "node:crypto";
import { downloadFirmaSignedPdf, getFirmaSigningUsers } from "@/lib/firma-signing";
import { createAdminClient } from "@/lib/supabase/admin";

export type FirmaRecipientEvent = {
  email?: string;
  order?: number;
  designation?: string;
  signed_at?: string | null;
  finished_on?: string | null;
  declined_on?: string | null;
  decline_reason?: string | null;
};

export type FirmaWebhookPayload = {
  id: string;
  type: string;
  created_at?: string;
  data?: {
    signing_request?: { id?: string; completed_at?: string | null; cancelled_at?: string | null };
    signing_request_id?: string;
    recipient?: FirmaRecipientEvent;
    recipients?: FirmaRecipientEvent[];
  };
};

type FirmaWebhookJob = {
  job_id: string;
  provider_event_id: string;
  signing_request_id: string;
  event_type: string;
  event_payload: FirmaWebhookPayload;
  attempts: number;
};

async function saveFirmaPdf(
  admin: ReturnType<typeof createAdminClient>,
  contract: { id: string; signing_request_id: string },
  source: { file_name: string; storage_path: string },
  organizationId: string,
  refreshExisting = false,
) {
  const { data: existing, error: existingError } = await admin.from("contract_documents")
    .select("id, storage_path").eq("contract_id", contract.id).eq("kind", "signed").maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id && !refreshExisting) {
    const { error } = await admin.from("contracts").update({ signing_document_id: existing.id })
      .eq("id", contract.id).eq("signature_status", "signed");
    if (error) throw error;
    return;
  }

  const signedPdf = await downloadFirmaSignedPdf(contract.signing_request_id);
  const baseName = source.file_name.replace(/(?:_gezeichnet)+\.pdf$/i, "").replace(/\.pdf$/i, "");
  const fileName = `${baseName}_gezeichnet.pdf`;
  const storagePath = `${organizationId}/contracts/${contract.id}/signed-firma-${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
  const { error: uploadError } = await admin.storage.from("sponsorproof-files").upload(storagePath, signedPdf, { contentType: "application/pdf", upsert: false });
  if (uploadError) throw uploadError;
  if (existing?.id) {
    const { error: replaceError } = await admin.from("contract_documents").update({
      storage_path: storagePath,
      file_name: fileName,
      content_type: "application/pdf",
    }).eq("id", existing.id);
    if (replaceError) {
      await admin.storage.from("sponsorproof-files").remove([storagePath]);
      throw replaceError;
    }
    const { error: pointerError } = await admin.from("contracts").update({ signing_document_id: existing.id })
      .eq("id", contract.id).eq("signature_status", "signed");
    if (pointerError) throw pointerError;
    if (existing.storage_path) await admin.storage.from("sponsorproof-files").remove([existing.storage_path]);
    return;
  }
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
    if (insertError?.code === "23505") {
      const { data: concurrentDocument, error: concurrentError } = await admin.from("contract_documents")
        .select("id").eq("contract_id", contract.id).eq("kind", "signed").maybeSingle();
      if (concurrentError) throw concurrentError;
      if (concurrentDocument?.id) {
        const { error } = await admin.from("contracts").update({ signing_document_id: concurrentDocument.id })
          .eq("id", contract.id).eq("signature_status", "signed");
        if (error) throw error;
        return;
      }
    }
    throw insertError ?? new Error("Die gezeichnete PDF konnte nicht gespeichert werden.");
  }
  const { error: updateError } = await admin.from("contracts").update({ signing_document_id: inserted.id })
    .eq("id", contract.id).eq("signature_status", "signed");
  if (updateError) throw updateError;
}

function recipientRole(recipient: FirmaRecipientEvent, sponsorEmail: string, organizerEmail: string) {
  const email = recipient.email?.trim().toLowerCase();
  return recipient.order === 1 || (email && email === sponsorEmail)
    ? "sponsor"
    : recipient.order === 2 || (email && email === organizerEmail) ? "organizer" : null;
}

async function processFirmaWebhookEvent(admin: ReturnType<typeof createAdminClient>, job: FirmaWebhookJob) {
  const event = job.event_payload;
  const requestId = job.signing_request_id;
  const { data: contract, error: contractError } = await admin.from("contracts")
    .select("id, event_id, sponsor_id, signature_status, signing_document_id, signing_request_id")
    .eq("signing_provider", "firma").eq("signing_request_id", requestId).maybeSingle();
  if (contractError) throw contractError;
  if (!contract || contract.signature_status === "draft") return;

  const [{ data: eventRecord, error: eventError }, { data: sponsor, error: sponsorError }] = await Promise.all([
    admin.from("events").select("contact_email, organization_id").eq("id", contract.event_id).maybeSingle(),
    admin.from("sponsors").select("email").eq("id", contract.sponsor_id).maybeSingle(),
  ]);
  if (eventError || sponsorError) throw eventError ?? sponsorError;
  const { data: owner, error: ownerError } = eventRecord?.organization_id && !eventRecord.contact_email
    ? await admin.from("organization_members").select("email").eq("organization_id", eventRecord.organization_id).eq("role", "owner").limit(1).maybeSingle()
    : { data: null, error: null };
  if (ownerError) throw ownerError;
  const sponsorEmail = sponsor?.email?.trim().toLowerCase() ?? "";
  const organizerEmail = (eventRecord?.contact_email || owner?.email || "").trim().toLowerCase();

  let recipients = event.data?.recipients ?? [];
  if (event.data?.recipient) recipients = [...recipients, event.data.recipient];
  if (["signing_request.recipient.declined", "signing_request.declined", "signing_request.certificate.generated"].includes(job.event_type)
    || (job.event_type === "signing_request.completed" && recipients.length === 0)) {
    const users = await getFirmaSigningUsers(requestId);
    recipients = [...recipients, ...users];
  }
  if (["signing_request.completed", "signing_request.certificate.generated"].includes(job.event_type) && recipients.length === 0) {
    recipients = [
      { order: 1, designation: "Signer", signed_at: event.data?.signing_request?.completed_at },
      { order: 2, designation: "Signer", signed_at: event.data?.signing_request?.completed_at },
    ];
  }

  for (const recipient of recipients
    .filter((item) => item.designation?.toLowerCase() === "signer" && (item.signed_at || item.finished_on))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const signerRole = recipientRole(recipient, sponsorEmail, organizerEmail);
    if (!signerRole) continue;
    const { error } = await admin.rpc("record_contract_signature", {
      target_contract_id: contract.id,
      signer_role: signerRole,
      occurred_at: recipient.signed_at || recipient.finished_on,
    });
    if (error) throw error;
  }

  if (["signing_request.recipient.declined", "signing_request.declined"].includes(job.event_type)) {
    const recipient = recipients.find((item) => item.declined_on || item.decline_reason)
      ?? (job.event_type === "signing_request.recipient.declined" ? event.data?.recipient : undefined);
    const signerRole = recipient ? recipientRole(recipient, sponsorEmail, organizerEmail) : null;
    if (signerRole) {
      const { error } = await admin.rpc("record_contract_signature_decline", {
        target_contract_id: contract.id,
        provider_request_id: requestId,
        signer_role: signerRole,
        occurred_at: recipient?.declined_on || event.created_at,
        decline_reason: recipient?.decline_reason ?? null,
      });
      if (error) throw error;
    }
  }

  if (job.event_type === "signing_request.cancelled") {
    const { error } = await admin.rpc("record_contract_signing_cancellation", {
      target_contract_id: contract.id,
      provider_request_id: requestId,
      occurred_at: event.data?.signing_request?.cancelled_at || event.created_at,
    });
    if (error) throw error;
  }

  if (job.event_type === "signing_request.certificate.generated") {
    const [{ data: currentContract, error: currentError }, { data: eventData, error: currentEventError }] = await Promise.all([
      admin.from("contracts").select("id, event_id, signature_status, signing_document_id").eq("id", contract.id).maybeSingle(),
      admin.from("events").select("organization_id").eq("id", contract.event_id).maybeSingle(),
    ]);
    if (currentError || currentEventError) throw currentError ?? currentEventError;
    if (currentContract?.signature_status === "signed") {
      if (!currentContract.signing_document_id || !eventData?.organization_id) {
        throw new Error("Für den unterschriebenen Vertrag fehlen Quelldokument oder Organisation.");
      }
      const { data: source, error: sourceError } = await admin.from("contract_documents")
        .select("file_name, storage_path").eq("id", currentContract.signing_document_id).maybeSingle();
      if (sourceError) throw sourceError;
      if (!source) throw new Error("Die ursprüngliche Vertrags-PDF wurde nicht gefunden.");
      await saveFirmaPdf(admin, { id: currentContract.id, signing_request_id: requestId }, source, eventData.organization_id, true);
    }
  }
}

export async function processFirmaWebhookQueue(options: { batchSize?: number; jobId?: string } = {}) {
  const admin = createAdminClient();
  const { data: jobs, error: claimError } = await admin.rpc("claim_firma_webhook_jobs", {
    target_batch_size: options.jobId ? 1 : options.batchSize ?? 10,
    target_job_id: options.jobId ?? null,
  });
  if (claimError) throw claimError;
  const result = { claimed: (jobs ?? []).length, completed: 0, pending: 0, failed: 0 };

  for (const job of (jobs ?? []) as FirmaWebhookJob[]) {
    try {
      await processFirmaWebhookEvent(admin, job);
      const { data: completed, error } = await admin.rpc("complete_firma_webhook_job", { target_job_id: job.job_id });
      if (error) throw error;
      if (completed !== true) throw new Error("Der Firma-Webhook-Auftrag konnte nicht als abgeschlossen markiert werden.");
      result.completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Unbekannter Verarbeitungsfehler";
      const { data: status, error: failError } = await admin.rpc("fail_firma_webhook_job", {
        target_job_id: job.job_id,
        failure_message: message,
      });
      if (failError) {
        console.error("Firma webhook job could not be rescheduled", { eventId: job.provider_event_id, error: failError });
        throw failError;
      }
      if (status === "failed") result.failed += 1;
      else result.pending += 1;
      console.error("Firma webhook job processing failed", {
        eventId: job.provider_event_id,
        eventType: job.event_type,
        attempt: job.attempts,
        status,
        error: message,
      });
    }
  }

  return result;
}
