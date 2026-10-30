"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon, Metric, Progress, SplowLogo, Status } from "@/components/ui";
import { SponsorPortal } from "@/components/sponsor-portal";
import { SponsorGroup } from "@/components/sponsor-group";
import { EventSponsorInvoice } from "@/components/event-sponsor-invoice";

type DemoView = "overview" | "sponsors" | "benefits" | "work" | "report";
type DemoRole = "organizer" | "sponsor" | "eventMode";

const organizerViews: Array<{ id: DemoView; label: string }> = [
  { id: "overview", label: "Dashboard" },
  { id: "sponsors", label: "Sponsoren" },
  { id: "benefits", label: "Leistungen" },
  { id: "work", label: "Aufgaben & Nachweise" },
  { id: "report", label: "Reports" },
];

function DemoStatus({ children, kind = "open" }: { children: string; kind?: "done" | "progress" | "open" | "waiting" }) {
  const className = kind === "done" ? "status-done" : kind === "progress" ? "status-progress" : kind === "waiting" ? "status-waiting" : "status-open";
  return <span className={`status ${className}`}>{children}</span>;
}

function DemoTimeline() {
  const steps = [
    ["Event angelegt", "13. Oktober 2026", "complete"],
    ["Sponsoren hinzugefügt", "3 Sponsoren hinzugefügt", "complete"],
    ["Verträge erstellt", "3 von 3 Verträgen", "complete"],
    ["Verträge unterschrieben", "1 von 3 Vereinbarungen", "active"],
    ["Alle Nachweise erbracht", "8 von 12 Nachweisen", "upcoming"],
    ["Abschlussreport erstellt und versendet", "0 von 3 erstellt · 0 von 3 versendet", "upcoming"],
  ];
  return <section className="event-timeline demo-event-timeline" aria-label="Event-Meilensteine"><div className="event-timeline-scroll"><ol className="event-timeline-steps">{steps.map(([title, detail, status]) => <li className={`event-timeline-step ${status}`} key={title}><span className="event-timeline-node">{status === "complete" ? <Icon name="check" size={13}/> : <span/>}</span><b>{title}</b><small>{detail}</small></li>)}</ol></div></section>;
}

function EventLogo() {
  return <span className="event-page-logo demo-event-logo" aria-label="Logo: Aloha Open-Air"><b>ALOHA</b><small>OPEN-AIR</small></span>;
}

function EventOverview() {
  return <>
    <section className="metric-grid">
      <Metric label="Sponsoringvolumen netto" value="9.000 €" icon="spark"/>
      <Metric label="Sponsoren" value="3" icon="users"/>
      <Metric label="Leistungen" value="3" icon="check"/>
      <Metric label="Erledigt" value="67 %" note="8 von 12 Aufgaben" icon="layers"/>
    </section>
    <section className="panel event-overview-details">
      <div className="event-details-heading"><div><div className="eyebrow">VERANSTALTUNG</div><h2>Event-Details</h2><p>Zeitraum, Veranstaltungsort und Ansprechperson für Sponsoren.</p></div><button className="btn" type="button" disabled title="Die Demo ist schreibgeschützt"><Icon name="settings" size={14}/> Details bearbeiten</button></div>
      <div className="event-details-grid"><div><span>Zeitraum</span><b>10.–12. Juni 2027</b></div><div><span>Veranstaltungsort</span><b>Festivalwiese 23, Dinslaken</b></div><div><span>Ansprechperson</span><b>Jonas Kastenholz</b><small>jonas@beispiel.de · 0175 34396572</small></div></div>
    </section>
  </>;
}

type DemoSponsor = {
  name: string;
  contract: string;
  value: string;
  benefits: string;
  completed: string;
  progress: number;
  status: string;
  statusKind: "done" | "progress" | "waiting";
};
type DemoSponsorTab = "Leistungen" | "Vertrag" | "Rechnung" | "Dokumente";

