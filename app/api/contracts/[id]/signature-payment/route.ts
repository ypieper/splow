import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string }> };
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function authorizeContract(id: string) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 }) };
  const admin = createAdminClient();
  const { data: contract, error } = await admin.from("contracts").select("event_id").eq("id", id).maybeSingle();
  if (error) return { response: NextResponse.json({ error: "Der Vertrag konnte nicht geladen werden." }, { status: 503 }) };
  if (!contract) return { response: NextResponse.json({ error: "Der Vertrag wurde nicht gefunden." }, { status: 404 }) };
  const { data: ownsEvent, error: ownsError } = await supabase.rpc("owns_event", { target_event_id: contract.event_id });
  if (ownsError) return { response: NextResponse.json({ error: "Der Zugriff auf den Vertrag konnte nicht geprüft werden." }, { status: 503 }) };
  if (!ownsEvent) return { response: NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 }) };
  return { response: null };
}

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Ungültiger Vertrag." }, { status: 400 });
  const { response } = await authorizeContract(id);
  if (response) return response;
  return NextResponse.json({ included: true, amountCents: 0, currency: "eur", paidSigningDocumentId: null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Ungültiger Vertrag." }, { status: 400 });
  const { response } = await authorizeContract(id);
  if (response) return response;
  return NextResponse.json({ error: "Die Vertragszeichnung ist inklusive und benötigt keine separate Zahlung." }, { status: 410 });
}
