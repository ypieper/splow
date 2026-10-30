import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string }> };
const bucket = "sponsorproof-files";
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Ungültiger Vertrag." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data: contract, error } = await admin.from("contracts")
      .select("id, event_id, signature_status, signed_at, sponsor_signed_at, organizer_signed_at")
      .eq("id", id).maybeSingle();
    if (error || !contract) return NextResponse.json({ error: "Der Vertrag wurde nicht gefunden." }, { status: 404 });
    const { data: ownsEvent, error: ownsError } = await supabase.rpc("owns_event", { target_event_id: contract.event_id });
    if (ownsError) throw ownsError;
    if (!ownsEvent) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });

    return NextResponse.json({
      signatureStatus: contract.signed_at ? "signed" : contract.signature_status,
      sponsorSignedAt: contract.sponsor_signed_at,
      organizerSignedAt: contract.organizer_signed_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
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
      .select("id, event_id, sponsor_id, signature_status, signing_document_id, signed_at")
      .eq("id", id).maybeSingle();
    if (contractError || !contract) return NextResponse.json({ error: "Der Vertrag wurde nicht gefunden." }, { status: 404 });
    const { data: signatureEnabled, error: entitlementError } = await admin.rpc("event_signature_addon_enabled", { target_event_id: contract.event_id });
    if (entitlementError) throw entitlementError;
    if (signatureEnabled !== true) return NextResponse.json({ error: "Für dieses Event ist noch kein Vertragspaket freigeschaltet." }, { status: 403 });
    const signatureStatus = contract.signed_at ? "signed" : contract.signature_status;

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
    const { data: signaturePayment, error: signaturePaymentError } = await admin.from("contract_signature_payments")
      .select("id").eq("contract_id", contract.id).eq("payment_status", "paid").limit(1).maybeSingle();
    if (signaturePaymentError) throw signaturePaymentError;
    if (!signaturePayment) return NextResponse.json({ error: "Die Vertragszeichnung wird erst nach bestätigter Zahlung freigegeben." }, { status: 402 });
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
    if (contract.signature_status !== "pending_sponsor" || contract.sponsor_signed_at || contract.signed_at) {
      return NextResponse.json({ error: "Die Freigabe kann nur zurückgenommen werden, solange der Sponsor noch nicht gezeichnet hat." }, { status: 409 });
    }
    if (contract.signing_provider || contract.signing_request_id) {
      return NextResponse.json({ error: "Diese Zeichnungsanfrage muss beim Signaturanbieter beendet werden." }, { status: 409 });
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
