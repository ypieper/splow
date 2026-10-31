import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string }> };
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Ungültiger Vertrag." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data: contract, error: contractError } = await admin.from("contracts").select("event_id").eq("id", id).maybeSingle();
    if (contractError || !contract) return NextResponse.json({ error: "Der Vertrag wurde nicht gefunden." }, { status: 404 });
    const { data: ownsEvent, error: ownsError } = await supabase.rpc("owns_event", { target_event_id: contract.event_id });
    if (ownsError) throw ownsError;
    if (!ownsEvent) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });

    const { error: prepareError } = await admin.rpc("prepare_new_contract_version", { target_contract_id: id });
    if (prepareError) return NextResponse.json({ error: "Eine neue Vertragsfassung kann nur nach einer Ablehnung oder einem Abbruch vorbereitet werden." }, { status: 409 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Preparing a new contract version failed", error);
    return NextResponse.json({ error: "Die neue Vertragsfassung konnte nicht vorbereitet werden." }, { status: 500 });
  }
}
