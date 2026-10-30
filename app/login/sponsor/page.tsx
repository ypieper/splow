import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata("Sponsor-Login", "Melde dich bei deinem Splow Sponsor-Konto an.");

export default async function SponsorLoginPage({ searchParams }: { searchParams: Promise<{ registration?: string }> }) {
  const params = await searchParams;
  const initialMessage = params.registration === "success"
    ? "Deine E-Mail ist bestätigt und dein Sponsor-Konto ist eingerichtet. Du kannst dich jetzt anmelden."
    : params.registration === "setup-failed"
      ? "Deine E-Mail wurde bestätigt, aber das Sponsor-Konto konnte nicht eingerichtet werden. Bitte wende dich an den Support."
      : params.registration === "confirmation-failed"
        ? "Der Bestätigungslink ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an oder starte die Registrierung erneut."
      : "";

  return <main className="auth-page">
    <div className="auth-sponsor-page">
      <div className="auth-sponsor-back"><Link href="/login">← Zur Auswahl</Link></div>
      <AuthForm accountType="sponsor" initialMessage={initialMessage} />
      <p className="auth-sponsor-note">Mit deiner Registrierung legst du dein Sponsor-Konto an. Über einen Einladungscode kannst du später Events damit verknüpfen.</p>
    </div>
  </main>;
}