const demoSponsors: DemoSponsor[] = [
  { name: "Elspass Autoland GmbH", contract: "Sponsoringvertrag", value: "5.000 €", benefits: "1", completed: "3 erledigt", progress: 75, status: "Gezeichnet", statusKind: "done" },
  { name: "Hellmich Baugesellschaft", contract: "Partnervereinbarung", value: "2.500 €", benefits: "1", completed: "2 erledigt", progress: 67, status: "Daten unvollständig", statusKind: "waiting" },
  { name: "Volksbank Rhein-Lippe", contract: "Partnervereinbarung", value: "1.500 €", benefits: "1", completed: "3 erledigt", progress: 60, status: "Freigabe offen", statusKind: "progress" },
];

const demoBenefits = [
  { sponsor: demoSponsors[0].name, title: "Hauptbanner am Eingang", type: "Sachleistung", description: "Werbefläche am Haupteingang", completed: 3, total: 4, status: "In Bearbeitung" },
  { sponsor: demoSponsors[1].name, title: "Logo auf der Event-Website", type: "Sachleistung", description: "Logo während der Eventbewerbung einbinden", completed: 2, total: 3, status: "In Bearbeitung" },
  { sponsor: demoSponsors[2].name, title: "Social-Media-Kommunikation", type: "Geldleistung", description: "Beitrag zur Partnerschaft veröffentlichen", completed: 3, total: 5, status: "Wartet auf Sponsor" },
];

function DemoBenefits() {
  const [selectedSponsor, setSelectedSponsor] = useState("all");
  const visibleBenefits = selectedSponsor === "all" ? demoBenefits : demoBenefits.filter((benefit) => benefit.sponsor === selectedSponsor);
  return <section className="panel event-benefits-overview"><div className="table-head"><div><h2>Leistungen nach Sponsor</h2><p className="subtitle">Fortschritt und Aufgabenstand der vereinbarten Leistungen.</p></div><label className="event-benefit-sponsor-filter"><span>Sponsor</span><select aria-label="Leistungen nach Sponsor filtern" value={selectedSponsor} onChange={(event) => setSelectedSponsor(event.target.value)}><option value="all">Alle Sponsoren</option>{demoSponsors.map((sponsor) => <option value={sponsor.name} key={sponsor.name}>{sponsor.name}</option>)}</select></label></div><div className="event-benefit-sponsor-groups">{visibleBenefits.map((benefit) => <SponsorGroup key={benefit.sponsor} name={benefit.sponsor} itemCount={1} itemLabel="Leistung" itemLabelPlural="Leistungen" headerAside={<div className="event-benefit-sponsor-progress"><span>{benefit.completed} von {benefit.total} Aufgabenleistungen erledigt</span><Progress value={Math.round(benefit.completed / benefit.total * 100)}/></div>}><article className="event-benefit-card"><div className="event-benefit-card-main"><span className="benefit-kind-badge">{benefit.type}</span><h4>{benefit.title}</h4><p>{benefit.description}</p></div><div className="event-benefit-card-progress"><span>{benefit.completed} von {benefit.total} Aufgaben</span><Progress value={Math.round(benefit.completed / benefit.total * 100)}/></div><Status value={benefit.status}/></article></SponsorGroup>)}</div></section>;
}

