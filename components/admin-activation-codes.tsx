"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "@/components/ui";
import { eventPlanLabel } from "@/lib/event-plan-labels";

type CodeRow = {
  id: string; code_hint: string; code: string | null; plan_code: "event" | "event_pro" | null; package_code: string | null; is_active: boolean;
  expires_at: string | null; max_uses: number | null; use_count: number;
  organization_id: string | null; organization_name: string | null; organization_sponso_id: string | null;
  event_id: string | null; event_name: string | null; internal_note: string;
  created_at: string; deactivated_at: string | null;
};
type Organization = { id: string; name: string; sponso_id: string };
type EventOption = { id: string; title: string; organization_id: string };
type PackageOption = { code: string; name: string; max_contracts: number; base_amount_cents: number };

export function AdminActivationCodes() {
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [packageCode, setPackageCode] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [organizationQuery, setOrganizationQuery] = useState("");
  const [organizationOptionsOpen, setOrganizationOptionsOpen] = useState(false);
  const [eventId, setEventId] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [createdCode, setCreatedCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState<string | null>(null);
  const [tableQuery, setTableQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/activation-codes", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Freischaltcodes konnten nicht geladen werden.");
      setCodes(result.codes ?? []);
      setOrganizations(result.organizations ?? []);
      setEvents(result.events ?? []);
      setPackages(result.packages ?? []);
      setPackageCode((current) => current || result.packages?.[0]?.code || "");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Freischaltcodes konnten nicht geladen werden.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (organizationQuery.trim() && !organizationId) {
      setError("Bitte wähle einen Veranstalterbereich mit Splow-ID aus der Liste aus.");
      return;
    }
    setSaving(true); setError(""); setMessage(""); setCreatedCode("");
    try {
      const response = await fetch("/api/admin/activation-codes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageCode, maxUses: maxUses || null, expiresAt: expiresAt || null, organizationId: organizationId || null, eventId: eventId || null, internalNote }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Der Freischaltcode konnte nicht erstellt werden.");
      setCreatedCode(result.code);
      setMessage("Der Code wurde erstellt und ist ab jetzt vollständig in der Adminübersicht sichtbar.");
      setMaxUses(""); setExpiresAt(""); setOrganizationId(""); setOrganizationQuery(""); setEventId(""); setInternalNote("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Der Freischaltcode konnte nicht erstellt werden.");
    } finally { setSaving(false); }
  }

  async function deactivate(id: string) {
    if (deactivating) return;
    setDeactivating(id); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/activation-codes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: false }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Der Code konnte nicht deaktiviert werden.");
      setMessage("Der Freischaltcode wurde deaktiviert.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Der Code konnte nicht deaktiviert werden.");
    } finally { setDeactivating(null); }
  }

  const eligibleEvents = events.filter((item) => !organizationId || item.organization_id === organizationId);
  const packageName = (value: string | null) => packages.find((item) => item.code === value)?.name ?? (value ?? "Unbekanntes Paket");
  const organizationOptionLabel = (item: Organization) => item.name + " · " + item.sponso_id;
  const matchingOrganizations = organizations.filter((item) => organizationOptionLabel(item).toLocaleLowerCase("de-DE").includes(organizationQuery.trim().toLocaleLowerCase("de-DE")));
  const filteredCodes = useMemo(() => {
    const needle = tableQuery.trim().toLocaleLowerCase("de-DE");
    if (!needle) return codes;
    return codes.filter((item) => [item.code, item.code_hint, item.package_code ? packageName(item.package_code) : item.plan_code ? eventPlanLabel(item.plan_code) : "", item.organization_name, item.organization_sponso_id, item.event_name, item.internal_note, item.use_count, item.max_uses].some((value) => String(value ?? "").toLocaleLowerCase("de-DE").includes(needle)));
  }, [codes, packages, tableQuery]);

  return <div className="admin-activation-codes">
    <section className="panel admin-toolbar"><div><strong>Freischaltcodes</strong><p>Alle Plattform-Admins sehen und verwalten dieselbe Codeübersicht – unabhängig davon, wer einen Code erstellt hat. Vollständige Codes sind nur für Plattform-Admins sichtbar.</p></div><span className="status status-progress">{codes.length} Codes</span></section>
    <section className="panel admin-code-create"><div className="panel-heading"><div><h2>Freischaltcode erstellen</h2><p>Der Code wird automatisch im Format S-Jahr-Zahlencode erstellt. Lege Tarif, Nutzungsgrenze und optionale Bindungen fest.</p></div></div>
      <form onSubmit={createCode}>
        <div className="settings-grid">
          <label className="settings-field"><span>Paket</span><select required value={packageCode} onChange={(event) => setPackageCode(event.target.value)}>{packages.map((item) => <option key={item.code} value={item.code}>{item.name} · bis zu {item.max_contracts} Sponsoren · {new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(item.base_amount_cents / 100)}</option>)}</select></label>
          <label className="settings-field"><span>Maximale Nutzungen</span><input type="number" min="1" step="1" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} placeholder="Unbegrenzt" /></label>
          <label className="settings-field"><span>Ablaufdatum (optional)</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
          <div className="settings-field admin-organization-picker"><label htmlFor="activation-code-organization-query">Veranstalterbereich (optional)</label><input id="activation-code-organization-query" role="combobox" aria-expanded={organizationOptionsOpen} aria-controls="activation-code-organizations" aria-autocomplete="list" value={organizationQuery} onFocus={() => setOrganizationOptionsOpen(true)} onBlur={() => window.setTimeout(() => setOrganizationOptionsOpen(false), 120)} onChange={(event) => { setOrganizationQuery(event.target.value); setOrganizationId(""); setEventId(""); setOrganizationOptionsOpen(true); }} placeholder="Name oder Splow-ID suchen"/>{organizationOptionsOpen && <div className="admin-organization-options" id="activation-code-organizations" role="listbox"><button type="button" role="option" aria-selected={!organizationId} onMouseDown={(event) => event.preventDefault()} onClick={() => { setOrganizationId(""); setOrganizationQuery(""); setEventId(""); setOrganizationOptionsOpen(false); }}>Alle Veranstalterbereiche</button>{matchingOrganizations.map((item) => <button key={item.id} type="button" role="option" aria-selected={organizationId === item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setOrganizationId(item.id); setOrganizationQuery(organizationOptionLabel(item)); setEventId(""); setOrganizationOptionsOpen(false); }}>{organizationOptionLabel(item)}</button>)}{matchingOrganizations.length === 0 && <span className="task-caption">Kein Veranstalterbereich gefunden.</span>}</div>}<small className="task-caption">Name und Splow-ID sind in der Liste sichtbar und durchsuchbar.</small></div>
          <label className="settings-field"><span>Event (optional)</span><select value={eventId} onChange={(event) => setEventId(event.target.value)}><option value="">Nicht an ein Event gebunden</option>{eligibleEvents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label className="settings-field settings-field-full"><span>Interne Notiz (optional)</span><input maxLength={500} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} placeholder="Interne Zuordnung oder Anlass" /></label>
        </div>
        {error && <p className="field-message error" role="alert">{error}</p>}
        {message && <p className="field-message success" role="status">{message}</p>}
        {createdCode && <div className="admin-issued-code"><code>{createdCode}</code><button className="btn" type="button" onClick={() => { void navigator.clipboard.writeText(createdCode); setMessage("Code in die Zwischenablage kopiert."); }}><Icon name="check" size={14}/> Code kopieren</button></div>}
        <div className="create-modal-actions"><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Wird erstellt …" : "Freischaltcode erstellen"}</button></div>
      </form>
    </section>
    <section className="panel table-panel admin-code-list"><div className="panel-heading admin-searchable-table-heading"><div><h2>Alle Codes</h2><p>Alle Plattform-Admins sehen hier alle Codes. Vollständige Codes sind auf dem Server verschlüsselt und werden nur für Plattform-Admins entschlüsselt.</p></div><label className="admin-search admin-table-search"><span className="sr-only">Freischaltcodes suchen</span><Icon name="search" size={16}/><input value={tableQuery} onChange={(event) => setTableQuery(event.target.value)} placeholder="Code, Paket, Bereich oder Splow-ID suchen"/></label></div>
      {loading ? <p className="task-empty">Codes werden geladen …</p> : codes.length === 0 ? <p className="task-empty">Es wurden noch keine Freischaltcodes erstellt.</p> : filteredCodes.length === 0 ? <p className="task-empty">Keine Freischaltcodes für diese Suche gefunden.</p> : <div className="admin-code-table-wrap"><table className="table table-card-list"><thead><tr><th>CODE</th><th>PAKET</th><th>STATUS</th><th>NUTZUNG</th><th>GEBUNDEN AN</th><th>ABLAUF</th><th>ERSTELLT</th><th>AKTION</th></tr></thead><tbody>{filteredCodes.map((item) => { const exhausted = item.max_uses !== null && item.use_count >= item.max_uses; const expired = Boolean(item.expires_at && new Date(item.expires_at).getTime() <= Date.now()); const status = !item.is_active ? "Deaktiviert" : exhausted ? "Aufgebraucht" : expired ? "Abgelaufen" : "Aktiv"; return <tr key={item.id}><td data-label="Code"><div className="admin-code-value"><code>{item.code ?? "Code nicht verfügbar"}</code>{item.code && <button className="btn admin-code-copy" type="button" onClick={() => { void navigator.clipboard.writeText(item.code!); setMessage("Freischaltcode kopiert."); }} aria-label="Freischaltcode kopieren">Kopieren</button>}</div>{!item.code && <div className="task-caption">Dieser ältere Code kann nicht aus seinem Hash rekonstruiert werden.</div>}{item.internal_note && <div className="task-caption">{item.internal_note}</div>}</td><td data-label="Paket">{item.package_code ? packageName(item.package_code) : item.plan_code ? eventPlanLabel(item.plan_code) : "—"}</td><td data-label="Status"><span className={`status ${status === "Aktiv" ? "status-done" : "status-open"}`}>{status}</span></td><td data-label="Nutzung">{item.use_count}{item.max_uses ? ` / ${item.max_uses}` : " / ∞"}</td><td data-label="Gebunden an">{item.event_name ?? item.organization_name ?? "Alle Bereiche"}<small className="admin-code-org-id">{item.organization_sponso_id}</small></td><td data-label="Ablauf">{item.expires_at ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(item.expires_at)) : "Kein Ablaufdatum"}</td><td data-label="Erstellt">{new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(item.created_at))}</td><td data-label="Aktion">{item.is_active && !exhausted && !expired && <button className="btn btn-danger-soft" type="button" disabled={deactivating === item.id} onClick={() => void deactivate(item.id)}>{deactivating === item.id ? "Wird deaktiviert …" : "Deaktivieren"}</button>}</td></tr>; })}</tbody></table></div>}
    </section>
  </div>;
}
