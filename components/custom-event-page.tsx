"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EventOverviewDetails } from "@/components/event-overview-details";
import { EventSponsorsOverview } from "@/components/event-sponsors-overview";
import { EventReports } from "@/components/event-reports";
import { EventSponsorDetail } from "@/components/event-sponsor-detail";
import { TasksOverview } from "@/components/tasks-overview";
import { EventBenefitsOverview } from "@/components/event-benefits-overview";
import { fetchStoredEventFromDatabase, type StoredEvent } from "@/lib/events-storage";
import { fetchSponsorRecordsForEvent, type SponsorRecord } from "@/lib/sponsors-storage";
import { EmptyState, Icon, Metric, PageHeading, Tabs } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/client";
import { eventLifecycleStage, useEventMetrics } from "@/lib/event-metrics";
import { useEventEntitlements, type EventEntitlement, type EventProductState } from "@/components/event-entitlements";
import { eventPlanLabel } from "@/lib/event-plan-labels";

function mergeSponsorRecords(current: SponsorRecord[], updates: SponsorRecord[]) {
  const records = new Map(updates.map((record) => [record.sponsor.id, record]));
  current.forEach((record) => records.set(record.sponsor.id, record));
  return [...records.values()].sort((a, b) => a.sponsor.name.localeCompare(b.sponsor.name, "de"));
}

