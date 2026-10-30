"use client";

import { DatePicker } from "@/components/date-picker";

import { benefitWorkflowCount } from "@/lib/benefit-workflow";
import { formatDue } from "@/lib/display-format";
import type { Evidence,OrganizerMember,OrganizerTaskFeedback,SponsorTaskFeedback,Task } from "@/lib/tasks/types";
import { applyWorkflowDependencies, isSponsorApprovalTask, taskStatus, workflowStatus } from "@/lib/tasks/workflow";
import { OrganizerApprovalControl, SponsorApprovalStatus, SponsorProofPendingNotice } from "./tasks/approval-control";
import { TaskFeedbackNotice, TaskVersionHistory } from "./tasks/feedback";
import { TaskProofControl } from "./tasks/proof-control";
import { Modal } from "@/components/modal";
import { useEventEntitlements } from "@/components/event-entitlements";
import { SponsorGroup } from "@/components/sponsor-group";
import { EmptyState, Icon, PageHeading, Status } from "@/components/ui";
import { fetchStoredBenefits, updateStoredBenefit } from "@/lib/benefits-storage";
import { fetchStoredEventsFromDatabase } from "@/lib/events-storage";
import { deleteStoredEvidenceRecord, fetchStoredEvidence, uploadStoredEvidence } from "@/lib/evidence-storage";
import { fetchSponsorRecords } from "@/lib/sponsors-storage";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createStoredTask, deleteStoredTask, fetchStoredTasks, updateStoredTask, type CompletionType } from "@/lib/tasks-storage";
import { useEffect, useRef, useState, type FormEvent } from "react";
const emptyDraft = { title: "", sponsor: "", sponsorId: "", assigneeId: "", due: "", eventId: "", completionType: "file_required" as CompletionType };
const SPONSOR_TASK_ASSIGNEE = "__sponsor__";

