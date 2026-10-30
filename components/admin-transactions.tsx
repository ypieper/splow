"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";

type Transaction = {
  id: string;
  date: string;
  organizationName: string;
  sponsoId: string | null;
  eventName: string;
  product: string;
  amountCents: number;
  status: string;
  provider: string;
  reference: string | null;
  kind: "payment" | "activation" | "enterprise" | "receipt";
};
type OrganizationOption = { id: string; name: string; sponsoId: string };
type TransactionSummary = { paidCount: number; confirmedTotalCents: number; enterpriseCount: number };
const emptySummary: TransactionSummary = { paidCount: 0, confirmedTotalCents: 0, enterpriseCount: 0 };

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

export function AdminTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [summary, setSummary] = useState<TransactionSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [organizationSearch, setOrganizationSearch] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [grossAmount, setGrossAmount] = useState("");
  const [netAmount, setNetAmount] = useState("");
  const [invoiceReference, setInvoiceReference] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 16));
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void fetch(`/api/admin/transactions?page=${page}&q=${encodeURIComponent(debouncedQuery)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Transaktionen konnten nicht geladen werden.");
        if (active) {
          setTransactions(result.transactions ?? []);
          setHasMore(Boolean(result.hasMore));
          if (result.summary) setSummary(result.summary);
        }
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Transaktionen konnten nicht geladen werden."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, debouncedQuery]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void fetch(`/api/admin/transactions/organizations?q=${encodeURIComponent(organizationSearch.trim())}`, { cache: "no-store" })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Veranstalterbereiche konnten nicht geladen werden.");
          if (active) setOrganizations(result.organizations ?? []);
        })
        .catch(() => { if (active) setOrganizations([]); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [organizationSearch]);

  async function recordEnterprisePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setRecording(true); setError("");
    try {
      const response = await fetch("/api/admin/transactions/enterprise-payment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, grossAmountCents: Math.round(Number(grossAmount.replace(",", ".")) * 100), netAmountCents: Math.round(Number(netAmount.replace(",", ".")) * 100), invoiceReference, paymentReference, paidAt: new Date(paidAt).toISOString() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Zahlungseingang konnte nicht dokumentiert werden.");
      setInvoiceReference(""); setPaymentReference(""); setGrossAmount(""); setNetAmount("");
      setPage(1); setQuery(""); setDebouncedQuery("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Zahlungseingang konnte nicht dokumentiert werden."); }
    finally { setRecording(false); }
  }

  return <>
    <form className="panel enterprise-receipt-form" onSubmit={recordEnterprisePayment}>
      <div className="enterprise-receipt-heading"><div><strong>Enterprise-Rechnungseingang dokumentieren</strong><p>Nur nach tatsächlichem Zahlungseingang ausfüllen. Die Freischaltung selbst gilt nicht als Zahlung.</p></div></div>
      <div className="enterprise-receipt-fields">
        <label className="settings-field"><span>Veranstalterbereich</span><input required list="transaction-organization-options" value={organizationSearch} onChange={event => { const value = event.target.value; setOrganizationSearch(value); const selected = organizations.find(item => `${item.name} · ${item.sponsoId}` === value); setOrganizationId(selected?.id ?? ""); }} placeholder="Name oder Splow-ID suchen" /><datalist id="transaction-organization-options">{organizations.map(item=><option key={item.id} value={`${item.name} · ${item.sponsoId}`} />)}</datalist></label>
        <label className="settings-field"><span>Rechnungsreferenz</span><input required value={invoiceReference} onChange={e=>setInvoiceReference(e.target.value)} /></label>
        <label className="settings-field"><span>Zahlungsreferenz</span><input required value={paymentReference} onChange={e=>setPaymentReference(e.target.value)} /></label>
        <label className="settings-field"><span>Brutto (€)</span><input type="number" min="0.01" step="0.01" required value={grossAmount} onChange={e=>setGrossAmount(e.target.value)} /></label>
        <label className="settings-field"><span>Netto (€)</span><input type="number" min="0.01" step="0.01" required value={netAmount} onChange={e=>setNetAmount(e.target.value)} /></label>
        <label className="settings-field"><span>Zahlungsdatum</span><input type="datetime-local" required value={paidAt} onChange={e=>setPaidAt(e.target.value)} /></label>
      </div>
      <button className="btn btn-primary" type="submit" disabled={recording || !organizationId}>{recording?"Wird dokumentiert …":"Zahlungseingang bestätigen"}</button>
    </form>
    <section className="panel admin-transaction-summary">
      <div className="admin-transaction-metric"><span>Bestätigte Zahlungseingänge</span><strong>{summary.paidCount}</strong></div>
      <div className="admin-transaction-metric"><span>Erfasste Bruttobeträge</span><strong>{euro.format(summary.confirmedTotalCents / 100)}</strong></div>
      <div className="admin-transaction-metric"><span>Enterprise-Freischaltungen</span><strong>{summary.enterpriseCount}</strong></div>
      <label className="admin-search admin-transaction-search"><span className="sr-only">Transaktionen suchen</span><Icon name="search" size={16}/><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Bereich, Splow-ID, Event oder Referenz suchen" /></label>
    </section>
    <section className="panel admin-transaction-table-wrap">
      {error ? <p className="admin-empty" role="alert">{error}</p> : loading ? <p className="admin-empty">Transaktionen werden geladen …</p> : transactions.length === 0 ? <div className="admin-transaction-empty"><span className="metric-icon"><Icon name="file" size={17}/></span><strong>{debouncedQuery ? "Keine passenden Transaktionen" : "Noch keine Transaktionen vorhanden"}</strong><p>{debouncedQuery ? "Passe den Suchbegriff an." : "Bestätigte Paketkäufe und manuelle Enterprise-Freischaltungen erscheinen hier. Die Seite liest die Zahlungsdaten aus Supabase und ist für einen späteren Zahlungsanbieter-Webhook vorbereitet."}</p></div> : <div className="admin-transaction-overflow"><table className="table admin-transactions-table table-card-list"><thead><tr><th>Datum</th><th>Veranstalterbereich</th><th>Event / Umfang</th><th>Produkt</th><th>Zahlungsweg</th><th>Status</th><th>Betrag</th><th>Referenz</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td data-label="Datum">{dateTime.format(new Date(item.date))}</td><td data-label="Veranstalterbereich"><strong>{item.organizationName}</strong><small>{item.sponsoId ?? "Keine Splow-ID"}</small></td><td data-label="Event / Umfang">{item.eventName}</td><td data-label="Produkt">{item.product}</td><td data-label="Zahlungsweg">{item.provider}</td><td data-label="Status"><span className={`admin-transaction-status ${item.kind}`}>{item.status}</span></td><td className="admin-transaction-amount" data-label="Betrag">{euro.format(item.amountCents / 100)}</td><td data-label="Referenz"><code>{item.reference || "—"}</code></td></tr>)}</tbody></table></div>}
      {!loading && !error && (transactions.length > 0 || page > 1) && <div className="admin-transaction-pagination"><button className="btn btn-secondary" type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Zurück</button><span>Seite {page} · {transactions.length} Einträge</span><button className="btn btn-secondary" type="button" disabled={!hasMore} onClick={() => setPage((current) => current + 1)}>Weiter</button></div>}
    </section>
    <p className="admin-transaction-footnote">Paketumsätze und dokumentierte Rechnungseingänge sind getrennte Datensätze. Eine Enterprise-Freischaltung wird nicht automatisch als bezahlte Rechnung gewertet.</p>
  </>;
}
