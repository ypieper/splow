import { AuthForm } from "@/components/auth-form";
import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata("Veranstalter-Login", "Melde dich bei deinem Splow Veranstalterkonto an.");

export default async function OrganizerLoginPage({ searchParams }: { searchParams: Promise<{ mode?: string; referral?: string; confirmation?: string }> }) {
  const params = await searchParams;
  const initialMessage = params.confirmation === "failed" ? "Der Bestätigungslink ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an oder starte die Registrierung erneut." : params.referral === "invalid" ? "Der Empfehlungslink ist ungültig oder nicht mehr aktiv." : "";
  return <main className="auth-page"><AuthForm accountType="organizer" initialMode={params.mode === "signup" ? "signup" : "login"} initialMessage={initialMessage} /></main>;
}
