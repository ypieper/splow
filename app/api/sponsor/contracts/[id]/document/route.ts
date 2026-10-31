import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string }> };
const bucket = "sponsorproof-files";
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function GET(request: Request, context: Context) {
  const { id: contractId } = await context.params;
  const downloadSignedVersion = new URL(request.url).searchParams.get("download") === "true";
  if (!isUuid(contractId)) return NextResponse.json({ error: "Ungültiger Vertrag." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data: memberships, error: membershipsError } = await admin
      .from("sponsor_account_members")
      .select("account_id")
      .eq("user_id", user.id);
    if (membershipsError) throw membershipsError;
    const accountIds = (memberships ?? []).map((membership) => membership.account_id);
    if (!accountIds.length) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });

    const { data: contract, error: contractError } = await admin
      .from("contracts")
      .select("id, event_id, sponsor_id, signature_status, signed_at, signing_document_id")
      .eq("id", contractId)
      .maybeSingle();
    if (contractError) throw contractError;
    if (!contract || (!contract.signed_at && contract.signature_status === "draft") || (!downloadSignedVersion && !contract.signing_document_id)) {
      return NextResponse.json({ error: "Für diesen Vertrag ist keine Zeichnungs-PDF freigegeben." }, { status: 404 });
    }

    const { data: assignment, error: assignmentError } = await admin
      .from("sponsor_event_accounts")
      .select("event_id")
      .eq("event_id", contract.event_id)
      .eq("sponsor_id", contract.sponsor_id)
      .in("account_id", accountIds)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });
    if (downloadSignedVersion && !contract.signed_at && contract.signature_status !== "signed") {
      return NextResponse.json({ error: "Der Vertrag ist noch nicht vollständig gezeichnet." }, { status: 409 });
    }

    let storagePath = "";
    let fileName = "Vertrag.pdf";
    let contentType = "application/pdf";
    if (downloadSignedVersion) {
      const { data: signedContract, error: signedContractError } = await admin.from("contract_documents")
        .select("storage_path, file_name, content_type")
        .eq("contract_id", contract.id).eq("kind", "signed").maybeSingle();
      if (signedContractError) throw signedContractError;
      if (signedContract) {
        storagePath = signedContract.storage_path;
        fileName = signedContract.file_name || fileName;
        contentType = signedContract.content_type || contentType;
      } else {
        const { data: signedDocument, error: signedDocumentError } = await admin.from("sponsor_documents")
          .select("storage_path, file_name, content_type")
          .eq("event_id", contract.event_id).eq("sponsor_id", contract.sponsor_id).eq("contract_id", contract.id)
          .eq("document_role", "signed_contract").order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
        if (signedDocumentError) throw signedDocumentError;
        if (signedDocument) {
          storagePath = signedDocument.storage_path;
          fileName = signedDocument.file_name || fileName;
          contentType = signedDocument.content_type || contentType;
        }
      }
      if (!storagePath) return NextResponse.json({ error: "Die endgültig gezeichnete PDF wird noch bereitgestellt. Bitte versuche es gleich erneut." }, { status: 409 });
    } else {
      const { data: document, error: documentError } = await admin
        .from("contract_documents")
        .select("contract_id, storage_path, file_name, content_type")
        .eq("id", contract.signing_document_id!)
        .eq("contract_id", contract.id)
        .maybeSingle();
      if (documentError) throw documentError;
      if (!document) return NextResponse.json({ error: "Die freigegebene Vertragsdatei wurde nicht gefunden." }, { status: 404 });
      storagePath = document.storage_path;
      fileName = document.file_name || fileName;
      contentType = document.content_type || contentType;
    }

    const { data: file, error: downloadError } = await admin.storage.from(bucket).download(storagePath);
    if (downloadError || !file) throw downloadError ?? new Error("Die Vertragsdatei konnte nicht geladen werden.");

    const fallbackFileName = fileName.replace(/[\r\n"\\]/g, "_").replace(/[^\x20-\x7E]/g, "_");
    const encodedFileName = encodeURIComponent(fileName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return new NextResponse(file, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${downloadSignedVersion ? "attachment" : "inline"}; filename="${fallbackFileName}"; filename*=UTF-8''${encodedFileName}`,
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[sponsor/contracts/document] File delivery failed", error);
    return NextResponse.json({ error: "Die Vertragsdatei konnte nicht geladen werden." }, { status: 500 });
  }
}
