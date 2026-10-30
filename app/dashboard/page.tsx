import { DashboardWorkspace } from "@/components/dashboard-workspace";
import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata("Dashboard", "Behalte die nächsten Sponsoring-Aufgaben und alle Veranstaltungen im Blick.");

export default function DashboardPage() {
  return <DashboardWorkspace />;
}
