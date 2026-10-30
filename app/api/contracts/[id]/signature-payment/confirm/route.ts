import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getStripeCheckoutSession, recordVerifiedContractSignaturePayment } from "@/lib/stripe-checkout";

type Context = { params: Promise<{ id: string }> };
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Ungültiger Vertrag." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  try {
    const body = await request.json() as { sessionId?: string };
    if (typeof body.sessionId !== "string" || !/^cs_(test_|live_)[A-Za-z0-9]+$/.test(body.sessionId)) {
      return NextResponse.json({ error: "Ungültige Zahlungsreferenz." }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data: contract } = await admin.from("contracts").select("event_id").eq("id", id).maybeSingle();
    if (!contract) return NextResponse.json({ error: "Der Vertrag wurde nicht gefunden." }, { status: 404 });
    const { data: ownsEvent, error: ownsError } = await supabase.rpc("owns_event", { target_event_id: contract.event_id });
    if (ownsError) throw ownsError;
    if (!ownsEvent) return NextResponse.json({ error: "Du hast keinen Zugriff auf diesen Vertrag." }, { status: 403 });

    const session = await getStripeCheckoutSession(body.sessionId);
    if (session.metadata?.contract_id !== id) return NextResponse.json({ error: "Die Zahlung gehört nicht zu diesem Vertrag." }, { status: 403 });
    if (session.payment_status !== "paid") return NextResponse.json({ error: "Die Zahlung wurde noch nicht bestätigt." }, { status: 409 });
    await recordVerifiedContractSignaturePayment(session);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Die Zahlung konnte noch nicht bestätigt werden. Bitte lade die Seite in einigen Sekunden neu." }, { status: 503 });
  }
}
