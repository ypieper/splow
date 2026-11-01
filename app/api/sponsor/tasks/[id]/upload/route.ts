import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isUuid, sponsorUploadBucket, validateSponsorUploadFile } from "@/lib/sponsor-upload-server";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Ungültige Sponsor-Aufgabe." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Die Datei konnte nicht gelesen werden." }, { status: 400 });
  }
  const file = formData.get("file");
  const brandKitFileId = String(formData.get("brandKitFileId") ?? "").trim();
  if (!brandKitFileId && !(file instanceof File)) return NextResponse.json({ error: "Bitte wähle eine Datei aus." }, { status: 400 });
  const validatedFile = file instanceof File ? validateSponsorUploadFile({ name: file.name, contentType: file.type, size: file.size }) : null;
  if (!brandKitFileId && !validatedFile) return NextResponse.json({ error: "Bitte lade ein PDF, Bild oder Office-Dokument mit höchstens 25 MB hoch." }, { status: 400 });

  const admin = createAdminClient();
  const { data: task, error: taskError } = await admin.from("tasks")
    .select("id, organization_id, event_id, sponsor_id, benefit_id, workflow_instance, workflow_order, completion_type, assigned_to_sponsor, status")
    .eq("id", id)
    .maybeSingle();
  if (taskError) return NextResponse.json({ error: "Die Aufgabe konnte nicht geladen werden." }, { status: 500 });
  if (!task) return NextResponse.json({ error: "Die Aufgabe wurde nicht gefunden." }, { status: 404 });
  if (task.completion_type !== "sponsor_upload" || !task.assigned_to_sponsor) return NextResponse.json({ error: "Für diese Aufgabe ist kein Datei-Upload durch den Sponsor vorgesehen." }, { status: 409 });
  if (!task.event_id || !task.sponsor_id) return NextResponse.json({ error: "Die Aufgabe ist keinem Event-Sponsor zugeordnet." }, { status: 409 });
  const { data: sponsorTaskEvidenceEnabled, error: featureError } = await admin.rpc("event_feature_enabled", { target_event_id: task.event_id, target_feature: "sponsor_task_evidence" });
  if (featureError) return NextResponse.json({ error: "Die Paketberechtigung konnte nicht geprüft werden." }, { status: 503 });
  if (sponsorTaskEvidenceEnabled !== true) return NextResponse.json({ error: "Sponsor-Aufgaben und Nachweise sind ab Professional verfügbar." }, { status: 403 });

  const { data: memberships, error: membershipError } = await admin.from("sponsor_account_members")
    .select("account_id")
    .eq("user_id", user.id);
  if (membershipError) return NextResponse.json({ error: "Deine Sponsor-Zuordnung konnte nicht geprüft werden." }, { status: 500 });
  const accountIds = (memberships ?? []).map((membership) => membership.account_id);
  if (!accountIds.length) return NextResponse.json({ error: "Du hast keinen Zugriff auf diese Aufgabe." }, { status: 403 });
  const { data: assignments, error: assignmentError } = await admin.from("sponsor_event_accounts")
    .select("event_id, account_id")
    .eq("event_id", task.event_id)
    .eq("sponsor_id", task.sponsor_id)
    .in("account_id", accountIds);
  if (assignmentError) return NextResponse.json({ error: "Deine Sponsor-Zuordnung konnte nicht geprüft werden." }, { status: 500 });
  if (!assignments?.length) return NextResponse.json({ error: "Du hast keinen Zugriff auf diese Aufgabe." }, { status: 403 });
  if (task.status === "Erledigt") return NextResponse.json({ error: "Diese Aufgabe ist bereits abgeschlossen." }, { status: 409 });

  let uploadBody: File | Blob;
  let fileName: string;
  let contentType: string;
  if (brandKitFileId) {
    const { data: brandFile, error: brandError } = await admin.from("sponsor_brand_kit_files")
      .select("account_id, storage_path, file_name, content_type, size_bytes")
      .eq("id", brandKitFileId).in("account_id", (assignments ?? []).map((assignment) => assignment.account_id)).maybeSingle();
    if (brandError) return NextResponse.json({ error: "Die Datei aus dem Brand-Kit konnte nicht geladen werden." }, { status: 500 });
    if (!brandFile || Number(brandFile.size_bytes) > 25 * 1024 * 1024) return NextResponse.json({ error: "Diese Datei ist nicht verfügbar oder zu groß." }, { status: 404 });
    const { data: savedFile, error: downloadError } = await admin.storage.from(sponsorUploadBucket).download(brandFile.storage_path);
    if (downloadError || !savedFile) return NextResponse.json({ error: "Die Datei aus dem Brand-Kit konnte nicht geladen werden." }, { status: 500 });
    uploadBody = savedFile;
    fileName = brandFile.file_name;
    contentType = brandFile.content_type;
  } else {
    uploadBody = file as File;
    fileName = validatedFile!.fileName;
    contentType = validatedFile!.contentType;
  }

  if (task.benefit_id && task.workflow_order !== null) {
    const { data: previousTasks, error: previousError } = await admin.from("tasks")
      .select("status")
      .eq("event_id", task.event_id)
      .eq("sponsor_id", task.sponsor_id)
      .eq("benefit_id", task.benefit_id)
      .eq("workflow_instance", task.workflow_instance)
      .lt("workflow_order", task.workflow_order);
    if (previousError) return NextResponse.json({ error: "Der Aufgabenablauf konnte nicht geprüft werden." }, { status: 500 });
    if ((previousTasks ?? []).some((previous) => previous.status !== "Erledigt")) {
      return NextResponse.json({ error: "Die vorherige Aufgabe muss zuerst abgeschlossen werden." }, { status: 409 });
    }
  }

  const storagePath = `${task.organization_id}/events/${task.event_id}/evidence/${crypto.randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
  const { error: storageError } = await admin.storage.from(sponsorUploadBucket).upload(storagePath, uploadBody, {
    contentType,
    upsert: false,
  });
  if (storageError) return NextResponse.json({ error: "Die Datei konnte nicht gespeichert werden." }, { status: 500 });

  const { error: evidenceError } = await admin.from("evidence_files").insert({
    organization_id: task.organization_id,
    event_id: task.event_id,
    benefit_id: task.benefit_id,
    task_id: task.id,
    storage_path: storagePath,
    file_name: fileName,
    content_type: contentType,
    uploaded_by: user.id,
  });
  if (evidenceError) {
    await admin.storage.from(sponsorUploadBucket).remove([storagePath]);
    const isFeatureError = evidenceError.message.includes("EVENT_FEATURE_REQUIRED");
    return NextResponse.json({ error: isFeatureError ? "Die Nachweisfunktion dieses Events ist aktuell nicht freigeschaltet." : "Die Datei konnte nicht der Aufgabe zugeordnet werden." }, { status: isFeatureError ? 403 : 500 });
  }

  const { data: updatedTask, error: updateError } = await admin.from("tasks")
    .update({ status: "Erledigt" })
    .eq("id", task.id)
    .neq("status", "Erledigt")
    .select("id")
    .maybeSingle();
  if (updateError || !updatedTask) {
    await admin.from("evidence_files").delete().eq("task_id", task.id).eq("storage_path", storagePath);
    await admin.storage.from(sponsorUploadBucket).remove([storagePath]);
    const isFeatureError = updateError?.message.includes("EVENT_FEATURE_REQUIRED");
    return NextResponse.json({ error: isFeatureError ? "Die Aufgabenfunktion dieses Events ist aktuell nicht freigeschaltet." : "Die Aufgabe konnte nicht abgeschlossen werden. Bitte lade die Datei erneut hoch." }, { status: isFeatureError ? 403 : 409 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
