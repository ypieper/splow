import { NextResponse } from "next/server";
import { createAdminClient, isPlatformAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type ContactBody = {
  name?: unknown;
  email?: unknown;
  organizationName?: unknown;
  subject?: unknown;
  message?: unknown;
  privacyRead?: unknown;
  website?: unknown;
};

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as ContactBody | null;
  if (!body) return NextResponse.json({ error: "Bitte prüfe deine Eingaben." }, { status: 400 });
  if (clean(body.website, 200)) return NextResponse.json({ ok: true });

  const name = clean(body.name, 120);
  const email = clean(body.email, 254).toLowerCase();
  const organizationName = clean(body.organizationName, 160);
  const subject = body.subject === "Enterprise-Anfrage" ? "Enterprise-Anfrage" : body.subject === "Allgemeine Anfrage" ? "Allgemeine Anfrage" : "";
  const message = clean(body.message, 5000);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !subject || message.length < 10 || body.privacyRead !== true) {
    return NextResponse.json({ error: "Bitte prüfe Name, E-Mail-Adresse, Anliegen, Nachricht und die Bestätigung der Datenschutzhinweise." }, { status: 400 });
  }
  if (!isPlatformAdminConfigured()) return NextResponse.json({ error: "Das Kontaktformular ist derzeit nicht verfügbar." }, { status: 503 });

  const admin = createAdminClient();
  let userId: string | null = null;
  let organizationId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      userId = user.id;
      const { data: membership } = await admin.from("organization_members").select("organization_id").eq("user_id", user.id).maybeSingle();
      organizationId = membership?.organization_id ?? null;
    }
  } catch {
    // Public visitors can submit without a Splow account.
  }

  const { error } = await admin.from("contact_requests").insert({
    user_id: userId,
    organization_id: organizationId,
    name,
    email,
    organization_name: organizationName,
    subject,
    message,
  });
  if (error) return NextResponse.json({ error: "Deine Nachricht konnte nicht gespeichert werden. Bitte versuche es später erneut." }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
