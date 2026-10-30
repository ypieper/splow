import { LegalPage } from "@/components/public-page-frame";
import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata("Impressum", "Anbieter- und Kontaktangaben zu Splow.");

export default function ImprintPage() {
  return <LegalPage title="Impressum" intro="Angaben zum Anbieter dieses digitalen Dienstes." sections={[
    { title: "Anbieter", paragraphs: ["Pieper/Janßen GbR", "Vertreten durch Yannick Pieper und Moritz Weber-Frerigmann", "In den Drieschen 37", "46539 Dinslaken", "Deutschland"] },
    { title: "Kontakt", paragraphs: ["E-Mail: hi@filmemitfreunden.de", "Telefon: 0174 3456865", "Kontaktformular: /kontakt"] },
    { title: "Register und Umsatzsteuer", paragraphs: ["Registergericht und Registernummer: [falls vorhanden]", "Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: DE305534080", "Wirtschafts-Identifikationsnummer: [falls vorhanden]"] },
    { title: "Aufsichtsbehörde und Berufsrecht", paragraphs: ["Zuständige Aufsichtsbehörde: [nur falls die Tätigkeit einer behördlichen Zulassung bedarf]", "Berufsbezeichnung und berufsrechtliche Regelungen: [nur falls für die Tätigkeit einschlägig]"] },
    { title: "Verantwortlich für Inhalte", paragraphs: ["[Name und ladungsfähige Anschrift der verantwortlichen Person, sofern erforderlich]"] },
    { title: "Streitbeilegung", paragraphs: ["[Angaben zu Teilnahme oder Nichtteilnahme an Verbraucherschlichtungsverfahren prüfen und hier ergänzen, soweit anwendbar.]"] },
  ]} />;
}