function OrganizerSponsors() {
  const [selectedSponsor, setSelectedSponsor] = useState<DemoSponsor | null>(null);
  const [sponsorTab, setSponsorTab] = useState<DemoSponsorTab>("Leistungen");
  const [benefitTypeFilter, setBenefitTypeFilter] = useState<"all" | "monetary" | "in_kind">("all");

  if (selectedSponsor) {
    const benefit = demoBenefits.find((item) => item.sponsor === selectedSponsor.name);
    const benefitType = benefit?.type === "Sachleistung" ? "in_kind" : "monetary";
    const showBenefit = benefit && (benefitTypeFilter === "all" || benefitTypeFilter === benefitType);
    return <>
      <section className="panel sponsor-event-detail demo-sponsor-event-detail"><div className="panel-heading"><div><div className="eyebrow">SPONSOR IM EVENT</div><div className="sponsor-event-name-row"><h2>{selectedSponsor.name}</h2></div></div><div className="sponsor-event-heading-actions"><DemoStatus kind={selectedSponsor.statusKind}>{selectedSponsor.status}</DemoStatus><button className="btn" type="button" onClick={() => { setSelectedSponsor(null); setSponsorTab("Leistungen"); }}>← Alle Sponsoren</button></div></div>
        <div className="event-sponsor-tabs" role="tablist" aria-label={`Bereiche für ${selectedSponsor.name}`}>{(["Leistungen", "Vertrag", "Rechnung", "Dokumente"] as const).map((tab) => <button type="button" role="tab" aria-selected={sponsorTab === tab} className={sponsorTab === tab ? "active" : ""} key={tab} onClick={() => setSponsorTab(tab)}>{tab}</button>)}</div>
        {sponsorTab === "Leistungen" && <section className="panel table-panel sponsor-contract-benefits"><div className="table-head"><div><h2>Vereinbarte Leistungen</h2><p className="subtitle" style={{ fontSize: 11, marginTop: 4 }}>Einzelleistungen und Nachweisstatus für diesen Eventvertrag.</p></div><button className="btn btn-primary" type="button" disabled title="Die Demo ist schreibgeschützt"><Icon name="plus" size={14}/> Leistung hinzufügen</button></div><div className="sponsor-benefit-filters" role="group" aria-label="Leistungen nach Art filtern">{([{ value: "all", label: "Alle" }, { value: "monetary", label: "Geldleistungen" }, { value: "in_kind", label: "Sachleistungen" }] as const).map((filter) => <button key={filter.value} className={`filter-chip${benefitTypeFilter === filter.value ? " active" : ""}`} type="button" aria-pressed={benefitTypeFilter === filter.value} onClick={() => setBenefitTypeFilter(filter.value)}>{filter.label}</button>)}</div>{showBenefit ? <div className="sponsor-benefit-cards"><article className="sponsor-benefit-card"><details className="sponsor-benefit-card-disclosure" open><summary><span className="benefit-kind-badge">{benefit.type}</span><span className="sponsor-benefit-card-title"><b>{benefit.title}</b><small>{benefit.description}</small></span></summary><div className="sponsor-benefit-card-expanded"><dl className="sponsor-benefit-card-details"><div><dt>Anzahl</dt><dd>1</dd></div><div><dt>Kategorie</dt><dd>{benefit.type}</dd></div><div><dt>Fortschritt</dt><dd>{benefit.completed} von {benefit.total} Aufgaben</dd></div><div><dt>Nachweis</dt><dd>{benefit.status === "In Bearbeitung" ? "In Bearbeitung" : "Noch kein Nachweis"}</dd></div><div><dt>Zuständige Person</dt><dd>Veranstalter</dd></div></dl></div></details><div className="sponsor-benefit-card-tools"><DemoStatus kind={benefit.status === "In Bearbeitung" ? "progress" : "done"}>{benefit.status}</DemoStatus></div></article></div> : <p className="task-empty">Für diese Leistungsart gibt es keine vereinbarten Leistungen.</p>}</section>}
        {sponsorTab === "Vertrag" && <><section className="panel sponsor-contract-data"><div className="table-head"><div><h2>Vertragsdaten</h2><p className="subtitle" style={{ fontSize: 11, marginTop: 4 }}>Vertragswert und Leistungsfortschritt für diesen Eventvertrag.</p></div></div><div className="sponsor-contract-detail-grid"><div><span>Vertragswert netto</span><b>{selectedSponsor.value}</b></div><div><span>Vertragswert brutto</span><b>{selectedSponsor.value === "5.000 €" ? "5.950 €" : selectedSponsor.value === "2.500 €" ? "2.975 €" : "1.785 €"}</b></div><div><span>Vereinbarte Leistungen</span><b>{selectedSponsor.benefits}</b></div><div><span>Leistungsfortschritt</span><Progress value={selectedSponsor.progress}/></div><div><span>Zeichnungsdatum</span><b>{selectedSponsor.statusKind === "done" ? "14. Juni 2027" : "Noch nicht gezeichnet"}</b></div></div></section><section className="panel contract-signature-preparation"><div className="table-head"><div><h2>Unterschriften</h2><p className="subtitle" style={{ fontSize: 11, marginTop: 4 }}>Die Zeichnung erfolgt in dieser Reihenfolge.</p></div><DemoStatus kind={selectedSponsor.statusKind}>{selectedSponsor.status}</DemoStatus></div><div className="signature-steps">{[selectedSponsor.name, "Aloha Veranstaltungs GmbH"].map((signer, index) => <div className="signature-step done" key={signer}><span className="signature-step-marker"><Icon name="check" size={13}/></span><div><b>{index + 1}. {signer}</b><small>Gezeichnet am 14. Juni 2027</small></div></div>)}</div></section><section className="panel sponsor-contract-files"><div className="table-head"><div><h2>Vertragsdatei</h2><p className="subtitle" style={{ fontSize: 11, marginTop: 4 }}>Der gezeichnete Vertrag für diesen Sponsor.</p></div></div><article className="contract-document-card"><div className="contract-document-file"><Icon name="file" size={17}/><div><b>{selectedSponsor.contract} · {selectedSponsor.name}.pdf</b><small>Gezeichneter Vertrag · PDF · 14. Juni 2027</small></div></div><div className="contract-document-actions"><a className="btn" href="/downloads/splow-muster-vertriebspartnervereinbarung.pdf"><Icon name="file" size={14}/> Herunterladen</a></div></article></section></>}
        {sponsorTab === "Rechnung" && <EventSponsorInvoice eventId="demo-event" sponsorId={`demo-${selectedSponsor.name}`} sponsorName={selectedSponsor.name} mode="organizer" demoMode />}
        {sponsorTab === "Dokumente" && <section className="panel sponsor-document-area"><div className="table-head"><div><h2>Dokumente</h2><p className="subtitle" style={{ fontSize: 11, marginTop: 4 }}>Verträge und Unterlagen zu diesem Sponsor.</p></div></div><article className="contract-document-card"><div className="contract-document-file"><Icon name="file" size={17}/><div><b>{selectedSponsor.contract} · {selectedSponsor.name}.pdf</b><small>Gezeichneter Vertrag · PDF · 14. Juni 2027</small></div></div><div className="contract-document-actions"><a className="btn" href="/downloads/splow-muster-vertriebspartnervereinbarung.pdf"><Icon name="file" size={14}/> Herunterladen</a></div></article></section>}
      </section>
    </>;
  }

  return <>
    <div className="page-heading demo-subheading"><div><div className="eyebrow">SPONSORING</div><h2>Alle Sponsoren</h2><p className="subtitle">Event-Zuordnung, Vertragswert und Leistungsfortschritt auf einen Blick.</p></div><button className="btn btn-primary" type="button" disabled title="Die Demo ist schreibgeschützt"><Icon name="plus" size={14}/> Sponsor hinzufügen</button></div>
    <section className="panel table-panel event-sponsors-panel"><div className="table-head"><div><h2>Sponsoren im Überblick</h2><p className="subtitle" style={{ fontSize: 11, marginTop: 4 }}>Wähle einen Sponsor, um Vertrag und vereinbarte Einzelleistungen dieses Events zu sehen.</p></div></div><div className="adaptive-table-wrap event-sponsor-table-wrap"><table className="table adaptive-data-table event-sponsor-data-table"><thead><tr><th>Sponsor</th><th>Vertragswert netto</th><th>Erfüllung</th><th>Status</th><th>Einladungscode</th><th>Aktionen</th></tr></thead><tbody>{demoSponsors.map((sponsor) => <tr key={sponsor.name}><td data-label="Sponsor"><button className="sponsor-name demo-sponsor-open-link" type="button" onClick={() => { setSelectedSponsor(sponsor); setSponsorTab("Leistungen"); }}><span className="sponsor-mark">{sponsor.name.split(/\s+/).map((word) => word[0]).join("").slice(0,2)}</span><b>{sponsor.name}</b></button></td><td data-label="Vertragswert netto">{sponsor.value}</td><td data-label="Erfüllung"><Progress value={sponsor.progress}/></td><td data-label="Status"><DemoStatus kind={sponsor.statusKind}>{sponsor.status}</DemoStatus></td><td data-label="Einladungscode"><button className="btn event-sponsor-code-copy" type="button" disabled title="Die Demo ist schreibgeschützt">Kopieren</button></td><td data-label="Aktionen"><div className="event-sponsor-table-actions"><button className="btn" type="button" onClick={() => { setSelectedSponsor(sponsor); setSponsorTab("Leistungen"); }}>Öffnen</button><button className="btn btn-danger event-sponsor-remove" type="button" disabled title="Die Demo ist schreibgeschützt">Entfernen</button></div></td></tr>)}</tbody></table></div></section>
  </>;
}

