"use client";

import { benefitWorkflowCount } from "@/lib/benefit-workflow";
import { Modal } from "@/components/modal";
import { useEventEntitlements } from "@/components/event-entitlements";
import { EmptyState, Icon, Progress, SplowLogo, Status } from "@/components/ui";
import { fetchStoredBenefits } from "@/lib/benefits-storage";
import { fetchContractReportStates, saveContractReportState } from "@/lib/contract-documents-storage";
import { formatContractValue, parseContractValue } from "@/lib/event-contract-values";
import { formatEventReportMetricValue } from "@/lib/event-report-metric-format";
import { deleteEventReportMetric, fetchEventReportMetrics, saveEventReportMetric, type EventReportMetric } from "@/lib/event-report-metrics-storage";
import { fetchStoredEvidence } from "@/lib/evidence-storage";
import type { Sponsor,SponsorContract } from "@/lib/sponsor-types";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { fetchStoredTasks } from "@/lib/tasks-storage";
import Link from "next/link";
import { useEffect, useState } from "react";

const reportNumberFormat = new Intl.NumberFormat("de-DE");

type ReportTask = { id: string; title: string; evidence: string };
type SponsorReport = { sponsor: Sponsor; contract: SponsorContract; tasks: ReportTask[]; completed: number; ready: boolean; sent: boolean };
type ManagedEventReportMetric = EventReportMetric & { isNew: boolean; dirty: boolean };

function taskIdForBenefit(eventId: string, benefit: { id?: string; title: string }) {
  return benefit.id ? `benefit-${benefit.id}` : `benefit-${eventId}-${benefit.title.toLocaleLowerCase("de-DE").replace(/[^a-z0-9]+/g, "-")}`;
}

