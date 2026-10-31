import type { Sponsor, SponsorContract } from "@/lib/sponsor-types";
import { normalizeCityName } from "@/lib/location";

export type SponsorRow = {
  id: string;
  name: string;
  initials: string;
  sponsorship_value_cents: number;
  status: string;
  color: string | null;
  logo_path?: string | null;
  legal_form: string | null;
  street: string | null;
  street_number: string | null;
  postal_code: string | null;
  city: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  email: string | null;
  phone: string | null;
  vat_id: string | null;
  iban: string | null;
  bic: string | null;
  bank: string | null;
};

export type ContractRow = {
  id: string;
  event_id: string;
  sponsor_id: string;
  title: string;
  value_cents: number;
  gross_value_cents?: number;
  status: string;
  signed_at: string | null;
  signature_status?: SponsorContract["signatureStatus"];
  sponsor_signed_at?: string | null;
  organizer_signed_at?: string | null;
  signing_document_id?: string | null;
  signature_declined_by?: "sponsor" | "organizer" | null;
  signature_declined_at?: string | null;
  signature_decline_reason?: string | null;
  signature_new_version_required?: boolean;
  signing_provider?: string | null;
};

export type SponsorRecord = { sponsor: Sponsor; contracts: SponsorContract[] };

const sponsorColumns = "id, name, initials, sponsorship_value_cents, status, color, legal_form, street, street_number, postal_code, city, contact_first_name, contact_last_name, email, phone, vat_id, iban, bic, bank";
const contractColumns = "id, event_id, sponsor_id, title, value_cents, gross_value_cents, status, signed_at, signature_status, sponsor_signed_at, organizer_signed_at, signing_document_id, signing_provider, signature_declined_by, signature_declined_at, signature_decline_reason, signature_new_version_required";

export function formatCents(cents: number) {
  return `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cents / 100)} €`;
}

function displayStatus(value: string): Sponsor["status"] {
  if (value === "Erfüllt" || value === "Erledigt") return "Erfüllt";
  if (value === "In Arbeit") return "In Arbeit";
  return "Offen";
}

function displaySignedAt(value: string | null) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : value;
}