function WorkAndEvidence({ role }: { role: DemoRole }) {
  const [selectedSponsor, setSelectedSponsor] = useState("all");
  const [hideCompleted, setHideCompleted] = useState(false);
  const tasks = [
    { benefit: "Social-Media-Kommunikation", type: "Geldleistung", sponsor: "Volksbank Rhein-Lippe", title: "Social-Media-Beitrag für den Sponsor veröffentlichen", status: "Warte auf Sponsor" as const, kind: "waiting" as const, assignee: "Sponsor" },
    { benefit: "Hauptbanner am Eingang", type: "Sachleistung", sponsor: "Elspass Autoland", title: "Hauptbanner am Eingang platzieren", status: "Erledigt" as const, kind: "done" as const, assignee: "Veranstalter" },
    { benefit: "Logo auf der Event-Website", type: "Sachleistung", sponsor: "Hellmich Baugesellschaft", title: "Sponsorlogo auf der Event-Website einbinden", status: "In Bearbeitung" as const, kind: "progress" as const, assignee: "Veranstalter" },
  ];
  const sponsorGroups = [...new Set(tasks.map((task) => task.sponsor))].map((sponsor) => ({ sponsor, tasks: tasks.filter((task) => task.sponsor === sponsor) })).filter((group) => selectedSponsor === "all" || group.sponsor === selectedSponsor).map((group) => ({ ...group, tasks: hideCompleted ? group.tasks.filter((task) => task.kind !== "done") : group.tasks })).filter((group) => group.tasks.length > 0);
  return <>
    <section className={`panel table-panel event-task-panel demo-task-panel ${role === "sponsor" ? "demo-sponsor-task-panel" : ""}`}><div className="table-head tasks-table-head"><div><h2>{role === "organizer" ? "Aufgaben im Überblick" : "Vereinbarte Leistungen"}</h2><p className="subtitle">Verwalte Aufgaben und dokumentiere Nachweise zu vereinbarten Leistungen.</p><p className="subtitle demo-task-summary">1 von 3 Aufgaben abgeschlossen</p></div>{role === "organizer" && <button className="btn btn-primary" disabled type="button"><Icon name="plus" size={14}/> Aufgabe anlegen</button>}</div>
      {role === "organizer" && <div className="task-filters demo-task-filters"><label className="task-event-filter"><span>Sponsor</span><select aria-label="Aufgaben nach Sponsor filtern" value={selectedSponsor} onChange={(event) => setSelectedSponsor(event.target.value)}><option value="all">Alle Sponsoren</option>{[...new Set(tasks.map((task) => task.sponsor))].map((sponsor) => <option value={sponsor} key={sponsor}>{sponsor}</option>)}</select></label><label className="task-own-filter"><input type="checkbox" checked={hideCompleted} onChange={(event) => setHideCompleted(event.target.checked)}/> Erledigte ausblenden</label></div>}
      <div className="benefit-task-sponsor-groups">{sponsorGroups.map((group) => <SponsorGroup key={group.sponsor} name={group.sponsor} itemCount={group.tasks.length} itemLabel="Aufgabe" itemLabelPlural="Aufgaben" contentClassName="benefit-task-groups demo-sponsor-task-content">{group.tasks.map((task) => <section className="benefit-task-group" key={task.title} aria-label={`Aufgaben zu ${task.benefit}`}>
        <header className="benefit-task-group-heading"><div><span className={`task-source ${task.type === "Sachleistung" ? "derived" : "manual"}`}>{task.type}</span><h3>{task.benefit}</h3><small>{task.sponsor} · Aloha Open-Air 2027</small></div><DemoStatus kind={task.kind}>{task.status}</DemoStatus></header>
        <div className="benefit-task-instances"><details className="benefit-task-instance" open><summary><span>Details</span><DemoStatus kind={task.kind}>{task.status}</DemoStatus></summary><div className="benefit-task-subtasks"><article className="benefit-task-subtask"><div className="benefit-task-subtask-info"><b>{task.title}</b><span>Bearbeiter: {task.assignee}</span></div><div className="benefit-task-due"><span>Fällig</span><b>12. Juni 2027</b></div><div className="standalone-task-actions"><button className="btn" disabled type="button">{task.kind === "waiting" && role === "sponsor" ? "Freigeben" : "Details"}</button></div></article></div></details></div>
      </section>)}</SponsorGroup>)}</div>
    </section>
  </>;
}

