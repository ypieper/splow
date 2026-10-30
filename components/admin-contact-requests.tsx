"use client";

import { useCallback, useEffect, useState } from "react";

type ContactRequest = {
  id: string; user_id: string | null; organization_id: string | null; name: string; email: string;
  organization_name: string; subject: "Enterprise-Anfrage" | "Allgemeine Anfrage"; message: string;
  status: "new" | "handled"; created_at: string; handled_at: string | null;
};

export function AdminContactRequests() {
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/contact-requests", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Kontaktanfragen konnten nicht geladen werden.");
      setRequests(result.requests ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kontaktanfragen konnten nicht geladen werden.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setHandled(item: ContactRequest, handled: boolean) {
    setBusyId(item.id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/contact-requests", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, status: handled ? "handled" : "new" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Der Status konnte nicht gespeichert werden.");
      setMessage("Status gespeichert.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Der Status konnte nicht gespeichert werden.");
    } finally { setBusyId(null); }
  }

  return <div className="admin-contact-requests">
    <section className="panel admin-toolbar"><div><strong>Kontaktanfragen</strong><p>Enterprise- und allgemeine Anfragen aus dem Kontaktformular.</p></div><span className="status status-progress">{requests.filter((item) => item.status === "new").length} offen</span></section>
    {message && <p className="admin-feedback" role="status">{message}</p>}
    {error && <p className="admin-feedback" role="alert">{error}</p>}
    {loading ? <section className="panel admin-empty">Kontaktanfragen werden geladen …</section> : requests.length === 0 ? <section className="panel admin-empty">Es sind noch keine Kontaktanfragen eingegangen.</section> : <div className="admin-contact-list">{requests.map((item) => <article className="panel admin-contact-card" key={item.id}>
      <div className="admin-contact-heading"><div><span className={`status ${item.status === "new" ? "status-progress" : "status-done"}`}>{item.status === "new" ? "Offen" : "Bearbeitet"}</span><h2>{item.subject}</h2><p>{new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.created_at))}</p></div><a className="btn" href={`mailto:${encodeURIComponent(item.email)}?subject=${encodeURIComponent(`Splow – ${item.subject}`)}`}>Per E-Mail antworten</a></div>
      <div className="admin-contact-meta"><b>{item.name}</b><a href={`mailto:${item.email}`}>{item.email}</a>{item.organization_name && <span>{item.organization_name}</span>}</div>
      <p className="admin-contact-message">{item.message}</p>
      <div className="admin-contact-actions">{item.status === "new" ? <button className="btn btn-primary" type="button" disabled={busyId === item.id} onClick={() => void setHandled(item, true)}>{busyId === item.id ? "Wird gespeichert …" : "Als bearbeitet markieren"}</button> : <button className="btn" type="button" disabled={busyId === item.id} onClick={() => void setHandled(item, false)}>Wieder öffnen</button>}</div>
    </article>)}</div>}
  </div>;
}
