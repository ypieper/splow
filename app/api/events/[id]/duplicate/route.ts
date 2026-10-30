import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string }> };
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isDate = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
};

export async function POST(request: Request, context: Context) {
  const { id: sourceEventId } = await context.params;
  if (!isUuid(sourceEventId)) return NextResponse.json({ error: "Ungültiges Event." }, { status: 400 });

  const body = await request.json().catch(() => null) as { title?: unknown; startDate?: unknown; endDate?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 100) return NextResponse.json({ error: "Bitte gib einen Eventnamen mit höchstens 100 Zeichen ein." }, { status: 400 });
  if (!isDate(body?.startDate) || !isDate(body?.endDate) || body.endDate < body.startDate) {
    return NextResponse.json({ error: "Bitte gib einen gültigen Zeitraum mit Beginn und Ende ein." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });
  const { data: canAccess, error: accessError } = await supabase.rpc("owns_event", { target_event_id: sourceEventId });
  if (accessError) return NextResponse.json({ error: "Der Zugriff auf das Event konnte nicht geprüft werden." }, { status: 500 });
  if (!canAccess) return NextResponse.json({ error: "Du hast keinen Zugriff auf dieses Event." }, { status: 403 });

  const { data: eventId, error } = await supabase.rpc("duplicate_event_with_configuration", {
    source_event_id: sourceEventId,
    new_event_title: title,
    new_event_start_date: body.startDate,
    new_event_end_date: body.endDate,
  });
  if (error || typeof eventId !== "string") {
    const message = error?.message ?? "Event konnte nicht dupliziert werden.";
    if (message.includes("EVENT_ACCESS_DENIED")) return NextResponse.json({ error: "Du hast keinen Zugriff auf dieses Event." }, { status: 403 });
    return NextResponse.json({ error: "Das Event konnte nicht vollständig dupliziert werden. Bitte versuche es erneut." }, { status: 500 });
  }

  return NextResponse.json({ eventId }, { headers: { "Cache-Control": "no-store" } });
}