function DemoReport() {
  return <section className="panel demo-report-panel"><div className="table-head"><div><h2>Abschlussreports</h2><p className="subtitle">Erstelle für jeden Sponsor einen Leistungsnachweis und versende ihn nach der Prüfung.</p></div></div>
    <div className="demo-report-sponsor-list">{demoSponsors.map((sponsor, index) => <article className="demo-report-sponsor-card" key={sponsor.name}><header><div><span className="eyebrow">SPONSOR</span><b>{sponsor.name}</b><small>{sponsor.contract} · {sponsor.value}</small></div><DemoStatus kind="open">Offen</DemoStatus></header><div className="demo-report-sponsor-details"><div><span>Aufgaben erfüllt</span><b>{[3, 2, 3][index]} von {[4, 3, 5][index]}</b></div><div><span>Fortschritt</span><Progress value={sponsor.progress}/></div><div><span>Versandstatus</span><DemoStatus kind="open">Nicht erstellt</DemoStatus></div></div><button className="btn btn-primary" disabled type="button">Abschlussreport erstellen</button></article>)}</div>

  </section>;
}

function DemoEventMode() {
  const [tab, setTab] = useState<"event" | "proofs">("proofs");
  return <div className="mobile-shell mobile-event-mode demo-event-mode-preview">
    <header className="mobile-header"><span className="brand" aria-label="Splow"><SplowLogo markSize={29}/></span><div className="mobile-header-actions"><button className="icon-button demo-phone-header-button" type="button" disabled aria-label="Menü"><Icon name="menu" size={16}/></button><button className="icon-button demo-phone-header-button" type="button" disabled aria-label="Zur Eventübersicht"><Icon name="chevron" size={16}/></button></div></header>
    <main className="mobile-content">
      <span className="live-pill"><span className="live-dot"/> NACHWEIS-MODUS</span>
      <h1>{tab === "event" ? "Event auswählen" : "Nachweise vor Ort"}</h1>
      <p className="mobile-sub">{tab === "event" ? "Wähle das Event, für das du Nachweise erfassen möchtest." : "Aloha Open-Air 2027"}</p>
      {tab === "event" ? <section className="mobile-event-selection" aria-label="Event auswählen">
        <button className="mobile-event-option selected" type="button" aria-pressed="true"><span className="mobile-event-option-icon"><Icon name="calendar" size={17}/></span><span className="mobile-event-option-copy"><strong>Aloha Open-Air 2027</strong><small>10. Juni 2027</small><small>Festivalwiese 23</small></span><span className="mobile-event-option-check"><Icon name="check" size={16}/></span></button>
        <button className="btn btn-primary mobile-event-continue" type="button" onClick={() => setTab("proofs")}><Icon name="camera" size={15}/> Nachweise für Aloha Open-Air 2027</button>
      </section> : <>
        <section className="mobile-progress"><div className="mobile-progress-head"><span>Nachweise im Event</span><b>2 von 3 erledigt</b></div><Progress value={67}/></section>
        <section className="panel table-panel demo-mobile-tasks"><div className="table-head tasks-table-head"><div><h2>Aufgaben im Überblick</h2><p className="subtitle" style={{fontSize:11,marginTop:4}}>2 von 3 abgeschlossen</p></div><label className="mobile-open-tasks-filter"><input type="checkbox" disabled/>Nur offene</label></div>
          <div className="mobile-proof-list">
            <SponsorGroup name="Elspass Autoland" itemCount={1} itemLabel="Aufgabe" contentClassName="demo-mobile-sponsor-task-content"><article className="mobile-task"><div className="mobile-task-top"><div className="mobile-task-heading"><h3>Hauptbanner am Eingang platzieren</h3><span className="task-source derived">Sachleistung</span><p>Fällig 12. Juni 2027 · Bearbeiter: Veranstalter</p></div><DemoStatus kind="done">Erledigt</DemoStatus></div><span className="task-proof-file"><Icon name="check" size={13}/>Hauptbanner-Eingang.jpg</span><div className="task-proof-actions compact"><button className="btn task-proof-icon-button" type="button" disabled aria-label="Datei ersetzen"><Icon name="file" size={14}/></button><button className="btn task-proof-icon-button" type="button" disabled aria-label="Foto aufnehmen"><Icon name="camera" size={14}/></button><button className="btn task-proof-icon-button" type="button" disabled aria-label="Nachweis herunterladen"><Icon name="download" size={14}/></button></div></article></SponsorGroup>
            <SponsorGroup name="Hellmich Baugesellschaft" itemCount={1} itemLabel="Aufgabe" contentClassName="demo-mobile-sponsor-task-content"><article className="mobile-task"><div className="mobile-task-top"><div className="mobile-task-heading"><h3>Sponsorlogo auf der Event-Website einbinden</h3><span className="task-source derived">Sachleistung</span><p>Fällig 12. Juni 2027 · Bearbeiter: Veranstalter</p></div><DemoStatus kind="progress">In Bearbeitung</DemoStatus></div><div className="task-proof-actions"><button className="btn task-proof-upload" type="button" disabled><Icon name="file" size={14}/> Datei hochladen</button><button className="btn task-proof-camera" type="button" disabled><Icon name="camera" size={14}/> Foto aufnehmen</button></div></article></SponsorGroup>
            <SponsorGroup name="Volksbank Rhein-Lippe" itemCount={1} itemLabel="Aufgabe" contentClassName="demo-mobile-sponsor-task-content"><article className="mobile-task"><div className="mobile-task-top"><div className="mobile-task-heading"><h3>Social-Media-Beitrag für den Sponsor veröffentlichen</h3><span className="task-source derived">Geldleistung</span><p>Fällig 12. Juni 2027 · Bearbeiter: Sponsor</p></div><DemoStatus kind="waiting">Warte auf Sponsor</DemoStatus></div><span className="task-caption">Wartet auf Sponsorenfreigabe</span></article></SponsorGroup>
          </div>
        </section>
      </>}
    </main>
    <nav className="mobile-nav" aria-label="Nachweis-Modus"><button type="button" className={tab === "event" ? "active" : ""} aria-pressed={tab === "event"} onClick={() => setTab("event")}><Icon name="calendar" size={17}/>Event</button><button type="button" className={tab === "proofs" ? "active" : ""} aria-pressed={tab === "proofs"} onClick={() => setTab("proofs")}><Icon name="camera" size={17}/>Nachweise</button></nav>
  </div>;
}

