const FIRMA_API_BASE = "https://api.firma.dev/functions/v1/signing-request-api";
const INLINE_DOCUMENT_LIMIT = 5 * 1024 * 1024;

export type FirmaRecipient = {
  first_name: string;
  last_name: string;
  email: string;
  designation: "Signer";
  order: number;
};

export type FirmaUser = {
  id: string;
  email?: string;
  order?: number;
  designation?: string;
  signed_at?: string | null;
  finished_on?: string | null;
  declined_on?: string | null;
  decline_reason?: string | null;
};

function apiKey() {
  const key = process.env.FIRMA_API_KEY?.trim();
  if (!key) throw new Error("Firma ist noch nicht konfiguriert. Hinterlege FIRMA_API_KEY in den Preview-Umgebungsvariablen.");
  return key;
}

async function firmaRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${FIRMA_API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    console.error("Firma API request failed", { path, status: response.status, message: message.slice(0, 500) });
    throw new Error(`Firma konnte die Anfrage nicht verarbeiten (HTTP ${response.status}).`);
  }
  return response;
}

async function uploadDocument(file: Blob, fileName: string) {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength <= INLINE_DOCUMENT_LIMIT) return { document: bytes.toString("base64") };

  const upload = await firmaRequest("/documents", {
    method: "POST",
    body: JSON.stringify({ file_name: fileName, file_size: bytes.byteLength, content_type: "application/pdf" }),
  });
  const uploadInfo = await upload.json() as { document_id?: string; upload_url?: string };
  if (!uploadInfo.document_id || !uploadInfo.upload_url) throw new Error("Firma hat keine Upload-Adresse für die Vertrags-PDF zurückgegeben.");
  const uploaded = await fetch(uploadInfo.upload_url, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bytes, cache: "no-store" });
  if (!uploaded.ok) throw new Error(`Die Vertrags-PDF konnte nicht zu Firma übertragen werden (HTTP ${uploaded.status}).`);
  return { document_id: uploadInfo.document_id };
}

export async function createAndSendFirmaSigningRequest(input: { file: Blob; fileName: string; name: string; recipients: FirmaRecipient[] }) {
  const document = await uploadDocument(input.file, input.fileName);
  const response = await firmaRequest("/signing-requests/create-and-send", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      ...document,
      recipients: input.recipients,
      settings: { use_signing_order: 1, send_signing_email: true },
    }),
  });
  const result = await response.json() as { id?: string; data?: { id?: string } };
  const requestId = result.id ?? result.data?.id;
  if (!requestId) throw new Error("Firma hat keine Signaturanfrage-ID zurückgegeben.");
  return requestId;
}

export async function getFirmaSigningUsers(requestId: string): Promise<FirmaUser[]> {
  const response = await firmaRequest(`/signing-requests/${encodeURIComponent(requestId)}/users`);
  const result = await response.json() as FirmaUser[] | { users?: FirmaUser[]; results?: FirmaUser[]; data?: FirmaUser[] };
  if (Array.isArray(result)) return result;
  return result.users ?? result.results ?? result.data ?? [];
}

export async function cancelFirmaSigningRequest(requestId: string) {
  await firmaRequest(`/signing-requests/${encodeURIComponent(requestId)}/cancel`, { method: "POST" });
}

export async function downloadFirmaSignedPdf(requestId: string) {
  const response = await firmaRequest(`/signing-requests/${encodeURIComponent(requestId)}/download`);
  const contentType = response.headers.get("content-type") ?? "application/pdf";
  if (!contentType.includes("pdf")) throw new Error("Firma hat keine gezeichnete PDF zurückgegeben.");
  return new Blob([await response.arrayBuffer()], { type: "application/pdf" });
}
