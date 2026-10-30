import Link from "next/link";
import { SplowLogo } from "@/components/ui";
import { AuthForm } from "@/components/auth-form";
import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata("Anmelden", "Melde dich bei Splow an, um Sponsoren, Events und Nachweise zu verwalten.");

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string; next?: string; type?: string }> }) {
  const params = await searchParams;
  const invitation = params.next?.startsWith("/team/join") ?? false;
  if (invitation || params.type === "organizer") {
    const initialMode = params.mode === "signup" && invitation ? "signup" : "login";
    return <main className="auth-page"><AuthForm initialMode={initialMode} invitation={invitation} /></main>;
  }

  return <main className="auth-page">
    <section className="auth-choice-layout">
      <div className="auth-choice-brand"><SplowLogo /></div>
      <div className="auth-choice-heading"><span className="auth-form-eyebrow">WILLKOMMEN BEI SPLOW</span><h1>Wie möchtest du dich anmelden?</h1><p>Wähle den passenden Zugang für dein Konto.</p></div>
      <div className="auth-choice-grid">
        <a className="auth-choice-card" href="/login/veranstalter">
          <span className="auth-choice-icon" aria-hidden="true">↗</span>
          <strong>Als Veranstalter</strong>
          <span>Events, Sponsoren und Leistungen verwalten</span>
          <b>Zum Veranstalter-Login <span aria-hidden="true">→</span></b>
        </a>
        <a className="auth-choice-card auth-choice-sponsor" href="/login/sponsor">
          <span className="auth-choice-icon" aria-hidden="true">◇</span>
          <strong>Als Sponsor</strong>
          <span>Zu deinem Sponsor-Konto und deinen Events</span>
          <b>Zum Sponsor-Login <span aria-hidden="true">→</span></b>
        </a>
      </div>
      <nav className="auth-legal-links" aria-label="Rechtliche Hinweise"><Link href="/agb">AGB</Link><Link href="/impressum">Impressum</Link><Link href="/datenschutz">Datenschutz</Link><Link href="/kontakt">Kontakt</Link></nav>
    </section>
  </main>;
}
