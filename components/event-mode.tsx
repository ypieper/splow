"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TasksOverview } from "@/components/tasks-overview";
import { EmptyState, Icon, SplowLogo } from "@/components/ui";
import { fetchStoredEventsFromDatabase, formatEventDate, formatEventDateRange, type StoredEvent } from "@/lib/events-storage";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type EventModeTab = "event" | "proofs";

function eventDates(event: StoredEvent) {
  if (event.startDate && event.endDate) return formatEventDateRange(event.startDate, event.endDate);
  return formatEventDate(event.startDate || event.endDate, { day: "2-digit", month: "long", year: "numeric" });
}

function eventModeHref(tab: EventModeTab, eventId: string) {
  const params = new URLSearchParams({ tab: tab === "event" ? "event" : "nachweise" });
  if (eventId) params.set("event", eventId);
  return `/event-modus?${params.toString()}`;
}

export function EventMode() {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [activeTab, setActiveTab] = useState<EventModeTab>("proofs");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const syncTabFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setActiveTab(params.get("tab") === "event" ? "event" : "proofs");
      const eventId = params.get("event");
      if (eventId) setSelectedEventId(eventId);
    };
    syncTabFromUrl();
    window.addEventListener("popstate", syncTabFromUrl);

    async function loadEvents() {
      try {
        let visibleEvents: StoredEvent[] = [];
        if (isSupabaseConfigured) {
          const result = await fetchStoredEventsFromDatabase();
          if (result.data && !result.error) visibleEvents = result.data;
          else if (result.error) setLoadError("Events konnten gerade nicht geladen werden.");
        } else setLoadError("Supabase ist nicht eingerichtet.");
        setEvents(visibleEvents);
        const linkedEventId = new URLSearchParams(window.location.search).get("event") ?? "";
        const initialEventId = linkedEventId;
        setSelectedEventId(visibleEvents.some((event) => event.id === initialEventId) ? initialEventId : "");
      } catch {
        setEvents([]);
        setLoadError("Events konnten gerade nicht geladen werden.");
      } finally {
        setReady(true);
      }
    }
    void loadEvents();
    return () => window.removeEventListener("popstate", syncTabFromUrl);
  }, []);

  function selectEvent(eventId: string) {
    setSelectedEventId(eventId);
    window.history.pushState({}, "", eventModeHref("event", eventId));
  }

  function selectModeTab(tab: EventModeTab) {
    setActiveTab(tab);
    window.history.pushState({}, "", eventModeHref(tab, selectedEventId));
  }

  const selectedEvent = events.find((event) => event.id === selectedEventId);

  return <div className="mobile-shell mobile-event-mode">
    <header className="mobile-header"><Link href="/dashboard" className="brand" aria-label="Splow Übersicht öffnen"><SplowLogo markSize={29} /></Link><div className="mobile-header-actions"><nav className="mobile-header-mode-nav" aria-label="Event-Modus"><button className={activeTab === "event" ? "active" : ""} type="button" aria-pressed={activeTab === "event"} onClick={() => selectModeTab("event")}><Icon name="calendar" size={14}/>Event</button><button className={activeTab === "proofs" ? "active" : ""} type="button" aria-pressed={activeTab === "proofs"} onClick={() => selectModeTab("proofs")}><Icon name="camera" size={14}/>Nachweise</button></nav><Link href="/events" className="icon-button" aria-label="Zur Eventübersicht"><Icon name="chevron" size={16}/></Link></div></header>
    <main className="mobile-content">
      <span className="live-pill"><span className="live-dot"/> NACHWEIS-MODUS</span>
      <h1>{activeTab === "event" ? "Event auswählen" : "Nachweise vor Ort"}</h1>
      <p className="mobile-sub">{activeTab === "event" ? "Wähle das Event, für das du Nachweise erfassen möchtest." : selectedEvent ? selectedEvent.title : "Wähle zuerst ein Event aus, um die offenen Aufgaben und Nachweise zu sehen."}</p>
      {loadError && <p className="field-message error" role="alert">{loadError}</p>}
      {activeTab === "event" && <section className="mobile-event-selection" aria-label="Event auswählen">
        {!ready ? <p className="task-empty">Events werden geladen …</p> : events.length === 0 ? <EmptyState title="Noch keine Events" description="Lege zuerst ein Event an. Danach kannst du hier die passenden Nachweise erfassen." action={<Link href="/events" className="btn btn-primary"><Icon name="calendar" size={14}/> Events öffnen</Link>} /> : <div className="mobile-event-list">{events.map((event) => <button key={event.id} type="button" className={`mobile-event-option ${event.id === selectedEventId ? "selected" : ""}`} aria-pressed={event.id === selectedEventId} onClick={() => selectEvent(event.id)}><span className="mobile-event-option-icon"><Icon name="calendar" size={17}/></span><span className="mobile-event-option-copy"><strong>{event.title}</strong>{(event.startDate || event.endDate) && <small>{eventDates(event)}</small>}{event.location && <small>{event.location}</small>}</span><span className="mobile-event-option-check">{event.id === selectedEventId ? <Icon name="check" size={16}/> : <Icon name="chevron" size={16}/>}</span></button>)}</div>}
        {selectedEvent && <button className="btn btn-primary mobile-event-continue" type="button" onClick={() => selectModeTab("proofs")}><Icon name="camera" size={15}/> Nachweise für {selectedEvent.title}</button>}
      </section>}

      {activeTab === "proofs" && (selectedEvent ? <TasksOverview eventFilter={selectedEvent.id} embedded mobileMode /> : <EmptyState title="Kein Event ausgewählt" description="Wähle im Reiter „Event“ zuerst eine Veranstaltung aus. Danach erscheinen hier alle Aufgaben und Nachweise." action={<button className="btn btn-primary" type="button" onClick={() => selectModeTab("event")}><Icon name="calendar" size={14}/> Event auswählen</button>} />)}
    </main>
  </div>;
}
