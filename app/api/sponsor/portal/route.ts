import { benefitWorkflowCount } from "@/lib/benefit-workflow";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  const profileName = {
    firstName: String(user.user_metadata?.first_name ?? "").trim(),
    lastName: String(user.user_metadata?.last_name ?? "").trim(),
  };
  const profileRequired = !profileName.firstName || !profileName.lastName;
  const searchParams = new URL(request.url).searchParams;
  const requestedEventId = searchParams.get("eventId");
  const summaryOnly = searchParams.get("summary") === "1" && !requestedEventId;
  if (profileRequired) return NextResponse.json({ profileRequired, profileName, events: [] }, { headers: { "Cache-Control": "no-store" } });

  try {
    const admin = createAdminClient();
    let assignmentQuery = admin.from("sponsor_event_accounts")
      .select("event_id, sponsor_id, account_id, sponsor_accounts!inner(sponsor_account_members!inner(user_id))")
      .eq("sponsor_accounts.sponsor_account_members.user_id", user.id);
    if (requestedEventId) assignmentQuery = assignmentQuery.eq("event_id", requestedEventId);
    const { data: allAssignments, error: assignmentError } = await assignmentQuery;
    if (assignmentError) throw assignmentError;
    const assignments = (allAssignments ?? []).map(({ event_id, sponsor_id, account_id }) => ({ event_id, sponsor_id, account_id }));
    if (!assignments.length) return NextResponse.json({ profileRequired, profileName, events: [] }, { headers: { "Cache-Control": "no-store" } });

    const eventIds = [...new Set(assignments.map((item) => item.event_id))];
    const sponsorIds = [...new Set(assignments.map((item) => item.sponsor_id))];
    if (summaryOnly) {
      const [eventsResult, benefitsResult, contractsResult] = await Promise.all([
        admin.from("events").select("id, title, start_date, end_date, location, organizer_logo_path").in("id", eventIds),
        admin.from("benefits").select("id, event_id, sponsor_id").in("event_id", eventIds).in("sponsor_id", sponsorIds),
        admin.from("contracts").select("event_id, sponsor_id, value_cents, signature_status, signed_at").in("event_id", eventIds).in("sponsor_id", sponsorIds),
      ]);
      if (eventsResult.error || benefitsResult.error || contractsResult.error) throw eventsResult.error ?? benefitsResult.error ?? contractsResult.error;
      const allowedAssignments = new Set(assignments.map((assignment) => `${assignment.event_id}:${assignment.sponsor_id}`));
      const benefitCounts = new Map<string, number>();
      for (const benefit of benefitsResult.data ?? []) {
        if (allowedAssignments.has(`${benefit.event_id}:${benefit.sponsor_id}`)) {
          benefitCounts.set(benefit.event_id, (benefitCounts.get(benefit.event_id) ?? 0) + 1);
        }
      }
      const signedVolumes = new Map<string, number>();
      for (const contract of contractsResult.data ?? []) {
        if (!allowedAssignments.has(`${contract.event_id}:${contract.sponsor_id}`) || (!contract.signed_at && contract.signature_status !== "signed")) continue;
        signedVolumes.set(contract.event_id, (signedVolumes.get(contract.event_id) ?? 0) + (contract.value_cents ?? 0));
      }
      const eventsWithPaths = eventsResult.data ?? [];
      const logoPaths = eventsWithPaths.flatMap((event) => event.organizer_logo_path ? [event.organizer_logo_path] : []);
      const { data: signedLogos } = logoPaths.length
        ? await admin.storage.from("sponsorproof-files").createSignedUrls(logoPaths, 60 * 60 * 24)
        : { data: [] };
      const logoUrlByPath = new Map((signedLogos ?? []).map((item) => [item.path, item.signedUrl]));
      const events = eventsWithPaths.map((event) => {
        const { organizer_logo_path, ...eventData } = event;
        return {
          ...eventData,
          organizer_logo_url: organizer_logo_path ? logoUrlByPath.get(organizer_logo_path) ?? null : null,
          benefit_count: benefitCounts.get(event.id) ?? 0,
          signed_volume_cents: signedVolumes.get(event.id) ?? 0,
        };
      });
      return NextResponse.json({ profileRequired, profileName, events }, { headers: { "Cache-Control": "no-store" } });
    }
    const eventsPromise = admin.from("events").select("id, organization_id, title, start_date, end_date, location, organizer_logo_path, contact_first_name, contact_last_name, contact_email, contact_phone").in("id", eventIds).then((result) => result);
    const relatedResultsPromise = Promise.all([
      admin.from("sponsors").select("id, name").in("id", sponsorIds),
      admin.from("contracts").select("id, event_id, sponsor_id, title, value_cents, signature_status, sponsor_signed_at, organizer_signed_at, signed_at, signing_document_id").in("event_id", eventIds),
      admin.from("tasks").select("id, event_id, sponsor_id, sponsor_name, benefit_id, title, due_at, status, source, workflow_order, workflow_instance, completion_type, requires_sponsor_approval, assigned_to_sponsor, sponsor_approval_status, sponsor_approved_at").in("event_id", eventIds),
      admin.from("benefits").select("id, event_id, sponsor_id, title, benefit_type, material_logistics, description, quantity, tasks_per_unit, status, due_at").in("event_id", eventIds).in("sponsor_id", sponsorIds),
      admin.from("event_report_metrics").select("id, event_id, metric_name, metric_value").in("event_id", eventIds).order("created_at", { ascending: true }),
      admin.from("event_sponsor_invoices").select("id, event_id, sponsor_id, updated_at, sponsor_visible").in("event_id", eventIds).in("sponsor_id", sponsorIds),
      admin.from("sponsor_documents").select("id, event_id, sponsor_id, uploaded_at, uploaded_by_type, document_role, published_to_sponsor, status").in("event_id", eventIds).in("sponsor_id", sponsorIds),
      Promise.all(eventIds.map(async (eventId) => {
        const { data, error } = await admin.rpc("event_signature_addon_enabled", { target_event_id: eventId });
        if (error) throw error;
        return data === true ? eventId : null;
      })),
    ]);
    const eventsResult = await eventsPromise;
    if (eventsResult.error) throw eventsResult.error;
    const organizationIds = [...new Set((eventsResult.data ?? []).flatMap((event) => event.organization_id ? [event.organization_id] : []))];
    const organizationsPromise = organizationIds.length
      ? admin.from("organizations").select("id, name").in("id", organizationIds)
      : Promise.resolve({ data: [], error: null });
    const [sponsorsResult, contractsResult, taskResult, benefitResult, reportMetricsResult, invoiceUpdatesResult, documentUpdatesResult, signatureChecks] = await relatedResultsPromise;
    if (sponsorsResult.error || contractsResult.error || taskResult.error || benefitResult.error || reportMetricsResult.error || invoiceUpdatesResult.error || documentUpdatesResult.error) throw sponsorsResult.error ?? contractsResult.error ?? taskResult.error ?? benefitResult.error ?? reportMetricsResult.error ?? invoiceUpdatesResult.error ?? documentUpdatesResult.error;
    const reportMetricsByEvent = new Map<string, Array<{ id: string; name: string; value: string }>>();
    for (const metric of reportMetricsResult.data ?? []) {
      reportMetricsByEvent.set(metric.event_id, [...(reportMetricsByEvent.get(metric.event_id) ?? []), { id: metric.id, name: metric.metric_name, value: metric.metric_value }]);
    }
    const allowedAssignments = new Set(assignments.map((item) => `${item.event_id}:${item.sponsor_id}`));
    const invoiceUpdates = (invoiceUpdatesResult.data ?? []).filter((invoice) => invoice.sponsor_visible && allowedAssignments.has(`${invoice.event_id}:${invoice.sponsor_id}`));
    const documentUpdates = (documentUpdatesResult.data ?? []).filter((document) =>
      document.status === "uploaded" && allowedAssignments.has(`${document.event_id}:${document.sponsor_id}`) &&
      (document.uploaded_by_type === "sponsor" || document.document_role === "signed_contract" || document.published_to_sponsor) &&
      (document.uploaded_by_type === "organizer" || document.document_role === "signed_contract")
    );
    const { data: organizations, error: organizationsError } = await organizationsPromise;
    if (organizationsError) throw organizationsError;
    const organizationNames = new Map((organizations ?? []).map((organization) => [organization.id, organization.name]));
    const allowed = new Set(assignments.map((item) => `${item.event_id}:${item.sponsor_id}`));
    const sponsorNamesById = new Map((sponsorsResult.data ?? []).map((sponsor) => [sponsor.id, sponsor.name.trim().toLocaleLowerCase()]));
    const benefitWorkflowCounts = new Map((benefitResult.data ?? []).map((benefit) => [benefit.id, benefitWorkflowCount(benefit.quantity ?? 1, benefit.tasks_per_unit !== false)]));
    const tasks = (taskResult.data ?? []).flatMap((task) => {
      if (task.benefit_id && benefitWorkflowCounts.has(task.benefit_id) && task.workflow_instance > (benefitWorkflowCounts.get(task.benefit_id) ?? 1)) return [];
      if (task.sponsor_id) return allowed.has(`${task.event_id}:${task.sponsor_id}`) ? [task] : [];
      if (task.source !== "Manuell" || !task.sponsor_name.trim()) return [];
      const normalizedName = task.sponsor_name.trim().toLocaleLowerCase();
      const matchingSponsorIds = [...new Set(assignments
        .filter((assignment) => assignment.event_id === task.event_id && allowed.has(`${assignment.event_id}:${assignment.sponsor_id}`) && sponsorNamesById.get(assignment.sponsor_id) === normalizedName)
        .map((assignment) => assignment.sponsor_id))];
      return matchingSponsorIds.length === 1 ? [{ ...task, sponsor_id: matchingSponsorIds[0] }] : [];
    });
    const benefits = (benefitResult.data ?? []).filter((benefit) => allowed.has(`${benefit.event_id}:${benefit.sponsor_id}`));
    const taskIds = tasks.map((task) => task.id);
    const sponsorUploadTaskIds = new Set(tasks.filter((task) => task.completion_type === "sponsor_upload").map((task) => task.id));
    const allSponsorApprovalTasks = tasks.filter((task) => task.completion_type === "sponsor_approval" || task.requires_sponsor_approval);
    const approvalTaskIds = allSponsorApprovalTasks.map((task) => task.id);
    const [evidenceResult, feedbackResult] = await Promise.all([
      taskIds.length
        ? admin.from("evidence_files").select("id, event_id, task_id, benefit_id, file_name, storage_path, content_type, sponsor_visible, created_at").in("task_id", taskIds)
        : Promise.resolve({ data: [], error: null }),
      approvalTaskIds.length
        ? admin.from("sponsor_task_feedback").select("task_id, evidence_file_id, created_at").in("task_id", approvalTaskIds).eq("decision", "changes_requested")
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (evidenceResult.error) throw evidenceResult.error;
    if (feedbackResult.error) throw feedbackResult.error;
    const evidenceRows = evidenceResult.data ?? [];
    const feedbackByApproval = new Map<string, Array<{ evidence_file_id: string | null; created_at: string }>>();
    for (const feedback of feedbackResult.data ?? []) feedbackByApproval.set(feedback.task_id, [...(feedbackByApproval.get(feedback.task_id) ?? []), feedback]);
    const returnedEvidenceIdsByApproval = new Map<string, Set<string>>();
    const latestReturnAtByApproval = new Map<string, string>();
    for (const task of allSponsorApprovalTasks) {
      const feedback = feedbackByApproval.get(task.id) ?? [];
      if (feedback.length) latestReturnAtByApproval.set(task.id, feedback.reduce((latest, item) => item.created_at > latest ? item.created_at : latest, feedback[0].created_at));
      const returnedIds = new Set(feedback.flatMap((item) => item.evidence_file_id ? [item.evidence_file_id] : []));
      for (const item of feedback.filter((entry) => !entry.evidence_file_id)) {
        const hasWorkflow = Boolean(task.benefit_id && task.workflow_order !== null);
        const previousSteps = hasWorkflow
          ? tasks.filter((candidate) => candidate.event_id === task.event_id && candidate.sponsor_id === task.sponsor_id && candidate.benefit_id === task.benefit_id && candidate.workflow_instance === task.workflow_instance && candidate.workflow_order !== null && candidate.workflow_order < (task.workflow_order ?? 0))
          : [];
        const sourceTaskIds = new Set(previousSteps.length ? previousSteps.map((candidate) => candidate.id) : [task.id]);
        const legacyReturnedEvidence = evidenceRows.filter((evidence) => evidence.sponsor_visible && sourceTaskIds.has(evidence.task_id ?? "") && evidence.created_at <= item.created_at).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        if (legacyReturnedEvidence) returnedIds.add(legacyReturnedEvidence.id);
      }
      if (returnedIds.size) returnedEvidenceIdsByApproval.set(task.id, returnedIds);
    }
    const activeEvidenceIdByApproval = new Map<string, string>();
    for (const task of allSponsorApprovalTasks) {
      const hasWorkflow = Boolean(task.benefit_id && task.workflow_order !== null);
      const orderedSteps = hasWorkflow
        ? tasks.filter((item) => item.event_id === task.event_id && item.sponsor_id === task.sponsor_id && item.benefit_id === task.benefit_id && item.workflow_instance === task.workflow_instance && item.workflow_order !== null && item.workflow_order < (task.workflow_order ?? 0) && item.status === "Erledigt")
        : [];
      const sourceTaskIds = new Set(orderedSteps.length ? orderedSteps.map((step) => step.id) : [task.id]);
      const latestReturnAt = latestReturnAtByApproval.get(task.id);
      const returnedIds = returnedEvidenceIdsByApproval.get(task.id) ?? new Set<string>();
      const activeEvidence = evidenceRows
        .filter((evidence) => evidence.sponsor_visible && sourceTaskIds.has(evidence.task_id ?? "") && !returnedIds.has(evidence.id) && (!latestReturnAt || evidence.created_at > latestReturnAt))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (activeEvidence) {
        activeEvidenceIdByApproval.set(task.id, activeEvidence.id);
      }
    }
    const sponsorApprovalEvidenceIds = new Set([...activeEvidenceIdByApproval.values(), ...[...returnedEvidenceIdsByApproval.values()].flatMap((ids) => [...ids])]);
    const evidenceToSign = evidenceRows.filter((evidence) => sponsorApprovalEvidenceIds.has(evidence.id) || sponsorUploadTaskIds.has(evidence.task_id ?? ""));
    const { data: signedEvidenceUrls } = evidenceToSign.length
      ? await admin.storage.from("sponsorproof-files").createSignedUrls(evidenceToSign.map((evidence) => evidence.storage_path), 3600, { download: false })
      : { data: [] };
    const evidenceUrlByPath = new Map((signedEvidenceUrls ?? []).map((item) => [item.path, item.signedUrl]));
    const signedEvidence = evidenceToSign.map((evidence) => {
      const url = evidenceUrlByPath.get(evidence.storage_path);
      return url ? { id: evidence.id, task_id: evidence.task_id, file_name: evidence.file_name, content_type: evidence.content_type, created_at: evidence.created_at, url } : null;
    });
    const evidenceByTask = new Map<string, NonNullable<(typeof signedEvidence)[number]>[]>();
    for (const item of signedEvidence) if (item?.task_id) evidenceByTask.set(item.task_id, [...(evidenceByTask.get(item.task_id) ?? []), item]);
    const sponsorApprovals = allSponsorApprovalTasks.filter((task) => ["pending", "changes_requested", "approved"].includes(task.sponsor_approval_status)).map((task) => {
      const hasWorkflow = Boolean(task.benefit_id && task.workflow_order !== null);
      const orderedSteps = hasWorkflow ? tasks.filter((item) => item.event_id === task.event_id && item.sponsor_id === task.sponsor_id && item.benefit_id === task.benefit_id && item.workflow_instance === task.workflow_instance && item.workflow_order !== null && item.workflow_order < (task.workflow_order ?? 0)).sort((a, b) => (a.workflow_order ?? 0) - (b.workflow_order ?? 0)) : [];
      const lastStep = orderedSteps.at(-1);
      const activeEvidenceId = activeEvidenceIdByApproval.get(task.id);
      const approvalEvidenceIds = new Set([...(activeEvidenceId ? [activeEvidenceId] : []), ...[...(returnedEvidenceIdsByApproval.get(task.id) ?? [])]]);
      const sharedFiles = (orderedSteps.length ? orderedSteps.flatMap((step) => evidenceByTask.get(step.id) ?? []) : evidenceByTask.get(task.id) ?? [])
        .filter((file) => approvalEvidenceIds.has(file.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const blockedBy = orderedSteps.find((item) => item.status !== "Erledigt");
      const ready = !blockedBy && Boolean(activeEvidenceId);
      return { ...task, ready, blocked_by: blockedBy?.title ?? null, planned_publish_date: lastStep?.due_at ?? task.due_at ?? null, files: sharedFiles };
    });
    const portalSponsorApprovals = sponsorApprovals;
    const approvalById = new Map(portalSponsorApprovals.map((task) => [task.id, task]));
    const benefitsWithTasks = benefits.map((benefit) => {
      const allBenefitTasks = tasks.filter((task) => task.event_id === benefit.event_id && task.sponsor_id === benefit.sponsor_id && task.benefit_id === benefit.id);
      const sponsorTasks = allBenefitTasks.filter((task) => task.completion_type === "sponsor_approval" || task.requires_sponsor_approval);
      const sponsorAssignedTasks = allBenefitTasks.filter((task) => task.assigned_to_sponsor && task.completion_type !== "sponsor_approval" && !task.requires_sponsor_approval);
      const allComplete = allBenefitTasks.length > 0 && allBenefitTasks.every((task) => task.status === "Erledigt");
      const someComplete = allBenefitTasks.some((task) => task.status === "Erledigt");
      const status = allBenefitTasks.length
        ? allComplete ? "Abgeschlossen" : someComplete ? "In Bearbeitung" : "Offen"
        : ["Erfüllt", "Erledigt", "Abgeschlossen"].includes(benefit.status)
          ? "Abgeschlossen"
          : benefit.status === "In Arbeit" ? "In Bearbeitung" : "Offen";
      const workflowCount = benefitWorkflowCount(benefit.quantity ?? 1, benefit.tasks_per_unit !== false);
      const units = Array.from({ length: workflowCount }, (_, index) => {
        const instance = index + 1;
        const instanceTasks = allBenefitTasks.filter((task) => task.workflow_instance === instance);
        const instanceComplete = instanceTasks.length > 0 && instanceTasks.every((task) => task.status === "Erledigt");
        const instanceStarted = instanceTasks.some((task) => task.status === "Erledigt");
        const fallbackStatus = ["Erfüllt", "Erledigt", "Abgeschlossen"].includes(benefit.status)
          ? "Abgeschlossen"
          : benefit.status === "In Arbeit" ? "In Bearbeitung" : "Offen";
        return {
          instance,
          needed_at: instanceTasks.filter((task) => task.completion_type !== "sponsor_approval").sort((a, b) => (a.workflow_order ?? 0) - (b.workflow_order ?? 0))[0]?.due_at ?? null,
          status: instanceTasks.length ? instanceComplete ? "Abgeschlossen" : instanceStarted ? "In Bearbeitung" : "Offen" : fallbackStatus,
          hasSponsorApproval: sponsorTasks.some((task) => task.workflow_instance === instance && ["pending", "changes_requested"].includes(task.sponsor_approval_status)),
          tasks: [
            ...sponsorAssignedTasks.filter((task) => task.workflow_instance === instance).map((task) => {
              const previousSteps = instanceTasks.filter((step) => step.workflow_order !== null && step.workflow_order < (task.workflow_order ?? 0));
              const blockedBy = previousSteps.find((step) => step.status !== "Erledigt");
              const ready = !blockedBy;
              return { ...task, ready, blocked_by: blockedBy?.title ?? null, planned_publish_date: null, files: evidenceByTask.get(task.id) ?? [] };
            }),
            ...sponsorTasks.flatMap((task) => task.workflow_instance === instance && approvalById.has(task.id) ? [{ ...task, ...approvalById.get(task.id)! }] : []),
          ].sort((a, b) => (a.workflow_order ?? 0) - (b.workflow_order ?? 0)),
        };
      });
      return {
        ...benefit,
        status,
        units,
      };
    });
    const events = eventsResult.data ?? [];
    const signatureEnabledEventIds = new Set(signatureChecks.filter((eventId): eventId is string => Boolean(eventId)));
    const sponsors = sponsorsResult.data ?? [];
    const contracts = (contractsResult.data ?? []).filter((contract) =>
      allowed.has(`${contract.event_id}:${contract.sponsor_id}`) && (contract.signed_at || contract.signature_status !== "draft")
    ).map((contract) => ({
      ...contract,
      signature_status: contract.signed_at ? "signed" : contract.signature_status,
    }));
    const docIds = contracts.flatMap((contract) => contract.signing_document_id ? [contract.signing_document_id] : []);
    const documentsById = new Map<string, { contract_id: string }>();
    if (docIds.length) {
      const { data: documents, error: documentsError } = await admin.from("contract_documents").select("id, contract_id").in("id", docIds);
      if (documentsError) throw documentsError;
      for (const document of documents ?? []) documentsById.set(document.id, { contract_id: document.contract_id });
    }
    const logoPaths = events.flatMap((event) => event.organizer_logo_path ? [event.organizer_logo_path] : []);
    const { data: signedLogos } = logoPaths.length
      ? await admin.storage.from("sponsorproof-files").createSignedUrls(logoPaths, 60 * 60 * 24)
      : { data: [] };
    const logoUrlByPath = new Map((signedLogos ?? []).map((item) => [item.path, item.signedUrl]));
    const eventsWithLogos = events.map((event) => {
      const { organizer_logo_path, organization_id, ...eventData } = event;
      return {
      ...eventData,
      organizer_name: organizationNames.get(organization_id) ?? "",
      organizer_logo_url: organizer_logo_path ? logoUrlByPath.get(organizer_logo_path) ?? null : null,
      signature_addon_enabled: signatureEnabledEventIds.has(event.id),
      report_metrics: reportMetricsByEvent.get(event.id) ?? [],
      sponsor_assignments: assignments.filter((assignment) => assignment.event_id === event.id).map((assignment) => ({
        sponsor_id: assignment.sponsor_id,
        sponsor_name: sponsors.find((sponsor) => sponsor.id === assignment.sponsor_id)?.name ?? "Sponsor",
        tab_updates: {
          invoices: invoiceUpdates.filter((invoice) => invoice.event_id === event.id && invoice.sponsor_id === assignment.sponsor_id).map(({ id, updated_at }) => ({ id, updated_at })),
          documents: documentUpdates.filter((document) => document.event_id === event.id && document.sponsor_id === assignment.sponsor_id).map(({ id, uploaded_at }) => ({ id, uploaded_at })),
        },
        tasks: tasks.filter((task) => {
          if (task.event_id !== event.id || task.sponsor_id !== assignment.sponsor_id || task.source !== "Manuell" || task.benefit_id) return false;
          const requiresApproval = task.completion_type === "sponsor_approval" || task.requires_sponsor_approval;
          if (!requiresApproval) return true;
          const approval = sponsorApprovals.find((item) => item.id === task.id);
          return Boolean(approval) || task.sponsor_approval_status === "changes_requested";
        }).map((task) => {
          const approval = sponsorApprovals.find((item) => item.id === task.id);
          return {
            id: task.id,
            title: task.title,
            due_at: task.due_at,
            status: task.status,
            completion_type: task.completion_type,
            requires_sponsor_approval: task.requires_sponsor_approval,
            sponsor_approval_status: task.sponsor_approval_status,
            sponsor_approved_at: task.sponsor_approved_at,
            // Standalone tasks have no workflow predecessor. Only approval tasks
            // can be blocked by an earlier step (or missing evidence).
            ready: approval ? approval.ready : true,
            blocked_by: approval?.blocked_by ?? null,
            files: approval?.files ?? evidenceByTask.get(task.id) ?? [],
          };
        }),
        benefits: benefitsWithTasks.filter((benefit) => benefit.event_id === event.id && benefit.sponsor_id === assignment.sponsor_id),
        contracts: contracts.filter((contract) => contract.event_id === event.id && contract.sponsor_id === assignment.sponsor_id).map((contract) => ({
          ...contract,
          sponsor_name: sponsors.find((sponsor) => sponsor.id === contract.sponsor_id)?.name ?? "Sponsor",
          signing_url: contract.signing_document_id && documentsById.get(contract.signing_document_id)?.contract_id === contract.id
            ? `/api/sponsor/contracts/${contract.id}/document`
            : null,
        })),
      })),
    };
    });
    return NextResponse.json({ profileRequired, profileName, events: eventsWithLogos }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Dein Sponsor-Bereich konnte nicht geladen werden." }, { status: 500 });
  }
}
