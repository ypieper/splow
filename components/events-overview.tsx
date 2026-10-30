"use client";

import { DatePicker } from "@/components/date-picker";

import { Modal } from "@/components/modal";
import { useEventEntitlements } from "@/components/event-entitlements";
import { EventLocationFields } from "@/components/event-location-fields";
import { EmptyState, Icon } from "@/components/ui";
import { eventContractPackageLabel } from "@/lib/event-contract-package-labels";
import { eventLifecycleStage, useEventMetrics } from "@/lib/event-metrics";
import { eventPlanLabel } from "@/lib/event-plan-labels";
import { createStoredEventInDatabase, deleteStoredEventFromDatabase, fetchStoredEventsFromDatabase, formatEventDateRange, type StoredEvent } from "@/lib/events-storage";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

type EventDraft = Omit<StoredEvent, "id" | "createdAt" | "planCode" | "bookedPlanCode" | "entitlementStatus" | "hasPaidEventLicense" | "organizerLogoPath" | "organizerLogoUrl">;
const emptyDraft: EventDraft = { title: "", startDate: "", endDate: "", location: "", locationStreet: "", locationPostalCode: "", locationCity: "", responsible: "" };

export function EventsOverview() {
  const router = useRouter();
  const { requestUpgrade } = useEventEntitlements();
  const [createdEvents, setCreatedEvents] = useState<StoredEvent[]>([]);
  const [ready, setReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<{ id: string; title: string; hasPaidEventLicense: boolean } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [showCompletedEvents, setShowCompletedEvents] = useState(true);
  const [completedEventsPreferenceReady, setCompletedEventsPreferenceReady] = useState(false);
  const [savingCompletedEventsPreference, setSavingCompletedEventsPreference] = useState(false);
  const [completedEventsPreferenceMessage, setCompletedEventsPreferenceMessage] = useState("");
  const [draft, setDraft] = useState<EventDraft>(emptyDraft);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [freeLimitHit, setFreeLimitHit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [eventToDuplicate, setEventToDuplicate] = useState<StoredEvent | null>(null);
  const [duplicateDraft, setDuplicateDraft] = useState({ title: "", startDate: "", endDate: "" });
  const [duplicateError, setDuplicateError] = useState("");
  const [duplicating, setDuplicating] = useState(false);

  function updateLocation(value: Partial<Pick<EventDraft, "locationStreet" | "locationPostalCode" | "locationCity">>) {
    setDraft((current) => {
      const parts = { locationStreet: current.locationStreet, locationPostalCode: current.locationPostalCode, locationCity: current.locationCity, ...value };
      const location = [parts.locationStreet.trim(), [parts.locationPostalCode.trim(), parts.locationCity.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      return { ...current, ...parts, location };
    });
    setFormError("");
  }

  useEffect(() => {
    async function loadEvents() {
      try {
        if (isSupabaseConfigured) {
          const { data, error } = await fetchStoredEventsFromDatabase();
          if (error || !data) {
            setMessage("Die Events konnten nicht geladen werden. Bitte versuche es später erneut oder nutze das Kontaktformular, wenn der Fehler bestehen bleiben sollte.");
          } else {
            setCreatedEvents(data);
          }
        } else setMessage("Supabase ist nicht eingerichtet. Events können derzeit nicht gespeichert werden.");
      } catch {
        setMessage("Gespeicherte Events konnten nicht vollständig geladen werden.");
      } finally {
        setReady(true);
      }
    }
    void loadEvents();
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setCompletedEventsPreferenceReady(true);
      return;
    }
    let cancelled = false;
    void createClient().auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data.user) {
        setCompletedEventsPreferenceMessage("Deine Anzeigeauswahl konnte nicht geladen werden.");
      } else {
        const savedPreference = data.user.user_metadata?.show_completed_events;
        if (typeof savedPreference === "boolean") setShowCompletedEvents(savedPreference);
      }
      setCompletedEventsPreferenceReady(true);
    }).catch(() => {
      if (cancelled) return;
      setCompletedEventsPreferenceMessage("Deine Anzeigeauswahl konnte nicht geladen werden.");
      setCompletedEventsPreferenceReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  async function updateCompletedEventsPreference(showCompleted: boolean) {
    const previous = showCompletedEvents;
    setShowCompletedEvents(showCompleted);
    setCompletedEventsPreferenceMessage("");
    if (!isSupabaseConfigured) return;
    setSavingCompletedEventsPreference(true);
    try {
      const supabase = createClient();
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError || !data.user) throw userError ?? new Error("Nutzerkonto nicht gefunden.");
      const { error } = await supabase.auth.updateUser({
        data: { ...data.user.user_metadata, show_completed_events: showCompleted },
      });
      if (error) throw error;
    } catch {
      setShowCompletedEvents(previous);
      setCompletedEventsPreferenceMessage("Die Auswahl konnte nicht gespeichert werden. Bitte versuche es erneut.");
    } finally {
      setSavingCompletedEventsPreference(false);
    }
  }

  const visibleEvents = [...createdEvents].sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
  const eventMetrics = useEventMetrics(visibleEvents.map((event) => event.id));
  const activeEvents = visibleEvents.map((event) => {
    const metrics = eventMetrics.byEvent[event.id];
    const values = metrics ?? { sponsorship: 0, signedSponsorship: 0, sponsors: 0, benefits: 0, trackedBenefits: 0, completed: 0, contracts: 0, contractsCreated: 0, contractsSigned: 0, reportsCreated: 0, reportsSent: 0, evidenceTasks: 0, completedEvidenceTasks: 0 };
    return { ...event, date: formatEventDateRange(event.startDate, event.endDate), sponsorship: values.sponsorship, sponsors: values.sponsors, completed: values.completed, benefits: values.benefits, trackedBenefits: values.trackedBenefits, metricsLoading: eventMetrics.loading || eventMetrics.error, stage: eventLifecycleStage(values) };
  });
  const displayedEvents = activeEvents.filter((event) => showCompletedEvents || event.stage.label !== "Abgeschlossen");
  async function createEvent(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (saving) return;
    const title = draft.title.trim();
    if (!draft.locationStreet.trim() || !/^\d{5}$/.test(draft.locationPostalCode) || !draft.locationCity.trim()) {
      setFormError("Bitte trage Straße, eine fünfstellige PLZ und den ermittelten Ort ein.");
      return;
    }
    const location = [draft.locationStreet.trim(), `${draft.locationPostalCode} ${draft.locationCity.trim()}`].join(", ");
    const eventDetails = { ...draft, title, location, locationStreet: draft.locationStreet.trim(), locationPostalCode: draft.locationPostalCode.trim(), locationCity: draft.locationCity.trim(), responsible: draft.responsible.trim() };
    setSaving(true);
    setFormError("");
    setFreeLimitHit(false);
    try {
      let event: StoredEvent;
      if (isSupabaseConfigured) {
        const { data, error } = await createStoredEventInDatabase(eventDetails);
        if (error || !data) {
          const code = error && "code" in error ? error.code : undefined;
          const errorMessage = error && "message" in error ? error.message : "";
          if (errorMessage.includes("FREE_EVENT_LIMIT_REACHED")) {
            setFreeLimitHit(true);
            setFormError("Dein Free-Tarif enthält ein Event. Schalte dein bestehendes Event frei, bevor du ein weiteres erstellst.");
          } else if (code === "42P01" || code === "PGRST205") {
            setFormError("Die Events-Tabelle fehlt in Supabase noch. Bitte führe zuerst die Datenbankmigration aus und versuche es danach erneut.");
          } else if (code === "42501") {
            setFormError("Supabase hat das Speichern wegen fehlender Berechtigung abgelehnt. Bitte melde dich erneut an und prüfe die Datenbankmigration.");
          } else {
            const detail = error && "message" in error ? error.message : "Bitte versuche es erneut.";
            setFormError(`Das Event konnte nicht gespeichert werden. ${detail}`);
          }
          return;
        }
        event = data;
      } else throw new Error("Supabase ist nicht eingerichtet.");
      const updated = [...createdEvents, event];
      setCreatedEvents(updated);
      setDraft(emptyDraft);
      setCreating(false);
      setMessage("");
    } catch {
      setFormError("Das Event konnte nicht gespeichert werden. Bitte prüfe deine Verbindung und versuche es erneut.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent() {
    if (!eventToDelete || deleteConfirmation.trim() !== "löschen") return;
    const isCreatedEvent = createdEvents.some((event) => event.id === eventToDelete.id);
    try {
      if (isCreatedEvent) {
        const updated = createdEvents.filter((event) => event.id !== eventToDelete.id);
        if (isSupabaseConfigured) {
          const { error } = await deleteStoredEventFromDatabase(eventToDelete.id);
          if (error) {
            setMessage("Das Event konnte nicht aus Supabase gelöscht werden.");
            return;
          }
        } else throw new Error("Supabase ist nicht eingerichtet.");
        setCreatedEvents(updated);
      } else {
        throw new Error("Das Event ist nicht in Supabase gespeichert und kann deshalb nicht gelöscht werden.");
      }
      setEventToDelete(null);
      setDeleteConfirmation("");
      setMessage("");
    } catch {
      setMessage("Das Event konnte nicht gelöscht werden.");
    }
  }

  function openDuplicateDialog(event: StoredEvent) {
    const copySuffix = " (Kopie)";
    setDuplicateDraft({ title: `${event.title.slice(0, 100 - copySuffix.length)}${copySuffix}`, startDate: "", endDate: "" });
    setDuplicateError("");
    setEventToDuplicate(event);
  }

  async function duplicateEvent(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!eventToDuplicate || duplicating) return;
    const title = duplicateDraft.title.trim();
    if (!title || title.length > 100) {
      setDuplicateError("Bitte gib einen Eventnamen mit höchstens 100 Zeichen ein.");
      return;
    }
    if (!duplicateDraft.startDate || !duplicateDraft.endDate || duplicateDraft.endDate < duplicateDraft.startDate) {
      setDuplicateError("Bitte lege einen gültigen Beginn und ein Ende fest.");
      return;
    }
    setDuplicating(true);
    setDuplicateError("");
    try {
      const response = await fetch(`/api/events/${eventToDuplicate.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, startDate: duplicateDraft.startDate, endDate: duplicateDraft.endDate }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.eventId !== "string") throw new Error(result.error ?? "Das Event konnte nicht dupliziert werden.");
      router.push(`/events/${result.eventId}?tab=sponsoren`);
    } catch (reason) {
      setDuplicateError(reason instanceof Error ? reason.message : "Das Event konnte nicht dupliziert werden. Bitte versuche es erneut.");
    } finally {
      setDuplicating(false);
    }
  }

  return <main className="content">
    <div className="page-heading"><div><div className="eyebrow">VERANSTALTERBEREICH</div><h1>Events</h1><p className="subtitle">Alle Veranstaltungen und ihren aktuellen Fortschritt im Überblick.</p></div><button className="btn btn-primary" type="button" onClick={() => { setMessage(""); setCreating(true); }}><Icon name="plus" size={16}/> Event erstellen</button></div>
    <section>
      <div className="panel-heading event-overview-list-heading"><div><h2>Events</h2><p>Veranstaltungen und ihr aktueller Sponsoringfortschritt</p></div><div className="event-overview-heading-actions"><label className="event-completed-filter"><input type="checkbox" checked={showCompletedEvents} disabled={!completedEventsPreferenceReady || savingCompletedEventsPreference} onChange={(event) => void updateCompletedEventsPreference(event.target.checked)} /> Abgeschlossene Events anzeigen</label></div></div>
      {completedEventsPreferenceMessage && <p className="event-details-message" role="status">{completedEventsPreferenceMessage}</p>}
      <div className="adaptive-table-wrap"><table className="table adaptive-data-table events-data-table"><thead><tr><th>Event</th><th>Status</th><th>Vertragsvolumen</th><th>Sponsoren</th><th>Leistungsfortschritt</th><th><span className="sr-only">Aktionen</span></th></tr></thead><tbody>
        {displayedEvents.map((event) => {
          const progress = event.trackedBenefits ? Math.round(event.completed / event.trackedBenefits * 100) : 0;
          const planLabel = event.planCode === "enterprise" ? "Enterprise" : event.contractPackage ? eventContractPackageLabel(event.contractPackage.maxContracts, event.contractPackage.code) : eventPlanLabel(event.bookedPlanCode);
          return <tr key={event.id}><td data-label="Event"><Link className="events-data-name" href={`/events/${event.id}`}>{event.title}</Link><small className="events-data-meta">{event.date} · {event.location}</small><span className="event-plan-badge events-data-plan">{planLabel}</span></td><td data-label="Status"><span className={`event-lifecycle-status event-lifecycle-${event.stage.color}`}>{eventMetrics.loading ? "Wird geladen …" : eventMetrics.error ? "Nicht verfügbar" : event.stage.label}</span></td><td data-label="Vertragsvolumen">{event.metricsLoading ? "—" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(event.sponsorship)}</td><td data-label="Sponsoren">{event.metricsLoading ? "—" : event.sponsors}</td><td data-label="Leistungsfortschritt"><div className="events-data-progress"><div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div><b>{event.metricsLoading ? "—" : `${progress} %`}</b><small>{event.metricsLoading ? "Wird geladen …" : `${event.completed} von ${event.trackedBenefits} Leistungen`}</small></div></td><td data-label="Aktionen"><div className="events-data-row-actions"><button className="btn event-duplicate-button" type="button" onClick={() => openDuplicateDialog(event)}><Icon name="copy" size={14}/> Duplizieren</button><button className="btn event-delete-button event-overview-delete" type="button" onClick={() => { setDeleteConfirmation(""); setEventToDelete({ id: event.id, title: event.title, hasPaidEventLicense: event.hasPaidEventLicense }); }}><Icon name="close" size={14}/> Löschen</button></div></td></tr>;
        })}
      </tbody></table></div>
      {ready && activeEvents.length === 0 && <EmptyState title="Noch keine Events" description="Lege deine erste Veranstaltung an, um Sponsoren und Leistungen zu verwalten." action={<button className="btn btn-primary" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={14}/> Event erstellen</button>} />}
      {ready && activeEvents.length > 0 && displayedEvents.length === 0 && <EmptyState title="Alle Events abgeschlossen" description="Die abgeschlossenen Events sind ausgeblendet." action={<button className="btn" type="button" onClick={() => setShowCompletedEvents(true)}>Abgeschlossene Events anzeigen</button>} />}
      {ready && message && <p className="event-details-message" role="status">{message}</p>}
    </section>
    {creating && <Modal labelledBy="create-event-title" className="create-modal" backdropClassName="modal-backdrop" role="dialog" busy={saving} onClose={() => setCreating(false)}><div className="create-modal-head"><div><h2 id="create-event-title">Event erstellen</h2><p>Trage die Stammdaten der Veranstaltung ein.</p></div><button className="icon-button" type="button" aria-label="Dialog schließen" disabled={saving} onClick={() => setCreating(false)}><Icon name="close" size={16}/></button></div><form onSubmit={createEvent}><div className="settings-grid"><label className="settings-field settings-field-full"><span>Bezeichnung *</span><input autoFocus required maxLength={100} value={draft.title} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); setFormError(""); }} placeholder="z. B. Stadtfest 2027" /></label><label className="settings-field"><span>Beginn *</span><DatePicker required value={draft.startDate} onChange={(event) => { setDraft({ ...draft, startDate: event.target.value, endDate: draft.endDate && draft.endDate < event.target.value ? "" : draft.endDate }); setFormError(""); }} /></label><label className="settings-field"><span>Ende *</span><DatePicker required min={draft.startDate || undefined} value={draft.endDate} onChange={(event) => { setDraft({ ...draft, endDate: event.target.value }); setFormError(""); }} /></label><EventLocationFields required value={{ street: draft.locationStreet, postalCode: draft.locationPostalCode, city: draft.locationCity }} onChange={(location) => updateLocation({ ...(location.street !== undefined ? { locationStreet: location.street } : {}), ...(location.postalCode !== undefined ? { locationPostalCode: location.postalCode } : {}), ...(location.city !== undefined ? { locationCity: location.city } : {}) })} /></div>{formError && <p className="field-message error" role="alert" style={{ marginTop: 14 }}>{formError}</p>}{freeLimitHit && createdEvents[0] && <button className="btn" type="button" onClick={() => { setCreating(false); requestUpgrade(createdEvents[0].id, createdEvents[0].title, "Schalte dein bestehendes Event frei, um einen weiteren Veranstaltungsplatz zu nutzen."); }}>Bestehendes Event freischalten</button>}<div className="create-modal-actions"><button className="btn" type="button" disabled={saving} onClick={() => setCreating(false)}>Abbrechen</button><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Wird gespeichert …" : "Event speichern"}</button></div></form></Modal>}
    {eventToDuplicate && <Modal labelledBy="duplicate-event-title" className="create-modal event-duplicate-modal" backdropClassName="modal-backdrop" role="dialog" busy={duplicating} onClose={() => setEventToDuplicate(null)}><div className="create-modal-head"><div><h2 id="duplicate-event-title">Event duplizieren</h2><p>„{eventToDuplicate.title}“ wird als neues Event mit frischem Fortschritt angelegt.</p></div><button className="icon-button" type="button" aria-label="Dialog schließen" disabled={duplicating} onClick={() => setEventToDuplicate(null)}><Icon name="close" size={16}/></button></div><form onSubmit={(event) => void duplicateEvent(event)}><div className="settings-grid"><label className="settings-field settings-field-full"><span>Neuer Eventname *</span><input autoFocus required maxLength={100} value={duplicateDraft.title} onChange={(event) => { setDuplicateDraft((current) => ({ ...current, title: event.target.value })); setDuplicateError(""); }}/></label><label className="settings-field"><span>Beginn *</span><DatePicker required value={duplicateDraft.startDate} onChange={(event) => { setDuplicateDraft((current) => ({ ...current, startDate: event.target.value, endDate: current.endDate && current.endDate < event.target.value ? "" : current.endDate })); setDuplicateError(""); }}/></label><label className="settings-field"><span>Ende *</span><DatePicker required min={duplicateDraft.startDate || undefined} value={duplicateDraft.endDate} onChange={(event) => { setDuplicateDraft((current) => ({ ...current, endDate: event.target.value })); setDuplicateError(""); }}/></label></div><div className="event-duplicate-summary"><strong>Wird übernommen</strong><p>Sponsoren, Leistungen, Aufgabenabläufe sowie Ort und Ansprechpartner.</p><strong>Wird zurückgesetzt</strong><p>Aufgaben starten offen. Nachweise, Verträge, Rechnungen, Kennzahlen und bisherige Sponsorzugänge werden nicht übernommen. Für jeden Sponsor wird ein neuer Einladungscode angelegt.</p><small>Das neue Event erhält die für neue Events geltende Freischaltung; eine bezahlte Einzellizenz wird nicht kopiert.</small></div>{duplicateError && <p className="field-message error" role="alert">{duplicateError}</p>}<div className="create-modal-actions"><button className="btn" type="button" disabled={duplicating} onClick={() => setEventToDuplicate(null)}>Abbrechen</button><button className="btn btn-primary" type="submit" disabled={duplicating || !duplicateDraft.title.trim() || !duplicateDraft.startDate || !duplicateDraft.endDate}>{duplicating ? "Event wird dupliziert …" : "Event duplizieren"}</button></div></form></Modal>}
    {eventToDelete && <Modal labelledBy="delete-event-title" className="create-modal delete-event-modal" backdropClassName="modal-backdrop" role="dialog" onClose={() => { setEventToDelete(null); setDeleteConfirmation(""); }}><div className="create-modal-head"><div><h2 id="delete-event-title">Event endgültig löschen?</h2><p>Du löschst „{eventToDelete.title}“ und alle zugehörigen Daten im Veranstalterbereich.</p></div><button className="icon-button" type="button" aria-label="Dialog schließen" onClick={() => { setEventToDelete(null); setDeleteConfirmation(""); }}><Icon name="close" size={16}/></button></div><div className="delete-event-consequences"><strong>Das wird entfernt</strong><ul><li>Sponsorenzuordnungen und Verträge</li><li>Leistungen, Aufgaben und Nachweiseinträge</li><li>Reports und der Eventfortschritt</li></ul><p>Hochgeladene Fotos und Vertragsdateien bleiben zunächst im Dateispeicher, sind nach dem Löschen aber nicht mehr über dieses Event erreichbar.</p></div>{eventToDelete.hasPaidEventLicense && <div className="delete-event-license-warning" role="alert"><strong>Die Event-Lizenz geht verloren</strong><p>Die kostenpflichtige Freischaltung wird mit dem Event gelöscht und kann nicht auf ein anderes Event übertragen werden.</p></div>}<label className="settings-field"><span>Gib <b>löschen</b> ein, um fortzufahren</span><input autoFocus value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder="löschen" /></label><div className="create-modal-actions"><button className="btn" type="button" onClick={() => { setEventToDelete(null); setDeleteConfirmation(""); }}>Abbrechen</button><button className="btn btn-primary delete-event-confirm" type="button" onClick={deleteEvent} disabled={deleteConfirmation.trim() !== "löschen"}>Event endgültig löschen</button></div></Modal>}
  </main>;
}
