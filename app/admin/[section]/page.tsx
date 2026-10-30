import { notFound, redirect } from "next/navigation";
import AdminDashboard, { type AdminSection } from "@/components/admin-dashboard";
import { privatePageMetadata } from "@/lib/seo";
import { getAuthorizedPlatformAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = privatePageMetadata("Plattformverwaltung", "Verwalte die Splow-Plattform.");

const sections: Record<string, AdminSection> = {
  users: "users",
  transactions: "transactions",
  codes: "codes",
  enterprise: "enterprise",
  contacts: "contacts",
  organizations: "organizations",
  partners: "partners",
  commissions: "commissions",
  "commission-rules": "commission-rules",
};

export default async function AdminSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: slug } = await params;
  const section = sections[slug];
  if (!section) notFound();

  const auth = await getAuthorizedPlatformAdmin();
  if (auth.responseStatus === 401) redirect("/admin/login");
  if (auth.responseStatus === 403) notFound();
  if (auth.responseStatus === 503) return <main className="content"><section className="panel admin-notice"><strong>Admin-Verwaltung nicht verfügbar</strong><p>Die serverseitige Admin-Konfiguration konnte nicht geprüft werden.</p></section></main>;

  return <AdminDashboard section={section} />;
}
