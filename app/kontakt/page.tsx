import { PublicContactForm } from "@/components/public-contact-form";
import { PublicPageFrame } from "@/components/public-page-frame";
import { EVENT_PRO_UPGRADE_SURCHARGE_CENTS } from "@/lib/pricing";
import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata("Kontakt", "Kontaktiere das Splow-Team bei Fragen oder zu einem Tarifwechsel.");

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ anliegen?: string; event?: string; eventName?: string }> }) {
  const params = await searchParams;
  const defaultSubject = params.anliegen === "enterprise" ? "Enterprise-Anfrage" : "Allgemeine Anfrage";
  const isEventProUpgrade = params.anliegen === "event-pro";
  const eventId = params.event?.slice(0, 80) ?? "";
  const eventName = params.eventName?.slice(0, 160) ?? "";
  const surchargeText = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(EVENT_PRO_UPGRADE_SURCHARGE_CENTS / 100);
  const amountText = `den Aufpreis von ${surchargeText}`;
  const upgradeMessage = `Ich möchte das Event „${eventName || ""}“${eventId ? ` (Event-ID: ${eventId})` : ""} von Basic auf Pro upgraden. Bitte sende mir eine Rechnung über ${amountText} und informiere mich über die Freischaltung nach Zahlungseingang.`;
  return <PublicPageFrame>
    <main className="public-page-content public-contact-content">
      <div className="eyebrow">WIR HELFEN GERNE</div>
      <h1>{isEventProUpgrade ? "Pro-Upgrade anfragen" : "Kontakt"}</h1>
      <p className="public-page-intro">{isEventProUpgrade ? `Der Tarifwechsel von Basic auf Pro für ${eventName || "dein Event"} kostet ${surchargeText} extra. Wir senden dir eine Rechnung und schalten Pro nach Zahlungseingang für dieses Event frei.` : "Schreib uns, wenn du Fragen zu Splow oder zur Enterprise-Edition hast. Wir melden uns per E-Mail bei dir."}</p>
      <PublicContactForm defaultSubject={defaultSubject} defaultMessage={isEventProUpgrade ? upgradeMessage : ""}/>
    </main>
  </PublicPageFrame>;
}