export function sponsorFromRow(row: SponsorRow, contracts: SponsorContract[] = [], eventIds: string[] = []): Sponsor {
  const total = contracts.reduce((sum, contract) => sum + Math.round(Number(contract.value.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", ".")) * 100), 0);
  return {
    id: row.id,
    eventIds,
    name: row.name,
    initials: row.initials || row.name.slice(0, 3).toUpperCase(),
    value: formatCents(total || Number(row.sponsorship_value_cents) || 0),
    progress: 0,
    status: displayStatus(row.status),
    color: row.color ?? undefined,
    logoPath: row.logo_path ?? undefined,
    legalForm: row.legal_form ?? undefined,
    street: row.street ?? undefined,
    streetNumber: row.street_number ?? undefined,
    postalCode: row.postal_code ?? undefined,
    city: row.city ? normalizeCityName(row.city) : undefined,
    contactFirstName: row.contact_first_name ?? undefined,
    contactLastName: row.contact_last_name ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    vatId: row.vat_id ?? undefined,
    iban: row.iban ?? undefined,
    bic: row.bic ?? undefined,
    bank: row.bank ?? undefined,
  };
}

export function contractFromRow(row: ContractRow): SponsorContract {
  return {
    id: row.id,
    sponsorId: row.sponsor_id,
    eventId: row.event_id,
    title: row.title,
    value: formatCents(Number(row.value_cents) || 0),
    grossValue: formatCents(Number(row.gross_value_cents) || 0),
    progress: 0,
    status: displayStatus(row.status),
    signedAt: displaySignedAt(row.signed_at),
    signatureStatus: row.signed_at ? "signed" : row.signature_status ?? "draft",
    sponsorSignedAt: row.sponsor_signed_at ?? null,
    organizerSignedAt: row.organizer_signed_at ?? null,
    signingDocumentId: row.signing_document_id ?? null,
    signatureProvider: row.signing_provider ?? null,
    signatureDeclinedBy: row.signature_declined_by ?? null,
    signatureDeclinedAt: row.signature_declined_at ?? null,
    signatureDeclineReason: row.signature_decline_reason ?? null,
    signatureNewVersionRequired: row.signature_new_version_required ?? false,
  };
}

export async function updateContractRecord(id: string, details: { netValueCents?: number; grossValueCents?: number; signatureStatus?: SponsorContract["signatureStatus"]; signedAt?: string | null; sponsorSignedAt?: string | null; organizerSignedAt?: string | null; signingDocumentId?: string | null }) {
  const { createClient } = await import("@/lib/supabase/client");
  const updates: Record<string, number | string | null> = {};
  if (details.netValueCents !== undefined) updates.value_cents = details.netValueCents;
  if (details.grossValueCents !== undefined) updates.gross_value_cents = details.grossValueCents;
  if (details.signatureStatus !== undefined) updates.signature_status = details.signatureStatus;
  if (details.signedAt !== undefined) updates.signed_at = details.signedAt;
  if (details.sponsorSignedAt !== undefined) updates.sponsor_signed_at = details.sponsorSignedAt;
  if (details.organizerSignedAt !== undefined) updates.organizer_signed_at = details.organizerSignedAt;
  if (details.signingDocumentId !== undefined) updates.signing_document_id = details.signingDocumentId;
  return createClient().from("contracts").update(updates).eq("id", id);
}

export async function setContractSigningDocument(id: string, documentId: string) {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient().from("contracts").update({ signing_document_id: documentId }).eq("id", id);
}

export async function fetchSponsorRecords() {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const [sponsorResult, contractResult, assignmentResult] = await Promise.all([
    supabase.from("sponsors").select(sponsorColumns).order("name"),
    supabase.from("contracts").select(contractColumns).order("created_at", { ascending: false }),
    supabase.from("event_sponsors").select("event_id, sponsor_id"),
  ]);
  if (sponsorResult.error) return { data: null, error: sponsorResult.error };
  if (contractResult.error) return { data: null, error: contractResult.error };
  if (assignmentResult.error) return { data: null, error: assignmentResult.error };
  const contracts = (contractResult.data ?? []).map((row) => contractFromRow(row as ContractRow));
  const eventIdsBySponsor = new Map<string, string[]>();
  for (const assignment of assignmentResult.data ?? []) {
    const current = eventIdsBySponsor.get(assignment.sponsor_id) ?? [];
    current.push(assignment.event_id);
    eventIdsBySponsor.set(assignment.sponsor_id, current);
  }
  for (const contract of contracts) {
    const current = eventIdsBySponsor.get(contract.sponsorId) ?? [];
    if (!current.includes(contract.eventId)) current.push(contract.eventId);
    eventIdsBySponsor.set(contract.sponsorId, current);
  }
  const records = (sponsorResult.data ?? []).map((raw) => {
    const row = raw as SponsorRow;
    const relatedContracts = contracts.filter((contract) => contract.sponsorId === row.id);
    return { sponsor: sponsorFromRow(row, relatedContracts, eventIdsBySponsor.get(row.id) ?? []), contracts: relatedContracts };
  });
  return { data: records, error: null };
}

export async function fetchSponsorRecord(id: string) {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const [sponsorResult, contractResult, assignmentResult] = await Promise.all([
    supabase.from("sponsors").select(sponsorColumns).eq("id", id).maybeSingle(),
    supabase.from("contracts").select(contractColumns).eq("sponsor_id", id).order("created_at", { ascending: false }),
    supabase.from("event_sponsors").select("event_id").eq("sponsor_id", id),
  ]);
  if (sponsorResult.error) return { data: null, error: sponsorResult.error };
  if (contractResult.error) return { data: null, error: contractResult.error };
  if (assignmentResult.error) return { data: null, error: assignmentResult.error };
  if (!sponsorResult.data) return { data: null, error: null };
  const contracts = (contractResult.data ?? []).map((row) => contractFromRow(row as ContractRow));
  return { data: { sponsor: sponsorFromRow(sponsorResult.data as SponsorRow, contracts, (assignmentResult.data ?? []).map((row) => row.event_id)), contracts }, error: null };
}

export async function fetchSponsorRecordsForEvent(eventId: string) {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const [assignmentResult, contractResult] = await Promise.all([
    supabase.from("event_sponsors").select("sponsor_id").eq("event_id", eventId),
    supabase.from("contracts").select(contractColumns).eq("event_id", eventId).order("created_at", { ascending: false }),
  ]);
  const { data: assignments, error: assignmentError } = assignmentResult;
  if (assignmentError) return { data: null, error: assignmentError };
  if (contractResult.error) return { data: null, error: contractResult.error };
  const eventContracts = (contractResult.data ?? []).map((row) => contractFromRow(row as ContractRow));
  const sponsorIds = [...new Set([...(assignments ?? []).map((row) => row.sponsor_id), ...eventContracts.map((contract) => contract.sponsorId)])];
  if (!sponsorIds.length) return { data: [], error: null };
  const [sponsorResult] = await Promise.all([
    supabase.from("sponsors").select(sponsorColumns).in("id", sponsorIds).order("name"),
  ]);
  if (sponsorResult.error) return { data: null, error: sponsorResult.error };
  return {
    data: (sponsorResult.data ?? []).map((raw) => {
      const row = raw as SponsorRow;
      const contracts = eventContracts.filter((contract) => contract.sponsorId === row.id);
      return { sponsor: sponsorFromRow(row, contracts, [eventId]), contracts };
    }),
    error: null,
  };
}

export async function createSponsorRecord(input: {
  eventId?: string;
  name: string;
  valueCents?: number;
  legalForm?: string;
  street?: string;
  streetNumber?: string;
  postalCode?: string;
  city?: string;
  vatId?: string;
  contactFirstName?: string;
  contactLastName?: string;
  email?: string;
  phone?: string;
}) {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const words = input.name.trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words.map((word) => word[0]).join("") : words[0]?.slice(0, 3) ?? "").slice(0, 3).toUpperCase();
  const { data: row, error } = await supabase.from("sponsors").insert({
    name: input.name.trim(),
    initials,
    sponsorship_value_cents: input.valueCents ?? 0,
    status: "Offen",
    legal_form: input.legalForm || null,
    street: input.street || null,
    street_number: input.streetNumber || null,
    postal_code: input.postalCode || null,
    city: input.city || null,
    vat_id: input.vatId || null,
    contact_first_name: input.contactFirstName || null,
    contact_last_name: input.contactLastName || null,
    email: input.email || null,
    phone: input.phone || null,
  }).select(sponsorColumns).single();
  if (error || !row) return { data: null, error };

  if (!input.eventId) {
    return { data: { sponsor: sponsorFromRow(row as SponsorRow), contracts: [] }, error: null };
  }

  const { data: contractId, error: assignmentError } = await supabase.rpc("add_sponsor_to_event", {
    target_event_id: input.eventId,
    target_sponsor_id: row.id,
    initial_contract_value_cents: input.valueCents ?? null,
  });
  if (assignmentError) {
    await supabase.from("sponsors").delete().eq("id", row.id);
    return { data: null, error: assignmentError };
  }

  const contracts: SponsorContract[] = [];
  if (typeof contractId === "string") {
    const { data: contractRow, error: contractError } = await supabase.from("contracts").select(contractColumns).eq("id", contractId).single();
    if (contractError || !contractRow) return { data: null, error: contractError ?? new Error("Vertrag konnte nicht geladen werden.") };
    contracts.push(contractFromRow(contractRow as ContractRow));
  }
  return { data: { sponsor: sponsorFromRow(row as SponsorRow, contracts, [input.eventId]), contracts }, error: null };
}

export async function addExistingSponsorToEventRecord(eventId: string, sponsorId: string, valueCents?: number) {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const { data: contractId, error: assignmentError } = await supabase.rpc("add_sponsor_to_event", {
    target_event_id: eventId,
    target_sponsor_id: sponsorId,
    initial_contract_value_cents: valueCents ?? null,
  });
  if (assignmentError) return { data: null, error: assignmentError };
  const [sponsorResult, contractResult] = await Promise.all([
    supabase.from("sponsors").select(sponsorColumns).eq("id", sponsorId).single(),
    typeof contractId === "string" ? supabase.from("contracts").select(contractColumns).eq("id", contractId).single() : Promise.resolve({ data: null, error: null }),
  ]);
  if (sponsorResult.error) return { data: null, error: sponsorResult.error };
  if (contractResult.error) return { data: null, error: contractResult.error };
  const contracts = contractResult.data ? [contractFromRow(contractResult.data as ContractRow)] : [];
  return { data: { sponsor: sponsorFromRow(sponsorResult.data as SponsorRow, contracts, [eventId]), contracts }, error: null };
}

export async function createSponsorContractRecord(eventId: string, sponsorId: string, valueCents: number) {
  const { createClient } = await import("@/lib/supabase/client");
  const { data, error } = await createClient().from("contracts").insert({
    event_id: eventId,
    sponsor_id: sponsorId,
    title: "Sponsoringvertrag",
    value_cents: valueCents,
    status: "Offen",
  }).select(contractColumns).single();
  return { data: data ? contractFromRow(data as ContractRow) : null, error };
}

export async function updateSponsorRecord(id: string, sponsor: Partial<Sponsor>) {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  return supabase.from("sponsors").update({
    name: sponsor.name,
    initials: sponsor.initials,
    color: sponsor.color ?? null,
    legal_form: sponsor.legalForm ?? null,
    street: sponsor.street ?? null,
    street_number: sponsor.streetNumber ?? null,
    postal_code: sponsor.postalCode ?? null,
    city: sponsor.city ?? null,
    contact_first_name: sponsor.contactFirstName ?? null,
    contact_last_name: sponsor.contactLastName ?? null,
    email: sponsor.email ?? null,
    phone: sponsor.phone ?? null,
    vat_id: sponsor.vatId ?? null,
    iban: sponsor.iban ?? null,
    bic: sponsor.bic ?? null,
    bank: sponsor.bank ?? null,
  }).eq("id", id);
}

export async function deleteUnassignedSponsorRecord(id: string) {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const { data, error } = await supabase.rpc("delete_unassigned_sponsor", { target_sponsor_id: id });
  return { deleted: data === true && !error, error };
}

export async function removeSponsorFromEventRecord(eventId: string, sponsorId: string) {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const { data, error } = await supabase.rpc("remove_sponsor_from_event", {
    target_event_id: eventId,
    target_sponsor_id: sponsorId,
  });
  return { removed: data === true, error };
}