export function TasksOverview({ sponsorFilter, sponsorName, eventFilter = "all", eventSponsors = [], embedded = false, mobileMode = false, allowCreate = false }: { sponsorFilter?: string; sponsorName?: string; eventFilter?: string; eventSponsors?: Array<{ id: string; name: string }>; embedded?: boolean; mobileMode?: boolean; allowCreate?: boolean } = {}) {
  const { ensureFeature } = useEventEntitlements();
  const [items, setItems] = useState<Task[]>([]);
  const loadRequestId = useRef(0);
  const [sponsorNames, setSponsorNames] = useState<Record<string, string>>({});
  const [availableSponsors, setAvailableSponsors] = useState<Array<{ id: string; name: string; eventIds: string[] }>>([]);
  const [eventNames, setEventNames] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<Array<{ id: string; title: string }>>([]);
  const [organizerMembers, setOrganizerMembers] = useState<OrganizerMember[]>([]);
  const [evidenceByTask, setEvidenceByTask] = useState<Record<string, Evidence>>({});
  const [evidenceVersionsByTask, setEvidenceVersionsByTask] = useState<Record<string, Evidence[]>>({});
  const [ready, setReady] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingTaskDraft, setEditingTaskDraft] = useState({ title: "", sponsorId: "", assigneeId: "", due: "" });
  const [savingTaskEdit, setSavingTaskEdit] = useState(false);
  const [draft, setDraft] = useState(() => ({ ...emptyDraft, sponsor: sponsorName ?? "", eventId: eventFilter !== "all" ? eventFilter : emptyDraft.eventId }));
  const [message, setMessage] = useState("");
  const [organizerApprovalBusyId, setOrganizerApprovalBusyId] = useState("");
  const [sponsorTaskCompletionBusyId, setSponsorTaskCompletionBusyId] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(eventFilter);
  const [selectedSponsor, setSelectedSponsor] = useState(sponsorFilter ?? "all");
  const [hideCompleted, setHideCompleted] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState("all");

  useEffect(() => setSelectedEvent(eventFilter), [eventFilter]);
  useEffect(() => setSelectedSponsor(sponsorFilter ?? "all"), [sponsorFilter]);

  useEffect(() => {
    async function loadTasks() {
      const requestId = ++loadRequestId.current;
      try {
        if (!isSupabaseConfigured) throw new Error("Supabase ist nicht eingerichtet.");
        const [evidenceResult, sponsorResult, eventResult, benefitResult, taskResult, feedbackResult, organizerFeedbackResult] = await Promise.all([
          fetchStoredEvidence(), fetchSponsorRecords(), fetchStoredEventsFromDatabase(), fetchStoredBenefits(), fetchStoredTasks(eventFilter !== "all" ? eventFilter : undefined),
          createClient().from("sponsor_task_feedback").select("id, task_id, decision, comment, created_at").order("created_at", { ascending: true }),
          createClient().from("task_workflow_feedback").select("id, task_id, decision, comment, created_at").order("created_at", { ascending: true }),
        ]);
        if (evidenceResult.error || sponsorResult.error || eventResult.error || benefitResult.error || taskResult.error) throw new Error("Supabase-Daten konnten nicht vollständig geladen werden.");
        const sponsorNameMap = Object.fromEntries((sponsorResult.data ?? []).map(({ sponsor }) => [sponsor.id, sponsor.name]));
        setAvailableSponsors((sponsorResult.data ?? []).map(({ sponsor }) => ({ id: sponsor.id, name: sponsor.name, eventIds: sponsor.eventIds })));
        const eventNameMap = Object.fromEntries((eventResult.data ?? []).map((event) => [event.id, event.title]));
        setSponsorNames(sponsorNameMap);
        setEventNames(eventNameMap);
        setEvents((eventResult.data ?? []).map((event) => ({ id: event.id, title: event.title })));
        const evidenceMap = Object.fromEntries((evidenceResult.data ?? []).map((entry) => [entry.taskId, entry]));
        setEvidenceByTask(evidenceMap);
        const evidenceVersions = (evidenceResult.data ?? []).reduce<Record<string, Evidence[]>>((versions, evidence) => {
          versions[evidence.taskId] = [...(versions[evidence.taskId] ?? []), evidence];
          return versions;
        }, {});
        setEvidenceVersionsByTask(evidenceVersions);
        const storedTasks = taskResult.data ?? [];
        const benefitsById = new Map((benefitResult.data ?? []).map((benefit) => [benefit.id, benefit]));
        const quantityBoundTasks = storedTasks.filter((task) => {
          if (task.source !== "Leistung" || !task.benefit_id) return true;
          const benefit = benefitsById.get(task.benefit_id);
          return !benefit || task.workflow_instance <= (benefitWorkflowCount(benefit.quantity, benefit.tasksPerUnit));
        });
        const assignedBenefitIds = new Set(quantityBoundTasks.filter((task) => task.source === "Leistung" && task.benefit_id).map((task) => task.benefit_id as string));
        const legacyBenefitTasks: Task[] = (benefitResult.data ?? []).filter((benefit) => benefit.completionRequired !== false && !assignedBenefitIds.has(benefit.id)).map((benefit) => ({ id: `benefit-${benefit.id}`, title: benefit.title, sponsor: sponsorNameMap[benefit.sponsorId ?? ""] ?? "—", sponsorId: benefit.sponsorId ?? "", due: benefit.dueAt ? formatDue(benefit.dueAt) : "—", dueAt: benefit.dueAt, status: (evidenceMap[`benefit-${benefit.id}`] || benefit.status === "Erfüllt" || benefit.status === "Erledigt" ? "Erledigt" : "Offen"), eventId: benefit.eventId, eventTitle: eventNameMap[benefit.eventId] ?? "Event nicht gefunden", source: "Leistung", benefitType: benefit.benefitType }));
        const supabase = createClient();
        const memberEmails = new Map<string, string>();
        const { data: organizationId } = await supabase.rpc("current_organization_id");
        if (typeof organizationId === "string") {
          const [memberResult, teamResponse] = await Promise.all([
            supabase.from("organization_members").select("user_id,email,role").eq("organization_id", organizationId),
            fetch("/api/team/members", { cache: "no-store" }).then(async (response) => response.ok ? await response.json() as { members?: OrganizerMember[] } : null).catch(() => null),
          ]);
          const validMembers = (memberResult.data ?? []).filter((member) => member.user_id && member.email) as OrganizerMember[];
          const namesById = new Map((teamResponse?.members ?? []).map((member) => [member.user_id, member.full_name ?? ""]));
          const membersWithNames = validMembers.map((member) => ({ ...member, full_name: namesById.get(member.user_id) || undefined }));
          setOrganizerMembers(membersWithNames);
          for (const member of validMembers) memberEmails.set(member.user_id, member.email);
        }
        const feedbackByTask = new Map<string, SponsorTaskFeedback[]>();
        for (const feedback of feedbackResult.data ?? []) feedbackByTask.set(feedback.task_id, [...(feedbackByTask.get(feedback.task_id) ?? []), feedback as SponsorTaskFeedback]);
        const organizerFeedbackByTask: Record<string, OrganizerTaskFeedback[]> = {};
        for (const feedback of organizerFeedbackResult.data ?? []) organizerFeedbackByTask[feedback.task_id] = [...(organizerFeedbackByTask[feedback.task_id] ?? []), feedback as OrganizerTaskFeedback];
        const mappedTasks: Task[] = quantityBoundTasks.filter((task) => task.source === "Leistung" || task.source === "Manuell").map((task) => ({ id: task.id, title: task.title, sponsor: sponsorNameMap[task.sponsor_id ?? ""] ?? task.sponsor_name ?? "—", sponsorId: task.sponsor_id ?? "", due: task.due_at ? formatDue(task.due_at) : "—", dueAt: task.due_at ?? undefined, status: task.status === "Erledigt" ? "Erledigt" : "Offen", eventId: task.event_id ?? "", eventTitle: eventNameMap[task.event_id ?? ""] ?? "Keinem Event zugeordnet", source: task.source as Task["source"], storedTask: true, benefitId: task.benefit_id ?? undefined, benefitTitle: task.benefit_id ? benefitsById.get(task.benefit_id)?.title : undefined, benefitQuantity: task.benefit_id ? benefitsById.get(task.benefit_id)?.quantity : undefined, benefitTasksPerUnit: task.benefit_id ? benefitsById.get(task.benefit_id)?.tasksPerUnit : undefined, benefitType: task.benefit_id ? benefitsById.get(task.benefit_id)?.benefitType : undefined, workflowOrder: task.workflow_order ?? undefined, workflowInstance: task.workflow_instance ?? undefined, completionType: task.completion_type, assignee: task.assigned_to_sponsor || task.completion_type === "sponsor_upload" || task.completion_type === "sponsor_approval" || task.requires_sponsor_approval ? "Sponsor" : task.assigned_to ? memberEmails.get(task.assigned_to) : undefined, assigneeId: task.assigned_to ?? undefined, assignedToSponsor: task.assigned_to_sponsor, publishReady: task.publish_ready, sponsorApprovalStatus: task.sponsor_approval_status, requiresSponsorApproval: task.requires_sponsor_approval, sponsorFeedback: feedbackByTask.get(task.id) ?? [], organizerFeedback: organizerFeedbackByTask[task.id] ?? [] }));
        if (requestId === loadRequestId.current) setItems(applyWorkflowDependencies([...legacyBenefitTasks, ...mappedTasks]));
      } catch {
        if (requestId === loadRequestId.current) setMessage("Gespeicherte Aufgaben konnten nicht geladen werden.");
      } finally {
        if (requestId === loadRequestId.current) setReady(true);
      }
    }
    void loadTasks();
    const refreshOnFocus = () => { void loadTasks(); };
    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener("sponso:event-timeline-updated", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener("sponso:event-timeline-updated", refreshOnFocus);
    };
  }, []);

  async function addProof(task: Task, file: File): Promise<boolean> {
    if (!task.eventId) {
      setMessage("Ordne die Aufgabe zuerst einem Event zu, um einen Nachweis hinzuzufügen.");
      return false;
    }
    if (!(await ensureFeature(task.eventId, task.eventTitle, "evidence"))) return false;
    const benefitId = task.source === "Leistung" ? task.storedTask ? task.benefitId : task.id.slice("benefit-".length) : undefined;
    const needsSponsorApproval = task.completionType === "sponsor_approval" || task.requiresSponsorApproval;
    const standaloneSponsorApproval = needsSponsorApproval && (!task.benefitId || task.workflowOrder == null);
    const { data, error } = await uploadStoredEvidence({ file, eventId: task.eventId || undefined, taskId: task.id, benefitId, sponsorVisible: standaloneSponsorApproval });
    if (error || !data) throw error ?? new Error("Nachweis konnte nicht gespeichert werden.");
    const isResubmission = needsSponsorApproval && task.sponsorApprovalStatus === "changes_requested";
    if (isResubmission) {
      const { error: approvalError } = await updateStoredTask(task.id, { sponsorApprovalStatus: "pending" });
      if (approvalError) {
        await deleteStoredEvidenceRecord(data);
        throw approvalError;
      }
    }
    if (task.source === "Leistung" && !task.storedTask) {
      const { error } = await updateStoredBenefit(task.id.slice("benefit-".length), { status: "Erfüllt", evidence: file.name });
      if (error) throw error;
    } else if (!needsSponsorApproval) { const { error } = await updateStoredTask(task.id, { status: "Erledigt" }); if (error) throw error; }
    if (task.storedTask && task.benefitId && !needsSponsorApproval) await syncBenefitStatus(task.benefitId);
    window.dispatchEvent(new Event("sponso:event-timeline-updated"));
    setEvidenceByTask((current) => ({ ...current, [task.id]: data }));
    setEvidenceVersionsByTask((current) => ({ ...current, [task.id]: [...(current[task.id] ?? []), data].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "")) }));
    if (!needsSponsorApproval) setItems((current) => applyWorkflowDependencies(current.map((item) => item.id === task.id ? { ...item, status: "Erledigt" as Task["status"] } : item)));
    else if (isResubmission) setItems((current) => current.map((item) => item.id === task.id ? { ...item, sponsorApprovalStatus: "pending" } : item));
    if (!mobileMode) setMessage(needsSponsorApproval
      ? isResubmission ? `Die neue Datei für „${task.title}“ wurde hochgeladen und ist wieder zur Sponsorfreigabe bereit.` : `Datei für „${task.title}“ bereitgestellt. Die Sponsorfreigabe ist noch offen.`
      : `Nachweis für „${task.title}“ gespeichert. Aufgabe abgeschlossen.`);
    return true;
  }

  async function deleteProof(task: Task) {
    const evidence = evidenceByTask[task.id];
    if (evidence) { const { error } = await deleteStoredEvidenceRecord(evidence); if (error) throw error; }
    const needsSponsorApproval = task.completionType === "sponsor_approval" || task.requiresSponsorApproval;
    if (task.source === "Leistung" && !task.storedTask) {
      const { error } = await updateStoredBenefit(task.id.slice("benefit-".length), { status: "Offen", evidence: "Noch kein Nachweis" });
      if (error) throw error;
    } else if (!needsSponsorApproval) { const { error } = await updateStoredTask(task.id, { status: "Offen" }); if (error) throw error; }
    if (task.storedTask && task.benefitId && !needsSponsorApproval) await syncBenefitStatus(task.benefitId);
    window.dispatchEvent(new Event("sponso:event-timeline-updated"));
    setEvidenceByTask((current) => {
      const updated = { ...current };
      delete updated[task.id];
      return updated;
    });
    if (evidence) setEvidenceVersionsByTask((current) => ({ ...current, [task.id]: (current[task.id] ?? []).filter((version) => version.id !== evidence.id) }));
    if (!needsSponsorApproval) setItems((current) => applyWorkflowDependencies(current.map((item) => item.id === task.id ? { ...item, status: "Offen" as const } : item)));
    setMessage(needsSponsorApproval ? `Datei für „${task.title}“ gelöscht. Die Sponsorfreigabe bleibt offen.` : `Nachweis für „${task.title}“ gelöscht. Die Aufgabe ist wieder offen.`);
  }

  async function completeSponsorAssignedTask(task: Task) {
    if (!task.assignedToSponsor || isSponsorApprovalTask(task) || task.status === "Erledigt" || task.blockedBy || !task.storedTask) return;
    if (!(await ensureFeature(task.eventId, task.eventTitle, "tasks"))) return;
    setSponsorTaskCompletionBusyId(task.id);
    setMessage("");
    try {
      const { error } = await updateStoredTask(task.id, { status: "Erledigt" });
      if (error) throw error;
      if (task.benefitId) await syncBenefitStatus(task.benefitId);
      setItems((current) => applyWorkflowDependencies(current.map((item) => item.id === task.id ? { ...item, status: "Erledigt" } : item)));
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
      setMessage(`„${task.title}“ wurde abgeschlossen.`);
    } catch {
      setMessage("Die Sachleistungsaufgabe konnte nicht abgeschlossen werden.");
    } finally {
      setSponsorTaskCompletionBusyId("");
    }
  }

  function sponsorAssignedTaskControl(task: Task) {
    if (!task.assignedToSponsor || isSponsorApprovalTask(task)) return null;
    if (task.completionType === "sponsor_upload") {
      return evidenceByTask[task.id]
        ? <TaskProofControl task={task} evidence={evidenceByTask[task.id]} disabled mobileMode={mobileMode} onProofAdded={addProof} onProofDeleted={deleteProof}/>
        : <span className="task-caption">Wartet auf Datei-Upload durch Sponsor</span>;
    }
    if (task.status === "Erledigt") return null;
    return <button className="btn btn-primary sponsor-task-complete" type="button" disabled={!ready || Boolean(task.blockedBy) || sponsorTaskCompletionBusyId === task.id} onClick={() => { void completeSponsorAssignedTask(task); }}>{sponsorTaskCompletionBusyId === task.id ? "Wird gespeichert …" : "Als erledigt markieren"}</button>;
  }

  function previousWorkflowTask(task: Task) {
    const workflowOrder = task.workflowOrder;
    if (!task.benefitId || workflowOrder == null) return undefined;
    return items.filter((candidate) => candidate.benefitId === task.benefitId && candidate.workflowInstance === task.workflowInstance && candidate.workflowOrder != null && candidate.workflowOrder < workflowOrder).sort((a, b) => (b.workflowOrder ?? 0) - (a.workflowOrder ?? 0))[0];
  }

  function hasFollowingSponsorApproval(task: Task) {
    const workflowOrder = task.workflowOrder;
    if (!task.benefitId || workflowOrder == null) return false;
    return items.some((candidate) => candidate.benefitId === task.benefitId
      && candidate.workflowInstance === task.workflowInstance
      && candidate.workflowOrder != null
      && candidate.workflowOrder > workflowOrder
      && isSponsorApprovalTask(candidate));
  }

  function canRevokeOrganizerTask(task: Task) {
    const workflowOrder = task.workflowOrder;
    if (!task.benefitId || workflowOrder == null) return true;
    return !items.some((candidate) => candidate.benefitId === task.benefitId
      && candidate.workflowInstance === task.workflowInstance
      && candidate.workflowOrder != null
      && candidate.workflowOrder > workflowOrder
      && (candidate.status === "Erledigt" || (isSponsorApprovalTask(candidate) && candidate.sponsorApprovalStatus === "approved")));
  }

  async function refreshWorkflow(task: Task) {
    const [taskResult, evidenceResult, feedbackResult] = await Promise.all([fetchStoredTasks(), fetchStoredEvidence(), createClient().from("task_workflow_feedback").select("id, task_id, decision, comment, created_at").order("created_at", { ascending: true })]);
    if (taskResult.error || evidenceResult.error || feedbackResult.error) throw taskResult.error ?? evidenceResult.error ?? feedbackResult.error;
    const storedTasks = taskResult.data ?? [];
    const taskById = new Map(storedTasks.map((item) => [item.id, item]));
    const feedbackByTask = new Map<string, OrganizerTaskFeedback[]>();
    for (const feedback of feedbackResult.data ?? []) feedbackByTask.set(feedback.task_id, [...(feedbackByTask.get(feedback.task_id) ?? []), feedback as OrganizerTaskFeedback]);
    setItems((current) => applyWorkflowDependencies(current.map((item) => {
      const latest = taskById.get(item.id);
      return latest ? { ...item, status: latest.status === "Erledigt" ? "Erledigt" : "Offen", sponsorApprovalStatus: latest.sponsor_approval_status, publishReady: latest.publish_ready, organizerFeedback: feedbackByTask.get(item.id) ?? item.organizerFeedback } : item;
    })));
    setEvidenceByTask(Object.fromEntries((evidenceResult.data ?? []).map((entry) => [entry.taskId, entry])));
    if (task.benefitId) await syncBenefitStatus(task.benefitId);
    window.dispatchEvent(new Event("sponso:event-timeline-updated"));
  }

  async function approveOrganizerTask(task: Task, sharePreviousFile: boolean): Promise<boolean> {
    if (task.completionType !== "organizer_approval" || task.status === "Erledigt" || task.blockedBy) return false;
    setOrganizerApprovalBusyId(task.id);
    try {
      const { error } = await createClient().rpc("respond_to_organizer_task", { target_task_id: task.id, target_decision: "approved", target_comment: null, share_previous_file: sharePreviousFile });
      if (error) throw error;
      await refreshWorkflow(task);
      setMessage(sharePreviousFile ? `„${task.title}“ wurde bestätigt. Der vorherige Nachweis ist jetzt für den Sponsor sichtbar.` : `„${task.title}“ wurde durch den Veranstalter bestätigt.`);
      return true;
    } catch (reason) {
      const error = reason as { message?: string; details?: string; hint?: string; code?: string };
      const details = [error?.message, error?.details, error?.hint, error?.code].filter(Boolean).join(" ");
      setMessage(details.includes("ORGANIZER_TASK_SPONSOR_FILE_REQUIRED")
        ? "Für die folgende Sponsorenfreigabe muss der Nachweis bereitgestellt werden."
        : details.includes("ORGANIZER_TASK_FILE_NOT_FOUND")
          ? "Lade zuerst einen Nachweis in der vorherigen Aufgabe hoch."
          : details.includes("ORGANIZER_TASK_PREVIOUS_STEPS_INCOMPLETE")
            ? "Schließe zuerst die vorherigen Aufgaben dieser Leistung ab."
            : details.includes("ORGANIZER_TASK_NOT_APPROVAL")
              ? "Diese Aufgabe ist nicht als Veranstalter-Bestätigung eingerichtet."
              : details.includes("ORGANIZER_TASK_ACCESS_DENIED") || error?.code === "42501"
                ? "Du hast keine Berechtigung, diese Aufgabe zu bestätigen."
                : details.includes("respond_to_organizer_task") || error?.code === "PGRST202"
                  ? "Die Bestätigungsfunktion fehlt in der Datenbank. Wende die aktuellen Supabase-Migrationen an."
                  : `Die Bestätigung konnte nicht gespeichert werden${details ? `: ${details}` : "."}`);
      return false;
    } finally {
      setOrganizerApprovalBusyId("");
    }
  }

  async function revokeOrganizerTask(task: Task, comment: string): Promise<boolean> {
    if (task.completionType !== "organizer_approval" || task.status !== "Erledigt" || !comment.trim()) return false;
    setOrganizerApprovalBusyId(task.id);
    try {
      const supabase = createClient();
      const { data: deletedPaths, error } = await supabase.rpc("revoke_organizer_task_approval", { target_task_id: task.id, target_comment: comment.trim() });
      if (error) throw error;
      const storagePaths = Array.isArray(deletedPaths) ? deletedPaths.filter((path): path is string => typeof path === "string") : [];
      const { error: storageError } = storagePaths.length ? await supabase.storage.from("sponsorproof-files").remove(storagePaths) : { error: null };
      await refreshWorkflow(task);
      setMessage(storageError
        ? "Die Freigabe wurde zurückgenommen und die Sponsorenfreigabe ausgeblendet. Der Nachweis wurde aus dem Archiv entfernt, konnte aber nicht vollständig aus dem Speicher gelöscht werden."
        : "Die Freigabe wurde zurückgenommen. Der vorherige Nachweis wurde gelöscht und die Sponsorenfreigabe ausgeblendet.");
      return true;
    } catch (reason) {
      const details = reason instanceof Error ? reason.message : "";
      setMessage(details.includes("ORGANIZER_APPROVAL_FOLLOWING_TASK_COMPLETED")
        ? "Die Freigabe kann nicht zurückgenommen werden, weil eine nachfolgende Aufgabe bereits abgeschlossen ist."
        : details.includes("ORGANIZER_APPROVAL_SPONSOR_ALREADY_APPROVED")
          ? "Die Freigabe kann nicht zurückgenommen werden, weil der Sponsor bereits freigegeben hat."
        : "Die Freigabe konnte nicht zurückgenommen werden. Prüfe, ob die Datenbankmigration angewendet wurde.");
      return false;
    } finally {
      setOrganizerApprovalBusyId("");
    }
  }

  async function rejectOrganizerTask(task: Task, comment: string): Promise<boolean> {
    if (task.completionType !== "organizer_approval" || task.status === "Erledigt" || task.blockedBy || !comment.trim()) return false;
    setOrganizerApprovalBusyId(task.id);
    try {
      const supabase = createClient();
      const { data: deletedPaths, error } = await supabase.rpc("respond_to_organizer_task", { target_task_id: task.id, target_decision: "changes_requested", target_comment: comment.trim(), share_previous_file: false });
      if (error) throw error;
      const storagePaths = Array.isArray(deletedPaths) ? deletedPaths.filter((path): path is string => typeof path === "string") : [];
      const { error: storageError } = storagePaths.length ? await supabase.storage.from("sponsorproof-files").remove(storagePaths) : { error: null };
      await refreshWorkflow(task);
      setMessage(storageError
        ? `„${task.title}“ wurde zurückgegeben und die vorherige Aufgabe zurückgesetzt. Mindestens eine Nachweisdatei konnte nicht aus dem Archiv gelöscht werden.`
        : `„${task.title}“ wurde zurückgegeben. Der vorherige Nachweis wurde gelöscht und die Aufgabe zurückgesetzt.`);
      return true;
    } catch {
      setMessage("Die Aufgabe konnte nicht abgelehnt werden. Prüfe, ob die Datenbankmigration angewendet wurde.");
      return false;
    } finally {
      setOrganizerApprovalBusyId("");
    }
  }

  async function updateTaskDueDate(task: Task, dueAt: string) {
    try {
      if (task.source === "Leistung" && !task.storedTask) {
        if (!(await ensureFeature(task.eventId, task.eventTitle, "benefits"))) return;
        const benefitId = task.id.slice("benefit-".length);
        const { error } = await updateStoredBenefit(benefitId, { dueAt: dueAt || null });
        if (error) throw error;
      } else {
        const { error } = await updateStoredTask(task.id, { dueAt: dueAt || null });
        if (error) throw error;
      }
      setItems((current) => current.map((item) => item.id === task.id ? { ...item, dueAt: dueAt || undefined, due: dueAt ? formatDue(dueAt) : "—" } : item));
      setMessage(dueAt ? "Fälligkeit gespeichert." : "Fälligkeit entfernt.");
    } catch {
      setMessage("Die Fälligkeit konnte nicht gespeichert werden.");
    }
  }

  async function updateTaskEvent(task: Task, eventId: string) {
    if (task.source !== "Manuell" || task.eventId === eventId) return;
    if (evidenceByTask[task.id]) {
      setMessage("Lösche zuerst den vorhandenen Nachweis, bevor du die Aufgabe einem anderen Event zuordnest.");
      return;
    }
    try {
      const { error } = await updateStoredTask(task.id, { eventId: eventId || null });
      if (error) throw error;
      const eventTitle = events.find((item) => item.id === eventId)?.title ?? "Keinem Event zugeordnet";
      setItems((current) => current.map((item) => item.id === task.id ? { ...item, eventId, eventTitle, sponsorId: "" } : item));
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
      setMessage(eventId ? `Aufgabe „${task.title}“ wurde dem Event „${eventTitle}“ zugeordnet.` : `Aufgabe „${task.title}“ ist keinem Event mehr zugeordnet.`);
    } catch {
      setMessage("Das Event der Aufgabe konnte nicht geändert werden.");
    }
  }

  async function deleteManualTask(task: Task) {
    if (task.source !== "Manuell" || !window.confirm(`Möchtest du die manuelle Aufgabe „${task.title}“ wirklich löschen?`)) return;
    try {
      const proof = evidenceByTask[task.id];
      if (proof) { const { error } = await deleteStoredEvidenceRecord(proof); if (error) throw error; }
      const { error } = await deleteStoredTask(task.id);
      if (error) throw error;
      setItems((current) => current.filter((item) => item.id !== task.id));
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
      setEvidenceByTask((current) => {
        const updated = { ...current };
        delete updated[task.id];
        return updated;
      });
      setMessage(`Aufgabe „${task.title}“ gelöscht.`);
    } catch {
      setMessage("Die Aufgabe konnte nicht gelöscht werden.");
    }
  }

  function startEditingManualTask(task: Task) {
    if (task.source !== "Manuell") return;
    setEditingTask(task);
    setEditingTaskDraft({ title: task.title, sponsorId: task.sponsorId, assigneeId: task.assignedToSponsor ? SPONSOR_TASK_ASSIGNEE : task.assigneeId ?? "", due: task.dueAt ?? "" });
    setMessage("");
  }

  async function saveManualTaskEdit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!editingTask || editingTask.source !== "Manuell") return;
    setSavingTaskEdit(true);
    const selectedSponsor = sponsorOptions.find((sponsor) => sponsor.id === editingTaskDraft.sponsorId && (!editingTask.eventId || sponsor.eventIds.includes(editingTask.eventId)));
    const assigneeIsSponsor = editingTaskDraft.assigneeId === SPONSOR_TASK_ASSIGNEE;
    try {
      const { error } = await updateStoredTask(editingTask.id, {
        title: editingTaskDraft.title.trim(),
        sponsorId: selectedSponsor?.id || null,
        sponsorName: selectedSponsor?.name || "",
        dueAt: editingTaskDraft.due || null,
        assignedTo: assigneeIsSponsor ? null : editingTaskDraft.assigneeId || null,
        assignedToSponsor: assigneeIsSponsor,
      });
      if (error) throw error;
      setItems((current) => current.map((task) => task.id === editingTask.id ? {
        ...task,
        title: editingTaskDraft.title.trim(),
        sponsorId: selectedSponsor?.id ?? "",
        sponsor: selectedSponsor?.name ?? "—",
        dueAt: editingTaskDraft.due || undefined,
        due: editingTaskDraft.due ? formatDue(editingTaskDraft.due) : "—",
        assigneeId: assigneeIsSponsor ? undefined : editingTaskDraft.assigneeId || undefined,
        assignee: assigneeIsSponsor ? "Sponsor" : organizerMembers.find((member) => member.user_id === editingTaskDraft.assigneeId)?.email,
        assignedToSponsor: assigneeIsSponsor,
      } : task));
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
      setMessage(`Aufgabe „${editingTaskDraft.title.trim()}“ gespeichert.`);
      setEditingTask(null);
    } catch {
      setMessage("Die Aufgabe konnte nicht gespeichert werden.");
    } finally {
      setSavingTaskEdit(false);
    }
  }

  async function createTask(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const eventId = eventFilter !== "all" ? eventFilter : draft.eventId;
    const eventSponsors = sponsorOptions.filter((item) => !eventId || item.eventIds.includes(eventId));
    const selectedSponsorId = draft.sponsorId || (selectedSponsor !== "all" ? selectedSponsor : eventSponsors.length === 1 ? eventSponsors[0].id : "");
    const selectedSponsorRecord = sponsorOptions.find((item) => item.id === selectedSponsorId && (!eventId || item.eventIds.includes(eventId)));
    try {
      const sponsorId = selectedSponsorId;
      const sponsor = selectedSponsorRecord?.name || sponsorName || draft.sponsor.trim() || "—";
      if ((draft.completionType === "sponsor_approval" || draft.completionType === "sponsor_upload") && (!eventId || !sponsorId || !selectedSponsorRecord)) {
        setMessage(draft.completionType === "sponsor_upload"
          ? "Wähle für einen Sponsor-Upload ein Event und einen zugeordneten Sponsor aus."
          : "Wähle für eine Sponsorfreigabe ein Event und einen zugeordneten Sponsor aus.");
        return;
      }
      const isSponsorAssigned = draft.completionType === "sponsor_upload" || draft.completionType === "sponsor_approval";
      const targetEventId = eventId && eventId !== "all" ? eventId : undefined;
      const { data, error } = await createStoredTask({ title: draft.title.trim(), eventId: targetEventId, sponsorId, sponsorName: sponsor, dueAt: draft.due.trim() || undefined, completionType: draft.completionType, assignedTo: isSponsorAssigned ? undefined : draft.assigneeId || undefined, assignedToSponsor: draft.completionType === "sponsor_upload" });
      if (error || !data) throw error ?? new Error("Aufgabe konnte nicht gespeichert werden.");
      const savedEventId = targetEventId ?? data.event_id ?? "";
      if (targetEventId && data.event_id !== targetEventId) {
        const { error: eventAssignmentError } = await updateStoredTask(data.id, { eventId: targetEventId, sponsorId, sponsorName: sponsor });
        if (eventAssignmentError) throw eventAssignmentError;
      }
      const manualTask: Task = { id: data.id, title: data.title, sponsor, sponsorId, due: data.due_at ? formatDue(data.due_at) : "—", dueAt: data.due_at ?? undefined, status: "Offen", eventId: savedEventId, eventTitle: eventNames[savedEventId] ?? "Keinem Event zugeordnet", source: "Manuell", storedTask: true, completionType: data.completion_type, assignee: data.assigned_to_sponsor ? "Sponsor" : organizerMembers.find((member) => member.user_id === data.assigned_to)?.email, assigneeId: data.assigned_to ?? undefined, sponsorApprovalStatus: data.sponsor_approval_status, requiresSponsorApproval: data.requires_sponsor_approval };
      setItems((current) => [...current, manualTask]);
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
      setDraft(emptyDraft);
      setShowCreate(false);
      setMessage("Aufgabe hinzugefügt.");
    } catch {
      setMessage("Die Aufgabe konnte nicht gespeichert werden.");
    }
  }

  const filteredItems = items.filter((task) => (eventFilter !== "all" ? task.eventId === eventFilter : selectedEvent === "all" || task.eventId === selectedEvent) && (selectedSponsor === "all" || task.sponsorId === selectedSponsor) && (selectedAssignee === "all" || (selectedAssignee === "unassigned" ? !task.assigneeId && !task.assignedToSponsor : task.assigneeId === selectedAssignee)));
  const workflowItems = filteredItems.filter((task) => task.storedTask && task.benefitId && task.workflowOrder != null);
  const workflowGroups = [...workflowItems.reduce((groups, task) => {
    const key = task.benefitId!;
    const group = groups.get(key) ?? { key, benefitId: task.benefitId!, title: task.benefitTitle ?? "Leistung", quantity: task.benefitQuantity ?? 1, tasksPerUnit: task.benefitTasksPerUnit !== false, benefitType: task.benefitType, tasks: [] as Task[] };
    group.tasks.push(task);
    groups.set(key, group);
    return groups;
  }, new Map<string, { key: string; benefitId: string; title: string; quantity: number; tasksPerUnit: boolean; benefitType?: Task["benefitType"]; tasks: Task[] }>()).values()].map((group) => ({ ...group, tasks: group.tasks.filter((task) => !hideCompleted || task.status !== "Erledigt") })).filter((group) => group.tasks.length > 0);
  const groupedTaskIds = new Set(workflowItems.map((task) => task.id));
  const standaloneItems = filteredItems.filter((task) => !groupedTaskIds.has(task.id) && (!hideCompleted || task.status !== "Erledigt"));
  const standaloneTaskIds = new Set(standaloneItems.map((task) => task.id));
  const taskSponsorIds = [...new Set([...workflowGroups.map((group) => group.tasks[0]?.sponsorId ?? ""), ...standaloneItems.map((task) => task.sponsorId)])];
  const taskSponsorGroups = taskSponsorIds.map((sponsorId) => ({ sponsorId, name: sponsorId ? sponsorNames[sponsorId] ?? "Sponsor" : "Keinem Sponsor zugeordnet", workflowGroups: workflowGroups.filter((group) => (group.tasks[0]?.sponsorId ?? "") === sponsorId), standaloneItems: standaloneItems.filter((task) => task.sponsorId === sponsorId) }));
  const visibleItems = filteredItems.filter((task) => !groupedTaskIds.has(task.id) && !standaloneTaskIds.has(task.id) && (!hideCompleted || task.status !== "Erledigt"));
  const visibleCompleted = filteredItems.filter((task) => task.status === "Erledigt").length;
  const sponsorOptions = [...[...availableSponsors, ...eventSponsors.map((sponsor) => ({ ...sponsor, eventIds: [eventFilter] })), ...items.filter((task) => task.sponsorId).map((task) => ({ id: task.sponsorId, name: sponsorNames[task.sponsorId] ?? (task.sponsor === task.sponsorId ? "Sponsor" : task.sponsor), eventIds: [task.eventId] }))].reduce((sponsors, sponsor) => {
    const current = sponsors.get(sponsor.id);
    sponsors.set(sponsor.id, current
      ? { ...current, name: sponsor.name || current.name, eventIds: [...new Set([...current.eventIds, ...sponsor.eventIds].filter(Boolean))] }
      : { ...sponsor, eventIds: [...new Set(sponsor.eventIds.filter(Boolean))] });
    return sponsors;
  }, new Map<string, { id: string; name: string; eventIds: string[] }>()).values()];
  const eventOptions = events.length ? events : [...new Map([...items.filter((task) => task.eventId && task.eventId !== "all").map((task) => [task.eventId, { id: task.eventId, title: eventNames[task.eventId] ?? task.eventTitle }] as const), ...(eventFilter !== "all" ? [[eventFilter, { id: eventFilter, title: eventNames[eventFilter] ?? "Dieses Event" }] as const] : [])]).values()];
  const taskFormEventId = eventFilter !== "all" ? eventFilter : draft.eventId;
  const taskFormSponsors = sponsorOptions.filter((sponsor) => !taskFormEventId || sponsor.eventIds.includes(taskFormEventId));
  const taskFormSponsorId = draft.sponsorId || (selectedSponsor !== "all" ? selectedSponsor : taskFormSponsors.length === 1 ? taskFormSponsors[0].id : "");
  const selectedSponsorName = sponsorOptions.find((sponsor) => sponsor.id === selectedSponsor)?.name;
  const completionSummary = `${visibleCompleted} von ${filteredItems.length} abgeschlossen`;
  const noTasksYet = !embedded && ready && items.length === 0 && selectedEvent === eventFilter;
  function renderTaskDetailRow(task: Task, standalone = false, showRowStatus = true) {
    const sponsorFeedback = task.sponsorFeedback ?? [];
    const organizerFeedback = task.organizerFeedback ?? [];
    const versionFeedback = task.source === "Manuell" ? [
      ...sponsorFeedback.filter((feedback) => feedback.decision === "changes_requested").map((feedback) => ({ feedback, decision: "sponsor_return" as const })),
      ...organizerFeedback.filter((feedback) => feedback.decision === "organizer_changes_requested").map((feedback) => ({ feedback, decision: "organizer_return" as const })),
    ] : [];
    const activeEvidence = evidenceByTask[task.id];
    const previousVersions = (evidenceVersionsByTask[task.id] ?? []).filter((version) => version.id !== activeEvidence?.id).slice().sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    const showVersionHistory = previousVersions.length > 0 || (task.source === "Manuell" && versionFeedback.length > 0);
    const otherSponsorFeedback = sponsorFeedback.filter((feedback) => !(task.source === "Manuell" && feedback.decision === "changes_requested"));
    const otherOrganizerFeedback = organizerFeedback.filter((feedback) => !(task.source === "Manuell" && feedback.decision === "organizer_changes_requested"));
    const hasFeedback = otherSponsorFeedback.length > 0 || otherOrganizerFeedback.length > 0;
    const feedbackNotices = <>{otherSponsorFeedback.map((feedback) => <TaskFeedbackNotice feedback={feedback} decision="sponsor_return" collapsed={task.sponsorApprovalStatus === "approved"} key={`sponsor-${feedback.id}`}/>)}{otherOrganizerFeedback.map((feedback) => <TaskFeedbackNotice feedback={feedback} decision={feedback.decision === "organizer_changes_requested" ? "organizer_return" : "organizer_revoked"} collapsed={feedback.decision === "organizer_changes_requested" && Boolean(evidenceByTask[task.id])} key={`organizer-${feedback.id}`}/>)}</>;
    const recordActions = task.source === "Manuell" ? <><button className="btn task-overflow-menu-item" type="button" onClick={() => { startEditingManualTask(task); }}><Icon name="settings" size={14}/> Bearbeiten</button><button className="btn task-overflow-menu-item task-overflow-delete" type="button" onClick={() => { void deleteManualTask(task); }}><Icon name="trash" size={14}/> Löschen</button></> : undefined;
    const proofMenuOwnsActions = standalone && !mobileMode && !task.blockedBy && !task.assignedToSponsor && task.completionType !== "organizer_approval" && !(isSponsorApprovalTask(task) && task.benefitId && task.workflowOrder != null);
    const taskControl = task.blockedBy ? null
      : task.assignedToSponsor ? sponsorAssignedTaskControl(task)
      : task.completionType === "organizer_approval" ? <OrganizerApprovalControl task={task} canRevoke={canRevokeOrganizerTask(task)} sponsorApprovalFollows={hasFollowingSponsorApproval(task)} disabled={!ready} busy={organizerApprovalBusyId === task.id} previousEvidence={(() => { const previous = previousWorkflowTask(task); return previous ? evidenceByTask[previous.id] : undefined; })()} onApprove={approveOrganizerTask} onReject={rejectOrganizerTask} onRevoke={revokeOrganizerTask}/>
        : isSponsorApprovalTask(task) && task.benefitId && task.workflowOrder != null ? <SponsorApprovalStatus task={task}/>
          : <TaskProofControl task={task} evidence={evidenceByTask[task.id]} disabled={!ready} mobileMode={mobileMode} actionMenu={!mobileMode} extraActions={recordActions} onProofAdded={addProof} onProofDeleted={deleteProof}/>;
    return <article className={`benefit-task-subtask ${standalone ? "standalone-task-row" : ""} ${task.status === "Erledigt" ? "task-completed-row" : ""} ${task.currentWorkflowStep ? "workflow-current-step" : ""} ${task.blockedBy ? "workflow-locked-step" : ""}`} key={task.id}>
      <div className="benefit-task-subtask-info">{task.currentWorkflowStep && <span className="task-workflow-current">AKTUELLER SCHRITT</span>}<b>{standalone ? "Einzelaufgabe" : task.title}</b>{standalone && <span>Bearbeiter: {task.assignee ?? "Nicht zugewiesen"}</span>}{showRowStatus && <Status value={taskStatus(task, Boolean(activeEvidence))}/>}{standalone && !embedded && task.source === "Manuell" && <label className="standalone-task-event"><span>Event</span><select className="task-event-select" aria-label={`Event für ${task.title}`} value={task.eventId} onChange={(event) => { void updateTaskEvent(task, event.target.value); }} disabled={!ready}><option value="">Keinem Event zugeordnet</option>{eventOptions.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>}{task.blockedBy && <span className="task-dependency-blocked">Gesperrt bis „{task.blockedBy}“ abgeschlossen ist</span>}</div>
      {!standalone && <div className="benefit-task-assignee"><span>Bearbeiter</span><b>{task.assignee ?? "Nicht zugewiesen"}</b></div>}
      <label className="benefit-task-due"><span>Fällig</span><DatePicker className="task-due-input" aria-label={`Fälligkeit für ${task.title}`} value={task.dueAt ?? ""} onChange={(event) => { void updateTaskDueDate(task, event.target.value); }} disabled={!ready}/></label>
      {(taskControl || (recordActions && !proofMenuOwnsActions)) && <div className="standalone-task-actions"><span className="standalone-task-actions-label">Aktionen</span><div className="standalone-task-action-controls">{taskControl}{recordActions && !proofMenuOwnsActions && <details className="task-overflow-menu task-record-overflow-menu"><summary className="btn" aria-label="Weitere Aufgabenaktionen" title="Weitere Aufgabenaktionen"><Icon name="menu" size={15}/></summary><div className="task-overflow-menu-items">{recordActions}</div></details>}</div></div>}
      <SponsorProofPendingNotice task={task} evidence={activeEvidence}/>
      {showVersionHistory && <TaskVersionHistory versions={previousVersions} feedback={versionFeedback} onDownloadError={() => setMessage("Eine ältere Datei konnte nicht geladen werden.")}/>}
      {hasFeedback && <div className="benefit-task-subtask-feedback">{feedbackNotices}</div>}
    </article>;
  }

  function renderStandaloneTaskCard(task: Task) {
    return <section className="benefit-task-group standalone-task-group" key={task.id} aria-label={`Aufgabe ${task.title}`}>
      <header className="benefit-task-group-heading"><div><span className={`task-source ${task.source === "Leistung" ? "derived" : "manual"}`}>{task.source === "Leistung" ? task.benefitType === "in_kind" ? "Sachleistung" : "Geldleistung" : "Aufgabe"}</span><h3>{task.title}</h3><small>{sponsorNames[task.sponsorId] ?? (task.sponsor === task.sponsorId ? "Sponsor" : task.sponsor)}{task.eventTitle ? ` · ${task.eventTitle}` : ""}</small></div><Status value={taskStatus(task, Boolean(evidenceByTask[task.id]))}/></header>
      <div className="benefit-task-instances"><details className="benefit-task-instance"><summary><span>Details</span></summary><div className="benefit-task-subtasks">{renderTaskDetailRow(task, true, false)}</div></details></div>
    </section>;
  }
  async function syncBenefitStatus(benefitId: string) {
    const [{ data, error }, benefitResult] = await Promise.all([
      fetchStoredTasks(),
      createClient().from("benefits").select("quantity, tasks_per_unit").eq("id", benefitId).maybeSingle(),
    ]);
    if (error) throw error;
    if (benefitResult.error) throw benefitResult.error;
    const quantity = benefitResult.data?.tasks_per_unit === false ? 1 : benefitResult.data?.quantity ?? Number.MAX_SAFE_INTEGER;
    const benefitTasks = (data ?? []).filter((task) => task.benefit_id === benefitId && task.source === "Leistung" && task.workflow_instance <= quantity);
    if (!benefitTasks.length) return;
    const status = benefitTasks.every((task) => task.status === "Erledigt") ? "Erfüllt" : "Offen";
    const result = await updateStoredBenefit(benefitId, { status });
    if (result.error) throw result.error;
  }

  return <>
    {!sponsorFilter && !embedded && <PageHeading eyebrow="VERANSTALTERBEREICH" title="Aufgaben" subtitle="Hier siehst du Aufgaben aus vereinbarten Leistungen und dokumentierst ihre Nachweise." />}
    {sponsorFilter && !embedded && <div className="sponsor-task-heading"><div><h2>Aufgaben & Nachweise</h2><p>Nachweise schließen Aufgaben ab.</p></div></div>}
    {noTasksYet ? <EmptyState title="Noch keine Aufgaben" description="Aufgaben erscheinen hier, sobald du Leistungen vereinbart oder im Event Aufgaben ergänzt hast." action={allowCreate ? <button className="btn btn-primary" type="button" onClick={() => { setMessage(""); setShowCreate(true); }}><Icon name="plus" size={14}/> Aufgabe anlegen</button> : undefined} /> : <section className={`panel table-panel ${embedded ? "event-task-panel" : ""}`}>
      <div className="table-head tasks-table-head"><div>{mobileMode ? <><h2>Aufgaben im Überblick</h2><p className="subtitle" style={{ fontSize: 11, marginTop: 4 }}>{completionSummary}</p></> : embedded ? <><h2>Aufgaben im Überblick</h2><p className="subtitle" style={{ fontSize: 11, marginTop: 4 }}>Verwalte Aufgaben und dokumentiere Nachweise zu vereinbarten Leistungen.</p><p className="subtitle" style={{ fontSize: 10, marginTop: 4 }}>{completionSummary}</p></> : <><h2>{selectedSponsorName ? "Aufgaben" : "Alle Aufgaben"}</h2><p className="subtitle" style={{ fontSize: 11, marginTop: 4 }}>{completionSummary}</p></>}</div>{mobileMode ? <div className="mobile-task-filters">{!sponsorFilter && <label className="mobile-task-assignee-filter"><span>Bearbeiter</span><select aria-label="Aufgaben nach Bearbeiter filtern" value={selectedAssignee} onChange={(event) => setSelectedAssignee(event.target.value)}><option value="all">Alle Personen</option><option value="unassigned">Nicht zugewiesen</option>{organizerMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email} · {member.role === "owner" ? "Inhaber" : "Mitglied"}</option>)}</select></label>}<label className="mobile-open-tasks-filter"><input type="checkbox" checked={hideCompleted} onChange={(event) => setHideCompleted(event.target.checked)}/>Abgeschlossene Aufgaben ausblenden</label></div> : <div className="task-filters"><label className="task-event-filter task-sponsor-filter"><span>Sponsor</span><select value={selectedSponsor} onChange={(event) => setSelectedSponsor(event.target.value)}><option value="all">Alle Sponsoren</option>{sponsorOptions.map((sponsor) => <option key={sponsor.id} value={sponsor.id}>{sponsor.name}</option>)}</select></label>{!embedded && <label className="task-event-filter"><span>Event</span><select value={selectedEvent} onChange={(event) => setSelectedEvent(event.target.value)}><option value="all">Alle Events</option>{eventOptions.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>}{!sponsorFilter && <label className="task-event-filter task-assignee-filter"><span>Bearbeiter</span><select aria-label="Aufgaben nach Bearbeiter filtern" value={selectedAssignee} onChange={(event) => setSelectedAssignee(event.target.value)}><option value="all">Alle Personen</option><option value="unassigned">Nicht zugewiesen</option>{organizerMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email} · {member.role === "owner" ? "Inhaber" : "Mitglied"}</option>)}</select></label>}<label className="task-own-filter"><input type="checkbox" checked={hideCompleted} onChange={(event) => setHideCompleted(event.target.checked)}/>Abgeschlossene Aufgaben ausblenden</label>{allowCreate && <button className="btn btn-primary" type="button" onClick={() => { setMessage(""); setShowCreate(true); }}><Icon name="plus" size={15}/> Aufgabe anlegen</button>}</div>}</div>
      {taskSponsorGroups.length > 0 && <div className="benefit-task-sponsor-groups">{taskSponsorGroups.map((sponsorGroup) => <SponsorGroup className="benefit-task-sponsor-group" key={sponsorGroup.sponsorId} name={sponsorGroup.name} itemCount={sponsorGroup.workflowGroups.reduce((count, group) => count + group.tasks.length, 0) + sponsorGroup.standaloneItems.length} itemLabel="Aufgabe" itemLabelPlural="Aufgaben" contentClassName="benefit-task-sponsor-content"><div className="benefit-task-groups">{sponsorGroup.workflowGroups.map((group) => {
        const allTasks = items.filter((task) => task.benefitId === group.benefitId && task.workflowOrder != null);
        const instances = [...new Set(group.tasks.map((task) => task.workflowInstance ?? 1))].sort((a, b) => a - b);
        return <section className="benefit-task-group" key={group.key} aria-label={`Aufgaben zu ${group.title}`}>
          <header className="benefit-task-group-heading"><div><span className="task-source derived">{group.benefitType === "in_kind" ? "Sachleistung" : "Geldleistung"}</span><h3>{group.title}</h3>{group.quantity > 1 && <span className="benefit-task-quantity">{group.tasksPerUnit ? `${group.quantity} Einzelleistungen` : `Eine Aufgabenfolge für ${group.quantity} Einheiten`}</span>}{!embedded && <small>{group.tasks[0]?.sponsor}{group.tasks[0]?.eventTitle ? ` · ${group.tasks[0].eventTitle}` : ""}</small>}</div><div className="benefit-task-group-summary"><span>{allTasks.filter((task) => task.status === "Erledigt").length} von {allTasks.length} Aufgaben erledigt</span><Status value={workflowStatus(allTasks)}/></div></header>
          <div className="benefit-task-instances">{instances.map((instance) => {
            const instanceTasks = group.tasks.filter((task) => (task.workflowInstance ?? 1) === instance).sort((a, b) => (a.workflowOrder ?? 0) - (b.workflowOrder ?? 0));
            const allInstanceTasks = allTasks.filter((task) => (task.workflowInstance ?? 1) === instance);
            const nextTask = allInstanceTasks.find((task) => task.status !== "Erledigt") ?? allInstanceTasks[0];
            return <details className="benefit-task-instance" key={instance}>
              <summary><span className="benefit-task-instance-title">{group.tasksPerUnit && group.quantity > 1 ? `Leistung ${instance} von ${group.quantity}` : "Aufgaben anzeigen"}</span><span className="benefit-task-instance-meta">{allInstanceTasks.every((task) => task.status === "Erledigt") ? "Alle Aufgaben erledigt" : nextTask ? `Schritt ${allInstanceTasks.findIndex((task) => task.id === nextTask.id) + 1} von ${allInstanceTasks.length}: ${nextTask.title}` : `${allInstanceTasks.length} Aufgaben`}</span></summary>
              <div className="benefit-task-subtasks"><div className="benefit-task-subtask-table-head" aria-hidden="true"><span>Aufgabe</span><span>Bearbeiter</span><span>Fälligkeit</span><span>Nachweis & Aktion</span></div>{instanceTasks.map((task) => renderTaskDetailRow(task, false, allInstanceTasks.length > 1))}</div>
            </details>;
          })}</div>
        </section>;
      })}{sponsorGroup.standaloneItems.map(renderStandaloneTaskCard)}</div></SponsorGroup>)}</div>}
      {mobileMode && visibleItems.length > 0 && <div className="mobile-proof-list">{visibleItems.map((task) => <article className="mobile-task" key={task.id}>
        <div className="mobile-task-top"><div className="mobile-task-heading"><h3>{task.title}</h3>{task.source === "Leistung" && <span className="task-source derived">{task.benefitType === "in_kind" ? "Sachleistung" : "Geldleistung"}</span>}{task.publishReady && <span className="task-publish-ready">Freigegeben · Veröffentlichung möglich</span>}{task.sponsorFeedback?.map((feedback) => <TaskFeedbackNotice feedback={feedback} decision="sponsor_return" collapsed={task.sponsorApprovalStatus === "approved"} key={feedback.id}/>)}{task.organizerFeedback?.map((feedback) => <TaskFeedbackNotice feedback={feedback} decision={feedback.decision === "organizer_changes_requested" ? "organizer_return" : "organizer_revoked"} collapsed={feedback.decision === "organizer_changes_requested" && Boolean(evidenceByTask[task.id])} key={feedback.id}/>)}<p>{sponsorNames[task.sponsorId] ?? task.sponsor}{task.dueAt || task.due !== "—" ? ` · Fällig ${formatDue(task.dueAt ?? task.due)}` : ""} · Bearbeiter: {task.assignee ?? "Nicht zugewiesen"}</p></div><Status value={taskStatus(task, Boolean(evidenceByTask[task.id]))} /></div>
        {task.blockedBy && <span className="task-caption task-dependency-blocked">Wartet auf Abschluss: {task.blockedBy}</span>}{task.assignedToSponsor ? sponsorAssignedTaskControl(task) : task.completionType === "organizer_approval" ? !task.blockedBy && <OrganizerApprovalControl task={task} canRevoke={canRevokeOrganizerTask(task)} sponsorApprovalFollows={hasFollowingSponsorApproval(task)} disabled={!ready} busy={organizerApprovalBusyId === task.id} previousEvidence={(() => { const previous = previousWorkflowTask(task); return previous ? evidenceByTask[previous.id] : undefined; })()} onApprove={approveOrganizerTask} onReject={rejectOrganizerTask} onRevoke={revokeOrganizerTask}/> : isSponsorApprovalTask(task) && task.benefitId && task.workflowOrder != null ? <SponsorApprovalStatus task={task}/> : <TaskProofControl task={task} evidence={evidenceByTask[task.id]} disabled={!ready || Boolean(task.blockedBy)} mobileMode={mobileMode} onProofAdded={addProof} onProofDeleted={deleteProof}/> }
      </article>)}</div>}
      {!mobileMode && visibleItems.length > 0 && <table className="table table-card-list tasks-table"><thead><tr><th>AUFGABE</th><th>SPONSOR</th><th>EVENT</th><th>FÄLLIG</th><th>QUELLE</th><th>STATUS</th><th>NACHWEIS</th><th>AKTION</th></tr></thead><tbody>{visibleItems.map((task) => <tr key={task.id} className={task.status === "Erledigt" ? "task-completed-row" : undefined}>
        <td data-label="Aufgabe"><b style={{ color: "#3d4c5b" }}>{task.title}</b>{task.source === "Leistung" && <div className="task-caption">{task.benefitType === "in_kind" ? "Sachleistung" : "Geldleistung"}</div>}{task.publishReady && <div className="task-publish-ready">Freigegeben · Veröffentlichung möglich</div>}{task.sponsorFeedback?.map((feedback) => <TaskFeedbackNotice feedback={feedback} decision="sponsor_return" collapsed={task.sponsorApprovalStatus === "approved"} key={feedback.id}/>)}{task.organizerFeedback?.map((feedback) => <TaskFeedbackNotice feedback={feedback} decision={feedback.decision === "organizer_changes_requested" ? "organizer_return" : "organizer_revoked"} collapsed={feedback.decision === "organizer_changes_requested" && Boolean(evidenceByTask[task.id])} key={feedback.id}/>)}{task.blockedBy && <div className="task-caption task-dependency-blocked">Wartet auf Abschluss: {task.blockedBy}</div>}<div className="task-caption">Bearbeiter: {task.assignee ?? "Nicht zugewiesen"}</div></td><td data-label="Sponsor">{sponsorFilter && task.sponsorId === sponsorFilter ? sponsorName ?? sponsorNames[task.sponsorId] ?? "Sponsor" : sponsorNames[task.sponsorId] ?? (task.sponsor === task.sponsorId ? "Sponsor" : task.sponsor)}</td><td data-label="Event" className="task-event-cell">{task.source === "Manuell" ? <select className="task-event-name task-event-select" aria-label={`Event für ${task.title}`} value={task.eventId} onChange={(event) => { void updateTaskEvent(task, event.target.value); }} disabled={!ready}><option value="">Keinem Event zugeordnet</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select> : <span className="task-event-name" title={task.eventTitle}>{task.eventTitle}</span>}</td><td data-label="Fällig"><DatePicker className="task-due-input" aria-label={`Fälligkeit für ${task.title}`} value={task.dueAt ?? (/^\d{4}-\d{2}-\d{2}$/.test(task.due) ? task.due : "")} onChange={(event) => updateTaskDueDate(task, event.target.value)} disabled={!ready} /></td><td data-label="Quelle"><span className={`task-source ${task.source === "Leistung" ? "derived" : "manual"}`}>{task.source === "Leistung" ? "Aus Vertrag" : "Manuell"}</span></td><td data-label="Status"><Status value={taskStatus(task, Boolean(evidenceByTask[task.id]))} /></td><td data-label="Nachweis">{task.assignedToSponsor ? sponsorAssignedTaskControl(task) : task.completionType === "organizer_approval" ? !task.blockedBy && <OrganizerApprovalControl task={task} canRevoke={canRevokeOrganizerTask(task)} sponsorApprovalFollows={hasFollowingSponsorApproval(task)} disabled={!ready} busy={organizerApprovalBusyId === task.id} previousEvidence={(() => { const previous = previousWorkflowTask(task); return previous ? evidenceByTask[previous.id] : undefined; })()} onApprove={approveOrganizerTask} onReject={rejectOrganizerTask} onRevoke={revokeOrganizerTask}/> : isSponsorApprovalTask(task) && task.benefitId && task.workflowOrder != null ? <SponsorApprovalStatus task={task}/> : !task.blockedBy && <TaskProofControl task={task} evidence={evidenceByTask[task.id]} disabled={!ready} onProofAdded={addProof} onProofDeleted={deleteProof}/> }</td><td data-label="Aktionen">{task.source === "Manuell" && <button className="btn task-delete-button" type="button" onClick={() => deleteManualTask(task)} aria-label={`Aufgabe ${task.title} löschen`} title="Aufgabe löschen"><Icon name="trash" size={14}/></button>}</td>
      </tr>)}</tbody></table>}
      {ready && visibleItems.length === 0 && workflowGroups.length === 0 && standaloneItems.length === 0 && (items.length === 0 ? <EmptyState className="empty-state-compact" title="Noch keine Aufgaben" description="Aufgaben erscheinen hier, sobald du Leistungen vereinbart oder Aufgaben ergänzt hast." /> : hideCompleted && filteredItems.length > 0 ? <EmptyState className="empty-state-compact" title="Keine offenen Aufgaben" description="Mit diesen Filtern werden keine offenen Aufgaben angezeigt." action={<button className="btn" type="button" onClick={() => setHideCompleted(false)}>Abgeschlossene Aufgaben anzeigen</button>} /> : <EmptyState className="empty-state-compact" title="Keine passenden Aufgaben" description="Passe die Filter an, um andere Aufgaben zu sehen." action={<button className="btn" type="button" onClick={() => { setSelectedSponsor("all"); setSelectedEvent(eventFilter); setHideCompleted(false); setSelectedAssignee("all"); }}>Filter zurücksetzen</button>} />)}
      {message && <p className="task-feedback" role="status">{message}</p>}
    </section>}
    {editingTask && <Modal labelledBy="edit-manual-task-title" className="create-modal" backdropClassName="modal-backdrop" role="dialog" busy={savingTaskEdit} onClose={() => setEditingTask(null)}><div className="create-modal-head"><div><h2 id="edit-manual-task-title">Manuelle Aufgabe bearbeiten</h2><p>Ändere Titel, Sponsor, Bearbeiter oder Fälligkeit.</p></div><button className="icon-button" type="button" aria-label="Dialog schließen" disabled={savingTaskEdit} onClick={() => setEditingTask(null)}><Icon name="close" size={16}/></button></div><form onSubmit={(event) => { void saveManualTaskEdit(event); }}><div className="settings-grid"><label className="settings-field settings-field-full"><span>Aufgabe *</span><input autoFocus required maxLength={100} value={editingTaskDraft.title} onChange={(event) => setEditingTaskDraft((current) => ({ ...current, title: event.target.value }))}/></label><label className="settings-field settings-field-full"><span>Sponsor</span><select value={editingTaskDraft.sponsorId} onChange={(event) => setEditingTaskDraft((current) => ({ ...current, sponsorId: event.target.value }))}><option value="">Keinem Sponsor zugeordnet</option>{sponsorOptions.filter((sponsor) => !editingTask.eventId || sponsor.eventIds.includes(editingTask.eventId)).map((sponsor) => <option key={sponsor.id} value={sponsor.id}>{sponsor.name}</option>)}</select></label><label className="settings-field"><span>Bearbeiter</span><select value={editingTaskDraft.assigneeId} onChange={(event) => setEditingTaskDraft((current) => ({ ...current, assigneeId: event.target.value }))}><option value="">Nicht zugewiesen</option><option value={SPONSOR_TASK_ASSIGNEE}>Sponsor</option>{organizerMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.email} · {member.role === "owner" ? "Inhaber" : "Mitglied"}</option>)}</select></label><label className="settings-field"><span>Fällig</span><DatePicker lang="de" value={editingTaskDraft.due} onChange={(event) => setEditingTaskDraft((current) => ({ ...current, due: event.target.value }))}/></label></div><div className="create-modal-actions"><button className="btn" type="button" disabled={savingTaskEdit} onClick={() => setEditingTask(null)}>Abbrechen</button><button className="btn btn-primary" type="submit" disabled={savingTaskEdit}>{savingTaskEdit ? "Wird gespeichert …" : "Änderungen speichern"}</button></div></form></Modal>}
    {allowCreate && showCreate && <Modal labelledBy="create-task-title" className="create-modal" backdropClassName="modal-backdrop" role="dialog" onClose={() => setShowCreate(false)}><div className="create-modal-head"><div><h2 id="create-task-title">Aufgabe anlegen</h2><p>Wähle, ob eine Datei benötigt wird, der Sponsor eine Datei hochlädt oder eine Aufgabe durch Veranstalter bzw. Sponsor bestätigt wird.</p></div><button className="icon-button" type="button" aria-label="Dialog schließen" onClick={() => setShowCreate(false)}><Icon name="close" size={16}/></button></div><form onSubmit={createTask}><div className="settings-grid"><label className="settings-field settings-field-full"><span>Aufgabe *</span><input autoFocus required maxLength={100} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Was muss erledigt werden?" /></label><label className="settings-field settings-field-full"><span>Abschlussart</span><select value={draft.completionType} onChange={(event) => setDraft({ ...draft, completionType: event.target.value as CompletionType, sponsorId: "" })}><option value="file_required">Datei erforderlich</option><option value="organizer_approval">Bestätigung durch Veranstalter</option><option value="sponsor_approval">Freigabe durch Sponsor</option><option value="sponsor_upload">Upload durch Sponsor</option></select></label><label className="settings-field settings-field-full"><span>{draft.completionType === "sponsor_approval" || draft.completionType === "sponsor_upload" ? "Event *" : "Event"}</span><select required={draft.completionType === "sponsor_approval" || draft.completionType === "sponsor_upload"} value={draft.eventId || (eventFilter !== "all" ? eventFilter : "")} disabled={eventFilter !== "all"} onChange={(event) => setDraft({ ...draft, eventId: event.target.value, sponsorId: "" })}><option value="">Keinem Event zugeordnet</option>{eventOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</select></label>{draft.completionType === "sponsor_approval" || draft.completionType === "sponsor_upload" || draft.eventId || eventFilter !== "all" ? <label className="settings-field settings-field-full"><span>{draft.completionType === "sponsor_approval" || draft.completionType === "sponsor_upload" ? "Sponsor *" : "Sponsor (optional)"}</span><select required={draft.completionType === "sponsor_approval" || draft.completionType === "sponsor_upload"} value={taskFormSponsorId} onChange={(event) => setDraft({ ...draft, sponsorId: event.target.value })}><option value="">{draft.completionType === "sponsor_approval" || draft.completionType === "sponsor_upload" ? "Sponsor auswählen" : "Keinem Sponsor zugeordnet"}</option>{taskFormSponsors.map((sponsor) => <option key={sponsor.id} value={sponsor.id}>{sponsor.name}</option>)}</select>{(draft.completionType === "sponsor_approval" || draft.completionType === "sponsor_upload") && taskFormSponsors.length === 0 && <small>Für dieses Event wurde noch kein Sponsor geladen. Lade die Seite neu oder prüfe die Event-Zuordnung.</small>}</label> : <label className="settings-field"><span>Sponsor</span><input value={draft.sponsor} onChange={(event) => setDraft({ ...draft, sponsor: event.target.value })} placeholder="Optional" /></label>}{draft.completionType !== "sponsor_approval" && draft.completionType !== "sponsor_upload" && <label className="settings-field"><span>Bearbeiter / Login</span><select value={draft.assigneeId} onChange={(event) => setDraft({ ...draft, assigneeId: event.target.value })}><option value="">Nicht zugewiesen</option>{organizerMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.email} · {member.role === "owner" ? "Inhaber" : "Mitglied"}</option>)}</select></label>}<label className="settings-field"><span>Fällig</span><DatePicker lang="de" value={draft.due} onChange={(event) => setDraft({ ...draft, due: event.target.value })} /></label></div><div className="create-modal-actions"><button className="btn" type="button" onClick={() => setShowCreate(false)}>Abbrechen</button><button className="btn btn-primary" type="submit" disabled={!ready}>Aufgabe speichern</button></div></form></Modal>}
  </>;
}
