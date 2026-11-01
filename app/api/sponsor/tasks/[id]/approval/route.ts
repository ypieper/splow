import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string }> };
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Ungültige Sponsor-Aufgabe." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  const body = await request.json().catch(() => null) as { decision?: unknown; comment?: unknown } | null;
  const decision = body?.decision === "return" ? "changes_requested" : body?.decision === "approve" ? "approved" : "invalid";
  const comment = typeof body?.comment === "string" ? body.comment.trim() : "";
  if (decision === "invalid") return NextResponse.json({ error: "Bitte wähle Freigeben oder Änderungen anfordern." }, { status: 400 });
  if (decision === "changes_requested" && !comment) return NextResponse.json({ error: "Bitte gib einen Kommentar zu den gewünschten Änderungen ein." }, { status: 400 });

  const admin = createAdminClient();
  const { data: task, error: taskError } = await admin.from("tasks").select("event_id").eq("id", id).maybeSingle();
  if (taskError) return NextResponse.json({ error: "Die Aufgabe konnte nicht geladen werden." }, { status: 503 });
  if (!task?.event_id) return NextResponse.json({ error: "Die Aufgabe wurde nicht gefunden." }, { status: 404 });
  const { data: sponsorTaskEvidenceEnabled, error: featureError } = await admin.rpc("event_feature_enabled", { target_event_id: task.event_id, target_feature: "sponsor_task_evidence" });
  if (featureError) return NextResponse.json({ error: "Die Paketberechtigung konnte nicht geprüft werden." }, { status: 503 });
  if (sponsorTaskEvidenceEnabled !== true) return NextResponse.json({ error: "Sponsor-Aufgaben und Nachweise sind ab Professional verfügbar." }, { status: 403 });

  let deletedPaths: string[] = [];
  let error;
  try {
    const result = await admin.rpc("respond_to_sponsor_task", {
      target_task_id: id,
      target_user_id: user.id,
      target_decision: decision,
      target_comment: comment || null,
    });
    error = result.error;
    if (!error && Array.isArray(result.data)) {
      deletedPaths = result.data.filter((path): path is string => typeof path === "string");
      if (deletedPaths.length) {
        const { error: storageError } = await admin.storage.from("sponsorproof-files").remove(deletedPaths);
        if (storageError) {
          console.error("[sponsor/tasks/approval] Returned proof files could not be removed from storage", { code: storageError.name, message: storageError.message });
          return NextResponse.json({ ok: true, decision, fileCleanupWarning: true }, { headers: { "Cache-Control": "no-store" } });
        }
      }
    }
  } catch (reason) {
    console.error("[sponsor/tasks/approval] Sponsor response could not reach Supabase", reason);
    return NextResponse.json({ error: "Der Freigabedienst ist serverseitig nicht erreichbar. Bitte prüfe die Supabase-Serverkonfiguration." }, { status: 503 });
  }
  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") {
      return NextResponse.json({ error: "Die Sponsorfreigabe ist in der Datenbank noch nicht eingerichtet. Bitte führe supabase db push aus und versuche es erneut." }, { status: 503 });
    }
    const messages: Array<[string, string, number]> = [
      ["SPONSOR_TASK_ACCESS_DENIED", "Du hast keinen Zugriff auf diese Aufgabe.", 403],
      ["SPONSOR_TASK_NOT_FOUND", "Die Aufgabe wurde nicht gefunden.", 404],
      ["SPONSOR_TASK_PREVIOUS_STEPS_INCOMPLETE", "Die vorherigen Aufgaben müssen zuerst abgeschlossen werden.", 409],
      ["SPONSOR_TASK_FILE_NOT_SHARED", "Es wurde noch keine Datei zur Sponsorfreigabe bereitgestellt.", 409],
      ["SPONSOR_TASK_NOT_ACTIVE", "Diese Sponsor-Aufgabe ist gerade nicht aktiv.", 409],
      ["SPONSOR_TASK_NOT_APPROVAL", "Für diese Aufgabe ist keine Sponsorfreigabe vorgesehen.", 409],
      ["SPONSOR_TASK_COMMENT_REQUIRED", "Bitte gib einen Kommentar zu den gewünschten Änderungen ein.", 400],
      ["SPONSOR_TASK_DECISION_INVALID", "Bitte wähle Freigeben oder Änderungen anfordern.", 400],
      ["EVENT_FEATURE_REQUIRED", "Die Aufgabenfunktion dieses Events ist aktuell nicht freigeschaltet.", 403],
    ];
    const match = messages.find(([key]) => error.message.includes(key));
    if (match) return NextResponse.json({ error: match[1] }, { status: match[2] });
    console.error("[sponsor/tasks/approval] Sponsor response failed", { code: error.code, message: error.message });
    return NextResponse.json({ error: `Deine Rückmeldung konnte nicht gespeichert werden. Datenbankfehler (${error.code || "unbekannt"}).` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, decision, deletedFileCount: deletedPaths.length }, { headers: { "Cache-Control": "no-store" } });
}
