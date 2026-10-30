import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageFrame } from "@/components/public-page-frame";
import { LandingMotion } from "./landing/landing-motion";

export const metadata: Metadata = {
  title: "Sponsoringmanagement für Veranstalter",
  description: "Mit Splow verwaltest du Sponsoren, Vereinbarungen, Aufgaben und Nachweise für deine Veranstaltung an einem Ort.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "de_DE",
    siteName: "Splow",
    title: "Splow – Sponsoring einfach organisiert",
    description: "Von der Vereinbarung bis zum Leistungsnachweis: Sponsoring für Veranstaltungen an einem Ort organisieren.",
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "Splow – Sponsoring einfach organisiert",
    description: "Sponsoren, Leistungen, Aufgaben und Nachweise für dein Event zentral verwalten.",
  },
};

const workflow = [
  { number: "01", title: "Vereinbaren", text: "Verwalte Verträge und Leistungen zentral und lass Vereinbarungen online zeichnen." },
  { number: "02", title: "Organisieren & abstimmen", text: "Lass Inhalte wie Social-Media-Beiträge direkt vom Sponsor prüfen und freigeben." },
  { number: "03", title: "Dokumentieren", text: "Halte Fotos, Dateien und den Erfüllungsstand nachvollziehbar fest." },
  { number: "04", title: "Belegen", text: "Erstelle für jeden Sponsor einen strukturierten Leistungsnachweis." },
];

const story = [
  { number: "01", title: "Vereinbaren und online zeichnen", text: "Verträge und Leistungen hängen direkt am Sponsor. Vereinbarungen lassen sich online zeichnen." },
  { number: "02", title: "Gemeinsam abstimmen und umsetzen", text: "Lass zum Beispiel Social-Media-Beiträge vom Sponsor freigeben und leite Zusagen in Aufgaben für dein Team über." },
  { number: "03", title: "Ergebnisse sauber belegen", text: "Fotos und Dateien werden gesammelt. Für jeden Sponsor entsteht ein nachvollziehbarer Leistungsnachweis." },
];

const eventPackages = [
  { name: "Starter", sponsorLimit: "Bis zu 10 Sponsoren", price: "99 €", signaturePrice: "+40 €", signatures: "10 Vertragsunterschriften inklusive" },
  { name: "Plus", sponsorLimit: "Bis zu 20 Sponsoren", price: "179 €", signaturePrice: "+80 €", signatures: "20 Vertragsunterschriften inklusive" },
  { name: "Pro", sponsorLimit: "Bis zu 30 Sponsoren", price: "239 €", signaturePrice: "+120 €", signatures: "30 Vertragsunterschriften inklusive", featured: true },
];

const eventPackageFeatures = [
  "Sponsoren und Verträge verwalten",
  "Leistungen und Aufgaben koordinieren",
  "Nachweise und Fotos dokumentieren",
  "Leistungsberichte je Sponsor erstellen",
];

