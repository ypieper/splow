import { NextResponse } from "next/server";
import { createAndSendFirmaSigningRequest, type FirmaRecipient } from "@/lib/firma-signing";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string }> };
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

function person(firstName: string, lastName: string, fallbackName: string) {
  const fallbackParts = fallbackName.trim().split(/\s+/).filter(Boolean);
  return {
    first_name: firstName || fallbackParts[0] || "Vertragspartner",
    last_name: lastName || fallbackParts.slice(1).join(" ") || "Team",
  };
}

export async function POST(request: Request, context: Context) {
  const { id: contractId } = await context.params;
  if (!isUuid(contractId)) return NextResponse.json({ error: "Ungültiger Vertrag." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });
  const payload = await request.json().catch(() => ({})) as { signingDocumentId?: string };
  if (!isUuid(clean(payload.signingDocumentId))) return NextResponse.json({ error: "Bitte wähle zuerst eine Vertrags-PDF aus." }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { data: contract, error: contractError } = await admin.from("contracts")
      .select("id, event_id, sponsor_id, signature_status, signature_new_version_required")
      .eq("id", contractId).maybeSingle();
    if (contractError || !contract) return NextResponse.json({ error: "Der Vertrag wurde nicht gefunden." }, { status: 404 });

    const { data: ownsEvent, error: ownsError } = await supabase.rpc("owns_event", { target_event_id: contract.event_id });
    if (ownsError) throw ownsError;
    if (!ownsEvent) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });
    if (contract.signature_status !== "draft") return NextResponse.json({ error: "Der Zeichnungsablauf wurde bereits gestartet." }, { status: 409 });
    if (contract.signature_new_version_required) return NextResponse.json({ error: "Erstelle zuerst die überarbeitete Vertrags-PDF, bevor du sie erneut freigibst." }, { status: 409 });

    const signingDocumentId = clean(payload.signingDocumentId);
    const [{ data: enabled, error: entitlementError }, { data: document, error: documentError }] = await Promise.all([
      admin.rpc("event_signature_addon_enabled", { target_event_id: contract.event_id }),
      admin.from("contract_documents").select("id, storage_path, file_name, content_type").eq("id", signingDocumentId).eq("contract_id", contractId)
        .in("kind", ["generated_pdf", "uploaded_pdf"]).maybeSingle(),
    ]);
    if (entitlementError || documentError) throw entitlementError ?? documentError;
    if (!enabled) return NextResponse.json({ error: "Für dieses Event ist noch kein Vertragspaket freigeschaltet." }, { status: 403 });
    if (!document) return NextResponse.json({ error: "Die gewählte Vertrags-PDF wurde nicht gefunden." }, { status: 404 });

    const [{ data: event, error: eventError }, { data: sponsor, error: sponsorError }] = await Promise.all([
      admin.from("events").select("title, organization_id, contact_first_name, contact_last_name, contact_email").eq("id", contract.event_id).maybeSingle(),
      admin.from("sponsors").select("name, contact_first_name, contact_last_name, email").eq("id", contract.sponsor_id).maybeSingle(),
    ]);
    if (eventError || sponsorError) throw eventError ?? sponsorError;
    if (!event || !sponsor) return NextResponse.json({ error: "Veranstaltung oder Sponsor wurde nicht gefunden." }, { status: 404 });

    const sponsorEmail = clean(sponsor.email);
    const { data: owner, error: ownerError } = !clean(event.contact_email) && event.organization_id
      ? await admin.from("organization_members").select("email").eq("organization_id", event.organization_id).eq("role", "owner").limit(1).maybeSingle()
      : { data: null, error: null };
    if (ownerError) throw ownerError;
    const organizerEmail = clean(event.contact_email) || clean(owner?.email);
    if (!sponsorEmail) return NextResponse.json({ error: "Beim Sponsor ist keine E-Mail-Adresse hinterlegt. Ergänze sie vor der Vertragsfreigabe." }, { status: 400 });
    if (!organizerEmail) return NextResponse.json({ error: "Für die Veranstalter-Unterschrift fehlt eine E-Mail-Adresse. Ergänze sie in den Event-Kontaktdaten." }, { status: 400 });
    const sponsorName = person(clean(sponsor.contact_first_name), clean(sponsor.contact_last_name), clean(sponsor.name));
    const organizerName = person(clean(event.contact_first_name), clean(event.contact_last_name), "Veranstalter Splow");
    const recipients: FirmaRecipient[] = [
      { ...sponsorName, email: sponsorEmail, designation: "Signer", order: 1 },
      { ...organizerName, email: organizerEmail, designation: "Signer", order: 2 },
    ];

    const { data: file, error: fileError } = await admin.storage.from("sponsorproof-files").download(document.storage_path);
    if (fileError || !file) throw fileError ?? new Error("Die Vertrags-PDF fehlt.");
    const requestId = await createAndSendFirmaSigningRequest({
      file,
      fileName: document.file_name,
      name: `${clean(event.title)} – ${clean(sponsor.name)} – Sponsoringvertrag`,
      recipients,
    });

    const { data: updated, error: updateError } = await admin.from("contracts")
      .update({ signing_document_id: signingDocumentId })
      .eq("id", contractId).eq("signature_status", "draft").select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return NextResponse.json({ error: "Die Signaturanfrage wurde versendet, aber der Vertrag wurde parallel geändert. Bitte kontaktiere den Support." }, { status: 409 });

    const { error: beginError } = await admin.rpc("begin_contract_signing", {
      target_contract_id: contractId,
      provider_name: "firma",
      provider_request_id: requestId,
    });
    if (beginError) throw beginError;
    return NextResponse.json({ released: true, provider: "firma" });
  } catch (error) {
    console.error("Firma contract release failed", error);
    const message = error instanceof Error && error.message.startsWith("Firma ist noch nicht konfiguriert")
      ? error.message
      : "Der Vertrag konnte bei Firma nicht zur Zeichnung freigegeben werden. Bitte prüfe die Veranstalter- und Sponsoren-E-Mail-Adressen.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
