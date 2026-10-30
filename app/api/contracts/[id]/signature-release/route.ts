import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string }> };
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);

export async function POST(request: Request, context: Context) {
  const { id: routeContractId } = await context.params;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  const payload = await request.json().catch(() => ({})) as { signingDocumentId?: string };
  if (typeof payload.signingDocumentId !== "string" || !isUuid(payload.signingDocumentId)) {
    return NextResponse.json({ error: "Bitte wähle zuerst eine Vertrags-PDF aus." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    let contractId = routeContractId;
    if (!isUuid(contractId)) {
      // Recover the contract through the selected PDF when a stale page submits
      // an invalid route id. Access and payment are still verified below.
      const { data: selectedDocument, error: selectedDocumentError } = await admin.from("contract_documents")
        .select("contract_id").eq("id", payload.signingDocumentId).maybeSingle();
      if (selectedDocumentError) throw selectedDocumentError;
      contractId = selectedDocument?.contract_id ?? "";
    }
    if (!isUuid(contractId)) return NextResponse.json({ error: "Der Vertragsbezug ist ungültig. Lade die Seite neu und versuche es erneut." }, { status: 400 });

    const { data: contract, error: contractError } = await admin.from("contracts")
      .select("id, event_id, signature_status")
      .eq("id", contractId).maybeSingle();
    if (contractError || !contract) return NextResponse.json({ error: "Der Vertrag wurde nicht gefunden." }, { status: 404 });

    const { data: ownsEvent, error: ownsError } = await supabase.rpc("owns_event", { target_event_id: contract.event_id });
    if (ownsError) throw ownsError;
    if (!ownsEvent) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });
    if (contract.signature_status !== "draft") return NextResponse.json({ error: "Der Zeichnungsablauf wurde bereits gestartet." }, { status: 409 });

    const [{ data: enabled, error: entitlementError }, { data: document, error: documentError }] = await Promise.all([
      admin.rpc("event_signature_addon_enabled", { target_event_id: contract.event_id }),
      admin.from("contract_documents").select("id").eq("id", payload.signingDocumentId).eq("contract_id", contractId)
        .in("kind", ["generated_pdf", "uploaded_pdf"]).maybeSingle(),
    ]);
    if (entitlementError || documentError) throw entitlementError ?? documentError;
    if (!enabled) return NextResponse.json({ error: "Für dieses Event ist noch kein Vertragspaket freigeschaltet." }, { status: 403 });
    if (!document) return NextResponse.json({ error: "Die gewählte Vertrags-PDF wurde nicht gefunden." }, { status: 404 });

    const { data: payment, error: paymentError } = await admin.from("contract_signature_payments")
      .select("id").eq("contract_id", contractId).eq("signing_document_id", payload.signingDocumentId).eq("payment_status", "paid").maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return NextResponse.json({ error: "Bezahle zuerst die Gebühr für diese PDF." }, { status: 402 });

    const { data: updated, error: updateError } = await admin.from("contracts")
      .update({ signing_document_id: payload.signingDocumentId })
      .eq("id", contractId).eq("signature_status", "draft").select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return NextResponse.json({ error: "Der Vertrag kann nicht mehr zur Zeichnung freigegeben werden." }, { status: 409 });

    const { error: releaseError } = await supabase.rpc("start_simple_contract_signing", { target_contract_id: contractId });
    if (releaseError) {
      await admin.from("contracts").update({ signing_document_id: null })
        .eq("id", contractId).eq("signature_status", "draft").eq("signing_document_id", payload.signingDocumentId);
      if (releaseError.message.includes("CONTRACT_SIGNATURE_PAYMENT_REQUIRED")) {
        return NextResponse.json({ error: "Bezahle zuerst die Gebühr für diese PDF." }, { status: 402 });
      }
      return NextResponse.json({ error: "Der Vertrag konnte nicht freigegeben werden. Bitte lade die Seite neu." }, { status: 409 });
    }

    return NextResponse.json({ released: true });
  } catch {
    return NextResponse.json({ error: "Der Vertrag konnte nicht freigegeben werden." }, { status: 500 });
  }
}