export default function LandingPage() {
  return <PublicPageFrame brandHref="/">
    <LandingMotion><main className="landing-page">
      <section className="landing-hero">
        <div className="landing-hero-copy landing-reveal landing-reveal-left">
          <span className="landing-eyebrow">SPONSORING FÜR VERANSTALTER</span>
          <h1>Weniger Abstimmung.<br/><span>Mehr Überblick.</span></h1>
          <p>Von der Vereinbarung bis zum Leistungsnachweis – alles rund um Sponsoring an einem Ort.</p>
          <div className="landing-hero-actions">
            <Link className="btn btn-primary" href="/login?type=organizer&mode=signup">Als Veranstalter starten <span aria-hidden="true">→</span></Link>
            <Link className="landing-demo-link" href="/demo">Produktdemo ansehen <span aria-hidden="true">↗</span></Link>
            <Link className="landing-text-link" href="#ablauf">So funktioniert Splow <span aria-hidden="true">↓</span></Link>
            <Link className="landing-price-link" href="#preise">Preise ansehen <span aria-hidden="true">↓</span></Link>
          </div>
          <div className="landing-audience">Für Festivals, Stadtfeste, Vereine und Open-Air-Events</div>
        </div>
        <div className="landing-hero-visual landing-reveal landing-reveal-right" aria-label="Sponsoringablauf vom Sponsor bis zum Leistungsnachweis">
          <div className="landing-visual-orbit landing-visual-orbit-one" />
          <div className="landing-visual-orbit landing-visual-orbit-two" />
          <div className="landing-visual-spark landing-visual-spark-one" aria-hidden="true">✳</div>
          <div className="landing-visual-spark landing-visual-spark-two" aria-hidden="true">✦</div>
          <div className="landing-float-pill landing-float-pill-one"><span>✓</span> Alles im Blick</div>
          <div className="landing-float-pill landing-float-pill-two"><span>↗</span> Schritt für Schritt</div>
          <div className="landing-flow-card">
            <span className="landing-flow-label">DEIN EVENT</span>
            <div className="landing-flow-row"><span className="landing-flow-icon sponsor">S</span><div><b>Sponsor</b><small>Vereinbarung & Kontakt</small></div><span className="landing-flow-check">✓</span></div>
            <div className="landing-flow-connector" />
            <div className="landing-flow-row"><span className="landing-flow-icon benefit">↗</span><div><b>Leistungen</b><small>Aufgaben fürs Team</small></div><span className="landing-flow-check">✓</span></div>
            <div className="landing-flow-connector" />
            <div className="landing-flow-row"><span className="landing-flow-icon proof">▣</span><div><b>Nachweise</b><small>Dokumentiert & gebündelt</small></div><span className="landing-flow-check">✓</span></div>
            <div className="landing-flow-footer"><span className="landing-flow-dot"/>Ein gemeinsamer Stand für alle</div>
          </div>
        </div>
      </section>

      <section className="landing-problem landing-reveal" aria-label="Herausforderung im Sponsoringalltag">
        <p>Wenn Absprachen, Aufgaben und Fotos an verschiedenen Orten liegen, kostet jeder nächste Schritt Zeit.</p>
        <span>Ein klarer Ablauf hilft deinem Team, den Überblick zu behalten.</span>
      </section>

      <section className="landing-story" aria-label="So begleitet Splow dein Event">
        <div className="landing-section-heading landing-reveal">
          <span className="landing-eyebrow">EIN EVENT. EIN KLARER FADEN.</span>
          <h2>Vom ersten Ja bis zum letzten Nachweis.</h2>
          <p>Ein Blick in Splow: Sponsoren, Leistungen und Nachweise bleiben im Event an einem Ort verbunden.</p>
        </div>
        <div className="landing-story-layout">
          <div className="landing-story-steps">
            {story.map((step, index) => <article className={`landing-story-step landing-reveal landing-reveal-delay-${index + 1}`} data-story-step={index} key={step.number}>
              <span className="landing-story-number">{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <span className="landing-story-step-line" aria-hidden="true" />
            </article>)}
          </div>
          <div className="landing-story-visual landing-reveal landing-reveal-right" data-active-step="0" aria-label="Animierte Vorschau des Event-Arbeitsstands">
            <div className="landing-story-glow" />
            <div className="landing-story-window">
              <div className="landing-story-window-top"><span className="landing-window-dots"><i/><i/><i/></span><span className="landing-browser-address"><i/>Splow <b>/</b> Veranstalterbereich <b>/</b> Filme mit Freunden 2027</span><b className="landing-live-status"><i/>Live-Übersicht</b></div>
              <div className="landing-story-window-body">
                <div className="landing-story-sidebar"><span className="landing-mini-logo">s</span><i/><i/><i/><i/></div>
                <div className="landing-story-board">
                  <div className="landing-board-heading"><div><small>VERANSTALTERBEREICH / EVENT</small><b>Filme mit Freunden 2027</b></div><span>1. JUNI – 31. AUGUST</span></div>
                  <div className="landing-board-metrics"><div><small>Sponsoren</small><b>06</b><span>im Event</span></div><div><small>Vereinbarungen</small><b>05</b><span>bereit</span></div><div><small>Fortschritt</small><b>78%</b><span className="landing-mini-progress"><i/></span></div></div>
                  <div className="landing-story-screens">
                    <div className="landing-story-screen landing-story-screen-contract" data-story-screen="0"><div className="landing-screen-title"><span>VEREINBARUNGEN</span><b>Partner im Überblick</b></div><div className="landing-screen-row"><i className="landing-avatar avatar-orange">E</i><span><b>Elspass Autoland</b><small>Vertrag · Hauptsponsor</small></span><em>Vereinbart</em></div><div className="landing-screen-row"><i className="landing-avatar avatar-blue">H</i><span><b>Hellmich Baugesellschaft</b><small>Vertrag · Partner</small></span><em>Vereinbart</em></div><div className="landing-screen-row"><i className="landing-avatar avatar-green">W</i><span><b>Volksbank Rhein-Lippe</b><small>Leistungen · 3 Bausteine</small></span><em>In Arbeit</em></div></div>
                    <div className="landing-story-screen landing-story-screen-tasks" data-story-screen="1"><div className="landing-screen-title"><span>UMSETZUNG & FREIGABE</span><b>Gemeinsam mit dem Sponsor abstimmen</b></div><div className="landing-task-card"><span className="landing-task-check">✓</span><span><b>Logo am Eingangsbereich platzieren</b><small>Elspass Autoland · Heute</small></span><em>Erledigt</em></div><div className="landing-task-card landing-task-card-active"><span className="landing-task-check">↗</span><span><b>Social-Media-Beitrag freigeben</b><small>Volksbank Rhein-Lippe · Sponsor prüft</small></span><em>Freigabe offen</em></div><div className="landing-task-card"><span className="landing-task-check">✓</span><span><b>Bannerfläche vorbereiten</b><small>Hellmich Baugesellschaft · 14. Juni</small></span><em>Erledigt</em></div></div>
                    <div className="landing-story-screen landing-story-screen-proof" data-story-screen="2"><div className="landing-screen-title"><span>LEISTUNGSNACHWEIS</span><b>Gemeinsam dokumentiert</b></div><div className="landing-proof-report"><div className="landing-proof-cover"><span>Splow</span><b>LEISTUNGS-<br/>NACHWEIS</b><small>FILME MIT FREUNDEN<br/>2027</small><i>✓</i></div><div className="landing-proof-details"><small>FÜR ELSPASS AUTOLAND</small><b>Ein Event. Sichtbare Wirkung.</b><span><i/> Hauptbanner am Eingang</span><span><i/> Logo auf der Event-Website</span><span><i/> Social-Media-Beitrag</span><em>3 von 3 Leistungen belegt</em></div></div></div>
                  </div>
                  <div className="landing-story-window-footer"><span><i/> Alle arbeiten mit demselben aktuellen Stand</span><b>GESPEICHERT</b></div>
                </div>
              </div>
            </div>
            <div className="landing-story-float landing-story-float-one"><span>↗</span><div><b>Aufgabe erledigt</b><small>Nachweis ergänzt</small></div></div>
            <div className="landing-story-float landing-story-float-two"><span>✓</span><div><b>Alles dokumentiert</b><small>Bericht bereit</small></div></div>
          </div>
        </div>
      </section>

      <section className="landing-workflow" id="ablauf">
        <div className="landing-section-heading landing-reveal">
          <span className="landing-eyebrow">EIN DURCHGÄNGIGER PROZESS</span>
          <h2>Vom Sponsoring-Deal zum sichtbaren Ergebnis.</h2>
          <p>Splow verbindet Vereinbarungen, Aufgaben und Nachweise in einem Event.</p>
        </div>
        <div className="landing-steps">
          {workflow.map((step, index) => <article className={`landing-step landing-reveal landing-reveal-delay-${index + 1}`} key={step.number}>
            <span className="landing-step-number">{step.number}</span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </article>)}
        </div>
      </section>

      <section className="landing-collaboration">
        <div className="landing-section-heading landing-reveal">
          <span className="landing-eyebrow">GEMEINSAMER ARBEITSSTAND</span>
          <h2>Auch Sponsoren sind eingebunden.</h2>
          <p>Ein eigener Bereich macht Vereinbarungen und den Dateiaustausch für beide Seiten nachvollziehbar.</p>
        </div>
        <div className="landing-collaboration-grid">
          <article className="landing-reveal landing-reveal-delay-1">
            <span className="landing-audience-tag">VERANSTALTER</span>
            <h3>Du behältst den Überblick.</h3>
            <ul><li>Verträge online zur digitalen Signatur bereitstellen</li><li>Freigaben für Social-Media-Beiträge einholen</li><li>Aufgaben, Status und Dokumente je Sponsor im Blick</li></ul>
          </article>
          <article className="landing-reveal landing-reveal-delay-2">
            <span className="landing-audience-tag sponsor-tag">SPONSOR</span>
            <h3>Dein Partner arbeitet mit.</h3>
            <ul><li>Verträge online zeichnen</li><li>Social-Media-Beiträge und weitere Inhalte freigeben</li><li>Leistungen einsehen und Unterlagen austauschen</li></ul>
          </article>
        </div>
      </section>

      <section className="landing-pricing" id="preise">
        <div className="landing-section-heading landing-reveal">
          <span className="landing-eyebrow">TRANSPARENTE PREISE</span>
          <h2>Das passende Paket für dein Event.</h2>
          <p>Einmal buchen und Sponsoring, Aufgaben und Nachweise für dein Event an einem Ort verwalten.</p>
        </div>
        <div className="landing-pricing-grid">
          {eventPackages.map((item, index) => <article className={`landing-pricing-card landing-reveal landing-reveal-delay-${Math.min(index + 1, 4)}${item.featured ? " is-featured" : ""}`} key={item.name}>
            {item.featured && <span className="landing-pricing-popular">MEISTGEWÄHLT</span>}
            <h3>{item.name}</h3>
            <p className="landing-pricing-capacity">{item.sponsorLimit}</p>
            <strong className="landing-pricing-price">{item.price}</strong>
            <span className="landing-pricing-period">einmalig pro Event</span>
            <ul className="landing-pricing-features">{eventPackageFeatures.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            <span className="landing-pricing-signature"><span><small>OPTIONAL</small>Rechtssichere Vertragsunterschrift<small className="landing-pricing-signature-count">{item.signatures}</small></span><strong>{item.signaturePrice}</strong></span>
            <Link className={`btn${item.featured ? " btn-primary" : ""}`} href="/login?type=organizer&mode=signup">Event starten <span aria-hidden="true">→</span></Link>
          </article>)}
        </div>
        <p className="landing-pricing-note">Alle drei Pakete enthalten die Kernfunktionen. Die digitale Signatur ist optional; der Paketaufpreis steht jeweils in der Kachel.</p>
        <aside className="landing-enterprise-card">
          <div className="landing-enterprise-heading"><span>INDIVIDUELL</span><h3>Enterprise</h3><p>Für Veranstalter mit mehreren Events oder besonderen Anforderungen.</p></div>
          <ul><li>Mehrere Events in einem Veranstalterbereich</li><li>Individuelle Anzahl an Sponsoren und Verträgen</li><li>Alle Kernfunktionen enthalten</li></ul>
          <Link className="btn" href="/kontakt?anliegen=enterprise">Enterprise anfragen <span aria-hidden="true">→</span></Link>
        </aside>
      </section>

      <section className="landing-final-cta landing-reveal">
        <div><span className="landing-eyebrow">SPLOW · SPONSORING EINFACH ORGANISIERT</span><h2>Mach dein nächstes Event übersichtlicher.</h2><p>Bring Vereinbarungen, Umsetzung und Nachweise an einem Ort zusammen.</p></div>
        <div className="landing-final-actions"><Link className="btn btn-primary" href="/login?type=organizer&mode=signup">Als Veranstalter starten <span aria-hidden="true">→</span></Link><Link className="landing-final-contact" href="/demo">Demo ansehen</Link><Link className="landing-final-contact" href="/kontakt">Fragen? Schreib uns</Link></div>
      </section>
    </main></LandingMotion>
  </PublicPageFrame>;
}