export function EventReports({ eventId, eventTitle, organizerLogoUrl, sponsors, contracts, benefits }: {
  eventId: string;
  eventTitle: string;
  organizerLogoUrl?: string;
  sponsors: Sponsor[];
  contracts: SponsorContract[];
  benefits: { id?: string; title: string; sponsorId: string; eventId: string }[];
}) {
  const { ensureFeature, hasFeature, requestUpgrade } = useEventEntitlements();
  const [hasReportAccess, setHasReportAccess] = useState<boolean | null>(null);
  const [reports, setReports] = useState<SponsorReport[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [message, setMessage] = useState("");
  const [selectedReport, setSelectedReport] = useState<SponsorReport | null>(null);
  const [pendingSentReport, setPendingSentReport] = useState<SponsorReport | null>(null);
  const [updatingReportId, setUpdatingReportId] = useState<string | null>(null);
  const [reportAction, setReportAction] = useState<"download" | "share" | null>(null);
  const [eventMetrics, setEventMetrics] = useState<ManagedEventReportMetric[]>([]);
  const [eventMetricsLoading, setEventMetricsLoading] = useState(true);
  const [savingEventMetricId, setSavingEventMetricId] = useState("");
  const [deletingEventMetricId, setDeletingEventMetricId] = useState("");
  const [eventMetricsError, setEventMetricsError] = useState("");
  const [eventMetricsMessage, setEventMetricsMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    setHasReportAccess(null);
    void hasFeature(eventId, "reports_tab").then((allowed) => {
      if (!cancelled) setHasReportAccess(allowed);
    });
    return () => { cancelled = true; };
  }, [eventId, hasFeature]);

  useEffect(() => {
    if (hasReportAccess !== true) return;
    let cancelled = false;
    setEventMetricsLoading(true);
    setEventMetricsError("");
    void fetchEventReportMetrics(eventId).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setEventMetricsError("Die Event-Kennzahlen konnten nicht geladen werden.");
        return;
      }
      setEventMetrics((data ?? []).map((metric) => ({ ...metric, value: formatEventReportMetricValue(metric.value), isNew: false, dirty: false })));
    }).catch(() => {
      if (!cancelled) setEventMetricsError("Die Event-Kennzahlen konnten nicht geladen werden.");
    }).finally(() => {
      if (!cancelled) setEventMetricsLoading(false);
    });
    return () => { cancelled = true; };
  }, [eventId, hasReportAccess]);

  function addEventMetric() {
    setEventMetrics((current) => [...current, { id: `draft-${crypto.randomUUID()}`, name: "", value: "", isNew: true, dirty: true }]);
    setEventMetricsError("");
    setEventMetricsMessage("");
  }

  async function saveEventMetric(metric: ManagedEventReportMetric) {
    if (!metric.name.trim() || !metric.value.trim()) {
      setEventMetricsError("Bitte ergänze für jede Kennzahl einen Namen und einen Wert.");
      setEventMetricsMessage("");
      return;
    }
    setSavingEventMetricId(metric.id);
    setEventMetricsError("");
    setEventMetricsMessage("");
    try {
      const formattedValue = formatEventReportMetricValue(metric.value.trim());
      const result = await saveEventReportMetric(eventId, { ...metric, value: formattedValue }, metric.isNew ? undefined : metric.id);
      const error = result.error;
      if (error) throw error;
      const savedId = result.data?.id;
      if (!savedId) throw new Error("Kennzahl konnte nicht gespeichert werden.");
      setEventMetrics((current) => current.map((item) => item.id === metric.id ? { ...item, id: savedId, isNew: false, dirty: false, name: metric.name.trim(), value: formattedValue } : item));
      setEventMetricsMessage("Die Kennzahl wurde gespeichert.");
    } catch {
      setEventMetricsError("Die Kennzahl konnte nicht gespeichert werden. Prüfe, ob der Name bereits verwendet wird.");
    } finally {
      setSavingEventMetricId("");
    }
  }

  async function deleteEventMetric(metric: ManagedEventReportMetric) {
    if (metric.isNew) {
      setEventMetrics((current) => current.filter((item) => item.id !== metric.id));
      return;
    }
    setDeletingEventMetricId(metric.id);
    setEventMetricsError("");
    setEventMetricsMessage("");
    try {
      const { error } = await deleteEventReportMetric(eventId, metric.id);
      if (error) throw error;
      setEventMetrics((current) => current.filter((item) => item.id !== metric.id));
      setEventMetricsMessage("Die Kennzahl wurde entfernt.");
    } catch {
      setEventMetricsError("Die Kennzahl konnte nicht entfernt werden.");
    } finally {
      setDeletingEventMetricId("");
    }
  }

  useEffect(() => {
    if (hasReportAccess !== true) return;
    let cancelled = false;
    async function loadProgress() {
      setReady(false);
      setLoadError("");
      try {
        if (!isSupabaseConfigured) throw new Error("Supabase ist nicht eingerichtet.");
        const [evidenceResult, storedBenefitResult, taskResult, reportResult] = await Promise.all([fetchStoredEvidence(), fetchStoredBenefits(eventId), fetchStoredTasks(eventId), fetchContractReportStates(contracts.filter((contract) => contract.eventId === eventId).map((contract) => contract.id))]);
        if (evidenceResult.error || storedBenefitResult.error || taskResult.error || reportResult.error) throw new Error("Reportdaten konnten nicht geladen werden.");
        const evidenceById = new Map((evidenceResult.data ?? []).map((item) => [item.taskId, { name: item.name }]));
        const reportStates = new Map((reportResult.data ?? []).map((row) => [row.contract_id, row]));
        const eventContracts = contracts.filter((contract) => contract.eventId === eventId);
        const data = eventContracts.flatMap((contract) => {
          const sponsor = sponsors.find((item) => item.id === contract.sponsorId);
          if (!sponsor) return [];
          const contractedBenefits = (storedBenefitResult.data ?? []).filter((benefit) => benefit.eventId === eventId && benefit.sponsorId === sponsor.id);
          const sponsorTasks = (taskResult.data ?? []).filter((task) => task.event_id === eventId && (task.sponsor_id === sponsor.id || (!task.sponsor_id && task.sponsor_name === sponsor.name)));
          const benefitsById = new Map(contractedBenefits.map((benefit) => [benefit.id, benefit]));
          const currentSponsorTasks = sponsorTasks.filter((task) => {
            const benefit = task.benefit_id ? benefitsById.get(task.benefit_id) : undefined;
            if (benefit?.completionRequired === false) return false;
            if (task.source !== "Leistung" || !task.benefit_id || !benefit) return true;
            return task.workflow_instance <= (benefitWorkflowCount(benefit.quantity, benefit.tasksPerUnit));
          });
          const benefitsWithTasks = new Set(currentSponsorTasks.filter((task) => task.source === "Leistung" && task.benefit_id).map((task) => task.benefit_id));
          const legacyBenefitTasks: ReportTask[] = contractedBenefits.filter((benefit) => benefit.completionRequired !== false && !benefitsWithTasks.has(benefit.id)).map((benefit) => {
            const id = taskIdForBenefit(eventId, benefit);
            return { id, title: benefit.title, evidence: evidenceById.get(id)?.name ?? (benefit.evidence !== "Noch kein Nachweis" ? benefit.evidence : "") };
          });
          const storedTasks: ReportTask[] = currentSponsorTasks.filter((task) => task.source === "Leistung" || task.source === "Manuell").map((task) => ({ id: task.id, title: task.title, evidence: evidenceById.get(task.id)?.name ?? (task.requires_sponsor_approval && task.sponsor_approval_status === "approved" ? "Vom Sponsor freigegeben" : "") }));
          const tasks = [...legacyBenefitTasks, ...storedTasks];
          const completed = tasks.filter((task) => evidenceById.has(task.id) || Boolean(task.evidence)).length;
          const report = reportStates.get(contract.id);
          return [{ sponsor, contract: { ...contract, title: "Sponsoringvertrag", value: formatContractValue(parseContractValue(contract.value)) }, tasks, completed, ready: tasks.length > 0 && completed === tasks.length, sent: Boolean(report?.sent_at) }];
        });
        if (!cancelled) setReports(data);
      } catch {
        if (!cancelled) setLoadError("Der Aufgabenfortschritt konnte nicht geladen werden.");
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void loadProgress();
    return () => { cancelled = true; };
  }, [eventId, contracts, sponsors, benefits, retryKey, hasReportAccess]);

  function downloadPdf(file: File) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function createPdf(report: SponsorReport) {
    const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractId: report.contract.id }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error || "Der Abschlussreport konnte nicht erstellt werden.");
    }
    const fileName = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "Splow-Abschlussreport.pdf";
    const file = new File([await response.blob()], fileName, { type: "application/pdf" });
    const { error } = await saveContractReportState(report.contract.id, { generatedAt: new Date().toISOString() });
    if (!error) {
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
    }
    return { file, saved: !error };
  }

  async function downloadReportPdf() {
    if (!selectedReport) return;
    if (!(await ensureFeature(eventId, eventTitle, "reports_tab"))) return;
    setReportAction("download");
    try {
      const { file, saved } = await createPdf(selectedReport);
      downloadPdf(file);
      setMessage(saved
        ? `Der Abschlussreport für ${selectedReport.sponsor.name} wurde als PDF heruntergeladen.`
        : "Die PDF wurde heruntergeladen, aber der Erstellungsstatus konnte nicht gespeichert werden.");
    } catch {
      setMessage("Der Abschlussreport konnte nicht als PDF erstellt werden.");
    } finally {
      setReportAction(null);
    }
  }

  async function sendReportToSponsor() {
    if (!selectedReport) return;
    if (!(await ensureFeature(eventId, eventTitle, "reports_tab"))) return;
    setReportAction("share");
    try {
      const report = selectedReport;
      const { file, saved } = await createPdf(report);
      const shareData: ShareData = {
        files: [file],
        title: `Abschlussreport – ${report.sponsor.name}`,
        text: report.sponsor.email
          ? `Bitte sende den Abschlussreport an ${report.sponsor.email}. Veranstaltung: ${eventTitle}.`
          : `Abschlussreport für ${report.sponsor.name}, Veranstaltung ${eventTitle}.`,
      };
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share(shareData);
        setMessage(`${saved ? "Die PDF wurde erstellt" : "Die PDF wurde erstellt, ihr Status konnte aber nicht gespeichert werden"} und zum Teilen übergeben. Schließe den Versand in deiner E-Mail-App ab und bestätige ihn anschließend in der Übersicht.`);
      } else {
        downloadPdf(file);
        if (report.sponsor.email) {
          const subject = encodeURIComponent(`Abschlussreport – ${eventTitle}`);
          const body = encodeURIComponent(`Hallo,\n\nanbei findest du den Abschlussreport für ${eventTitle}.\n\nViele Grüße`);
          window.location.href = `mailto:${encodeURIComponent(report.sponsor.email)}?subject=${subject}&body=${body}`;
          setMessage(`${saved ? "Die PDF wurde erstellt" : "Die PDF wurde erstellt, ihr Status konnte aber nicht gespeichert werden"} und heruntergeladen. Eine E-Mail an ${report.sponsor.email} ist vorbereitet. Hänge die PDF an, sende die Nachricht und bestätige danach den Versand in der Übersicht.`);
        } else {
        setMessage("Die PDF wurde heruntergeladen. Für diesen Sponsor ist keine E-Mail-Adresse hinterlegt. Sende sie manuell und bestätige anschließend den Versand in der Übersicht.");
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setMessage("Teilen abgebrochen. Der Abschlussreport wurde erstellt und kann als PDF heruntergeladen werden.");
      } else {
        setMessage("Der Abschlussreport konnte nicht geteilt werden. Lade die PDF herunter und versende sie per E-Mail.");
      }
    } finally {
      setReportAction(null);
    }
  }

  async function updateReportSentStatus(report: SponsorReport, sent: boolean) {
    if (!(await ensureFeature(eventId, eventTitle, "reports_tab"))) return;
    setUpdatingReportId(report.contract.id);
    try {
      const { error } = await saveContractReportState(report.contract.id, { sentAt: sent ? new Date().toISOString() : null });
      if (error) throw error;
      window.dispatchEvent(new Event("sponso:event-timeline-updated"));
      setReports((current) => current.map((item) => item.contract.id === report.contract.id ? { ...item, sent } : item));
      setMessage(sent
        ? `Abschlussreport für ${report.sponsor.name} als versendet markiert.`
        : `Versandstatus für ${report.sponsor.name} zurückgenommen.`);
    } catch {
      setMessage("Der Versandstatus konnte nicht gespeichert werden.");
    } finally {
      setUpdatingReportId(null);
    }
  }

  if (hasReportAccess === null) return <section className="panel"><p className="task-empty" aria-busy="true">Paketberechtigung wird geprüft …</p></section>;
  if (!hasReportAccess) return <section className="panel event-reports-paywall"><div className="table-head"><div><div className="eyebrow">BUSINESS</div><h2>Reports</h2><p className="subtitle">Erweiterte Auswertungen und automatische Abschlussberichte sind im Business-Paket enthalten.</p></div><span className="event-plan-badge">Ab Business</span></div><p>Dieser Bereich ist für alle Events sichtbar. Die Reportdaten und Funktionen werden erst nach bestätigter Buchung des Business-Pakets freigeschaltet.</p><button className="btn btn-primary" type="button" onClick={() => requestUpgrade(eventId, eventTitle, "Reports und Abschlussberichte ab Business")}>Business ansehen</button></section>;

  return <>
    <section className="panel event-report-metrics-panel">
      <div className="table-head"><div><h2>Event-Kennzahlen</h2><p className="subtitle">Lege Kennzahlen zum gesamten Event an. Gespeicherte Angaben erscheinen im Leistungsnachweis der Sponsoren schreibgeschützt.</p></div></div>
      {eventMetricsLoading ? <p className="task-empty event-report-metrics-empty">Kennzahlen werden geladen …</p> : <div className="event-report-metrics-table-wrap"><table className="table event-report-metrics-table"><thead><tr><th>Kennzahl</th><th>Wert</th><th>Aktionen</th></tr></thead><tbody>
        {eventMetrics.length === 0 ? <tr><td className="event-report-metrics-table-empty" colSpan={3}>Noch keine Kennzahlen hinterlegt. Füge zum Beispiel Besucherzahl oder Social-Media-Reichweite hinzu.</td></tr> : eventMetrics.map((metric) => <tr key={metric.id}>
          <td><label className="event-report-metric-input"><span className="sr-only">Kennzahl</span><input type="text" maxLength={80} placeholder="z. B. Besucherzahl" value={metric.name} disabled={savingEventMetricId === metric.id || deletingEventMetricId === metric.id} onChange={(event) => setEventMetrics((current) => current.map((item) => item.id === metric.id ? { ...item, name: event.target.value, dirty: true } : item))}/></label></td>
          <td><label className="event-report-metric-input"><span className="sr-only">Wert</span><input type="text" maxLength={120} placeholder="z. B. 12.500" value={metric.value} disabled={savingEventMetricId === metric.id || deletingEventMetricId === metric.id} onChange={(event) => setEventMetrics((current) => current.map((item) => item.id === metric.id ? { ...item, value: event.target.value, dirty: true } : item))} onBlur={() => setEventMetrics((current) => current.map((item) => item.id === metric.id ? { ...item, value: formatEventReportMetricValue(item.value) } : item))}/></label></td>
          <td><div className="event-report-metric-actions"><button className="btn btn-primary" type="button" onClick={() => void saveEventMetric(metric)} disabled={!metric.dirty || !metric.name.trim() || !metric.value.trim() || savingEventMetricId === metric.id || deletingEventMetricId === metric.id}>{savingEventMetricId === metric.id ? "Speichert …" : "Speichern"}</button><button className="btn" type="button" onClick={() => void deleteEventMetric(metric)} disabled={savingEventMetricId === metric.id || deletingEventMetricId === metric.id}>{deletingEventMetricId === metric.id ? "Wird entfernt …" : "Entfernen"}</button></div></td>
        </tr>)}
      </tbody></table></div>}
      <div className="event-report-metrics-footer"><button className="btn" type="button" onClick={addEventMetric} disabled={eventMetricsLoading}><Icon name="plus" size={14}/> Kennzahl hinzufügen</button></div>
      {eventMetricsError && <p className="field-message error" role="alert">{eventMetricsError}</p>}{eventMetricsMessage && <p className="field-message success" role="status">{eventMetricsMessage}</p>}
    </section>
    <section className="panel table-panel event-reports-panel"><div className="table-head"><div><h2>Fortschritt je Sponsor</h2><p className="subtitle" style={{ fontSize: 11, marginTop: 4 }}>Ein Abschlussreport wird verfügbar, sobald alle Aufgaben eines Sponsors durch Nachweise abgeschlossen sind. Teile die PDF und bestätige den Versand anschließend hier.</p></div></div>{!ready ? <p className="task-empty">Reports werden geladen …</p> : loadError ? <EmptyState className="empty-state-compact" title="Reports gerade nicht verfügbar" description={loadError} action={<button className="btn" type="button" onClick={() => setRetryKey((key) => key + 1)}>Erneut laden</button>} /> : reports.length === 0 ? <EmptyState className="empty-state-compact" title="Noch keine Reports" description="Reports erscheinen, sobald für dieses Event Sponsoren und Verträge angelegt sind." action={<Link className="btn" href={`/events/${eventId}?tab=sponsoren`}>Zu den Sponsoren</Link>} /> : <div className="adaptive-table-wrap"><table className="table adaptive-data-table event-reports-data-table"><thead><tr><th>Sponsor</th><th>Aufgaben erfüllt</th><th>Fortschritt</th><th>Status</th><th>Versand</th><th>Aktionen</th></tr></thead><tbody>{reports.map((report) => <tr key={report.contract.id}>
      <td data-label="Sponsor"><b className="report-sponsor-name">{report.sponsor.name}</b><small>{report.contract.title} · {report.contract.value}</small></td>
      <td data-label="Aufgaben erfüllt">{reportNumberFormat.format(report.completed)} von {reportNumberFormat.format(report.tasks.length)}</td>
      <td data-label="Fortschritt"><Progress value={report.tasks.length ? Math.round(report.completed / report.tasks.length * 100) : 0}/></td>
      <td data-label="Status"><Status value={report.ready ? "Erledigt" : "Offen"}/></td>
      <td data-label="Versand"><span className={`status ${report.sent ? "status-done" : report.ready ? "status-progress" : "status-open"}`}>{report.sent ? "Versendet" : report.ready ? "Bereit" : "Nicht bereit"}</span></td>
      <td data-label="Aktionen"><div className="event-report-actions"><button className="btn btn-primary" type="button" onClick={async () => { if (await ensureFeature(eventId, eventTitle, "reports")) setSelectedReport(report); }} disabled={!ready || !report.ready}><Icon name="file" size={14}/> Report erstellen</button><button className={`btn event-report-sent-button${report.sent ? " is-sent" : ""}`} type="button" onClick={() => report.sent ? void updateReportSentStatus(report, false) : setPendingSentReport(report)} disabled={!ready || !report.ready || updatingReportId === report.contract.id}>{updatingReportId === report.contract.id ? "Speichert …" : report.sent ? "Versand zurücknehmen" : "Versand bestätigen"}</button></div></td>
    </tr>)}</tbody></table></div>}{message && <p className="task-feedback" role="status">{message}</p>}</section>
    {pendingSentReport && <Modal labelledBy="report-sent-confirm-title" className="create-modal" backdropClassName="modal-backdrop" role="dialog" busy={Boolean(updatingReportId)} onClose={() => setPendingSentReport(null)}><div className="create-modal-head"><div><h2 id="report-sent-confirm-title">Versand bestätigen?</h2><p>Wurde der Abschlussreport für {pendingSentReport.sponsor.name} tatsächlich an den Sponsor versendet? Der Status wird erst nach deiner Bestätigung aktualisiert.</p></div><button className="icon-button" type="button" aria-label="Dialog schließen" disabled={Boolean(updatingReportId)} onClick={() => setPendingSentReport(null)}><Icon name="close" size={16}/></button></div><div className="create-modal-actions"><button className="btn" type="button" disabled={Boolean(updatingReportId)} onClick={() => setPendingSentReport(null)}>Noch nicht</button><button className="btn btn-primary" type="button" disabled={Boolean(updatingReportId)} onClick={async () => { await updateReportSentStatus(pendingSentReport, true); setPendingSentReport(null); }}>{updatingReportId === pendingSentReport.contract.id ? "Speichert …" : "Versand bestätigen"}</button></div></Modal>}
    {selectedReport && <Modal labelledBy="completion-report-title" className="create-modal completion-report-modal" backdropClassName="modal-backdrop completion-report-backdrop" busy={reportAction !== null} onClose={() => setSelectedReport(null)}>
      <div className="completion-report-document">
        <header className="completion-report-brand-row">
          <div className="completion-report-splow-brand"><SplowLogo markSize={30}/></div>
          {organizerLogoUrl ? <img className="completion-report-logo" src={organizerLogoUrl} alt={`Logo für ${eventTitle}`}/> : <span className="completion-report-organizer-name">{eventTitle}</span>}
        </header>
        <div className="completion-report-overline">LEISTUNGSNACHWEIS · SPONSORING</div>
        <div className="completion-report-title-row"><div><h2 id="completion-report-title">{selectedReport.sponsor.name}</h2><p>Dokumentation der vereinbarten Sponsoringleistungen</p></div><span className="completion-report-seal"><span aria-hidden="true">✓</span> Vollständig erbracht</span></div>
        <div className="completion-report-event"><span>VERANSTALTUNG</span><strong>{eventTitle}</strong></div>
        <div className="completion-report-summary">
          <div><span>Vertragswert netto</span><b>{selectedReport.contract.value}</b></div>
          <div><span>Leistungen nachgewiesen</span><b>{reportNumberFormat.format(selectedReport.completed)} von {reportNumberFormat.format(selectedReport.tasks.length)}</b></div>
          <div><span>Erstellt am</span><b>{new Intl.DateTimeFormat("de-DE", { dateStyle: "long" }).format(new Date())}</b></div>
        </div>
        <div className="completion-report-section-heading"><div><span>LEISTUNGSÜBERSICHT</span><h3>Vereinbarte Leistungen</h3></div><span>{reportNumberFormat.format(selectedReport.tasks.length)} Nachweise</span></div>
        <div className="completion-report-items">{selectedReport.tasks.map((task, index) => <article className="completion-report-item" key={task.id}><span className="completion-report-item-number">{String(index + 1).padStart(2, "0")}</span><div className="completion-report-item-content"><h4>{task.title}</h4><div className="completion-report-evidence"><Icon name="file" size={15}/><span><small>NACHWEIS</small><strong>{task.evidence || "Nachweis erbracht"}</strong></span></div></div><span className="completion-report-item-check" aria-label="Nachgewiesen">✓</span></article>)}</div>
        <footer className="completion-report-footer"><span>Erstellt mit <strong>Splow</strong></span><span>{selectedReport.sponsor.name} · {eventTitle}</span></footer>
      </div>
      <div className="create-modal-actions completion-report-actions"><button className="btn" type="button" onClick={() => setSelectedReport(null)}>Schließen</button><button className="btn" type="button" onClick={downloadReportPdf} disabled={reportAction !== null}>{reportAction === "download" ? "PDF wird erstellt …" : "PDF herunterladen"}</button><button className="btn btn-primary" type="button" onClick={sendReportToSponsor} disabled={reportAction !== null}>{reportAction === "share" ? "Wird vorbereitet …" : "PDF teilen"}</button></div>
      {message && <p className="task-feedback completion-report-feedback" role="status">{message}</p>}
    </Modal>}
  </>;
}