export function ProductDemo() {
  const [view, setView] = useState<DemoView>("overview");
  const [role, setRole] = useState<DemoRole>("organizer");
  const views = organizerViews;

  function selectRole(nextRole: DemoRole) {
    setRole(nextRole);
    setView("overview");
  }

  return <main className="demo-page">
    <section className="demo-intro"><span className="demo-kicker">INTERAKTIVE PRODUKTDEMO</span><h1>Erlebe Splow im echten Ablauf.</h1><p>Sieh dir Veranstalter- und Sponsorbereich sowie den Event-Modus anhand eines Beispiel-Events an.</p><div className="demo-readonly-note"><span>✓</span><div><b>Feste Beispieldaten · sicher schreibgeschützt</b><small>Die Navigation ist interaktiv. Änderungen an Daten, Dokumenten und Verträgen sind deaktiviert.</small></div></div></section>
    <section className="demo-workspace" aria-label="Interaktive Splow Produktdemo">
      <div className="demo-toolbar"><div><SplowLogo markSize={27}/><span className="demo-toolbar-separator">/</span><b>Beispiel-Event</b></div><div className="demo-role-switch" role="group" aria-label="Ansicht wählen"><button type="button" className={role === "organizer" ? "active" : ""} aria-pressed={role === "organizer"} onClick={() => selectRole("organizer")}>Veranstalteransicht</button><button type="button" className={role === "eventMode" ? "active" : ""} aria-pressed={role === "eventMode"} onClick={() => selectRole("eventMode")}>Event-Modus (Veranstalter)</button><button type="button" className={role === "sponsor" ? "active" : ""} aria-pressed={role === "sponsor"} onClick={() => selectRole("sponsor")}>Sponsoransicht</button></div><span className="demo-readonly-label">DEMO · NUR ANSEHEN</span></div>
      {role === "eventMode" ? <div className="demo-iphone-stage" aria-label="iPhone-Vorschau, 390 × 844 Pixel"><div className="demo-iphone-frame"><div className="demo-iphone-status" aria-hidden="true"><span>9:41</span><i className="demo-iphone-island"/><span className="demo-iphone-status-icons"><svg className="demo-iphone-wifi" viewBox="0 0 16 13" fill="none" aria-hidden="true"><path d="M1.5 4.4a9.5 9.5 0 0 1 13 0M4.2 7.2a5.6 5.6 0 0 1 7.6 0M6.8 10a1.8 1.8 0 0 1 2.4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="8" cy="12" r=".8" fill="currentColor"/></svg><span className="demo-iphone-battery"><b>82%</b><i><span/></i></span></span></div><div className="demo-iphone-screen"><DemoEventMode/></div></div></div> : <div className={`demo-workspace-content${role === "sponsor" ? " demo-sponsor-workspace-content" : ""}`}>
        {role === "organizer" ? <>
          <div className="page-heading demo-event-page-heading"><div className="event-page-heading-main"><EventLogo/><div><div className="eyebrow">EVENT · IN VORBEREITUNG</div><h1>Aloha Open-Air 2027</h1><p className="subtitle">Stammdaten und Veranstaltungsdetails.</p></div></div><div className="event-heading-actions"><span className="event-lifecycle-status event-lifecycle-blue">Status: In Vorbereitung</span><span className="event-plan-badge event-plan-event">Paket: Pro</span><button className="btn" type="button" disabled>Alle Events</button></div></div>
          <DemoTimeline/>
          <nav className="tabs demo-tabs" role="tablist" aria-label="Event-Bereiche">{views.map((item) => <button type="button" role="tab" aria-selected={view === item.id} className={`tab${view === item.id ? " active" : ""}`} onClick={() => setView(item.id)} key={item.id}>{item.label}</button>)}</nav>
          <div className="demo-tab-content" role="tabpanel" key={`${view}-${role}`}>
            {view === "overview" && <EventOverview/>}
            {view === "sponsors" && <OrganizerSponsors/>}
            {view === "benefits" && <DemoBenefits/>}
            {view === "work" && <WorkAndEvidence role={role}/>}
            {view === "report" && <DemoReport/>}
          </div>
        </> : <SponsorPortal eventId="demo" demoMode />}
      </div>}
    </section>
    <section className="demo-next-step"><div><span className="demo-kicker">BEREIT FÜR DEIN EVENT?</span><h2>Bring dein Sponsoring an einen Ort.</h2><p>Starte mit deinem eigenen Veranstalterbereich und richte dein erstes Event ein.</p></div><div><Link className="btn btn-primary" href="/login?type=organizer&mode=signup">Kostenlos starten <span aria-hidden="true">→</span></Link><Link className="demo-contact-link" href="/kontakt">Fragen? Sprich mit uns</Link></div></section>
  </main>;
}
