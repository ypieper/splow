import { benefitWorkflowCount } from "@/lib/benefit-workflow";
import { createCompletionReportPdf } from "@/lib/completion-report-pdf";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id: eventId } = await context.params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  const { data: enabled, error: featureError } = await supabase.rpc("event_feature_enabled", { target_event_id: eventId, target_feature: "reports_tab" });
  if (featureError) return NextResponse.json({ error: "Die Reportberechtigung konnte nicht geprüft werden." }, { status: 503 });
  if (enabled !== true) return NextResponse.json({ error: "Abschlussreports sind im Business-Paket verfügbar." }, { status: 403 });

  const body = await request.json().catch(() => null) as { contractId?: unknown } | null;
  const contractId = typeof body?.contractId === "string" ? body.contractId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(contractId)) {
    return NextResponse.json({ error: "Ungültiger Vertrag." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: contract, error: contractError } = await admin.from("contracts")
    .select("id, event_id, sponsor_id, value_cents")
    .eq("id", contractId).eq("event_id", eventId).maybeSingle();
  if (contractError) return NextResponse.json({ error: "Der Vertrag konnte nicht geladen werden." }, { status: 503 });
  if (!contract?.sponsor_id) return NextResponse.json({ error: "Der Vertrag wurde nicht gefunden." }, { status: 404 });

  const [eventResult, sponsorResult, benefitResult, taskResult, evidenceResult] = await Promise.all([
    admin.from("events").select("title").eq("id", eventId).maybeSingle(),
    admin.from("sponsors").select("name").eq("id", contract.sponsor_id).maybeSingle(),
    admin.from("benefits").select("id, title, quantity, tasks_per_unit, completion_required, evidence_summary").eq("event_id", eventId).eq("sponsor_id", contract.sponsor_id).limit(500),
    admin.from("tasks").select("id, title, benefit_id, workflow_instance, source, status, requires_sponsor_approval, sponsor_approval_status").eq("event_id", eventId).eq("sponsor_id", contract.sponsor_id).limit(1000),
    admin.from("evidence_files").select("task_id, file_name").eq("event_id", eventId).eq("sponsor_id", contract.sponsor_id).limit(2000),
  ]);
  if (eventResult.error || sponsorResult.error || benefitResult.error || taskResult.error || evidenceResult.error) {
    return NextResponse.json({ error: "Die Reportdaten konnten nicht geladen werden." }, { status: 503 });
  }
  if (!eventResult.data || !sponsorResult.data) return NextResponse.json({ error: "Die Reportdaten wurden nicht gefunden." }, { status: 404 });

  const benefits = benefitResult.data ?? [];
  const benefitsById = new Map(benefits.map((benefit) => [benefit.id, benefit]));
  const evidenceByTask = new Map<string, string>();
  for (const file of evidenceResult.data ?? []) {
    if (file.task_id && !evidenceByTask.has(file.task_id)) evidenceByTask.set(file.task_id, file.file_name);
  }
  const tasks = (taskResult.data ?? []).filter((task) => {
    const benefit = task.benefit_id ? benefitsById.get(task.benefit_id) : undefined;
    if (benefit?.completion_required === false) return false;
    if (task.source !== "Leistung" || !task.benefit_id || !benefit) return true;
    return task.workflow_instance <= benefitWorkflowCount(benefit.quantity ?? 1, benefit.tasks_per_unit !== false);
  }).filter((task) => task.source === "Leistung" || task.source === "Manuell").map((task) => ({
    title: task.title,
    evidence: evidenceByTask.get(task.id) ?? (task.requires_sponsor_approval && task.sponsor_approval_status === "approved" ? "Vom Sponsor freigegeben" : ""),
  }));
  const benefitsWithTasks = new Set((taskResult.data ?? []).filter((task) => task.source === "Leistung" && task.benefit_id).map((task) => task.benefit_id));
  for (const benefit of benefits) {
    if (benefit.completion_required === false || benefitsWithTasks.has(benefit.id)) continue;
    tasks.push({ title: benefit.title, evidence: benefit.evidence_summary !== "Noch kein Nachweis" ? benefit.evidence_summary : "" });
  }
  if (!tasks.length) return NextResponse.json({ error: "Für diesen Sponsor gibt es noch keine reportfähigen Leistungen." }, { status: 409 });

  const value = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format((contract.value_cents ?? 0) / 100);
  const file = await createCompletionReportPdf({ sponsorName: sponsorResult.data.name, eventTitle: eventResult.data.title, contractValue: value, tasks });
  return new Response(await file.arrayBuffer(), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file.name.replace(/[\r\n"\\]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