export function CustomEventPage({ eventId, selectedTab, selectedSponsorId }: { eventId: string; selectedTab?: string; selectedSponsorId?: string }) {
  const [event, setEvent] = useState<StoredEvent | null>(null);
  const [eventLogoUrl, setEventLogoUrl] = useState("");
  const [eventSponsors, setEventSponsors] = useState<SponsorRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { getEntitlement, getProductState, loadEntitlement, requestUpgrade } = useEventEntitlements();
  const [entitlement, setEntitlement] = useState<EventEntitlement | null>(null);
  const [productState, setProductState] = useState<EventProductState | null>(null);
  const [packagePaymentNotice, setPackagePaymentNotice] = useState("");
  const eventMetrics = useEventMetrics(event ? [event.id] : []);

  useEffect(() => {
    async function loadEvent() {
      if (isSupabaseConfigured) {
        const [{ data, error }, sponsorResult] = await Promise.all([
          fetchStoredEventFromDatabase(eventId),
          fetchSponsorRecordsForEvent(eventId),
        ]);
        setEvent(!error && data ? data : null);
        setEventSponsors((current) => mergeSponsorRecords(current, sponsorResult.data ?? []));
      } else {
        setEvent(null);
        setEventSponsors([]);
      }
      setLoaded(true);
    }
    void loadEvent();
  }, [eventId]);

  useEffect(() => {
    let active = true;
    if (!event?.organizerLogoPath) { setEventLogoUrl(""); return () => { active = false; }; }
    void createClient().storage.from("sponsorproof-files").createSignedUrl(event.organizerLogoPath, 60 * 60 * 24)
      .then(({ data }) => { if (active) setEventLogoUrl(data?.signedUrl ?? ""); })
      .catch(() => { if (active) setEventLogoUrl(""); });
    return () => { active = false; };
  }, [event?.organizerLogoPath]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const current = await loadEntitlement(eventId);
      if (active) {
        setEntitlement(current);
        setProductState(getProductState(eventId));
      }
    };
    void load();
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ eventId?: string }>).detail;
      if (!detail?.eventId || detail.eventId === eventId) void load();
    };
    window.addEventListener("sponso:event-entitlement-updated", refresh);
    return () => { active = false; window.removeEventListener("sponso:event-entitlement-updated", refresh); };
  }, [eventId, getProductState, loadEntitlement]);

  useEffect(() => {
    if (!event) return;
    const url = new URL(window.location.href);
    const paymentStatus = url.searchParams.get("package_payment");
    if (!paymentStatus) return;

    if (paymentStatus === "cancelled") {
      url.searchParams.delete("package_payment");
      window.history.replaceState(window.history.state, "", url);
      setPackagePaymentNotice("Zahlung abgebrochen. Für dieses Event wurde noch kein Paket gebucht.");
      return;
    }
    if (paymentStatus !== "success") return;

    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) {
      setPackagePaymentNotice("Die Zahlung konnte nicht zugeordnet werden. Bitte lade die Seite erneut.");
      return;
    }
    let cancelled = false;
    void fetch(`/api/events/${event.id}/package-payment/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Das Eventpaket konnte nicht bestätigt werden.");
      if (cancelled) return;
      url.searchParams.delete("package_payment");
      url.searchParams.delete("session_id");
      window.history.replaceState(window.history.state, "", url);
      window.dispatchEvent(new CustomEvent("sponso:event-entitlement-updated", { detail: { eventId: event.id } }));
      setPackagePaymentNotice("Zahlung erfolgreich. Das Eventpaket ist jetzt freigeschaltet.");
    }).catch((error: unknown) => {
      if (!cancelled) setPackagePaymentNotice(error instanceof Error ? error.message : "Das Eventpaket konnte nicht bestätigt werden.");
    });
    return () => { cancelled = true; };
  }, [event]);

  useEffect(() => {
    let cancelled = false;
    const refreshSponsors = (event: Event) => {
      const detail = (event as CustomEvent<{ eventId?: string; record?: SponsorRecord }>).detail;
      if (detail?.eventId && detail.eventId !== eventId) return;
      if (detail?.record) {
        setEventSponsors((current) => mergeSponsorRecords(current, [detail.record!]));
        return;
      }
      void fetchSponsorRecordsForEvent(eventId).then(({ data }) => {
        if (!cancelled) setEventSponsors(data ?? []);
      });
    };
    window.addEventListener("sponsorproof:event-sponsors-updated", refreshSponsors);
    return () => {
      cancelled = true;
      window.removeEventListener("sponsorproof:event-sponsors-updated", refreshSponsors);
    };
  }, [eventId]);

  if (!loaded) return <main className="content" aria-busy="true"><p className="subtitle">Event wird geladen …</p></main>;
  if (!event) return <main className="content"><PageHeading eyebrow="EVENT" title="Event nicht gefunden" subtitle="Dieses Event ist nicht gespeichert."/><EmptyState title="Kein Event gefunden" description="Wähle ein vorhandenes Event aus oder lege ein neues an." action={<Link className="btn btn-primary" href="/events"><Icon name="calendar" size={14}/> Zur Eventübersicht</Link>} /></main>;

  const activeTab = selectedTab === "sponsoren" || selectedSponsorId ? "Sponsoren" : selectedTab === "leistungen" ? "Leistungen" : selectedTab === "aufgaben-nachweise" ? "Aufgaben & Nachweise" : selectedTab === "reports" ? "Reports" : "Übersicht";
  const currentPlanCode = entitlement?.plan_code ?? event.planCode;
  const selectedSponsorRecord = eventSponsors.find((record) => record.sponsor.id === selectedSponsorId);
  const selectedContract = selectedSponsorRecord?.contracts.find((contract) => contract.eventId === event.id);
  const currentEventMetrics = eventMetrics.byEvent[event.id] ?? { sponsorship: 0, signedSponsorship: 0, sponsors: 0, benefits: 0, trackedBenefits: 0, completed: 0, contracts: 0, contractsCreated: 0, contractsSigned: 0, reportsCreated: 0, reportsSent: 0, evidenceTasks: 0, completedEvidenceTasks: 0 };
  const lifecycleStage = eventLifecycleStage(currentEventMetrics);
  const eventHeaderMetricsUnavailable = eventMetrics.loading || eventMetrics.error;
  const signedSponsorship = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(currentEventMetrics.signedSponsorship);

  return <main className="content">
    <div className="page-heading"><div className="event-page-heading-main">{eventLogoUrl && <span className="event-page-logo"><img src={eventLogoUrl} alt={`Logo für ${event.title}`}/></span>}<div><div className="eyebrow">EVENT</div><h1>{event.title}</h1><div className="event-heading-summary" aria-label="Event-Kennzahlen"><div><strong>{eventHeaderMetricsUnavailable ? "—" : signedSponsorship}</strong><span>Gezeichnetes Sponsoring-Volumen</span></div><div><strong>{eventHeaderMetricsUnavailable ? "—" : currentEventMetrics.sponsors}</strong><span>{currentEventMetrics.sponsors === 1 ? "Sponsor" : "Sponsoren"}</span></div></div><p className="subtitle">Stammdaten und Veranstaltungsdetails.</p></div></div><div className="event-heading-actions"><span className={`event-lifecycle-status event-lifecycle-${lifecycleStage.color}`}>Status: {eventMetrics.loading ? "Status wird geladen …" : lifecycleStage.label}</span><span className={`event-plan-badge event-plan-${currentPlanCode}`}>Paket: {eventPlanLabel(currentPlanCode)}</span>{productState && currentPlanCode !== "enterprise" && <span className="event-plan-quota">{productState.assigned_sponsors}/{productState.included_sponsors + productState.purchased_sponsor_slots} Sponsoren</span>}{currentPlanCode !== "enterprise" && <button className="btn" type="button" onClick={() => requestUpgrade(event.id, event.title, productState ? `Kontingent: ${productState.assigned_sponsors} von ${productState.included_sponsors + productState.purchased_sponsor_slots} Sponsoren` : "Paket und Sponsorenkontingent")}>{currentPlanCode === "free" ? "Paket auswählen" : "Paket verwalten"}</button>}<Link className="btn" href="/events"><Icon name="chevron" size={14}/> Alle Events</Link></div></div>
    <Tabs items={[{ label: "Übersicht", href: `/events/${event.id}` }, { label: "Sponsoren", href: `/events/${event.id}?tab=sponsoren` }, { label: "Leistungen", href: `/events/${event.id}?tab=leistungen` }, { label: "Aufgaben & Nachweise", href: `/events/${event.id}?tab=aufgaben-nachweise` }, { label: "Reports", href: `/events/${event.id}?tab=reports` }]} active={activeTab} />
    {packagePaymentNotice && <p className="field-message" role="status">{packagePaymentNotice}</p>}
    {activeTab === "Übersicht" && <><section className="metric-grid"><Metric label="Sponsoringvolumen netto" value={eventMetrics.loading || eventMetrics.error ? "—" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(eventMetrics.aggregate.sponsorship)} icon="spark"/><Metric label="Sponsoren" value={eventMetrics.loading || eventMetrics.error ? "—" : String(eventMetrics.aggregate.sponsors)} icon="users"/><Metric label="Leistungen" value={eventMetrics.loading || eventMetrics.error ? "—" : String(eventMetrics.aggregate.benefits)} icon="check"/><Metric label="Erledigt" value={eventMetrics.loading || eventMetrics.error ? "—" : `${eventMetrics.aggregate.trackedBenefits ? Math.round(eventMetrics.aggregate.completed / eventMetrics.aggregate.trackedBenefits * 100) : 0} %`} note={eventMetrics.loading || eventMetrics.error ? undefined : `${eventMetrics.aggregate.completed} von ${eventMetrics.aggregate.trackedBenefits} aufgabenrelevanten Leistungen`} icon="layers"/></section><EventOverviewDetails eventId={event.id} initialDetails={{ title: event.title, startDate: event.startDate, endDate: event.endDate, location: event.location, locationStreet: event.locationStreet, locationPostalCode: event.locationPostalCode, locationCity: event.locationCity, responsible: event.responsible, contactFirstName: event.contactFirstName ?? "", contactLastName: event.contactLastName ?? "", contactEmail: event.contactEmail ?? "", contactPhone: event.contactPhone ?? "", organizerLogoPath: event.organizerLogoPath, organizerLogoUrl: event.organizerLogoUrl ?? eventLogoUrl }} onDetailsSaved={(details) => setEvent((current) => current ? { ...current, ...details } : current)} /></>}
    {activeTab === "Sponsoren" && selectedSponsorRecord && selectedContract ? <EventSponsorDetail key={selectedSponsorRecord.sponsor.id} eventId={event.id} eventTitle={event.title} eventStartDate={event.startDate} eventEndDate={event.endDate} eventLocation={event.location} eventResponsible={event.responsible} sponsor={selectedSponsorRecord.sponsor} contract={selectedContract} baseBenefits={[]} blocks={[]} /> : activeTab === "Sponsoren" && <EventSponsorsOverview eventId={event.id} eventTitle={event.title} sponsors={[]} contracts={[]} benefits={[]} databaseBacked />}
    {activeTab === "Leistungen" && <EventBenefitsOverview eventId={event.id} />}
    {activeTab === "Aufgaben & Nachweise" && <TasksOverview eventFilter={event.id} eventSponsors={eventSponsors.map(({ sponsor }) => sponsor)} embedded allowCreate />}
    {activeTab === "Reports" && <EventReports eventId={event.id} eventTitle={event.title} organizerLogoUrl={eventLogoUrl} sponsors={eventSponsors.map((record) => record.sponsor)} contracts={eventSponsors.flatMap((record) => record.contracts)} benefits={[]} />}
  </main>;
}
