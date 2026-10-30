import Link from "next/link";
import { SplowLogo } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const links = [
  ["AGB", "/agb"],
  ["Impressum", "/impressum"],
  ["Datenschutz", "/datenschutz"],
  ["Kontakt", "/kontakt"],
] as const;

export async function PublicPageFrame({ children, showLoginLink = true, partnerLogoUrl = null, brandHref = "/" }: { children: React.ReactNode; showLoginLink?: boolean; partnerLogoUrl?: string | null; brandHref?: string }) {
  let isAuthenticated = false;
  if (showLoginLink && isSupabaseConfigured) {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      isAuthenticated = Boolean(user);
    } catch {
      isAuthenticated = false;
    }
  }

  return <div className="public-site-shell">
    <header className={`public-site-header${partnerLogoUrl ? " public-site-header-partner" : ""}`}><div className="public-brand-lockup"><Link href={brandHref} aria-label="Splow öffnen"><SplowLogo /></Link>{partnerLogoUrl && <><span className="public-brand-partnership" aria-label="in Partnerschaft mit">×</span><img className="public-partner-logo" src={partnerLogoUrl} alt="Logo des Veranstalters"/></>}</div>{showLoginLink && <Link className="btn" href={isAuthenticated ? "/dashboard" : "/login"}>{isAuthenticated ? "Zurück zum Veranstalterbereich" : "Zur Anmeldung"}</Link>}</header>
    {children}
    <footer className="public-site-footer"><span>© {new Date().getFullYear()} Splow</span><nav aria-label="Rechtliche Hinweise">{links.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</nav></footer>
  </div>;
}

export type LegalSection = { title: string; paragraphs: string[]; bullets?: string[] };

export function LegalPage({ title, intro, sections }: { title: string; intro: string; sections: LegalSection[] }) {
  return <PublicPageFrame>
    <main className="public-page-content">
      <div className="eyebrow">SPLOW · ENTWURF</div>
      <h1>{title}</h1>
      <p className="public-page-intro">{intro}</p>
      <aside className="legal-draft-notice"><strong>Vorschlag – noch nicht veröffentlichen</strong><span>Die Angaben in eckigen Klammern müssen ergänzt werden. Bitte den Entwurf vor dem produktiven Einsatz rechtlich prüfen lassen.</span></aside>
      <article className="panel legal-document">{sections.map((section) => <section key={section.title}><h2>{section.title}</h2>{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}</section>)}</article>
    </main>
  </PublicPageFrame>;
}
