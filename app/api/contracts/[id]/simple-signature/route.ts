import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cancelFirmaSigningRequest, getFirmaSigningUsers } from "@/lib/firma-signing";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string }> };
const bucket = "sponsorproof-files";
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Ungültiger Vertrag." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data: contract, error: contractError } = await admin.from("contracts")
      .select("id, event_id, sponsor_id, signature_status, signed_at, sponsor_signed_at, organizer_signed_at, signing_provider, signing_request_id, signature_declined_by, signature_declined_at, signature_decline_reason, signature_cancelled_at")
      .eq("id", id).maybeSingle();
    if (contractError || !contract) return NextResponse.json({ error: "Der Vertrag wurde nicht gefunden." }, { status: 404 });

    const [{ data: memberships, error: membershipsError }, { data: ownsEvent, error: ownsError }] = await Promise.all([
      admin.from("sponsor_account_members").select("account_id").eq("user_id", user.id),
      supabase.rpc("owns_event", { target_event_id: contract.event_id }),
    ]);
    if (membershipsError || ownsError) throw membershipsError ?? ownsError;
    const accountIds = (memberships ?? []).map((row) => row.account_id);
    const { data: sponsorLink, error: sponsorLinkError } = accountIds.length
      ? await admin.from("sponsor_event_accounts").select("event_id").eq("event_id", contract.event_id).eq("sponsor_id", contract.sponsor_id).in("account_id", accountIds).limit(1).maybeSingle()
      : { data: null, error: null };
    if (sponsorLinkError) throw sponsorLinkError;
    const isSponsor = Boolean(sponsorLink);
    const isOrganizer = ownsEvent === true;
    if (!isSponsor && !isOrganizer) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });

    let currentContract = contract;
    let users: Awaited<ReturnType<typeof getFirmaSigningUsers>> = [];
    let eventEmail = "";
    let sponsorEmail = "";
    if (contract.signing_provider === "firma" && contract.signing_request_id) {
      const [{ data: event, error: eventError }, { data: sponsor, error: sponsorError }] = await Promise.all([
        admin.from("events").select("organization_id, contact_email").eq("id", contract.event_id).maybeSingle(),
        admin.from("sponsors").select("email").eq("id", contract.sponsor_id).maybeSingle(),
      ]);
      if (eventError || sponsorError) throw eventError ?? sponsorError;
      sponsorEmail = sponsor?.email?.trim().toLowerCase() ?? "";
      const { data: owner, error: ownerError } = event?.organization_id
        ? await admin.from("organization_members").select("email").eq("organization_id", event.organization_id).eq("role", "owner").limit(1).maybeSingle()
        : { data: null, error: null };
      if (ownerError) throw ownerError;
      eventEmail = (event?.contact_email || owner?.email || "").trim().toLowerCase();
      users = await getFirmaSigningUsers(contract.signing_request_id);

      const signers = users.map((recipient) => {
        const email = recipient.email?.trim().toLowerCase();
        const role = recipient.order === 1 || (email && email === sponsorEmail)
          ? "sponsor"
          : recipient.order === 2 || (email && email === eventEmail) ? "organizer" : null;
        return { role, signedAt: recipient.signed_at || recipient.finished_on };
      }).filter((recipient): recipient is { role: "sponsor" | "organizer"; signedAt: string } => Boolean(recipient.role && recipient.signedAt))
        .sort((left, right) => left.role === right.role ? 0 : left.role === "sponsor" ? -1 : 1);

      for (const signer of signers) {
        const { error: recordError } = await admin.rpc("record_contract_signature", {
          target_contract_id: contract.id,
          signer_role: signer.role,
          occurred_at: signer.signedAt,
        });
        if (recordError) throw recordError;
      }

      const declinedRecipient = users.find((recipient) => recipient.declined_on);
      const declinedEmail = declinedRecipient?.email?.trim().toLowerCase();
      const declinedRole = declinedRecipient?.order === 1 || (declinedEmail && declinedEmail === sponsorEmail)
        ? "sponsor"
        : declinedRecipient?.order === 2 || (declinedEmail && declinedEmail === eventEmail) ? "organizer" : null;
      if (declinedRecipient?.declined_on && declinedRole) {
        const { error: declineError } = await admin.rpc("record_contract_signature_decline", {
          target_contract_id: contract.id,
          provider_request_id: contract.signing_request_id,
          signer_role: declinedRole,
          occurred_at: declinedRecipient.declined_on,
          decline_reason: declinedRecipient.decline_reason ?? null,
        });
        if (declineError) throw declineError;
      }

      const { data: refreshedContract, error: refreshError } = await admin.from("contracts")
        .select("id, event_id, sponsor_id, signature_status, signed_at, sponsor_signed_at, organizer_signed_at, signing_provider, signing_request_id, signature_declined_by, signature_declined_at, signature_decline_reason, signature_cancelled_at")
        .eq("id", contract.id).maybeSingle();
      if (refreshError) throw refreshError;
      if (refreshedContract) currentContract = refreshedContract;
    }

    const signerRole = currentContract.signature_status === "pending_sponsor"
      ? isSponsor ? "sponsor" : "viewer"
      : currentContract.signature_status === "pending_organizer"
        ? isOrganizer ? "organizer" : "viewer"
        : isOrganizer ? "organizer" : "sponsor";
    let signingUrl: string | null = null;
    const requiredRole = currentContract.signature_status === "pending_sponsor" ? "sponsor"
      : currentContract.signature_status === "pending_organizer" ? "organizer" : null;
    if (currentContract.signing_provider === "firma" && currentContract.signing_request_id && requiredRole === signerRole) {
      const targetEmail = signerRole === "sponsor" ? sponsorEmail : eventEmail;
      const recipient = users.find((item) => item.email?.trim().toLowerCase() === targetEmail)
        ?? users.find((item) => item.order === (signerRole === "sponsor" ? 1 : 2));
      if (!recipient?.id) return NextResponse.json({ error: "Der Signaturlink konnte bei Firma nicht gefunden werden." }, { status: 502 });
      signingUrl = `https://app.firma.dev/signing/${encodeURIComponent(recipient.id)}?lang=de&zoom=1`;
    }

    return NextResponse.json({
      signatureStatus: currentContract.signed_at ? "signed" : currentContract.signature_status,
      sponsorSignedAt: currentContract.sponsor_signed_at,
      organizerSignedAt: currentContract.organizer_signed_at,
      signatureDeclinedBy: currentContract.signature_declined_by,
      signatureDeclinedAt: currentContract.signature_declined_at,
      signatureDeclineReason: currentContract.signature_decline_reason,
      signingUrl,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Contract signature status sync failed", error);
    return NextResponse.json({ error: "Der Zeichnungsstatus konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Ungültiger Vertrag." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data: contract, error: contractError } = await admin.from("contracts")
      .select("id, event_id, sponsor_id, signature_status, signing_document_id, signed_at, signing_provider, signature_new_version_required")
      .eq("id", id).maybeSingle();
    if (contractError || !contract) return NextResponse.json({ error: "Der Vertrag wurde nicht gefunden." }, { status: 404 });
    if (contract.signature_new_version_required) return NextResponse.json({ error: "Erstelle zuerst die überarbeitete Vertrags-PDF, bevor du sie erneut freigibst." }, { status: 409 });
    const { data: signatureEnabled, error: entitlementError } = await admin.rpc("event_signature_addon_enabled", { target_event_id: contract.event_id });
    if (entitlementError) throw entitlementError;
    if (signatureEnabled !== true) return NextResponse.json({ error: "Für dieses Event ist noch kein Vertragspaket freigeschaltet." }, { status: 403 });
    const signatureStatus = contract.signed_at ? "signed" : contract.signature_status;
    if (contract.signing_provider === "firma") return NextResponse.json({ error: "Bitte öffne die Signaturansicht von Firma, um den Vertrag zu zeichnen." }, { status: 409 });

    let signerRole: "sponsor" | "organizer";
    if (signatureStatus === "pending_sponsor") {
      const { data: memberships, error: membershipsError } = await admin.from("sponsor_account_members").select("account_id").eq("user_id", user.id);
      if (membershipsError) throw membershipsError;
      const accountIds = (memberships ?? []).map((row) => row.account_id);
      if (!accountIds.length) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });
      const { data: link, error: linkError } = await admin.from("sponsor_event_accounts").select("event_id")
        .eq("event_id", contract.event_id).eq("sponsor_id", contract.sponsor_id).in("account_id", accountIds).limit(1).maybeSingle();
      if (linkError) throw linkError;
      if (!link) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });
      signerRole = "sponsor";
    } else {
      const { data: ownsEvent, error: ownsError } = await supabase.rpc("owns_event", { target_event_id: contract.event_id });
      if (ownsError) throw ownsError;
      if (!ownsEvent) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });
      signerRole = "organizer";
      if (signatureStatus !== "pending_organizer" && signatureStatus !== "signed") {
        return NextResponse.json({ error: "Zuerst muss der Sponsor den Vertrag zeichnen." }, { status: 409 });
      }
    }

    if (!contract.signing_document_id) return NextResponse.json({ error: "Für diesen Vertrag ist keine PDF freigegeben." }, { status: 409 });
    if (signatureStatus !== "signed") {
      const { error: signatureError } = await admin.rpc("record_contract_signature", {
        target_contract_id: contract.id,
        signer_role: signerRole,
        occurred_at: new Date().toISOString(),
      });
      if (signatureError) return NextResponse.json({ error: "Die Zeichnung konnte nicht gespeichert werden. Bitte lade die Seite neu." }, { status: 409 });
    }

    if (signerRole === "organizer") {
      const { data: existing, error: existingError } = await admin.from("sponsor_documents").select("id")
        .eq("event_id", contract.event_id).eq("sponsor_id", contract.sponsor_id).eq("contract_id", contract.id)
        .eq("document_role", "signed_contract").maybeSingle();
      if (existingError) throw existingError;
      if (!existing) {
        const [{ data: source, error: sourceError }, { data: event, error: eventError }] = await Promise.all([
          admin.from("contract_documents").select("storage_path, file_name, content_type").eq("id", contract.signing_document_id).eq("contract_id", contract.id).maybeSingle(),
          admin.from("events").select("organization_id").eq("id", contract.event_id).maybeSingle(),
        ]);
        if (sourceError || eventError || !source || !event?.organization_id) throw sourceError ?? eventError ?? new Error("Vertragsdatei fehlt.");
        const { data: file, error: downloadError } = await admin.storage.from(bucket).download(source.storage_path);
        if (downloadError || !file) throw downloadError ?? new Error("Vertragsdatei fehlt.");
        const storagePath = `${event.organization_id}/events/${contract.event_id}/sponsor-documents/${contract.sponsor_id}/contracts/${randomUUID()}.pdf`;
        const { error: uploadError } = await admin.storage.from(bucket).upload(storagePath, file, { contentType: "application/pdf", upsert: false });
        if (uploadError) throw uploadError;
        const metadata = user.user_metadata ?? {};
        const first = String(metadata.first_name ?? "").trim();
        const last = String(metadata.last_name ?? "").trim();
        const uploader = [first, last].filter(Boolean).join(" ") || "Veranstalter";
        const fileName = source.file_name.replace(/\.pdf$/i, "") + "_gezeichnet.pdf";
        const { error: insertError } = await admin.from("sponsor_documents").insert({
          organization_id: event.organization_id,
          event_id: contract.event_id,
          sponsor_id: contract.sponsor_id,
          storage_path: storagePath,
          file_name: fileName,
          display_name: fileName.replace(/\.pdf$/i, ""),
          content_type: "application/pdf",
          size_bytes: file.size,
          status: "uploaded",
          uploaded_at: new Date().toISOString(),
          uploaded_by_type: "organizer",
          uploaded_by_user_id: user.id,
          uploaded_by_name: uploader,
          uploaded_by_email: user.email ?? null,
          document_role: "signed_contract",
          contract_id: contract.id,
        });
        if (insertError) {
          await admin.storage.from(bucket).remove([storagePath]);
          throw insertError;
        }
      }
    }
    return NextResponse.json({ ok: true, signerRole }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Die Zeichnung konnte nicht abgeschlossen werden. Bitte versuche es erneut." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Ungültiger Vertrag." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data: contract, error: contractError } = await admin.from("contracts")
      .select("id, event_id, signature_status, sponsor_signed_at, signed_at, signing_provider, signing_request_id")
      .eq("id", id).maybeSingle();
    if (contractError || !contract) return NextResponse.json({ error: "Der Vertrag wurde nicht gefunden." }, { status: 404 });
    const { data: ownsEvent, error: ownsError } = await supabase.rpc("owns_event", { target_event_id: contract.event_id });
    if (ownsError) throw ownsError;
    if (!ownsEvent) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });
    if (contract.signing_provider === "firma" && contract.signing_request_id && ["pending_sponsor", "pending_organizer"].includes(contract.signature_status)) {
      await cancelFirmaSigningRequest(contract.signing_request_id);
      const { error: cancellationError } = await admin.rpc("record_contract_signing_cancellation", {
        target_contract_id: contract.id,
        provider_request_id: contract.signing_request_id,
        occurred_at: new Date().toISOString(),
      });
      if (cancellationError) throw cancellationError;
      return NextResponse.json({ ok: true, cancelled: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (contract.signature_status !== "pending_sponsor" || contract.sponsor_signed_at || contract.signed_at) {
      return NextResponse.json({ error: "Die Freigabe kann nur zurückgenommen werden, solange noch keine Unterschrift vorliegt." }, { status: 409 });
    }
    if (contract.signing_provider || contract.signing_request_id) {
      return NextResponse.json({ error: "Diese Zeichnungsanfrage kann nicht zurückgenommen werden." }, { status: 409 });
    }

    const { data: revoked, error: revokeError } = await admin.from("contracts").update({
      signature_status: "draft",
      signing_document_id: null,
    }).eq("id", id).eq("signature_status", "pending_sponsor").is("sponsor_signed_at", null).is("signed_at", null).is("signing_provider", null).is("signing_request_id", null).select("id").maybeSingle();
    if (revokeError) throw revokeError;
    if (!revoked) return NextResponse.json({ error: "Der Sponsor hat inzwischen gezeichnet oder die Freigabe wurde bereits geändert. Lade die Seite neu." }, { status: 409 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Die Freigabe zur Zeichnung konnte nicht zurückgenommen werden." }, { status: 500 });
  }
}
