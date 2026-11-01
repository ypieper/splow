import { createClient } from "@/lib/supabase/client";

export type StoredBenefit = {
  id: string;
  eventId: string;
  sponsorId: string | null;
  contractId: string | null;
  title: string;
  benefitType: "monetary" | "in_kind";
  materialLogistics?: string;
  category: string;
  description: string;
  detail: string;
  quantity: number;
  tasksPerUnit: boolean;
  status: string;
  evidence: string;
  completionRequired: boolean;
  templateId?: string | null;
  dueAt?: string;
};

type BenefitRow = {
  id: string;
  event_id: string;
  sponsor_id: string | null;
  contract_id: string | null;
  title: string;
  benefit_type: "monetary" | "in_kind" | null;
  material_logistics: string | null;
  category: string;
  description: string;
  detail: string;
  quantity: number;
  tasks_per_unit?: boolean | null;
  status: string;
  evidence_summary: string;
  completion_required?: boolean | null;
  benefit_template_id?: string | null;
  due_at: string | null;
};

export type BenefitInput = Omit<StoredBenefit, "id" | "quantity" | "detail" | "benefitType" | "completionRequired" | "tasksPerUnit"> & { detail?: string; quantity?: number; benefitType?: StoredBenefit["benefitType"]; completionRequired?: boolean; tasksPerUnit?: boolean };
export type LegacyBenefit = {
  id?: string;
  eventId: string;
  sponsorId?: string;
  contractId?: string;
  title: string;
  category?: string;
  description?: string;
  detail?: string;
  quantity?: number;
  status?: string;
  evidence?: string;
  dueAt?: string;
};

export function benefitFromRow(row: BenefitRow): StoredBenefit {
  return {
    id: row.id,
    eventId: row.event_id,
    sponsorId: row.sponsor_id,
    contractId: row.contract_id,
    title: row.title,
    benefitType: row.benefit_type ?? "monetary",
    materialLogistics: row.material_logistics ?? "",
    category: row.category,
    description: row.description,
    detail: row.detail,
    quantity: row.quantity ?? 1,
    tasksPerUnit: row.tasks_per_unit !== false,
    status: row.status,
    evidence: row.evidence_summary,
    completionRequired: row.completion_required !== false,
    templateId: row.benefit_template_id ?? null,
    dueAt: row.due_at ?? undefined,
  };
}

function rowFromInput(benefit: BenefitInput) {
  return {
    event_id: benefit.eventId,
    sponsor_id: benefit.sponsorId,
    contract_id: benefit.contractId,
    title: benefit.title,
    benefit_type: benefit.benefitType ?? "monetary",
    material_logistics: benefit.materialLogistics?.trim() || null,
    category: benefit.category,
    description: benefit.description,
    detail: benefit.detail ?? "",
    quantity: benefit.quantity ?? 1,
    tasks_per_unit: benefit.tasksPerUnit !== false,
    status: benefit.status,
    evidence_summary: benefit.evidence,
    completion_required: benefit.completionRequired !== false,
    benefit_template_id: benefit.templateId ?? null,
    due_at: benefit.dueAt ?? null,
  };
}

export async function fetchStoredBenefits(eventId?: string) {
  let query = createClient().from("benefits").select("id, event_id, sponsor_id, contract_id, title, benefit_type, material_logistics, category, description, detail, quantity, tasks_per_unit, status, evidence_summary, completion_required, due_at, benefit_template_id").order("created_at", { ascending: true });
  if (eventId) query = query.eq("event_id", eventId);
  const { data, error } = await query;
  return { data: (data ?? []).map((row) => benefitFromRow(row as BenefitRow)), error };
}

export async function createStoredBenefits(benefits: BenefitInput[]) {
  if (!benefits.length) return { data: [], error: null };
  const { data, error } = await createClient()
    .from("benefits")
    .insert(benefits.map(rowFromInput))
    .select("id, event_id, sponsor_id, contract_id, title, benefit_type, material_logistics, category, description, detail, quantity, tasks_per_unit, status, evidence_summary, completion_required, due_at, benefit_template_id");
  return { data: (data ?? []).map((row) => benefitFromRow(row as BenefitRow)), error };
}

export async function syncLegacyBenefitsToSupabase(legacyBenefits: LegacyBenefit[]) {
  const legacy = legacyBenefits.filter((benefit) => benefit.eventId && benefit.sponsorId && benefit.title.trim());
  if (!legacy.length) return { data: [] as StoredBenefit[], error: null, imported: 0 };

  const supabase = createClient();
  const eventIds = [...new Set(legacy.map((benefit) => benefit.eventId))];
  const [benefitResult, contractResult] = await Promise.all([
    supabase.from("benefits").select("id, event_id, sponsor_id, contract_id, title, benefit_type, material_logistics, category, description, detail, quantity, tasks_per_unit, status, evidence_summary, completion_required, due_at, benefit_template_id").in("event_id", eventIds),
    supabase.from("contracts").select("id, event_id, sponsor_id").in("event_id", eventIds),
  ]);
  if (benefitResult.error) return { data: [] as StoredBenefit[], error: benefitResult.error, imported: 0 };
  if (contractResult.error) return { data: [] as StoredBenefit[], error: contractResult.error, imported: 0 };

  const existing = (benefitResult.data ?? []).map((row) => benefitFromRow(row as BenefitRow));
  const titleKey = (eventId: string, sponsorId: string | null, title: string) => `${eventId}:${sponsorId ?? ""}:${title.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE")}`;
  const existingKeys = new Set(existing.map((benefit) => titleKey(benefit.eventId, benefit.sponsorId, benefit.title)));
  const contracts = new Map((contractResult.data ?? []).map((row) => [`${row.event_id}:${row.sponsor_id}`, row.id as string]));
  const missing = legacy.filter((benefit) => {
    const key = titleKey(benefit.eventId, benefit.sponsorId ?? null, benefit.title);
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });
  const inserted = await createStoredBenefits(missing.map((benefit) => ({
    eventId: benefit.eventId,
    sponsorId: benefit.sponsorId ?? null,
    contractId: benefit.contractId ?? contracts.get(`${benefit.eventId}:${benefit.sponsorId}`) ?? null,
    title: benefit.title,
    benefitType: "monetary",
    category: benefit.category || "Werbung",
    description: benefit.description || "",
    detail: benefit.detail || "",
    quantity: benefit.quantity ?? 1,
    status: benefit.status || "Offen",
    evidence: benefit.evidence || "Noch kein Nachweis",
    dueAt: benefit.dueAt,
  })));
  if (inserted.error) return { data: [] as StoredBenefit[], error: inserted.error, imported: 0 };
  return { data: [...existing, ...inserted.data], error: null, imported: inserted.data.length };
}

export async function updateStoredBenefit(id: string, changes: { status?: string; evidence?: string; dueAt?: string | null; quantity?: number }) {
  const update: { status?: string; evidence_summary?: string; due_at?: string | null; quantity?: number } = {};
  if (changes.status !== undefined) update.status = changes.status;
  if (changes.evidence !== undefined) update.evidence_summary = changes.evidence;
  if (changes.dueAt !== undefined) update.due_at = changes.dueAt;
  if (changes.quantity !== undefined) update.quantity = changes.quantity;
  const { error } = await createClient().from("benefits").update(update).eq("id", id);
  return { error };
}
