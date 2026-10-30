"use client";

import { DatePicker } from "@/components/date-picker";

import { benefitWorkflowCount, normalizeBenefitTitle } from "@/lib/benefit-workflow";
import { Modal } from "@/components/modal";
import { useEventEntitlements } from "@/components/event-entitlements";
import { EventSponsorInvoice } from "@/components/event-sponsor-invoice";
import { SponsorDocumentArea } from "@/components/sponsor-document-area";
import { EmptyState, Icon, Status } from "@/components/ui";
import { createStoredBenefits, fetchStoredBenefits, updateStoredBenefit, type StoredBenefit } from "@/lib/benefits-storage";
import { deleteContractDocument, downloadContractDocument, fetchContractDocuments, saveContractDocument, type ContractDocument } from "@/lib/contract-documents-storage";
import { contractDateForInput } from "@/lib/event-contract-dates";
import { formatContractValue, parseContractValue, parseContractValueInput } from "@/lib/event-contract-values";
import { fetchStoredEvidence } from "@/lib/evidence-storage";
import { fetchOrganizerSettings } from "@/lib/organization-settings-storage";
import { contractFilename, fillContractTemplate } from "@/lib/render-contract-template";
import type { Sponsor,SponsorContract } from "@/lib/sponsor-types";
import { updateContractRecord } from "@/lib/sponsors-storage";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createStoredTasks, deleteStoredTasks, fetchStoredTasks, normalizeLegacyBenefitTaskInstances, updateStoredTask, type StoredTaskRecord, type TaskInput } from "@/lib/tasks-storage";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type CompletionType = "file_required" | "organizer_approval" | "sponsor_approval" | "sponsor_upload";
type BenefitType = "monetary" | "in_kind";
type TemplateSubtask = { id: string; title: string; sort_order: number; completion_type: CompletionType };
type Block = { id?: string; title: string; category: string; description: string; detail?: string; benefit_type?: BenefitType; material_logistics?: string | null; internal_comment?: string | null; default_completion_type?: "file_required" | "organizer_approval" | "none_required"; tasks_per_unit?: boolean; subtasks?: TemplateSubtask[] };
type EventBenefit = { id?: string; title: string; category: string; description: string; detail?: string; benefitType?: BenefitType; materialLogistics?: string; quantity: number; tasksPerUnit: boolean; status: string; evidence: string; completionRequired?: boolean; sponsorId: string; eventId: string; dueAt?: string };
type AssignedTask = { id: string; title: string; benefit_id: string | null; source: string; status: string; assigned_to: string | null; assigned_to_sponsor: boolean; due_at: string | null; completion_type: CompletionType; workflow_instance: number; workflow_order: number | null; template_task_id: string | null };
type OrganizerMember = { user_id: string; email: string; first_name: string; last_name: string; full_name: string; role: "owner" | "member" };
type StoredGeneratedContracts = { pdf?: ContractDocument; docx?: ContractDocument };
type AssignedTemplate = { name: string; storagePath: string; file: Blob };
type EventSponsorTab = "Vertrag" | "Rechnung" | "Leistungen" | "Dokumente";
const SPONSOR_ASSIGNEE = "__sponsor__";

function grossValueFromNet(netValue: number) {
  return Math.round((netValue * 1.19 + Number.EPSILON) * 100) / 100;
}

function storedBenefitToEventBenefit(benefit: StoredBenefit): EventBenefit {
  return { id: benefit.id, title: benefit.title, category: benefit.category, description: benefit.description, detail: benefit.detail, benefitType: benefit.benefitType ?? "monetary", materialLogistics: benefit.materialLogistics ?? "", quantity: benefit.quantity, tasksPerUnit: benefit.tasksPerUnit, status: benefit.status, evidence: benefit.evidence, completionRequired: benefit.completionRequired, sponsorId: benefit.sponsorId ?? "", eventId: benefit.eventId, dueAt: benefit.dueAt };
}

function storedTaskToAssignedTask(task: StoredTaskRecord): AssignedTask {
  return { id: task.id, title: task.title, benefit_id: task.benefit_id, source: task.source, status: task.status, assigned_to: task.assigned_to, assigned_to_sponsor: task.assigned_to_sponsor, due_at: task.due_at, completion_type: task.completion_type, workflow_instance: task.workflow_instance, workflow_order: task.workflow_order, template_task_id: task.template_task_id };
}

function benefitTaskId(eventId: string, benefit: EventBenefit) {
  return benefit.id ? `benefit-${benefit.id}` : `benefit-${eventId}-${benefit.title.toLocaleLowerCase("de-DE").replace(/[^a-z0-9]+/g, "-")}`;
}

function blockKey(block: Block) {
  return block.id ?? block.title;
}

function taskGroupStatus(tasks: AssignedTask[]) {
  if (tasks.length && tasks.every((task) => task.status === "Erledigt")) return "Abgeschlossen";
  if (tasks.some((task) => task.status === "Erledigt")) return "In Bearbeitung";
  return "Offen";
}

