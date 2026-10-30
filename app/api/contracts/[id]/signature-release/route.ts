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

  const payload = await request.json().catch(() => ({})) as { signingDocumentId?: string; contractId?: string };

  try {
    const admin = createAdminClient();
    let contractId = routeContractId;
    if (!isUuid(contractId) && typeof payload.contractId === "string" && isUuid(payload.contractId)) {
      contractId = payload.contractId;
    }
    if (!isUuid(contractId) && typeof signingDocumentId === "string" && isUuid(signingDocumentId)) {
      const { data: selectedDocument, error: selectedDocumentError } = await admin.from("contract_documents")
        .select("contract_id").eq("id", signingDocumentId).maybeSingle();
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

    let signingDocumentId = typeof signingDocumentId === "string" && isUuid(signingDocumentId)
      ? signingDocumentId
      : "";
    if (!signingDocumentId) {
      const { data: paidPayment, error: paidPaymentError } = await admin.from("contract_signature_payments")
        .select("signing_document_id").eq("contract_id", contractId).eq("payment_status", "paid")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (paidPaymentError) throw paidPaymentError;
      signingDocumentId = paidPayment?.signing_document_id ?? "";
    }
    if (!isUuid(signingDocumentId)) {
      return NextResponse.json({ error: "Für diesen Vertrag wurde keine bezahlte Vertrags-PDF gefunden. Wähle die bezahlte Datei erneut aus." }, { status: 400 });
    }

    const [{ data: enabled, error: entitlementError }, { data: document, error: documentError }] = await Promise.all([
      admin.rpc("event_signature_addon_enabled", { target_event_id: contract.event_id }),
      admin.from("contract_documents").select("id").eq("id", signingDocumentId).eq("contract_id", contractId)
        .in("kind", ["generated_pdf", "uploaded_pdf"]).maybeSingle(),
    ]);
    if (entitlementError || documentError) throw entitlementError ?? documentError;
    if (!enabled) return NextResponse.json({ error: "Für dieses Event ist noch kein Vertragspaket freigeschaltet." }, { status: 403 });
    if (!document) return NextResponse.json({ error: "Die gewählte Vertrags-PDF wurde nicht gefunden." }, { status: 404 });

    const { data: payment, error: paymentError } = await admin.from("contract_signature_payments")
      .select("id").eq("contract_id", contractId).eq("signing_document_id", signingDocumentId).eq("payment_status", "paid").maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return NextResponse.json({ error: "Bezahle zuerst die Gebühr für diese PDF." }, { status: 402 });

    const { data: updated, error: updateError } = await admin.from("contracts")
      .update({ signing_document_id: signingDocumentId })
      .eq("id", contractId).eq("signature_status", "draft").select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return NextResponse.json({ error: "Der Vertrag kann nicht mehr zur Zeichnung freigegeben werden." }, { status: 409 });

    const { error: releaseError } = await supabase.rpc("start_simple_contract_signing", { target_contract_id: contractId });
    if (releaseError) {
      await admin.from("contracts").update({ signing_document_id: null })
        .eq("id", contractId).eq("signature_status", "draft").eq("signing_document_id", signingDocumentId);
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
