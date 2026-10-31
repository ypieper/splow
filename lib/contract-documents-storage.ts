import { createClient } from "@/lib/supabase/client";

export type ContractDocumentKind = "generated_pdf" | "generated_docx" | "uploaded_pdf" | "signed";
export type ContractDocument = { id: string; contractId: string; kind: ContractDocumentKind; storagePath: string; fileName: string; contentType: string; createdAt: string };
type DocumentRow = { id: string; contract_id: string; kind: ContractDocumentKind; storage_path: string; file_name: string; content_type: string; created_at: string };
const bucket = "sponsorproof-files";
const fromRow = (row: DocumentRow): ContractDocument => ({ id: row.id, contractId: row.contract_id, kind: row.kind, storagePath: row.storage_path, fileName: row.file_name, contentType: row.content_type, createdAt: row.created_at });

export async function fetchContractDocuments(contractId: string) {
  const { data, error } = await createClient().from("contract_documents").select("id, contract_id, kind, storage_path, file_name, content_type, created_at").eq("contract_id", contractId);
  return { data: (data ?? []).map((row) => fromRow(row as DocumentRow)), error };
}

export async function saveContractDocument(contractId: string, kind: ContractDocumentKind, file: Blob, fileName: string) {
  const supabase = createClient();
  const { data: organizationId, error: organizationError } = await supabase.rpc("current_organization_id");
  if (organizationError || typeof organizationId !== "string") return { data: null, error: organizationError ?? new Error("Veranstalterbereich nicht gefunden.") };
  const path = `${organizationId}/contracts/${contractId}/${kind}-${crypto.randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
  const contentType = file.type || (kind === "generated_pdf" ? "application/pdf" : "application/octet-stream");
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, { contentType, upsert: false });
  if (uploadError) return { data: null, error: uploadError };
  const { data, error } = await supabase.from("contract_documents").upsert({ organization_id: organizationId, contract_id: contractId, kind, storage_path: path, file_name: fileName, content_type: contentType }, { onConflict: "contract_id,kind" }).select("id, contract_id, kind, storage_path, file_name, content_type, created_at").single();
  if (error || !data) {
    await supabase.storage.from(bucket).remove([path]);
    return { data: null, error: error ?? new Error("Vertragsdatei konnte nicht gespeichert werden.") };
  }
  if (kind === "generated_pdf" || kind === "uploaded_pdf") {
    const { error: versionError } = await supabase.from("contracts").update({ signature_new_version_required: false }).eq("id", contractId);
    if (versionError) return { data: fromRow(data as DocumentRow), error: versionError };
  }
  return { data: fromRow(data as DocumentRow), error: null };
}

export async function downloadContractDocument(document: ContractDocument) {
  return createClient().storage.from(bucket).download(document.storagePath);
}

export async function deleteContractDocument(document: ContractDocument) {
  const supabase = createClient();
  const { error } = await supabase.from("contract_documents").delete().eq("id", document.id);
  if (error) return { error };
  const { error: storageError } = await supabase.storage.from(bucket).remove([document.storagePath]);
  return { error: storageError };
}

export async function saveContractReportState(contractId: string, values: { generatedAt?: string | null; sentAt?: string | null }) {
  const supabase = createClient();
  const { data: organizationId, error: organizationError } = await supabase.rpc("current_organization_id");
  if (organizationError || typeof organizationId !== "string") return { error: organizationError ?? new Error("Veranstalterbereich nicht gefunden.") };
  const { data: existing, error: loadError } = await supabase.from("contract_reports").select("generated_at, sent_at").eq("contract_id", contractId).maybeSingle();
  if (loadError) return { error: loadError };
  const { error } = await supabase.from("contract_reports").upsert({
    organization_id: organizationId,
    contract_id: contractId,
    generated_at: values.generatedAt !== undefined ? values.generatedAt : existing?.generated_at ?? null,
    sent_at: values.sentAt !== undefined ? values.sentAt : existing?.sent_at ?? null,
    updated_at: new Date().toISOString(),
  });
  return { error };
}

export async function fetchContractReportStates(contractIds: string[]) {
  if (!contractIds.length) return { data: [], error: null };
  return createClient().from("contract_reports").select("contract_id, generated_at, sent_at").in("contract_id", contractIds);
}