function displayBenefitDate(value: string | null | undefined) {
  if (!value) return "Noch nicht geplant";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

function organizerMemberName(member: OrganizerMember) {
  return [member.first_name, member.last_name].map((name) => name.trim()).filter(Boolean).join(" ") || "Name nicht hinterlegt";
}

function subtaskKey(block: Block, task: TemplateSubtask) {
  return `${blockKey(block)}:${task.id}`;
}

function tasksForBlock(block: Block): TemplateSubtask[] {
  if (block.subtasks?.length) return block.subtasks;
  if (block.default_completion_type === "none_required") return [];
  const completionType = block.default_completion_type ?? "file_required";
  return [{ id: "__primary_task__", title: completionType === "organizer_approval" ? "Bestätigung durch Veranstalter" : "Leistungsnachweis hochladen", sort_order: 0, completion_type: completionType }];
}

export function EventSponsorDetail({ eventId, eventTitle, eventStartDate, eventEndDate, eventLocation, eventResponsible, sponsor, contract, baseBenefits, blocks }: {
  eventId: string;
  eventTitle: string;
  eventStartDate: string;
  eventEndDate: string;
  eventLocation: string;
  eventResponsible: string;
  sponsor: Sponsor;
  contract: SponsorContract;
  baseBenefits: EventBenefit[];
  blocks: Block[];
}) {
  const { ensureFeature } = useEventEntitlements();
  const [signatureAddonEnabled, setSignatureAddonEnabled] = useState(false);
  const [signaturePriceCents, setSignaturePriceCents] = useState<number | null>(null);
  const [paidSigningDocumentId, setPaidSigningDocumentId] = useState("");
  const [addedBenefits, setAddedBenefits] = useState<EventBenefit[]>([]);
  const [availableBlocks, setAvailableBlocks] = useState(blocks);
  const [blocksLoading, setBlocksLoading] = useState(isSupabaseConfigured);
  const [blocksLoadError, setBlocksLoadError] = useState("");
  const [blocksLoadWarning, setBlocksLoadWarning] = useState("");
  const [subtasksUnavailable, setSubtasksUnavailable] = useState(false);
  const [organizerMembers, setOrganizerMembers] = useState<OrganizerMember[]>([]);
  const [adding, setAdding] = useState(false);
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [editingBlockKey, setEditingBlockKey] = useState("");
  const [benefitQuantities, setBenefitQuantities] = useState<Record<string, string>>({});
  const [subtaskDueDates, setSubtaskDueDates] = useState<Record<string, string>>({});
  const [subtaskAssignees, setSubtaskAssignees] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [signedOn, setSignedOn] = useState(() => contractDateForInput(contract.signedAt));
  const [evidenceTaskIds, setEvidenceTaskIds] = useState<string[]>([]);
  const [assignedTasks, setAssignedTasks] = useState<AssignedTask[]>([]);
  const [removingBenefitId, setRemovingBenefitId] = useState<string | null>(null);
  const [editingBenefit, setEditingBenefit] = useState<EventBenefit | null>(null);
  const [editingBenefitQuantity, setEditingBenefitQuantity] = useState("1");
  const [taskEditValues, setTaskEditValues] = useState<Record<string, { dueAt: string; assigneeId: string }>>({});
  const [savingBenefitId, setSavingBenefitId] = useState<string | null>(null);
  const [generatedContracts, setGeneratedContracts] = useState<StoredGeneratedContracts | null>(null);
  const [contractAmountInput, setContractAmountInput] = useState(() => String(parseContractValue(contract.value)));
  const [contractAmountFocused, setContractAmountFocused] = useState(false);
  const [grossContractAmountInput, setGrossContractAmountInput] = useState(() => String(parseContractValue(contract.grossValue ?? "") || grossValueFromNet(parseContractValue(contract.value))));
  const [grossContractAmountFocused, setGrossContractAmountFocused] = useState(false);
  const [grossContractAmountManuallyEdited, setGrossContractAmountManuallyEdited] = useState(false);
  const [signedContractFile, setSignedContractFile] = useState<ContractDocument | null>(null);
  const [uploadedContract, setUploadedContract] = useState<ContractDocument | null>(null);
  const [contractWorkflowMode, setContractWorkflowMode] = useState<"create" | "upload" | null>(null);
  const [uploadingSignedContract, setUploadingSignedContract] = useState(false);
  const [deletingSignedContract, setDeletingSignedContract] = useState(false);
  const [deletingContractDocumentId, setDeletingContractDocumentId] = useState<string | null>(null);
  const [updatingSignedContractVisibility, setUpdatingSignedContractVisibility] = useState(false);
  const [signingDocumentId, setSigningDocumentId] = useState(contract.signingDocumentId ?? "");
  const [signingBusy, setSigningBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<EventSponsorTab>("Leistungen");
  const [showContractOutput, setShowContractOutput] = useState(false);
  const [contractTemplate, setContractTemplate] = useState<AssignedTemplate | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateLoadMessage, setTemplateLoadMessage] = useState("");
  const [creatingContract, setCreatingContract] = useState<"pdf" | "docx" | null>(null);
  const [printReady, setPrintReady] = useState(false);
  const [benefitTypeFilter, setBenefitTypeFilter] = useState<"all" | "monetary" | "in_kind">("all");
  const printPreviewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contract.signatureStatus !== "pending_sponsor" && contract.signatureStatus !== "pending_organizer") return;
    let cancelled = false;
    const refreshSignatureStatus = async () => {
      try {
        const response = await fetch(`/api/contracts/${contract.id}/simple-signature`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const result = await response.json();
        if (!cancelled && result.signatureStatus && result.signatureStatus !== contract.signatureStatus) window.location.reload();
      } catch {
        // The current signing status remains available in the page if the refresh request fails.
      }
    };
    const interval = window.setInterval(() => { void refreshSignatureStatus(); }, 15000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [contract.id, contract.signatureStatus]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchStoredBenefits(eventId);
        if (result.error) throw result.error;
        if (!cancelled) setAddedBenefits(result.data.filter((benefit) => benefit.sponsorId === sponsor.id).map(storedBenefitToEventBenefit));
        const [documents, tasks, evidence] = await Promise.all([fetchContractDocuments(contract.id), fetchStoredTasks(eventId), fetchStoredEvidence()]);
        if (documents.error || tasks.error || evidence.error) throw documents.error ?? tasks.error ?? evidence.error;
        if (cancelled) return;
        setGeneratedContracts({ pdf: documents.data?.find((document) => document.kind === "generated_pdf"), docx: documents.data?.find((document) => document.kind === "generated_docx") });
        const signedFile = documents.data?.find((document) => document.kind === "signed") ?? null;
        setSignedContractFile(signedFile);
        const uploadedFile = documents.data?.find((document) => document.kind === "uploaded_pdf") ?? null;
        const generatedPdf = documents.data?.find((document) => document.kind === "generated_pdf");
        const generatedDocx = documents.data?.find((document) => document.kind === "generated_docx");
        setUploadedContract(uploadedFile);
        setContractWorkflowMode((current) => current ?? (signedFile ? "upload" : generatedPdf || generatedDocx || uploadedFile ? "create" : null));
        setAssignedTasks((tasks.data ?? []).filter((task) => task.event_id === eventId && task.sponsor_id === sponsor.id).map((task) => ({ id: task.id, title: task.title, benefit_id: task.benefit_id, source: task.source, status: task.status, assigned_to: task.assigned_to, assigned_to_sponsor: task.assigned_to_sponsor, due_at: task.due_at, completion_type: task.completion_type, workflow_instance: task.workflow_instance, workflow_order: task.workflow_order, template_task_id: task.template_task_id })));
        setEvidenceTaskIds((evidence.data ?? []).map((item) => item.taskId));
        setContractAmountInput(String(parseContractValue(contract.value)));
        const grossValue = parseContractValue(contract.grossValue ?? "") || grossValueFromNet(parseContractValue(contract.value));
        setGrossContractAmountInput(String(grossValue));
        setGrossContractAmountManuallyEdited(grossValue !== grossValueFromNet(parseContractValue(contract.value)));
        setSignedOn(contractDateForInput(contract.signedAt));
      } catch {
        if (!cancelled) setMessage("Daten konnten nicht aus Supabase geladen werden.");
      }
    })();
    return () => { cancelled = true; };
  }, [contract.id, eventId, sponsor.id]);

  useEffect(() => {
    const storageKey = `sponso:event-sponsor-tab:${eventId}:${contract.id}`;
    const storedTab = window.sessionStorage.getItem(storageKey);
    if (storedTab && (["Leistungen", "Vertrag", "Rechnung", "Dokumente"] as string[]).includes(storedTab)) {
      setActiveTab(storedTab as EventSponsorTab);
    }
  }, [contract.id, eventId]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const { data, error } = await createClient().rpc("event_signature_addon_enabled", { target_event_id: eventId });
      if (!cancelled) setSignatureAddonEnabled(!error && data === true);
    };
    void refresh();
    const onEntitlementUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ eventId?: string }>).detail;
      if (!detail?.eventId || detail.eventId === eventId) void refresh();
    };
    window.addEventListener("sponso:event-entitlement-updated", onEntitlementUpdated);
    return () => { cancelled = true; window.removeEventListener("sponso:event-entitlement-updated", onEntitlementUpdated); };
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/contracts/${contract.id}/signature-payment`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => {
        if (cancelled || !Number.isInteger(result?.amountCents)) return;
        setSignaturePriceCents(result.amountCents);
        setPaidSigningDocumentId(typeof result.paidSigningDocumentId === "string" ? result.paidSigningDocumentId : "");
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [contract.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("contract_id") !== contract.id) return;
    const paymentResult = params.get("signature_payment");
    if (paymentResult === "cancelled") {
      params.delete("signature_payment"); params.delete("contract_id"); params.delete("session_id");
      window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
      setMessage("Die Zahlung wurde abgebrochen. Der Vertrag ist noch nicht zur Zeichnung freigegeben.");
      return;
    }
    const sessionId = params.get("session_id");
    if (paymentResult !== "success" || !sessionId) return;
    let cancelled = false;
    void fetch(`/api/contracts/${contract.id}/signature-payment/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }),
    }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Die Zahlung konnte nicht bestätigt werden.");
      if (cancelled) return;
      params.delete("signature_payment"); params.delete("contract_id"); params.delete("session_id");
      window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
      window.location.reload();
    }).catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Die Zahlung konnte nicht bestätigt werden."); });
    return () => { cancelled = true; };
  }, [contract.id]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/team/members", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { members?: OrganizerMember[] } : null)
      .then((data) => { if (!cancelled) setOrganizerMembers(data?.members ?? []); })
      .catch(() => { if (!cancelled) setOrganizerMembers([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setBlocksLoading(false);
      return;
    }

    let cancelled = false;
    async function loadBenefitTemplates() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("benefit_templates")
          .select("id, title, category, description, benefit_type, material_logistics, internal_comment, default_completion_type, tasks_per_unit")
          .order("created_at", { ascending: true });
        if (error) throw error;
        const templateIds = (data ?? []).map((item) => item.id);
        let taskRows: Array<{ id: string; benefit_template_id: string; title: string; sort_order: number; completion_type?: CompletionType }> = [];
        let warning = "";
        let missingSubtaskTable = false;
        if (templateIds.length) {
          const taskResult = await supabase.from("benefit_template_tasks").select("id, benefit_template_id, title, sort_order, completion_type").in("benefit_template_id", templateIds).order("sort_order");
          if (taskResult.error) {
            const legacyTaskResult = await supabase.from("benefit_template_tasks").select("id, benefit_template_id, title, sort_order").in("benefit_template_id", templateIds).order("sort_order");
            if (legacyTaskResult.error) {
              missingSubtaskTable = true;
              warning = "Bausteine sind verfügbar. Unteraufgaben können erst genutzt werden, wenn die Datenbankmigration eingespielt ist.";
            }
            else {
              taskRows = (legacyTaskResult.data ?? []).map((task) => ({ ...task, completion_type: "file_required" as const }));
              warning = "Bausteine sind verfügbar. Die aktuelle Datenbankmigration fehlt noch; Unteraufgaben mit Freigaben sind vorübergehend nicht verfügbar.";
            }
          } else taskRows = (taskResult.data ?? []) as typeof taskRows;
        }
        const subtasksByTemplate = new Map<string, TemplateSubtask[]>();
        for (const task of taskRows ?? []) {
          const current = subtasksByTemplate.get(task.benefit_template_id) ?? [];
          current.push({ id: task.id, title: task.title, sort_order: task.sort_order, completion_type: task.completion_type ?? "file_required" });
          subtasksByTemplate.set(task.benefit_template_id, current);
        }
        if (!cancelled) {
          const templates: Block[] = (data ?? []).map((item) => ({ ...item, benefit_type: item.benefit_type ?? "monetary", material_logistics: item.material_logistics ?? null, default_completion_type: item.default_completion_type ?? "file_required", tasks_per_unit: item.tasks_per_unit !== false, subtasks: subtasksByTemplate.get(item.id) ?? [] }));
          setAvailableBlocks(templates);
          setBlocksLoadError("");
          setBlocksLoadWarning(warning);
          setSubtasksUnavailable(missingSubtaskTable);
        }
      } catch {
        if (!cancelled) {
          setAvailableBlocks(blocks);
          setBlocksLoadError("Die Bausteine konnten nicht aus deiner Bibliothek geladen werden.");
          setBlocksLoadWarning("");
          setSubtasksUnavailable(false);
        }
      } finally {
        if (!cancelled) setBlocksLoading(false);
      }
    }

    void loadBenefitTemplates();
    return () => { cancelled = true; };
  }, []);

  const benefits = useMemo(() => [...baseBenefits, ...addedBenefits], [baseBenefits, addedBenefits]);
  const filteredBenefits = benefits.filter((benefit) => benefitTypeFilter === "all" || (benefitTypeFilter === "in_kind" ? benefit.benefitType === "in_kind" || Boolean(benefit.materialLogistics?.trim()) : benefit.benefitType !== "in_kind" && !benefit.materialLogistics?.trim()));
  const quantityBoundAssignedTasks = assignedTasks.filter((task) => {
    const benefit = benefits.find((item) => item.id === task.benefit_id);
    return !benefit || task.workflow_instance <= (benefitWorkflowCount(benefit.quantity, benefit.tasksPerUnit));
  });
  const existingBenefitTitles = new Set(benefits.map((benefit) => normalizeBenefitTitle(benefit.title)));
  const legacyBenefitTaskIds = benefits.filter((benefit) => benefit.completionRequired !== false && !quantityBoundAssignedTasks.some((task) => task.source === "Leistung" && task.benefit_id === benefit.id)).map((benefit) => benefitTaskId(eventId, benefit));
  const taskIds = [...legacyBenefitTaskIds, ...quantityBoundAssignedTasks.map((task) => task.id)];
  const completedTasks = taskIds.filter((taskId) => evidenceTaskIds.includes(taskId) || quantityBoundAssignedTasks.some((task) => task.id === taskId && task.status === "Erledigt") || benefits.some((benefit) => benefitTaskId(eventId, benefit) === taskId && Boolean(benefit.evidence && benefit.evidence !== "Noch kein Nachweis"))).length;
  const contractStatus = !signedOn ? "Offen" : taskIds.length > 0 && completedTasks === taskIds.length ? "Erledigt" : "In Arbeit";
  const editingTasks = editingBenefit ? assignedTasks.filter((task) => task.source === "Leistung" && task.benefit_id === editingBenefit.id && task.workflow_instance <= (benefitWorkflowCount(editingBenefit.quantity, editingBenefit.tasksPerUnit))).sort((a, b) => (a.workflow_instance - b.workflow_instance) || (a.workflow_order ?? 0) - (b.workflow_order ?? 0)) : [];
  const activeBlock = availableBlocks.find((block) => blockKey(block) === editingBlockKey && selectedBlocks.includes(editingBlockKey)) ?? availableBlocks.find((block) => selectedBlocks.includes(blockKey(block))) ?? null;

  function updateNetContractValue(value: string) {
    setContractAmountInput(value);
    const netAmount = parseContractValueInput(value);
    if (!grossContractAmountManuallyEdited && Number.isFinite(netAmount) && netAmount >= 0) {
      setGrossContractAmountInput(String(grossValueFromNet(netAmount)));
    }
  }

  function updateGrossContractValue(value: string) {
    setGrossContractAmountInput(value);
    setGrossContractAmountManuallyEdited(true);
  }

  function finishGrossContractValueEdit() {
    const amount = parseContractValueInput(grossContractAmountInput);
    const netAmount = parseContractValueInput(contractAmountInput);
    if (!Number.isFinite(amount) || amount < 0) {
      setGrossContractAmountInput(String(grossValueFromNet(Number.isFinite(netAmount) && netAmount >= 0 ? netAmount : 0)));
      setGrossContractAmountManuallyEdited(false);
    } else {
      setGrossContractAmountInput(String(amount));
      setGrossContractAmountManuallyEdited(amount !== grossValueFromNet(netAmount));
    }
    setGrossContractAmountFocused(false);
  }

  async function saveContractDetails() {
    if (!(await ensureFeature(eventId, eventTitle, "contracts"))) return;
    const amount = parseContractValueInput(contractAmountInput);
    const grossAmount = grossContractAmountInput.trim() ? parseContractValueInput(grossContractAmountInput) : grossValueFromNet(amount);
    if (!Number.isFinite(amount) || amount < 0) {
      setMessage("Bitte gib einen gültigen Vertragswert netto ein.");
      return;
    }
    if (!Number.isFinite(grossAmount) || grossAmount < 0) {
      setMessage("Bitte gib einen gültigen Bruttovertragswert ein.");
      return;
    }
    try {
      const { error } = await updateContractRecord(contract.id, { netValueCents: Math.round(amount * 100), grossValueCents: Math.round(grossAmount * 100), ...(contract.signatureStatus === "signed" ? { signedAt: signedOn || null } : {}) });
      if (error) throw error;
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
      setContractAmountInput(String(amount));
      setContractAmountFocused(false);
      setMessage(generatedContracts?.pdf ? "Vertragsdaten gespeichert. Erstelle den Vertrag erneut, damit die PDF-Datei die Änderungen enthält." : "Vertragsdaten gespeichert.");
    } catch {
      setMessage("Vertragswerte und Vertragsdatum konnten nicht gespeichert werden.");
    }
  }

  async function downloadSignedContractFile() {
    if (!signedContractFile) return;
    const { data, error } = await downloadContractDocument(signedContractFile);
    if (error || !data) { setMessage("Die gezeichnete Fassung konnte nicht heruntergeladen werden."); return; }
    const url = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = signedContractFile.fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function openAddBenefits() {
    if (!(await ensureFeature(eventId, eventTitle, "benefits"))) return;
    setSelectedBlocks([]);
    setEditingBlockKey("");
    setBenefitQuantities({});
    setSubtaskDueDates({});
    setSubtaskAssignees({});
    setAdding(true);
  }

  function closeAddBenefits() {
    setAdding(false);
    setSelectedBlocks([]);
    setEditingBlockKey("");
    setBenefitQuantities({});
    setSubtaskDueDates({});
    setSubtaskAssignees({});
  }

  async function openBenefitTaskEditor(benefit: EventBenefit) {
    if (!benefit.id) return;
    let tasks = assignedTasks.filter((task) => task.source === "Leistung" && task.benefit_id === benefit.id);
    try {
      const normalization = await normalizeLegacyBenefitTaskInstances(benefit.id);
      if (normalization.error) throw normalization.error;
      if (Number(normalization.data) > 0) {
        const refreshed = await fetchStoredTasks(eventId);
        if (refreshed.error) throw refreshed.error;
        const sponsorTasks = (refreshed.data ?? []).filter((task) => task.event_id === eventId && task.sponsor_id === sponsor.id && task.source === "Leistung");
        tasks = sponsorTasks.filter((task) => task.benefit_id === benefit.id).map(storedTaskToAssignedTask);
        setAssignedTasks((current) => [...current.filter((task) => task.benefit_id !== benefit.id), ...sponsorTasks.map(storedTaskToAssignedTask)]);
        window.dispatchEvent(new Event("sponso:event-timeline-updated"));
      }
    } catch {
      setMessage("Die Aufgaben konnten nicht mit den Leistungseinheiten abgeglichen werden. Bitte aktualisiere die Datenbankmigrationen und versuche es erneut.");
      return;
    }
    setEditingBenefit(benefit);
    setEditingBenefitQuantity(String(benefit.quantity));
    setTaskEditValues(Object.fromEntries(tasks.map((task) => [task.id, { dueAt: task.due_at ?? "", assigneeId: task.assigned_to_sponsor ? SPONSOR_ASSIGNEE : task.assigned_to ?? "" }])));
    setMessage("");
  }

  async function saveBenefitTaskEdits() {
    if (!editingBenefit?.id || savingBenefitId) return;
    const nextQuantity = Number(editingBenefitQuantity);
    if (!Number.isInteger(nextQuantity) || nextQuantity < 1) {
      setMessage("Bitte gib eine ganze Anzahl ab 1 ein.");
      return;
    }
    let tasks = assignedTasks.filter((task) => task.source === "Leistung" && task.benefit_id === editingBenefit.id);
    try {
      const normalization = await normalizeLegacyBenefitTaskInstances(editingBenefit.id);
      if (normalization.error) throw normalization.error;
      if (Number(normalization.data) > 0) {
        const refreshed = await fetchStoredTasks(eventId);
        if (refreshed.error) throw refreshed.error;
        const sponsorTasks = (refreshed.data ?? []).filter((task) => task.event_id === eventId && task.sponsor_id === sponsor.id && task.source === "Leistung");
        tasks = sponsorTasks.filter((task) => task.benefit_id === editingBenefit.id).map(storedTaskToAssignedTask);
        setAssignedTasks((current) => [...current.filter((task) => task.benefit_id !== editingBenefit.id), ...sponsorTasks.map(storedTaskToAssignedTask)]);
      }
    } catch {
      setMessage("Die Aufgaben konnten nicht mit der Leistungsanzahl abgeglichen werden. Bitte aktualisiere die Datenbankmigrationen und versuche es erneut.");
      return;
    }
    const nextWorkflowCount = editingBenefit.tasksPerUnit ? nextQuantity : 1;
    const removedTasks = tasks.filter((task) => task.workflow_instance > nextWorkflowCount);
    const remainingTasks = tasks.filter((task) => task.workflow_instance <= nextWorkflowCount);
    const firstInstance = tasks.length ? Math.min(...tasks.map((task) => task.workflow_instance)) : null;
    const existingBlueprints = firstInstance === null ? [] : tasks
      .filter((task) => task.workflow_instance === firstInstance)
      .sort((a, b) => (a.workflow_order ?? 0) - (b.workflow_order ?? 0))
      .map((task) => ({
        id: task.id,
        title: task.title,
        templateTaskId: task.template_task_id ?? undefined,
        workflowOrder: task.workflow_order ?? undefined,
        completionType: task.completion_type,
        dueAt: task.due_at,
        assignedToSponsor: task.assigned_to_sponsor,
        assignedTo: task.assigned_to,
      }));
    const matchingBlock = availableBlocks.find((block) => normalizeBenefitTitle(block.title) === normalizeBenefitTitle(editingBenefit.title));
    const templateBlueprints = matchingBlock ? tasksForBlock(matchingBlock).map((task) => ({
      id: "",
      title: task.title,
      templateTaskId: task.id === "__primary_task__" ? undefined : task.id,
      workflowOrder: task.sort_order,
      completionType: task.completion_type,
      dueAt: eventEndDate || null,
      assignedToSponsor: task.completion_type === "sponsor_upload",
      assignedTo: null,
    })) : [];
    const taskBlueprints = existingBlueprints.length ? existingBlueprints : templateBlueprints;
    if (editingBenefit.completionRequired !== false && !taskBlueprints.length && nextWorkflowCount > (benefitWorkflowCount(editingBenefit.quantity, editingBenefit.tasksPerUnit))) {
      setMessage("Die zugehörigen Aufgaben konnten nicht ermittelt werden. Bitte lade die Seite neu und versuche es erneut.");
      return;
    }
    const taskBlueprintKey = (task: { title: string; templateTaskId?: string; workflowOrder?: number }) => task.templateTaskId ? `template:${task.templateTaskId}` : `order:${task.workflowOrder ?? "none"}:${task.title}`;
    const existingTaskKeys = new Set(tasks.map((task) => `${task.workflow_instance}:${taskBlueprintKey({ title: task.title, templateTaskId: task.template_task_id ?? undefined, workflowOrder: task.workflow_order ?? undefined })}`));
    const addedTaskInputs: TaskInput[] = editingBenefit.completionRequired === false ? [] : Array.from({ length: nextWorkflowCount }, (_, index) => index + 1)
      .flatMap((workflowInstance) => taskBlueprints.filter((blueprint) => !existingTaskKeys.has(`${workflowInstance}:${taskBlueprintKey(blueprint)}`)).map((task) => {
        const value = task.id ? taskEditValues[task.id] ?? { dueAt: task.dueAt ?? "", assigneeId: task.assignedToSponsor ? SPONSOR_ASSIGNEE : task.assignedTo ?? "" } : { dueAt: task.dueAt ?? "", assigneeId: task.assignedToSponsor ? SPONSOR_ASSIGNEE : "" };
        const assignedToSponsor = task.completionType === "sponsor_upload" || (task.completionType !== "sponsor_approval" && value.assigneeId === SPONSOR_ASSIGNEE);
        return {
          title: task.title,
          eventId,
          sponsorId: sponsor.id,
          sponsorName: sponsor.name,
          benefitId: editingBenefit.id,
          source: "Leistung" as const,
          templateTaskId: task.templateTaskId,
          workflowOrder: task.workflowOrder,
          workflowInstance,
          completionType: task.completionType,
          dueAt: value.dueAt || undefined,
          assignedTo: task.completionType === "sponsor_approval" || assignedToSponsor ? undefined : value.assigneeId || undefined,
          assignedToSponsor,
        };
      }));

    if (addedTaskInputs.length && !(await ensureFeature(eventId, eventTitle, "tasks"))) return;
    setSavingBenefitId(editingBenefit.id);
    try {
      const results = await Promise.all(remainingTasks.map((task) => {
        const value = taskEditValues[task.id] ?? { dueAt: task.due_at ?? "", assigneeId: task.assigned_to_sponsor ? SPONSOR_ASSIGNEE : task.assigned_to ?? "" };
        const assignedToSponsor = task.completion_type === "sponsor_upload" || (task.completion_type !== "sponsor_approval" && value.assigneeId === SPONSOR_ASSIGNEE);
        return updateStoredTask(task.id, { dueAt: value.dueAt || null, assignedTo: task.completion_type === "sponsor_approval" || assignedToSponsor ? null : value.assigneeId || null, assignedToSponsor });
      }));
      const failed = results.find((result) => result.error)?.error;
      if (failed) throw failed;

      let createdTasks: AssignedTask[] = [];
      if (addedTaskInputs.length > 0) {
        const result = await createStoredTasks(addedTaskInputs);
        if (result.error) throw result.error;
        createdTasks = (result.data ?? []).map((task) => ({ id: task.id, title: task.title, benefit_id: task.benefit_id, source: task.source, status: task.status, assigned_to: task.assigned_to, assigned_to_sponsor: task.assigned_to_sponsor, due_at: task.due_at, completion_type: task.completion_type, workflow_instance: task.workflow_instance, workflow_order: task.workflow_order, template_task_id: task.template_task_id }));
      }

      if (nextQuantity !== editingBenefit.quantity) {
        const { error: benefitError } = await updateStoredBenefit(editingBenefit.id, { quantity: nextQuantity });
        if (benefitError) {
          if (createdTasks.length) await deleteStoredTasks(createdTasks.map((task) => task.id));
          throw benefitError;
        }
      }

      const remainingTaskIds = new Set(remainingTasks.map((task) => task.id));
      setAssignedTasks((current) => [
        ...current.map((task) => {
          if (!remainingTaskIds.has(task.id)) return task;
          const value = taskEditValues[task.id] ?? { dueAt: task.due_at ?? "", assigneeId: task.assigned_to_sponsor ? SPONSOR_ASSIGNEE : task.assigned_to ?? "" };
          const assignedToSponsor = task.completion_type === "sponsor_upload" || (task.completion_type !== "sponsor_approval" && value.assigneeId === SPONSOR_ASSIGNEE);
          return { ...task, due_at: value.dueAt || null, assigned_to: task.completion_type === "sponsor_approval" || assignedToSponsor ? null : value.assigneeId || null, assigned_to_sponsor: assignedToSponsor };
        }),
        ...createdTasks,
      ]);
      setAddedBenefits((current) => current.map((benefit) => benefit.id === editingBenefit.id ? { ...benefit, quantity: nextQuantity } : benefit));
      setEditingBenefit(null);
      setMessage(removedTasks.length
        ? "Anzahl und Aufgaben wurden gespeichert. Aufgaben und Nachweise der übrigen Einheiten bleiben für die Historie erhalten und werden nicht mehr mitgezählt."
        : "Anzahl und zugehörige Aufgaben wurden synchronisiert. Personen und Fälligkeiten sind gespeichert.");
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
    } catch {
      setMessage("Änderungen konnten nicht vollständig gespeichert werden.");
    } finally {
      setSavingBenefitId(null);
    }
  }

  async function addSelectedBlocks() {
    if (!(await ensureFeature(eventId, eventTitle, "benefits"))) return;
    try {
      const alreadyAdded = new Set(benefits.map((benefit) => normalizeBenefitTitle(benefit.title)));
      const requested = availableBlocks.filter((block) => selectedBlocks.includes(blockKey(block)));
      if (blocksLoadWarning && (subtasksUnavailable || requested.some((block) => (block.subtasks?.length ?? 0) > 0))) {
        setMessage("Die Unteraufgaben können erst angelegt werden, wenn die aktuelle Datenbankmigration eingespielt ist.");
        return;
      }
      const seen = new Set(alreadyAdded);
      const eligible = requested.filter((block) => {
        const key = normalizeBenefitTitle(block.title);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (eligible.length < requested.length) {
        setMessage("Ein oder mehrere Bausteine wurden diesem Sponsor im Event bereits hinzugefügt und übersprungen.");
      }
      if (eligible.some((block) => tasksForBlock(block).length > 0) && !(await ensureFeature(eventId, eventTitle, "tasks"))) return;
      const invalidQuantity = eligible.some((block) => {
        const quantity = Number(benefitQuantities[blockKey(block)] ?? "1");
        return !Number.isInteger(quantity) || quantity < 1;
      });
      if (invalidQuantity) {
        setMessage("Bitte gib für jeden Baustein eine ganze Anzahl ab 1 ein.");
        return;
      }
      const additions = eligible.map((block): EventBenefit => ({
        title: block.title,
        benefitType: block.benefit_type ?? "monetary",
        materialLogistics: block.material_logistics?.trim() ?? "",
        category: block.category,
        description: block.description,
        quantity: Number(benefitQuantities[blockKey(block)] ?? "1"),
        tasksPerUnit: block.tasks_per_unit !== false,
        status: block.default_completion_type === "none_required" ? "Keine Aufgaben vorgesehen" : "Offen",
        evidence: "Noch kein Nachweis",
        completionRequired: block.default_completion_type !== "none_required",
        sponsorId: sponsor.id,
        eventId,
        dueAt: undefined,
      }));
      if (additions.length === 0) {
        if (requested.length === 0) setMessage("Wähle zuerst mindestens einen Baustein aus.");
        else {
          setSelectedBlocks([]);
          setAdding(false);
          setMessage("Diese Bausteine wurden diesem Sponsor im Event bereits hinzugefügt.");
        }
        return;
      }
      const result = await createStoredBenefits(additions.map((benefit) => ({
          eventId: benefit.eventId,
          sponsorId: benefit.sponsorId,
          contractId: contract.id,
          title: benefit.title,
          benefitType: benefit.benefitType,
          materialLogistics: benefit.materialLogistics,
          category: benefit.category,
          description: benefit.description,
          status: benefit.status,
          evidence: benefit.evidence,
          completionRequired: benefit.completionRequired,
          quantity: benefit.quantity,
          tasksPerUnit: benefit.tasksPerUnit,
          dueAt: benefit.dueAt,
      })));
      if (result.error) throw result.error;
      const savedAdditions = result.data.map(storedBenefitToEventBenefit);
      const taskInputs = eligible.flatMap((block) => {
        const benefit = savedAdditions.find((item) => normalizeBenefitTitle(item.title) === normalizeBenefitTitle(block.title));
        if (!benefit?.id) return [];
        const workflowCount = benefitWorkflowCount(benefit.quantity, benefit.tasksPerUnit);
        return Array.from({ length: workflowCount }, (_, instanceIndex) => tasksForBlock(block).map((task) => {
          const key = subtaskKey(block, task);
          return {
            title: task.title,
            eventId,
            sponsorId: sponsor.id,
            sponsorName: sponsor.name,
            benefitId: benefit.id,
            templateTaskId: task.id === "__primary_task__" ? undefined : task.id,
            workflowOrder: task.sort_order,
            workflowInstance: instanceIndex + 1,
            source: "Leistung" as const,
            completionType: task.completion_type,
            dueAt: subtaskDueDates[key] || eventEndDate || undefined,
            assignedTo: task.completion_type === "sponsor_approval" || task.completion_type === "sponsor_upload" || subtaskAssignees[key] === SPONSOR_ASSIGNEE ? undefined : subtaskAssignees[key] || undefined,
            assignedToSponsor: task.completion_type === "sponsor_upload" || (task.completion_type !== "sponsor_approval" && subtaskAssignees[key] === SPONSOR_ASSIGNEE),
          };
        })).flat();
      });
      if (taskInputs.length) {
        const taskResult = await createStoredTasks(taskInputs);
        if (taskResult.error) {
          await createClient().from("benefits").delete().in("id", savedAdditions.map((item) => item.id).filter(Boolean));
          throw taskResult.error;
        }
        setAssignedTasks((current) => [...current, ...(taskResult.data ?? []).map((task) => ({ id: task.id, title: task.title, benefit_id: task.benefit_id, source: task.source, status: task.status, assigned_to: task.assigned_to, assigned_to_sponsor: task.assigned_to_sponsor, due_at: task.due_at, completion_type: task.completion_type, workflow_instance: task.workflow_instance, workflow_order: task.workflow_order, template_task_id: task.template_task_id }))]);
      }
      setAddedBenefits((current) => [...current, ...savedAdditions]);
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
      setSelectedBlocks([]);
      setBenefitQuantities({});
      setSubtaskDueDates({});
      setSubtaskAssignees({});
      setAdding(false);
      setMessage(eligible.length < requested.length
        ? `${additions.length} ${additions.length === 1 ? "Leistung hinzugefügt" : "Leistungen hinzugefügt"}. Bereits vorhandene Bausteine wurden übersprungen.`
        : `${additions.length} ${additions.length === 1 ? "Leistung hinzugefügt" : "Leistungen hinzugefügt"}.`);
    } catch (error) {
      setMessage(error instanceof Error && error.message.includes("TASK_WORKFLOW_INVALID_TRANSITION")
        ? "Die Unteraufgaben dieses Bausteins haben eine ungültige Reihenfolge. Bitte korrigiere zuerst die Abschlussarten im Baustein."
        : "Die Leistungen konnten nicht gespeichert werden.");
    }
  }

  async function removeBenefit(benefit: EventBenefit) {
    if (!benefit.id || removingBenefitId) return;
    const units = benefit.quantity > 1 ? ` (${benefit.quantity} Einheiten)` : "";
    if (!window.confirm(`„${benefit.title}“${units} aus diesem Sponsor-Event entfernen? Zugehörige Aufgaben und Nachweise werden ebenfalls entfernt.`)) return;

    setRemovingBenefitId(benefit.id);
    try {
      const supabase = createClient();
      const taskResult = await supabase.from("tasks").select("id").eq("event_id", eventId).eq("sponsor_id", sponsor.id).eq("benefit_id", benefit.id);
      if (taskResult.error) throw taskResult.error;
      const taskIds = (taskResult.data ?? []).map((task) => task.id as string);
      const evidenceQueries = [supabase.from("evidence_files").select("storage_path").eq("event_id", eventId).eq("benefit_id", benefit.id)];
      if (taskIds.length) evidenceQueries.push(supabase.from("evidence_files").select("storage_path").eq("event_id", eventId).in("task_id", taskIds));
      const evidenceResults = await Promise.all(evidenceQueries);
      const evidenceError = evidenceResults.find((result) => result.error)?.error;
      if (evidenceError) throw evidenceError;

      const { error } = await supabase.from("benefits").delete().eq("id", benefit.id).eq("event_id", eventId).eq("sponsor_id", sponsor.id);
      if (error) throw error;

      const storagePaths = [...new Set(evidenceResults.flatMap((result) => result.data ?? []).map((item) => item.storage_path as string).filter(Boolean))];
      const { error: storageError } = storagePaths.length ? await supabase.storage.from("sponsorproof-files").remove(storagePaths) : { error: null };
      setAddedBenefits((current) => current.filter((item) => item.id !== benefit.id));
      setAssignedTasks((current) => current.filter((task) => task.benefit_id !== benefit.id));
      setMessage(storageError ? `„${benefit.title}“ wurde entfernt. Mindestens eine Nachweisdatei konnte nicht aus dem Archiv gelöscht werden.` : `„${benefit.title}“ wurde aus diesem Sponsor-Event entfernt.`);
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
    } catch {
      setMessage("Die Leistung konnte nicht entfernt werden.");
    } finally {
      setRemovingBenefitId(null);
    }
  }

  async function setContractDocumentSponsorAccess(document: ContractDocument, visible: boolean) {
    if (visible) {
      if (paidSigningDocumentId !== document.id || !signatureAddonEnabled || contract.signatureStatus !== "draft" || signingBusy) return;
      setSigningBusy(true);
      setMessage("");
      try {
        const response = await fetch(`/api/contracts/${contract.id}/signature-release`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractId: contract.id, signingDocumentId: document.id }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Der Vertrag konnte nicht freigegeben werden.");
        window.location.reload();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Der Vertrag konnte nicht freigegeben werden.");
        setSigningBusy(false);
      }
      return;
    }
    if (contract.signatureStatus !== "draft" || signingBusy || signingDocumentId !== document.id) return;
    setSigningBusy(true);
    const { error } = await updateContractRecord(contract.id, { signingDocumentId: null });
    if (error) setMessage("Die Freigabe des Vertrags konnte nicht zurückgenommen werden.");
    else {
      setSigningDocumentId("");
      setMessage("Die Vertragsdatei ist für den Sponsor nicht mehr zur Zeichnung freigegeben.");
    }
    setSigningBusy(false);
  }

  async function removeContractDocument(document: ContractDocument) {
    if (deletingContractDocumentId) return;
    if (signingDocumentId === document.id && contract.signatureStatus !== "draft") {
      setMessage("Eine Vertragsdatei kann während oder nach der Zeichnung nicht gelöscht werden.");
      return;
    }
    if (!window.confirm(`Die Vertragsdatei „${document.fileName}“ löschen?`)) return;
    setDeletingContractDocumentId(document.id);
    setMessage("");
    try {
      if (signingDocumentId === document.id) {
        const { error } = await updateContractRecord(contract.id, { signingDocumentId: null });
        if (error) throw error;
        setSigningDocumentId("");
      }
      const { error } = await deleteContractDocument(document);
      if (error) {
        const remaining = await fetchContractDocuments(contract.id);
        if (remaining.error || remaining.data?.some((item) => item.id === document.id)) throw error;
      }
      if (document.kind === "generated_pdf") setGeneratedContracts((current) => current ? { ...current, pdf: undefined } : current);
      if (document.kind === "uploaded_pdf") setUploadedContract(null);
      if (document.kind === "generated_docx") setGeneratedContracts((current) => current ? { ...current, docx: undefined } : current);
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
      setMessage("Die Vertragsdatei wurde gelöscht.");
    } catch {
      setMessage("Die Vertragsdatei konnte nicht gelöscht werden.");
    } finally {
      setDeletingContractDocumentId(null);
    }
  }

  function reloadOnContractTab() {
    window.sessionStorage.setItem(`sponso:event-sponsor-tab:${eventId}:${contract.id}`, "Vertrag");
    window.location.reload();
  }

  async function uploadExistingSignedContract(file: File) {
    if (uploadingSignedContract) return;
    if (!signedContractFile && (generatedContracts?.pdf || generatedContracts?.docx || uploadedContract)) {
      setMessage("Es wurde bereits ein Vertrag erstellt. Lösche diesen zuerst, bevor du einen gezeichneten Vertrag hochlädst.");
      return;
    }
    if (!signedContractFile && (contract.signatureStatus === "pending_sponsor" || contract.signatureStatus === "pending_organizer")) {
      setMessage("Der digitale Zeichnungsablauf läuft bereits. Ein gezeichneter Vertrag kann jetzt nicht hochgeladen werden.");
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setMessage("Bitte lade den gezeichneten Vertrag als PDF-Datei hoch.");
      return;
    }
    if (!(await ensureFeature(eventId, eventTitle, "contracts"))) return;
    setUploadingSignedContract(true);
    setMessage("");
    try {
      const { data, error } = await saveContractDocument(contract.id, "signed", file, file.name);
      if (error || !data) throw error ?? new Error("Die Datei konnte nicht gespeichert werden.");
      const signedAt = new Date();
      const localDate = `${signedAt.getFullYear()}-${String(signedAt.getMonth() + 1).padStart(2, "0")}-${String(signedAt.getDate()).padStart(2, "0")}`;
      const { error: contractError } = await updateContractRecord(contract.id, {
        signatureStatus: "signed",
        signedAt: localDate,
        sponsorSignedAt: signedAt.toISOString(),
        organizerSignedAt: signedAt.toISOString(),
        signingDocumentId: null,
      });
      if (contractError) throw contractError;
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
      reloadOnContractTab();
    } catch {
      setMessage("Der gezeichnete Vertrag wurde nicht vollständig gespeichert. Bitte versuche es erneut.");
    } finally {
      setUploadingSignedContract(false);
    }
  }

  async function setSignedContractVisibility(visible: boolean) {
    if (!signedContractFile || updatingSignedContractVisibility) return;
    setUpdatingSignedContractVisibility(true);
    try {
      const { error } = await updateContractRecord(contract.id, { signingDocumentId: visible ? signedContractFile.id : null });
      if (error) throw error;
      setSigningDocumentId(visible ? signedContractFile.id : "");
      setMessage(visible ? "Der gezeichnete Vertrag ist jetzt für den Sponsor verfügbar." : "Der gezeichnete Vertrag ist für den Sponsor ausgeblendet.");
    } catch {
      setMessage("Die Sichtbarkeit für den Sponsor konnte nicht geändert werden.");
    } finally {
      setUpdatingSignedContractVisibility(false);
    }
  }

  async function removeSignedContractFile() {
    if (!signedContractFile || deletingSignedContract) return;
    if (!window.confirm("Den hochgeladenen gezeichneten Vertrag löschen? Der Vertrag wird danach wieder als nicht gezeichnet geführt.")) return;
    setDeletingSignedContract(true);
    setMessage("");
    const previousSignedAt = contractDateForInput(contract.signedAt) || null;
    try {
      const { error: contractError } = await updateContractRecord(contract.id, { signatureStatus: "draft", signedAt: null, sponsorSignedAt: null, organizerSignedAt: null, signingDocumentId: null });
      if (contractError) throw contractError;
      const { error: deleteError } = await deleteContractDocument(signedContractFile);
      if (deleteError) {
        const remaining = await fetchContractDocuments(contract.id);
        if (remaining.error || remaining.data?.some((document) => document.id === signedContractFile.id)) {
          await updateContractRecord(contract.id, { signatureStatus: contract.signatureStatus, signedAt: previousSignedAt, sponsorSignedAt: contract.sponsorSignedAt ?? null, organizerSignedAt: contract.organizerSignedAt ?? null, signingDocumentId: signingDocumentId || null });
          throw deleteError;
        }
      }
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
      reloadOnContractTab();
    } catch {
      setMessage("Der gezeichnete Vertrag konnte nicht gelöscht werden.");
    } finally {
      setDeletingSignedContract(false);
    }
  }

  async function startContractSignaturePayment(signingDocumentId: string) {
    const response = await fetch(`/api/contracts/${contract.id}/signature-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnTo: `${window.location.pathname}${window.location.search}`, signingDocumentId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Der Bezahlvorgang konnte nicht gestartet werden.");
    if (result.alreadyPaid) { window.location.reload(); return; }
    if (typeof result.url !== "string") throw new Error("Der Bezahlvorgang konnte nicht geöffnet werden.");
    window.location.assign(result.url);
  }

  async function revokeSponsorSigning() {
    if (!signatureAddonEnabled || contract.signatureStatus !== "pending_sponsor" || contract.sponsorSignedAt || signingBusy) return;
    if (!window.confirm("Die Freigabe zur Zeichnung zurücknehmen? Der Sponsor kann den Vertrag danach nicht mehr öffnen.")) return;
    setSigningBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/contracts/${contract.id}/simple-signature`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Die Freigabe konnte nicht zurückgenommen werden.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Die Freigabe konnte nicht zurückgenommen werden.");
      setSigningBusy(false);
    }
  }

  async function signAsOrganizer() {
    if (!signatureAddonEnabled || signingBusy) return;
    setSigningBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/contracts/${contract.id}/simple-signature`, { method: "POST" });
      const result = await response.json();
      if (response.status === 402) { await startContractSignaturePayment(contract.signingDocumentId ?? signingDocumentId); return; }
      if (!response.ok) throw new Error(result.error ?? "Die Zeichnung konnte nicht gespeichert werden.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Die Zeichnung konnte nicht gespeichert werden.");
      setSigningBusy(false);
    }
  }

  async function renderContractTemplatePdf(documentBlob: Blob, preview: HTMLDivElement) {
    const { renderAsync } = await import("docx-preview");
    preview.replaceChildren();
    await renderAsync(documentBlob, preview, undefined, { breakPages: true, renderHeaders: true, renderFooters: true });
    await document.fonts.ready;
    const pages = Array.from(preview.querySelectorAll<HTMLElement>(".docx"));
    if (!pages.length) throw new Error("Die Word-Vorlage enthält keine darstellbaren Seiten.");

    const html2canvas = (await import("html2canvas")).default;
    const { jsPDF } = await import("jspdf");
    let pdf: InstanceType<typeof jsPDF> | null = null;
    for (const [index, page] of pages.entries()) {
      const bounds = page.getBoundingClientRect();
      const width = page.offsetWidth || bounds.width;
      const height = page.offsetHeight || bounds.height;
      if (!width || !height) throw new Error("Eine Seite der Word-Vorlage konnte nicht dargestellt werden.");
      const canvas = await html2canvas(page, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        onclone: (clonedDocument) => {
          const clonedPreview = clonedDocument.querySelector(".contract-print-preview") as HTMLElement | null;
          if (clonedPreview) {
            clonedPreview.style.position = "absolute";
            clonedPreview.style.left = "0";
            clonedPreview.style.top = "0";
            clonedPreview.style.zIndex = "1";
            clonedPreview.style.width = `${width}px`;
            clonedPreview.style.visibility = "visible";
          }
        },
      });
      const pageWidth = width * 0.75;
      const pageHeight = height * 0.75;
      const orientation = pageWidth > pageHeight ? "landscape" : "portrait";
      if (!pdf) pdf = new jsPDF({ orientation, unit: "pt", format: [pageWidth, pageHeight], compress: true });
      else pdf.addPage([pageWidth, pageHeight], orientation);
      pdf.addImage(canvas, "JPEG", 0, 0, pageWidth, pageHeight, `contract-page-${index}`, "FAST");
    }
    if (!pdf) throw new Error("Das PDF konnte nicht erstellt werden.");
    return pdf.output("blob");
  }

  async function openContractOutput() {
    if (signedContractFile) {
      setMessage("Ein gezeichneter Vertrag wurde hochgeladen. Lösche ihn zuerst, bevor du einen Vertrag erstellst.");
      return;
    }
    if (benefits.length === 0) {
      setMessage("Füge zuerst mindestens eine Leistung hinzu, bevor du den Vertrag erstellst.");
      return;
    }
    if (!(await ensureFeature(eventId, eventTitle, "contracts"))) return;
    setShowContractOutput(true);
    setContractTemplate(null);
    setTemplateLoadMessage("");
    setTemplateLoading(true);
    try {
      const supabase = createClient();
      const { data: assignment, error: assignmentError } = await supabase
        .from("event_contract_templates")
        .select("template_id")
        .eq("event_id", eventId)
        .maybeSingle();
      if (assignmentError) throw assignmentError;
      if (!assignment) return;
      const { data: template, error: templateError } = await supabase
        .from("contract_templates")
        .select("name, storage_path")
        .eq("id", assignment.template_id)
        .single();
      if (templateError) throw templateError;
      const { data: file, error: fileError } = await supabase.storage.from("sponsorproof-files").download(template.storage_path);
      if (fileError) throw fileError;
      setContractTemplate({ name: template.name, storagePath: template.storage_path, file });
    } catch {
      setTemplateLoadMessage("Die Vertragsvorlage konnte nicht geladen werden. Prüfe bitte, ob die Supabase-Migration ausgeführt wurde.");
    } finally {
      setTemplateLoading(false);
    }
  }

  function downloadDocument(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function createTemplatedDocument(format: "docx" | "pdf") {
    if (creatingContract) return;
    if (signedContractFile) {
      setMessage("Ein gezeichneter Vertrag wurde hochgeladen. Lösche ihn zuerst, bevor du einen Vertrag erstellst.");
      return;
    }
    if (!(await ensureFeature(eventId, eventTitle, "contracts"))) return;
    if (!contractTemplate) {
      setTemplateLoadMessage("Diesem Event ist keine Dokumentenvorlage zugeordnet. Ordne unter Einstellungen → Vertragsvorlage eine vorhandene Vorlage zu oder lade eine neue DOCX-Datei hoch.");
      return;
    }
    const amount = parseContractValueInput(contractAmountInput);
    const grossAmount = grossContractAmountInput.trim() ? parseContractValueInput(grossContractAmountInput) : grossValueFromNet(amount);
    if (!Number.isFinite(amount) || amount < 0) {
      setMessage("Bitte gib einen gültigen Vertragswert netto ein.");
      setShowContractOutput(false);
      return;
    }
    if (!Number.isFinite(grossAmount) || grossAmount < 0) {
      setMessage("Bitte gib einen gültigen Bruttovertragswert ein.");
      setShowContractOutput(false);
      return;
    }
    setCreatingContract(format);
    try {
      const organizerResult = await fetchOrganizerSettings();
      if (organizerResult.error) throw organizerResult.error;
      const savedOrganizer = organizerResult.data ?? {};
      const contractForTemplate = { ...contract, value: formatContractValue(amount), signedAt: signedOn };
      const blob = await fillContractTemplate(contractTemplate.file, {
        organizer: savedOrganizer,
        sponsor,
        contract: contractForTemplate,
        grossValue: grossAmount,
        event: { id: eventId, title: eventTitle, startDate: eventStartDate, endDate: eventEndDate, location: eventLocation, locationStreet: "", locationPostalCode: "", locationCity: "", responsible: eventResponsible, organizerLogoPath: null, createdAt: "", planCode: "free", bookedPlanCode: "free", entitlementStatus: "active", hasPaidEventLicense: false },
        benefits,
      });
      if (format === "docx") {
        const filename = contractFilename(sponsor.name, eventTitle, "docx");
        downloadDocument(blob, filename);
        setShowContractOutput(false);
        try {
          const { data, error } = await saveContractDocument(contract.id, "generated_docx", blob, filename);
          if (error || !data) throw error ?? new Error("Word-Datei konnte nicht gespeichert werden.");
          setGeneratedContracts((current) => ({ ...current, docx: data }));
          window.dispatchEvent(new Event("sponso:event-timeline-updated"));
          setMessage("Der Word-Vertrag wurde heruntergeladen und steht im Vertragsreiter erneut zum Download bereit.");
        } catch {
          setMessage("Der Word-Vertrag wurde heruntergeladen, konnte aber nicht für einen späteren Download gespeichert werden.");
        }
        return;
      }
      if (!printPreviewRef.current) throw new Error("Die PDF-Datei konnte nicht erstellt werden.");
      setPrintReady(true);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const pdfBlob = await renderContractTemplatePdf(blob, printPreviewRef.current);
      const filename = contractFilename(sponsor.name, eventTitle, "pdf");
      downloadDocument(pdfBlob, filename);
      setShowContractOutput(false);
      setPrintReady(false);
      try {
        const { data, error } = await saveContractDocument(contract.id, "generated_pdf", pdfBlob, filename);
        if (error || !data) throw error ?? new Error("PDF konnte nicht gespeichert werden.");
        setGeneratedContracts((current) => ({ ...current, pdf: data }));
        window.dispatchEvent(new Event("sponso:event-timeline-updated"));
        setMessage("Der PDF-Vertrag wurde heruntergeladen und steht im Vertragsreiter erneut zum Download bereit.");
      } catch {
        setMessage("Der PDF-Vertrag wurde heruntergeladen, konnte aber nicht für einen späteren Download gespeichert werden.");
      }
    } catch (error) {
      setPrintReady(false);
      setMessage(error instanceof Error ? `Der Vertrag konnte nicht erstellt werden: ${error.message}` : "Der Vertrag konnte nicht erstellt werden.");
    } finally {
      setCreatingContract(null);
    }
  }

  const sponsorSigned = contract.signatureStatus === "pending_organizer" || contract.signatureStatus === "signed" || Boolean(contract.sponsorSignedAt);
  const organizerSigned = contract.signatureStatus === "signed" || Boolean(contract.organizerSignedAt);
  const contractDocuments = signedContractFile
    ? [signedContractFile]
    : [generatedContracts?.pdf, generatedContracts?.docx, uploadedContract].filter((document): document is ContractDocument => Boolean(document));
  const hasCreatedContract = !signedContractFile && Boolean(generatedContracts?.pdf || generatedContracts?.docx || uploadedContract);
  const createModeBlocked = Boolean(signedContractFile);
  const uploadModeBlocked = hasCreatedContract || (!signedContractFile && (contract.signatureStatus === "pending_sponsor" || contract.signatureStatus === "pending_organizer"));
  const createChoiceMessage = signedContractFile
    ? "Ein gezeichneter Vertrag wurde hochgeladen. Lösche ihn zuerst, bevor du einen Vertrag erstellst."
    : contract.signatureStatus !== "draft"
      ? "Der digitale Zeichnungsablauf wurde bereits gestartet oder abgeschlossen."
      : "Aus der Vorlage erstellen und digital zeichnen lassen.";
  const uploadChoiceMessage = hasCreatedContract
    ? "Es wurde bereits ein Vertrag erstellt. Lösche diesen zuerst, bevor du einen gezeichneten Vertrag hochlädst."
    : uploadModeBlocked
      ? "Der digitale Zeichnungsablauf läuft bereits. Ein gezeichneter Vertrag kann jetzt nicht hochgeladen werden."
      : signedContractFile
        ? "Eine bereits hochgeladene Datei dieses Typs kann hier ersetzt werden."
        : "Eine bereits unterschriebene PDF-Datei hinterlegen.";
  const signerStep = (done: boolean, active: boolean, signer: string, signedAt?: string | null, action?: ReactNode) => <div className={`signature-step ${done ? "done" : active ? "active" : ""}`}><span className="signature-step-marker">{done ? <Icon name="check" size={13}/> : null}</span><div><b>{signer}</b><small>{done ? `Gezeichnet${signedAt ? ` am ${new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(signedAt))}` : ""}` : active ? "Als Nächstes" : "Wartet auf die vorherige Zeichnung"}</small></div>{action}</div>;
  return <section className="panel sponsor-event-detail"><div className="panel-heading"><div><div className="eyebrow">SPONSOR IM EVENT</div><div className="sponsor-event-name-row"><h2>{sponsor.name}</h2><Link className="text-link sponsor-event-customer-link" href={`/sponsors/${sponsor.id}`}>Kundenkartei →</Link></div></div><div className="sponsor-event-heading-actions"><Status value={contractStatus}/><Link className="btn" href={`/events/${eventId}?tab=sponsoren`}>← Alle Sponsoren</Link></div></div>
    <div className="event-sponsor-tabs" role="tablist" aria-label={`Bereiche für ${sponsor.name}`}>
      {(["Leistungen", "Vertrag", "Rechnung", "Dokumente"] as const).map((tab) => <button type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? "active" : ""} key={tab} onClick={() => { setActiveTab(tab); window.sessionStorage.setItem(`sponso:event-sponsor-tab:${eventId}:${contract.id}`, tab); }}>{tab}</button>)}
    </div>
    {activeTab === "Vertrag" && <div className="sponsor-contract-workspace">
      <section className="panel sponsor-contract-data">
        <div className="table-head"><div><h2>Vertragsdaten</h2></div></div>
        <div className="sponsor-contract-detail-grid">
          <div className="contract-volume-field"><label><span>Vertragswert netto</span><input aria-label="Vertragswert netto in Euro" inputMode="decimal" type="text" value={contractAmountFocused ? contractAmountInput : Number.isFinite(parseContractValueInput(contractAmountInput)) ? formatContractValue(parseContractValueInput(contractAmountInput)) : contractAmountInput} onFocus={() => setContractAmountFocused(true)} onChange={(event) => updateNetContractValue(event.target.value)} onBlur={() => setContractAmountFocused(false)} /></label></div>
          <div className="contract-volume-field"><label><span>Vertragswert brutto</span><input aria-label="Vertragswert brutto in Euro" inputMode="decimal" type="text" value={grossContractAmountFocused ? grossContractAmountInput : grossContractAmountInput && Number.isFinite(parseContractValueInput(grossContractAmountInput)) ? formatContractValue(parseContractValueInput(grossContractAmountInput)) : grossContractAmountInput} onFocus={() => setGrossContractAmountFocused(true)} onChange={(event) => updateGrossContractValue(event.target.value)} onBlur={finishGrossContractValueEdit} /></label></div>
          <div><span>Vereinbarte Leistungen</span><b>{benefits.length}</b></div>
          <label className="event-contract-date"><span>Zeichnungsdatum</span><DatePicker aria-label="Zeichnungsdatum" value={signedOn} disabled={contract.signatureStatus !== "signed"} onChange={(event) => setSignedOn(event.target.value)}/>{contract.signatureStatus !== "signed" && <small>Nach beiden Unterschriften automatisch gesetzt.</small>}</label>
        </div>
        <div className="contract-details-save"><button className="btn btn-primary" type="button" onClick={saveContractDetails}>Speichern</button></div>
      </section>
      <section className="panel sponsor-contract-files"><div className="table-head"><div><h2>Vertrag</h2><p className="subtitle" style={{ fontSize: 11, marginTop: 4 }}>Wähle, ob du einen Vertrag aus einer Vorlage erstellen oder einen bereits gezeichneten Vertrag hinterlegen möchtest.</p></div></div>{benefits.length === 0 && <p className="field-message hint" role="status">Füge zuerst mindestens eine Leistung hinzu, bevor du einen Vertrag erstellst.</p>}<div className="contract-workflow-choice" role="group" aria-label="Vertragsweg auswählen"><button className={`contract-workflow-choice-button${contractWorkflowMode === "create" ? " active" : ""}`} type="button" aria-pressed={contractWorkflowMode === "create"} onClick={() => setContractWorkflowMode("create")}><Icon name="file" size={17}/><span><b>Vertrag erstellen</b><small className={createModeBlocked || contract.signatureStatus !== "draft" ? "blocked" : undefined}>{createChoiceMessage}</small></span></button><button className={`contract-workflow-choice-button${contractWorkflowMode === "upload" ? " active" : ""}`} type="button" aria-pressed={contractWorkflowMode === "upload"} onClick={() => setContractWorkflowMode("upload")}><Icon name="file" size={17}/><span><b>Gezeichneten Vertrag hochladen</b><small className={uploadModeBlocked ? "blocked" : undefined}>{uploadChoiceMessage}</small></span></button></div>
        {contractWorkflowMode === "create" && !createModeBlocked && <div className="contract-workflow-content"><p className="subtitle">Der Vertrag wird aus der hinterlegten Vorlage erstellt. Danach kannst du ihn dem Sponsor zur digitalen Zeichnung freigeben.</p>{contract.signatureStatus === "draft" && <div className="contract-file-actions"><button className="btn btn-primary" type="button" disabled={benefits.length === 0} title={benefits.length === 0 ? "Füge zuerst mindestens eine Leistung hinzu." : undefined} onClick={() => { void openContractOutput(); }}><Icon name="file" size={15}/> Vertrag erstellen</button></div>}</div>}
        {contractWorkflowMode === "upload" && !uploadModeBlocked && <div className="contract-workflow-content"><p className="subtitle">Der Vertrag wird direkt als gezeichnet markiert. Eine digitale Zeichnung ist danach nicht möglich.{signedContractFile ? " Du kannst die vorhandene gezeichnete Datei hier ersetzen." : ""}</p><label className="settings-field signed-contract-upload-field"><span>{signedContractFile ? "Gezeichneten Vertrag ersetzen" : "Gezeichneten Vertrag als PDF auswählen"}</span><input type="file" accept=".pdf,application/pdf" disabled={uploadingSignedContract || deletingSignedContract} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void uploadExistingSignedContract(file); }}/>{uploadingSignedContract && <small role="status">Vertrag wird hochgeladen …</small>}</label></div>}
        {contractDocuments.length > 0 && ((contractWorkflowMode === "create" && !createModeBlocked && !signedContractFile) || (contractWorkflowMode === "upload" && !uploadModeBlocked && Boolean(signedContractFile))) && <div className="contract-document-list">{contractDocuments.map((document) => <article className="contract-document-card" key={document.id}><div className="contract-document-file"><Icon name="file" size={17}/><div><b>{document.fileName}</b><small>{document.kind === "generated_pdf" ? "Erstellter Vertrag · PDF" : document.kind === "generated_docx" ? "Erstellter Vertrag · Word-Datei" : document.kind === "signed" ? "Gezeichneter Vertrag" : "Hochgeladener Vertragsentwurf"} · {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(document.createdAt))}</small></div></div><div className="contract-document-actions"><button className="btn" type="button" onClick={async () => { const { data, error } = await downloadContractDocument(document); if (error || !data) { setMessage("Die Vertragsdatei konnte nicht geladen werden."); return; } downloadDocument(data, document.fileName); }}><Icon name="file" size={14}/> Herunterladen</button>{signatureAddonEnabled && document.kind !== "generated_docx" && contract.signatureStatus === "draft" && (paidSigningDocumentId === document.id ? <span className="status status-done contract-document-paid-status">Gebühr bezahlt</span> : !paidSigningDocumentId && <button className="btn btn-primary contract-document-payment-button" type="button" disabled={signingBusy || signaturePriceCents === null} onClick={() => { setSigningBusy(true); setMessage(""); void startContractSignaturePayment(document.id).catch((error) => { setMessage(error instanceof Error ? error.message : "Der Bezahlvorgang konnte nicht gestartet werden."); setSigningBusy(false); }); }}>{signingBusy ? "Wird vorbereitet …" : "Zeichnung freischalten"}</button>)}<button className="btn signed-contract-delete" type="button" disabled={deletingContractDocumentId !== null || (document.kind === "signed" && deletingSignedContract) || (signingDocumentId === document.id && document.kind !== "signed" && contract.signatureStatus !== "draft") || paidSigningDocumentId === document.id} onClick={() => { if (document.kind === "signed") void removeSignedContractFile(); else void removeContractDocument(document); }}>{document.kind === "signed" ? deletingSignedContract ? "Wird gelöscht …" : "Löschen" : deletingContractDocumentId === document.id ? "Wird gelöscht …" : "Löschen"}</button></div>{document.kind === "signed" ? <label className="signed-contract-sponsor-visibility"><input type="checkbox" checked={signingDocumentId === document.id} disabled={updatingSignedContractVisibility || deletingSignedContract} onChange={(event) => { void setSignedContractVisibility(event.currentTarget.checked); }}/><span><b>Gezeichneten Vertrag dem Sponsor anzeigen</b><small>{signingDocumentId === document.id ? "Der Sponsor kann die gezeichnete Datei im Vertragsbereich herunterladen." : "Die Datei bleibt intern, bis du sie hier für den Sponsor freigibst."}</small></span></label> : signatureAddonEnabled && document.kind !== "generated_docx" && <label className="signed-contract-sponsor-visibility">
  <input type="checkbox" checked={signingDocumentId === document.id} disabled={(contract.signatureStatus !== "draft" && !(contract.signatureStatus === "pending_sponsor" && !sponsorSigned)) || (contract.signatureStatus === "draft" && paidSigningDocumentId !== document.id) || signingBusy || deletingContractDocumentId !== null} onChange={(event) => { if (event.currentTarget.checked) void setContractDocumentSponsorAccess(document, true); else if (contract.signatureStatus === "pending_sponsor") void revokeSponsorSigning(); else void setContractDocumentSponsorAccess(document, false); }}/>
  <span><b>PDF für den Sponsor freigeben</b><small>{signingDocumentId === document.id && contract.signatureStatus === "pending_sponsor" ? "Freigegeben. Der Sponsor kann jetzt unterschreiben." : paidSigningDocumentId === document.id ? "Gebühr bezahlt. Du kannst die PDF jetzt zur Zeichnung freigeben." : paidSigningDocumentId ? "Die Gebühr wurde bereits für eine andere PDF bezahlt." : `Vor der Freigabe ist eine Gebühr von ${signaturePriceCents === null ? "…" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(signaturePriceCents / 100)} fällig.`}</small></span>
</label>}</article>)}</div>}
      </section>
      {signatureAddonEnabled && contractWorkflowMode === "create" && <section className="panel contract-signature-preparation">
        <div className="table-head"><div><h2>Digitale Unterschrift</h2><p className="subtitle">Sponsor, dann Veranstalter.</p></div><span className={`status ${contract.signatureStatus === "signed" ? "status-done" : contract.signatureStatus === "pending_sponsor" || contract.signatureStatus === "pending_organizer" ? "status-progress" : "status-open"}`}>{contract.signatureStatus === "signed" ? "Abgeschlossen" : contract.signatureStatus === "pending_organizer" ? "Veranstalter zeichnet" : contract.signatureStatus === "pending_sponsor" ? "Sponsor zeichnet" : "Nicht gestartet"}</span></div>
        {contract.signatureStatus === "pending_organizer" && <div className="contract-sponsor-signed-notice" role="status"><b>Der Sponsor hat unterschrieben.</b><span>Du kannst den Vertrag jetzt gegenzeichnen.</span></div>}
        <div className="signature-steps">{signerStep(sponsorSigned, contract.signatureStatus === "pending_sponsor", "1. Sponsor", contract.sponsorSignedAt)}{signerStep(organizerSigned, contract.signatureStatus === "pending_organizer", "2. Veranstalter", contract.organizerSignedAt, contract.signatureStatus === "pending_organizer" && <button className="btn btn-primary signature-step-action" type="button" disabled={signingBusy} onClick={() => { void signAsOrganizer(); }}>{signingBusy ? "Wird gespeichert …" : "Jetzt unterschreiben"}</button>)}</div>
        <p className="contract-signature-note">{signedContractFile ? "Der gezeichnete Vertrag wurde hochgeladen. Eine weitere digitale Unterschrift ist nicht möglich." : signingDocumentId ? "Die Zahlung ist erfolgt. Der Sponsor kann nach der Freigabe unterschreiben." : paidSigningDocumentId ? "Gebühr bezahlt. Aktiviere bei der PDF die Checkbox, um sie zur Zeichnung freizugeben." : contractDocuments.some((document) => document.kind === "generated_pdf" || document.kind === "uploaded_pdf") ? "Bezahle zuerst die Gebühr neben der gewünschten PDF. Danach kannst du sie zur Zeichnung freigeben." : "Erstelle zuerst eine Vertrags-PDF, um den Zeichnungsablauf zu starten."}{!signedContractFile && " Die Klick-Unterschrift ist eine interne Bestätigung und keine qualifizierte elektronische Signatur."}</p>
      </section>}
    </div>}
    {activeTab === "Leistungen" && <div className="panel table-panel sponsor-contract-benefits"><div className="table-head"><div><h2>Vereinbarte Leistungen</h2><p className="subtitle" style={{ fontSize: 11, marginTop: 4 }}>Einzelleistungen und Nachweisstatus für diesen Eventvertrag.</p></div><button className="btn btn-primary" type="button" onClick={() => { setMessage(""); openAddBenefits(); }}><Icon name="plus" size={14}/> Leistung hinzufügen</button></div><div className="sponsor-benefit-filters" role="group" aria-label="Leistungen nach Art filtern">{([{ value: "all", label: "Alle" }, { value: "monetary", label: "Geldleistungen" }, { value: "in_kind", label: "Sachleistungen" }] as const).map((filter) => <button key={filter.value} className={`filter-chip${benefitTypeFilter === filter.value ? " active" : ""}`} type="button" aria-pressed={benefitTypeFilter === filter.value} onClick={() => setBenefitTypeFilter(filter.value)}>{filter.label}</button>)}</div>{benefitTypeFilter === "in_kind" && <p className="sponsor-in-kind-origin-note">Die Sachleistungen ergeben sich aus den Leistungen, die im Reiter „Leistungen“ ausgewählt wurden. Sachleistungen werden zur besseren Nachvollziehbarkeit hier gesondert ausgegeben.</p>}{filteredBenefits.length ? <div className="sponsor-benefit-cards">{filteredBenefits.map((benefit) => {
      const benefitTasks = quantityBoundAssignedTasks.filter((task) => task.source === "Leistung" && task.benefit_id === benefit.id);
      const taskDueDates = [...new Set(benefitTasks.flatMap((task) => task.due_at ? [task.due_at] : []))].sort();
      const dueDate = taskDueDates.length ? [...new Set(taskDueDates.map(displayBenefitDate))].join(", ") : benefit.dueAt ? displayBenefitDate(benefit.dueAt) : "—";
      const assignedPeople = [...new Set(benefitTasks.map((task) => {
        if (task.assigned_to_sponsor || task.completion_type === "sponsor_upload" || task.completion_type === "sponsor_approval") return "Sponsor";
        const member = organizerMembers.find((item) => item.user_id === task.assigned_to);
        return member ? organizerMemberName(member) : task.assigned_to ? "Name nicht hinterlegt" : "Nicht zugewiesen";
      }))];
      return <article className="sponsor-benefit-card" key={benefit.id ?? benefit.title}>
      <details className="sponsor-benefit-card-disclosure">
        <summary><span className="benefit-kind-badge">{benefit.benefitType === "in_kind" ? "Sachleistung" : "Geldleistung"}</span><span className="sponsor-benefit-card-title"><b>{benefit.title}</b>{benefit.description && <small>{benefit.description}</small>}</span></summary>
        <div className="sponsor-benefit-card-expanded"><dl className="sponsor-benefit-card-details"><div><dt>Anzahl</dt><dd>{benefit.quantity}</dd></div><div><dt>Kategorie</dt><dd>{benefit.category}</dd></div><div><dt>Fällig</dt><dd>{benefit.completionRequired === false ? "—" : dueDate}</dd></div>{benefit.completionRequired !== false && <><div><dt>Nachweis</dt><dd>{benefit.evidence || "Noch kein Nachweis"}</dd></div><div><dt>Zuständige Person</dt><dd>{assignedPeople.length ? assignedPeople.join(", ") : "Nicht zugewiesen"}</dd></div></>}</dl>{benefit.materialLogistics && <p className="sponsor-in-kind-logistics"><b>Zusätzliche Materiallogistik:</b> {benefit.materialLogistics}</p>}</div>
      </details>
      <div className="sponsor-benefit-card-tools"><Status value={benefit.completionRequired === false ? "Keine Aufgaben vorgesehen" : benefit.evidence && benefit.evidence !== "Noch kein Nachweis" ? "Erledigt" : "Offen"}/><details className="task-overflow-menu sponsor-benefit-overflow-menu"><summary className="btn" aria-label={`Aktionen für ${benefit.title}`} title="Aktionen"><Icon name="menu" size={15}/></summary><div className="task-overflow-menu-items"><button className="btn task-overflow-menu-item" type="button" disabled={!benefit.id || removingBenefitId !== null || savingBenefitId !== null} onClick={() => openBenefitTaskEditor(benefit)}>Bearbeiten</button><button className="btn task-overflow-menu-item" type="button" disabled={!benefit.id || removingBenefitId !== null || savingBenefitId !== null} onClick={() => { void removeBenefit(benefit); }}>{removingBenefitId === benefit.id ? "Wird entfernt …" : "Entfernen"}</button></div></details><div className="sponsor-benefit-card-actions"><button className="btn" type="button" disabled={!benefit.id || removingBenefitId !== null || savingBenefitId !== null} onClick={() => openBenefitTaskEditor(benefit)}>Bearbeiten</button><button className="btn" type="button" disabled={!benefit.id || removingBenefitId !== null || savingBenefitId !== null} onClick={() => { void removeBenefit(benefit); }}>{removingBenefitId === benefit.id ? "Wird entfernt …" : "Entfernen"}</button></div></div>
    </article>;
    })}</div> : benefits.length ? <EmptyState className="empty-state-compact" title="Keine passenden Leistungen" description="Für diese Leistungsart wurden noch keine Leistungen hinzugefügt." /> : <EmptyState className="empty-state-compact" title="Noch keine Leistungen" description="Füge Leistungen aus der Bausteinbibliothek zu diesem Vertrag hinzu." action={<button className="btn btn-primary" type="button" onClick={() => { setMessage(""); openAddBenefits(); }}><Icon name="plus" size={14}/> Leistung hinzufügen</button>} />}</div>}

    {activeTab === "Rechnung" && <EventSponsorInvoice eventId={eventId} sponsorId={sponsor.id} sponsorName={sponsor.name} mode="organizer" />}
    {activeTab === "Dokumente" && <div className="event-sponsor-documents"><SponsorDocumentArea eventId={eventId} sponsorId={sponsor.id} sponsorName={sponsor.name}/>{signedContractFile && <section className="panel signed-contract-file"><div><b>{signedContractFile.fileName}</b><span>Gezeichnete Fassung · hochgeladen am {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(signedContractFile.createdAt))}</span></div><button className="btn" type="button" onClick={() => { void downloadSignedContractFile(); }}><Icon name="file" size={14}/> Herunterladen</button></section>}</div>}
    {message && <p className={`task-feedback${activeTab === "Vertrag" ? " sponsor-contract-feedback" : ""}`} role="status">{message}</p>}
    {editingBenefit && <Modal labelledBy="edit-benefit-tasks-title" className="create-modal add-benefit-modal" backdropClassName="modal-backdrop" role="dialog" busy={Boolean(savingBenefitId)} onClose={() => setEditingBenefit(null)}><div className="create-modal-head"><div><h2 id="edit-benefit-tasks-title">{editingBenefit.benefitType === "in_kind" ? "Sachleistung bearbeiten" : "Leistung bearbeiten"}</h2><p>Ändere Anzahl, Fälligkeit und zuständige Person für „{editingBenefit.title}“.</p></div><button className="icon-button" type="button" aria-label="Dialog schließen" disabled={Boolean(savingBenefitId)} onClick={() => setEditingBenefit(null)}><Icon name="close" size={16}/></button></div><label className="settings-field benefit-edit-quantity"><span>Anzahl</span><input type="number" min="1" step="1" value={editingBenefitQuantity} disabled={Boolean(savingBenefitId)} onChange={(event) => setEditingBenefitQuantity(event.target.value)}/><small>Erledigte Einheiten und vorhandene Nachweise bleiben für die Historie gespeichert, zählen bei geringerer Anzahl aber nicht mehr mit.</small></label><div className="add-benefit-options">{editingTasks.length ? editingTasks.map((task) => {
      const value = taskEditValues[task.id] ?? { dueAt: task.due_at ?? "", assigneeId: task.assigned_to_sponsor ? SPONSOR_ASSIGNEE : task.assigned_to ?? "" };
      const isNeedDate = (editingBenefit.benefitType === "in_kind" || Boolean(editingBenefit.materialLogistics?.trim())) && task.completion_type !== "sponsor_approval" && !editingTasks.some((other) => other.workflow_instance === task.workflow_instance && other.completion_type !== "sponsor_approval" && (other.workflow_order ?? 0) < (task.workflow_order ?? 0));
      const sponsorCompletesTask = task.completion_type === "sponsor_approval" || task.completion_type === "sponsor_upload";
      return <div className="add-benefit-subtask-row benefit-edit-subtask-row" key={task.id}><span><b>{editingBenefit.quantity > 1 ? `Leistung ${task.workflow_instance} · ` : ""}{task.title}</b></span>{!sponsorCompletesTask ? <label className="settings-field"><span>Zugeordnete Person</span><select value={value.assigneeId} onChange={(event) => setTaskEditValues((current) => ({ ...current, [task.id]: { ...value, assigneeId: event.target.value } }))}><option value="">Nicht zugewiesen</option><option value={SPONSOR_ASSIGNEE}>Sponsor</option>{organizerMembers.map((member) => <option key={member.user_id} value={member.user_id}>{organizerMemberName(member)} · {member.role === "owner" ? "Inhaber" : "Mitglied"}</option>)}</select></label> : <span className="benefit-edit-sponsor-note">{task.completion_type === "sponsor_upload" ? "Datei-Upload durch Sponsor" : "Durch Sponsor erledigt"}</span>}<label className="settings-field"><span>{isNeedDate ? "Benötigt am" : "Fällig am"}</span><DatePicker value={value.dueAt} onChange={(event) => setTaskEditValues((current) => ({ ...current, [task.id]: { ...value, dueAt: event.target.value } }))}/></label></div>;
    }) : <p className="task-empty">Für diese Leistung wurden keine Unteraufgaben angelegt.</p>}</div><div className="create-modal-actions"><button className="btn" type="button" disabled={Boolean(savingBenefitId)} onClick={() => setEditingBenefit(null)}>Abbrechen</button><button className="btn btn-primary" type="button" disabled={Boolean(savingBenefitId)} onClick={() => { void saveBenefitTaskEdits(); }}>{savingBenefitId === editingBenefit.id ? "Wird gespeichert …" : "Änderungen speichern"}</button></div></Modal>}
    {adding && <Modal labelledBy="add-benefit-title" className="create-modal add-benefit-modal add-benefit-picker-modal" backdropClassName="modal-backdrop" role="dialog" onClose={closeAddBenefits}>
        <div className="create-modal-head"><div><h2 id="add-benefit-title">Leistungen hinzufügen</h2><p>Wähle links die Bausteine aus und richte rechts Anzahl und Aufgaben ein. Unteraufgaben werden nacheinander freigeschaltet.</p></div><button className="icon-button" type="button" aria-label="Dialog schließen" onClick={closeAddBenefits}><Icon name="close" size={16}/></button></div>
        <div className="add-benefit-picker-layout">
          <section className="add-benefit-picker-list" aria-labelledby="add-benefit-picker-list-title">
            <div className="add-benefit-picker-section-head"><h3 id="add-benefit-picker-list-title">Leistungen</h3><span>{selectedBlocks.length} ausgewählt</span></div>
            {!blocksLoading && !blocksLoadError && blocksLoadWarning && <p className="task-feedback" role="status">{blocksLoadWarning}</p>}
            {blocksLoading ? <p className="task-empty">Bausteine werden geladen …</p> : blocksLoadError ? <EmptyState title="Bausteine nicht verfügbar" description={blocksLoadError} action={<Link className="btn btn-primary" href="/bausteine">Zur Bausteinbibliothek</Link>} /> : availableBlocks.length ? <div className="add-benefit-options">{availableBlocks.map((block, index) => {
              const key = blockKey(block);
              const selected = selectedBlocks.includes(key);
              const alreadyAdded = existingBenefitTitles.has(normalizeBenefitTitle(block.title));
              return <div className={`add-benefit-assignment ${selected ? "selected" : ""} ${editingBlockKey === key && selected ? "active" : ""} ${alreadyAdded ? "already-added" : ""}`} key={`${key}-${index}`}>
                <label className="add-benefit-option"><input type="checkbox" checked={alreadyAdded || selected} disabled={alreadyAdded} onChange={(event) => {
                  if (event.target.checked) {
                    setSelectedBlocks((current) => current.includes(key) ? current : [...current, key]);
                    setEditingBlockKey(key);
                    setBenefitQuantities((current) => ({ ...current, [key]: current[key] || "1" }));
                  } else {
                    const remaining = selectedBlocks.filter((item) => item !== key);
                    setSelectedBlocks(remaining);
                    if (editingBlockKey === key) setEditingBlockKey(remaining[0] ?? "");
                  }
                }}/><span><b>{block.title}</b><small>{block.category} · {block.benefit_type === "in_kind" ? "Sachleistung" : "Geldleistung"}</small>{alreadyAdded && <small className="add-benefit-already-added">Bereits hinzugefügt</small>}<span>{block.description}</span>{block.internal_comment && <small className="add-benefit-internal-comment">Interner Kommentar: {block.internal_comment}</small>}{block.material_logistics && <small className="add-benefit-logistics">Sachleistung: {block.material_logistics}</small>}</span></label>
              </div>;
            })}</div> : <EmptyState title="Noch keine Bausteine" description="Erstelle zuerst wiederverwendbare Leistungen in der Bausteinbibliothek." action={<Link className="btn btn-primary" href="/bausteine">Zur Bausteinbibliothek</Link>} />}
          </section>
          <section className="add-benefit-picker-editor" aria-labelledby="add-benefit-picker-editor-title">
            {activeBlock ? <>
              <div className="add-benefit-picker-section-head"><h3 id="add-benefit-picker-editor-title">Aufgaben einrichten</h3><select aria-label="Leistung zur Bearbeitung auswählen" value={blockKey(activeBlock)} onChange={(event) => setEditingBlockKey(event.target.value)}>{availableBlocks.filter((block) => selectedBlocks.includes(blockKey(block))).map((block) => <option key={blockKey(block)} value={blockKey(block)}>{block.title}</option>)}</select></div>
              <div className="add-benefit-picker-active-title"><b>{activeBlock.title}</b><span>{activeBlock.category} · {activeBlock.benefit_type === "in_kind" ? "Sachleistung" : "Geldleistung"}</span></div>
              {activeBlock.internal_comment && <p className="add-benefit-internal-comment">Interner Kommentar: {activeBlock.internal_comment}</p>}
              {activeBlock.material_logistics && <p className="add-benefit-logistics">Sachleistung: {activeBlock.material_logistics}</p>}
              <div className="add-benefit-assignment-fields"><label className="settings-field"><span>Anzahl</span><input type="number" min="1" step="1" required value={benefitQuantities[blockKey(activeBlock)] ?? "1"} onChange={(event) => setBenefitQuantities((current) => ({ ...current, [blockKey(activeBlock)]: event.target.value }))}/></label></div><small className="add-benefit-task-frequency-hint">{activeBlock.tasks_per_unit === false ? "Eine Aufgabenfolge gilt für die gesamte vereinbarte Anzahl." : "Für jede Einheit wird eine eigene Aufgabenfolge angelegt."}</small>
              <div className="add-benefit-subtasks"><b>{activeBlock.subtasks?.length ? "Unteraufgaben · werden nacheinander bearbeitet" : activeBlock.default_completion_type === "none_required" ? "Keine Aufgabe erforderlich" : "Aufgabe"}</b>{activeBlock.default_completion_type === "none_required" && !activeBlock.subtasks?.length ? <p>Diese Leistung wird ohne Aufgaben angelegt.</p> : (() => { const blockTasks = tasksForBlock(activeBlock); const firstInternalTaskIndex = blockTasks.findIndex((task) => task.completion_type !== "sponsor_approval"); return blockTasks.map((task, index) => {
                const taskKey = subtaskKey(activeBlock, task);
                const sponsorCompletesTask = task.completion_type === "sponsor_approval" || task.completion_type === "sponsor_upload";
                const completionLabel = task.completion_type === "sponsor_approval" ? "Sponsorfreigabe" : task.completion_type === "sponsor_upload" ? "Upload durch Sponsor" : task.completion_type === "organizer_approval" ? "Bestätigung durch Veranstalter" : "Datei erforderlich";
                return <div className={`add-benefit-subtask-row ${sponsorCompletesTask ? "sponsor-assigned-subtask" : ""}`} key={task.id}><span>{task.title}<small>{completionLabel}</small>{index > 0 && <small className="subtask-dependency-hint">Startet nach Abschluss von: {blockTasks[index - 1].title}</small>}</span><label className="settings-field"><span>{(activeBlock.benefit_type === "in_kind" || Boolean(activeBlock.material_logistics?.trim())) && index === firstInternalTaskIndex ? "Benötigt am" : "Fällig am"}</span><DatePicker value={subtaskDueDates[taskKey] ?? eventEndDate} onChange={(event) => setSubtaskDueDates((current) => ({ ...current, [taskKey]: event.target.value }))}/></label>{!sponsorCompletesTask && <label className="settings-field"><span>Bearbeiter</span><select value={subtaskAssignees[taskKey] ?? ""} onChange={(event) => setSubtaskAssignees((current) => ({ ...current, [taskKey]: event.target.value }))}><option value="">Nicht zugewiesen</option>{organizerMembers.map((member) => <option key={member.user_id} value={member.user_id}>{organizerMemberName(member)} · {member.role === "owner" ? "Inhaber" : "Mitglied"}</option>)}</select></label>}</div>;
              }); })()}</div>
            </> : <div className="add-benefit-picker-empty"><h3 id="add-benefit-picker-editor-title">Aufgaben einrichten</h3><p>Wähle links eine Leistung aus, um Anzahl, Fälligkeiten und Bearbeiter festzulegen.</p></div>}
          </section>
        </div>
        <div className="create-modal-actions"><button className="btn" type="button" onClick={closeAddBenefits}>Abbrechen</button><button className="btn btn-primary" type="button" onClick={addSelectedBlocks} disabled={selectedBlocks.length === 0}>Auswahl hinzufügen</button></div>
      </Modal>}
    {showContractOutput && <Modal labelledBy="contract-output-title" className="create-modal contract-output-modal" backdropClassName="modal-backdrop" role="dialog" onClose={() => setShowContractOutput(false)}>
        <div className="create-modal-head"><div><h2 id="contract-output-title">Vertrag erstellen</h2><p>Wähle das gewünschte Dateiformat für {sponsor.name}.</p></div><button className="icon-button" type="button" aria-label="Dialog schließen" onClick={() => setShowContractOutput(false)}><Icon name="close" size={16}/></button></div>
        {templateLoading ? <p className="task-empty">Zugeordnete Vorlage wird geladen …</p> : <>
          {contractTemplate ? <p className="contract-output-note">Verwendete Vorlage: {contractTemplate.name}</p> : <div
            className={`contract-template-required-notice ${templateLoadMessage ? "error" : ""}`}
            role={templateLoadMessage ? "alert" : "status"}
          >
            <div>
              <strong>{templateLoadMessage ? "Vorlage konnte nicht geladen werden" : "Dokumentenvorlage erforderlich"}</strong>
              <p>{templateLoadMessage || `Für „${eventTitle}“ ist noch keine Dokumentenvorlage zugeordnet. Ordne unter Einstellungen → Vertragsvorlage eine vorhandene Vorlage zu oder lade eine neue DOCX-Datei hoch. PDF- und Word-Verträge werden beide daraus erstellt.`}</p>
            </div>
            {!templateLoadMessage && <Link className="btn" href="/einstellungen?tab=vertragsvorlage">Vorlage hinterlegen</Link>}
          </div>}
          {creatingContract && <p className="contract-output-note" role="status">{creatingContract === "pdf" ? "PDF wird erstellt und gleich heruntergeladen …" : "Word-Datei wird erstellt …"}</p>}
          <div className="contract-output-options">
            <button className="contract-output-option" type="button" disabled={!contractTemplate || creatingContract !== null} onClick={() => { void createTemplatedDocument("pdf"); }}><Icon name="file" size={23}/><span>PDF-Datei erstellen</span></button>
            <button className="contract-output-option" type="button" disabled={!contractTemplate || creatingContract !== null} onClick={() => { void createTemplatedDocument("docx"); }}><Icon name="file" size={23}/><span>Word-Datei erstellen</span></button>
          </div>
          {contractTemplate && <p className="contract-output-note">Die PDF-Datei wird aus der Vorlage erstellt und direkt heruntergeladen.</p>}
        </>}
      </Modal>}
    <div ref={printPreviewRef} className={`contract-print-preview ${printReady ? "active" : ""}`} aria-hidden={!printReady}/>
  </section>;
}
