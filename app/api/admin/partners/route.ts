import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient, getAuthorizedPlatformAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const jsonError = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function GET() {
  const auth = await getAuthorizedPlatformAdmin();
  if (auth.responseStatus) return jsonError("Kein Zugriff auf die Vertriebspartner.", auth.responseStatus);
  const admin = createAdminClient();
  const [{ data: partners, error }, { data: referrals }, { data: commissions }, { data: payouts }] = await Promise.all([
    admin.from("sales_partners").select("id,user_id,referral_code,is_active,created_at,attribution_window_days").order("created_at", { ascending: false }),
    admin.from("partner_referrals").select("id,partner_id,organization_id,organization_name_snapshot,sponso_id_snapshot,registered_at,organization_created_at"),
    admin.from("partner_commissions").select("id,partner_id,status,commission_amount_cents,product_code,organization_name_snapshot,sponso_id_snapshot,created_at,payment_receipt_id"),
    admin.from("partner_payouts").select("id,partner_id,amount_cents,paid_at,payout_reference")
  ]);
  if (error) return jsonError("Vertriebspartner konnten nicht geladen werden.", 500);
  const authUsers = new Map<string, { email: string; firstName: string; lastName: string }>();
  for (let page = 1; page <= Math.ceil((partners?.length ?? 0) / 1000) + 1; page += 1) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    for (const user of data.users) authUsers.set(user.id, { email: user.email ?? "", firstName: String(user.user_metadata?.first_name ?? ""), lastName: String(user.user_metadata?.last_name ?? "") });
    if (data.users.length < 1000) break;
  }
  return NextResponse.json({ partners: (partners ?? []).map((partner) => {
    const user = authUsers.get(partner.user_id) ?? { email: "Konto nicht gefunden", firstName: "", lastName: "" };
    return { ...partner, ...user, referrals: (referrals ?? []).filter((item) => item.partner_id === partner.id), commissions: (commissions ?? []).filter((item) => item.partner_id === partner.id), payouts: (payouts ?? []).filter((item) => item.partner_id === partner.id) };
  }) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await getAuthorizedPlatformAdmin();
  if (auth.responseStatus) return jsonError("Kein Zugriff auf die Vertriebspartner.", auth.responseStatus);
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) return jsonError("Bitte gib eine gültige E-Mail-Adresse ein.");
  const admin = createAdminClient();
  let target = null;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return jsonError("Benutzerkonten konnten nicht geprüft werden.", 500);
    target = data.users.find((user) => user.email?.toLowerCase() === email) ?? null;
    if (target || data.users.length < 1000) break;
  }
  if (!target) return jsonError("Für diese E-Mail-Adresse gibt es noch kein Splow-Konto. Das Konto muss zuerst registriert werden.");
  const { data: existing } = await admin.from("sales_partners").select("id").eq("user_id", target.id).maybeSingle();
  if (existing) return jsonError("Dieses Konto ist bereits als Vertriebspartner angelegt.", 409);
  let referralCode = "";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    referralCode = randomBytes(6).toString("hex").toUpperCase();
    const { data, error } = await admin.from("sales_partners").insert({ user_id: target.id, referral_code: referralCode }).select("id,user_id,referral_code,is_active,created_at,attribution_window_days").single();
    if (!error && data) {
      await admin.from("partner_commission_audit").insert({ actor_user_id: auth.user!.id, entity_type: "partner", entity_id: data.id, action: "created", after_data: { user_id: target.id, email } });
      return NextResponse.json({ partner: { ...data, email } }, { status: 201 });
    }
    if (error?.code !== "23505") return jsonError("Vertriebspartner konnte nicht angelegt werden.", 500);
  }
  return jsonError("Es konnte kein eindeutiger Referral-Code erzeugt werden.", 503);
}
