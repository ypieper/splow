import { notFound, redirect } from "next/navigation";
import { PartnerDashboard } from "@/components/partner-dashboard";
import { privatePageMetadata } from "@/lib/seo";
import { getAuthorizedSalesPartner } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = privatePageMetadata("Vertriebspartner", "Vermittlungen und Provisionen bei Splow im Überblick.");

export default async function PartnerPage() {
  const auth = await getAuthorizedSalesPartner();
  if (auth.responseStatus === 401) redirect("/login/veranstalter");
  if (auth.responseStatus === 403) notFound();
  if (auth.responseStatus === 503) return <main className="content"><section className="panel admin-notice"><strong>Partnerbereich nicht verfügbar</strong><p>Die serverseitige Partnerverwaltung ist derzeit nicht erreichbar.</p></section></main>;
  return <PartnerDashboard />;
}
