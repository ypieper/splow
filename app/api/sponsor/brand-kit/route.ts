import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sponsorUploadBucket, validateSponsorUploadFile } from "@/lib/sponsor-upload-server";

async function getAccounts() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { user: null, accountIds: [], admin: null, status: 401 };
  const admin = createAdminClient();
  const { data, error } = await admin.from("sponsor_account_members").select("account_id").eq("user_id", user.id);
  if (error) return { user: null, accountIds: [], admin: null, status: 500 };
  return { user, accountIds: (data ?? []).map((row) => row.account_id), admin, status: 200 };
}

export async function GET(request: Request) {
  const auth = await getAccounts();
  if (!auth.user || !auth.admin) return NextResponse.json({ error: auth.status === 401 ? "Bitte melde dich erneut an." : "Das Brand-Kit konnte nicht geladen werden." }, { status: auth.status });
  let permittedAccountIds = auth.accountIds;
  const taskId = new URL(request.url).searchParams.get("taskId");
  if (taskId) {
    const { data: task, error: taskError } = await auth.admin.from("tasks").select("event_id, sponsor_id").eq("id", taskId).maybeSingle();
    if (taskError) return NextResponse.json({ error: "Die Aufgabe konnte nicht geprüft werden." }, { status: 500 });
    if (!task?.event_id || !task.sponsor_id) return NextResponse.json({ error: "Die Aufgabe wurde nicht gefunden." }, { status: 404 });
    const { data: assignments, error: assignmentError } = await auth.admin.from("sponsor_event_accounts").select("account_id").eq("event_id", task.event_id).eq("sponsor_id", task.sponsor_id).in("account_id", auth.accountIds);
    if (assignmentError) return NextResponse.json({ error: "Deine Event-Zuordnung konnte nicht geprüft werden." }, { status: 500 });
    permittedAccountIds = (assignments ?? []).map((assignment) => assignment.account_id);
  }
  if (!permittedAccountIds.length) return NextResponse.json({ files: [] }, { headers: { "Cache-Control": "no-store" } });
  const [{ data: filesData, error: filesError }, { data: accounts }] = await Promise.all([
    auth.admin.from("sponsor_brand_kit_files").select("id, account_id, file_name, label, content_type, size_bytes, created_at, storage_path").in("account_id", permittedAccountIds).order("created_at", { ascending: false }),
    auth.admin.from("sponsor_accounts").select("id, name").in("id", auth.accountIds).order("created_at", { ascending: true }),
  ]);
  let data = filesData;
  if (filesError?.code === "42703") {
    const legacyResult = await auth.admin.from("sponsor_brand_kit_files")
      .select("id, account_id, file_name, content_type, size_bytes, created_at, storage_path")
      .in("account_id", permittedAccountIds)
      .order("created_at", { ascending: false });
    if (legacyResult.error) return NextResponse.json({ error: "Das Brand-Kit konnte nicht geladen werden." }, { status: 500 });
    data = (legacyResult.data ?? []).map((file) => ({ ...file, label: file.file_name }));
  } else if (filesError) {
    return NextResponse.json({ error: "Das Brand-Kit konnte nicht geladen werden." }, { status: 500 });
  }
  const files = await Promise.all((data ?? []).map(async ({ storage_path, ...file }) => {
    const { data: signed } = await auth.admin!.storage.from(sponsorUploadBucket).createSignedUrl(storage_path, 3600);
    return { ...file, url: signed?.signedUrl ?? null };
  }));
  return NextResponse.json({ files, accounts: accounts ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await getAccounts();
  if (!auth.user || !auth.admin) return NextResponse.json({ error: auth.status === 401 ? "Bitte melde dich erneut an." : "Der Upload konnte nicht vorbereitet werden." }, { status: auth.status });
  if (!auth.accountIds.length) return NextResponse.json({ error: "Dein Sponsor-Konto konnte nicht gefunden werden." }, { status: 403 });
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Die Datei konnte nicht gelesen werden." }, { status: 400 }); }
  const file = form.get("file");
  const requestedAccountId = String(form.get("accountId") ?? "").trim();
  const label = String(form.get("label") ?? "").trim();
  if (!(file instanceof File)) return NextResponse.json({ error: "Bitte wähle eine Datei aus." }, { status: 400 });
  if (!label || label.length > 100) return NextResponse.json({ error: "Bitte gib ein Label mit höchstens 100 Zeichen ein." }, { status: 400 });
  const checked = validateSponsorUploadFile({ name: file.name, contentType: file.type, size: file.size });
  if (!checked) return NextResponse.json({ error: "Bitte lade ein PDF, Bild oder Office-Dokument mit höchstens 25 MB hoch." }, { status: 400 });
  const accountQuery = auth.admin.from("sponsor_accounts").select("id").in("id", auth.accountIds).order("created_at", { ascending: true }).limit(1);
  const { data: account } = requestedAccountId ? await auth.admin.from("sponsor_accounts").select("id").eq("id", requestedAccountId).in("id", auth.accountIds).maybeSingle() : await accountQuery.maybeSingle();
  if (!account) return NextResponse.json({ error: "Dein Sponsor-Konto konnte nicht gefunden werden." }, { status: 403 });
  const path = `sponsor-brand-kit/${account.id}/${crypto.randomUUID()}-${checked.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
  const { error: storageError } = await auth.admin.storage.from(sponsorUploadBucket).upload(path, file, { contentType: checked.contentType, upsert: false });
  if (storageError) return NextResponse.json({ error: "Die Datei konnte nicht gespeichert werden." }, { status: 500 });
  const { data, error } = await auth.admin.from("sponsor_brand_kit_files").insert({ account_id: account.id, storage_path: path, file_name: checked.fileName, label, content_type: checked.contentType, size_bytes: file.size, created_by: auth.user.id }).select("id").single();
  if (error) { await auth.admin.storage.from(sponsorUploadBucket).remove([path]); return NextResponse.json({ error: "Die Datei konnte nicht im Brand-Kit gespeichert werden." }, { status: 500 }); }
  return NextResponse.json({ ok: true, id: data.id }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const auth = await getAccounts();
  if (!auth.user || !auth.admin) return NextResponse.json({ error: auth.status === 401 ? "Bitte melde dich erneut an." : "Das Label konnte nicht gespeichert werden." }, { status: auth.status });
  let body: { id?: string; label?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Die Eingabe konnte nicht gelesen werden." }, { status: 400 }); }
  const id = String(body.id ?? "").trim();
  const label = String(body.label ?? "").trim();
  if (!id || !label || label.length > 100) return NextResponse.json({ error: "Bitte gib ein Label mit höchstens 100 Zeichen ein." }, { status: 400 });
  const { data, error } = await auth.admin.from("sponsor_brand_kit_files").update({ label }).eq("id", id).in("account_id", auth.accountIds).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Das Label konnte nicht gespeichert werden." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Die Datei wurde nicht gefunden." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function PUT(request: Request) {
  const auth = await getAccounts();
  if (!auth.user || !auth.admin) return NextResponse.json({ error: auth.status === 401 ? "Bitte melde dich erneut an." : "Die Datei konnte nicht ersetzt werden." }, { status: auth.status });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Die Datei wurde nicht gefunden." }, { status: 400 });
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Die Datei konnte nicht gelesen werden." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Bitte wähle eine Datei aus." }, { status: 400 });
  const checked = validateSponsorUploadFile({ name: file.name, contentType: file.type, size: file.size });
  if (!checked) return NextResponse.json({ error: "Bitte lade ein PDF, Bild oder Office-Dokument mit höchstens 25 MB hoch." }, { status: 400 });
  const { data: existing, error: lookupError } = await auth.admin.from("sponsor_brand_kit_files")
    .select("id, account_id, storage_path")
    .eq("id", id)
    .in("account_id", auth.accountIds)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Die Datei konnte nicht geprüft werden." }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Die Datei wurde nicht gefunden." }, { status: 404 });

  const path = `sponsor-brand-kit/${existing.account_id}/${crypto.randomUUID()}-${checked.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
  const { error: storageError } = await auth.admin.storage.from(sponsorUploadBucket).upload(path, file, { contentType: checked.contentType, upsert: false });
  if (storageError) return NextResponse.json({ error: "Die neue Datei konnte nicht hochgeladen werden." }, { status: 500 });
  const { data: updated, error: updateError } = await auth.admin.from("sponsor_brand_kit_files")
    .update({ storage_path: path, file_name: checked.fileName, content_type: checked.contentType, size_bytes: file.size })
    .eq("id", existing.id)
    .eq("account_id", existing.account_id)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) {
    await auth.admin.storage.from(sponsorUploadBucket).remove([path]);
    return NextResponse.json({ error: updateError ? "Die Datei konnte nicht ersetzt werden." : "Die Datei wurde nicht gefunden." }, { status: updateError ? 500 : 404 });
  }
  await auth.admin.storage.from(sponsorUploadBucket).remove([existing.storage_path]);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const auth = await getAccounts();
  if (!auth.user || !auth.admin) return NextResponse.json({ error: auth.status === 401 ? "Bitte melde dich erneut an." : "Die Datei konnte nicht entfernt werden." }, { status: auth.status });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Die Datei wurde nicht gefunden." }, { status: 400 });
  const { data: file } = await auth.admin.from("sponsor_brand_kit_files").select("id, storage_path").eq("id", id).in("account_id", auth.accountIds).maybeSingle();
  if (!file) return NextResponse.json({ error: "Die Datei wurde nicht gefunden." }, { status: 404 });
  const { error: removeError } = await auth.admin.storage.from(sponsorUploadBucket).remove([file.storage_path]);
  if (removeError) return NextResponse.json({ error: "Die Datei konnte nicht vollständig entfernt werden." }, { status: 500 });
  const { error } = await auth.admin.from("sponsor_brand_kit_files").delete().eq("id", id).in("account_id", auth.accountIds);
  if (error) return NextResponse.json({ error: "Der Eintrag konnte nicht entfernt werden." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
