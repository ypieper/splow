"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Icon } from "@/components/ui";

type Organization = { id: string; name: string; sponso_id: string };
type EnterpriseAccess = {
  organization_id: string; organization_name: string; sponso_id: string | null; is_active: boolean; activated_at: string; expires_at: string;
  annual_fee_cents: number; invoice_reference: string | null; internal_note: string; created_at: string; updated_at: string;
};

function nextYearDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function AdminEnterpriseAccess() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [entitlements, setEntitlements] = useState<EnterpriseAccess[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [organizationQuery, setOrganizationQuery] = useState("");
  const [organizationOptionsOpen, setOrganizationOptionsOpen] = useState(false);
  const [annualFee, setAnnualFee] = useState("");
  const [expiresAt, setExpiresAt] = useState(nextYearDate);
  const [invoiceReference, setInvoiceReference] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/enterprise-access", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Enterprise-Freischaltungen konnten nicht geladen werden.");
      setOrganizations(result.organizations ?? []);
      setEntitlements(result.entitlements ?? []);
      setOrganizationId((current: string) => current || result.organizations?.[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Enterprise-Freischaltungen konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const organizationOptionLabel = (item: Organization) => `${item.name} · ${item.sponso_id}`;
  const selectedOrganization = organizations.find((item) => item.id === organizationId);
  const matchingOrganizations = organizations.filter((item) => organizationOptionLabel(item).toLocaleLowerCase("de-DE").includes(organizationQuery.trim().toLocaleLowerCase("de-DE")));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!organizationId) {
      setError("Bitte wähle einen Veranstalterbereich aus der Liste aus.");
      return;
    }
    setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/admin/enterprise-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          annualFeeCents: Math.round(Number(annualFee.replace(",", ".")) * 100),
          expiresAt: `${expiresAt}T23:59:59.999Z`,
          invoiceReference,
          internalNote,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Die Freischaltung konnte nicht gespeichert werden.");
      setMessage("Enterprise wurde für den Veranstalterbereich bis zum gewählten Datum freigeschaltet.");
      setAnnualFee(""); setInvoiceReference(""); setInternalNote(""); setExpiresAt(nextYearDate());
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Die Freischaltung konnte nicht gespeichert werden.");
    } finally { setSaving(false); }
  }

  async function deactivate(id: string) {
    setDeactivating(id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/enterprise-access", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: id, isActive: false }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Die Freischaltung konnte nicht deaktiviert werden.");
      setMessage("Enterprise wurde deaktiviert.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Die Freischaltung konnte nicht deaktiviert werden.");
    } finally { setDeactivating(null); }
  }

  return <div className="admin-enterprise-access">
    <section className="panel admin-toolbar"><div><strong>Enterprise-Zugänge</strong><p>Schalte einen ganzen Veranstalterbereich mit allen Funktionen und ohne Event- oder Sponsorenlimits frei. Die Jahresgebühr wird per Rechnung abgerechnet.</p></div><span className="status status-progress">{entitlements.filter((item) => item.is_active && new Date(item.expires_at).getTime() > Date.now()).length} aktiv</span></section>
    <section className="panel admin-code-create"><div className="panel-heading"><div><h2>Enterprise freischalten</h2><p>Die Freischaltung gilt bis zum eingetragenen Datum. Bei Verlängerung werden Gebühr und Laufzeit aktualisiert.</p></div></div>
      {loading && organizations.length === 0 ? <p className="task-empty">Veranstalterbereiche werden geladen …</p> : organizations.length === 0 ? <p className="task-empty">Es wurden noch keine Veranstalterbereiche angelegt.</p> : <form onSubmit={(event) => void save(event)}>
        <div className="settings-grid">
          <div className="settings-field admin-organization-picker">
            <label htmlFor="enterprise-organization-query">Veranstalterbereich</label>
            <input
              id="enterprise-organization-query"
              role="combobox"
              aria-expanded={organizationOptionsOpen}
              aria-controls="enterprise-organizations"
              aria-autocomplete="list"
              aria-invalid={!organizationId && Boolean(organizationQuery.trim())}
              value={selectedOrganization ? organizationOptionLabel(selectedOrganization) : organizationQuery}
              onFocus={() => setOrganizationOptionsOpen(true)}
              onBlur={() => window.setTimeout(() => setOrganizationOptionsOpen(false), 120)}
              onChange={(event) => { setOrganizationQuery(event.target.value); setOrganizationId(""); setOrganizationOptionsOpen(true); setError(""); }}
              placeholder="Name oder Splow-ID suchen"
            />
            {organizationOptionsOpen && <div className="admin-organization-options" id="enterprise-organizations" role="listbox">
              {matchingOrganizations.map((item) => <button key={item.id} type="button" role="option" aria-selected={organizationId === item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setOrganizationId(item.id); setOrganizationQuery(""); setOrganizationOptionsOpen(false); setError(""); }}>{organizationOptionLabel(item)}</button>)}
              {matchingOrganizations.length === 0 && <span className="task-caption">Kein Veranstalterbereich gefunden.</span>}
            </div>}
            <small className="task-caption">Name und Splow-ID sind sichtbar und durchsuchbar.</small>
          </div>
          <label className="settings-field"><span>Jahresgebühr (€)</span><input required type="number" min="0.01" step="0.01" inputMode="decimal" value={annualFee} onChange={(event) => setAnnualFee(event.target.value)} placeholder="Betrag laut Rechnung" /></label>
          <label className="settings-field"><span>Gültig bis</span><input required type="date" min={new Date().toISOString().slice(0, 10)} value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
          <label className="settings-field"><span>Rechnungsnummer (optional)</span><input maxLength={120} value={invoiceReference} onChange={(event) => setInvoiceReference(event.target.value)} placeholder="z. B. RE-2026-1042" /></label>
          <label className="settings-field settings-field-full"><span>Interne Notiz (optional)</span><input maxLength={500} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} placeholder="Interne Zuordnung oder Vereinbarung" /></label>
        </div>
        {error && <p className="field-message error" role="alert">{error}</p>}
        {message && <p className="field-message success" role="status">{message}</p>}
        <div className="create-modal-actions"><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Wird gespeichert …" : "Enterprise freischalten"}</button></div>
      </form>}
    </section>
    {entitlements.length > 0 && <section className="panel table-panel admin-code-list"><div className="panel-heading"><div><h2>Freischaltungen</h2><p>Aktive und abgelaufene Enterprise-Zugänge für alle Veranstalterbereiche.</p></div></div>
      <div className="admin-code-table-wrap"><table className="table table-card-list"><thead><tr><th>VERANSTALTERBEREICH</th><th>SPLOW-ID</th><th>JAHRESGEBÜHR</th><th>STATUS</th><th>GÜLTIG BIS</th><th>RECHNUNG</th><th>NOTIZ</th><th>AKTION</th></tr></thead><tbody>{entitlements.map((item) => {
        const expired = new Date(item.expires_at).getTime() <= Date.now();
        const active = item.is_active && !expired;
        return <tr key={item.organization_id}><td data-label="Veranstalterbereich"><b>{item.organization_name}</b></td><td data-label="Splow-ID"><code>{item.sponso_id ?? "—"}</code></td><td data-label="Jahresgebühr">{new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(item.annual_fee_cents / 100)}</td><td data-label="Status"><span className={`status ${active ? "status-done" : "status-open"}`}>{active ? "Aktiv" : item.is_active ? "Abgelaufen" : "Deaktiviert"}</span></td><td data-label="Gültig bis">{new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(item.expires_at))}</td><td data-label="Rechnung">{item.invoice_reference || "—"}</td><td data-label="Notiz">{item.internal_note || "—"}</td><td data-label="Aktion">{active && <button className="btn btn-danger-soft" type="button" disabled={deactivating === item.organization_id} onClick={() => void deactivate(item.organization_id)}>{deactivating === item.organization_id ? "Wird deaktiviert …" : "Deaktivieren"}</button>}</td></tr>;
      })}</tbody></table></div>
    </section>}
    {error && !loading && organizations.length > 0 && <p className="admin-feedback" role="alert">{error}</p>}
  </div>;
}
