"use client";

import { Modal } from "@/components/modal";
import { Icon } from "@/components/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
type PartnerReferral = { id: string; organization_id: string | null; organization_name_snapshot: string | null; sponso_id_snapshot: string | null; registered_at: string; organization_created_at: string | null };
type Partner = { id: string; user_id: string; referral_code: string; is_active: boolean; email: string; firstName: string; lastName: string; referrals: PartnerReferral[]; commissions: { status: string; commission_amount_cents: number }[]; payouts: { amount_cents: number }[] };
const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export function AdminPartners() {
  const [partners,setPartners]=useState<Partner[]>([]); const [email,setEmail]=useState(""); const [busy,setBusy]=useState(false); const [deletingId,setDeletingId]=useState<string|null>(null); const [message,setMessage]=useState(""); const [selectedPartner,setSelectedPartner]=useState<Partner|null>(null); const [tableQuery,setTableQuery]=useState("");
  const load=useCallback(async()=>{ const r=await fetch("/api/admin/partners",{cache:"no-store"}); const d=await r.json(); if(!r.ok) throw new Error(d.error); setPartners(d.partners??[]); },[]);
  useEffect(()=>{ void load().catch(e=>setMessage(e.message)); },[load]);
  const filteredPartners=useMemo(()=>{const needle=tableQuery.trim().toLocaleLowerCase("de-DE");if(!needle)return partners;return partners.filter(partner=>[partner.firstName,partner.lastName,partner.email,partner.referral_code,...partner.referrals.flatMap(referral=>[referral.organization_name_snapshot,referral.sponso_id_snapshot])].some(value=>value?.toLocaleLowerCase("de-DE").includes(needle)));},[partners,tableQuery]);
  async function create(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage("");try{const r=await fetch("/api/admin/partners",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});const d=await r.json();if(!r.ok)throw new Error(d.error);setEmail("");setMessage(`Vertriebspartner angelegt. Referral-Code: ${d.partner.referral_code}`);await load();}catch(e){setMessage(e instanceof Error?e.message:"Partner konnte nicht angelegt werden.");}finally{setBusy(false);}}
  async function active(p:Partner){const r=await fetch(`/api/admin/partners/${p.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({isActive:!p.is_active})});const d=await r.json();if(!r.ok){setMessage(d.error);return;}await load();}
  async function remove(p:Partner){
    if(!window.confirm(`Vertriebspartner ${[p.firstName,p.lastName].filter(Boolean).join(" ")||p.email} wirklich löschen? Der Splow-Login bleibt bestehen. Referral-Zuordnungen werden entfernt; abgeschlossene Provisionen und Auszahlungen bleiben als Verlauf erhalten. Offene Provisionen müssen zuerst geklärt werden.`))return;
    setDeletingId(p.id);setMessage("");
    try{const r=await fetch(`/api/admin/partners/${p.id}`,{method:"DELETE"});const d=await r.json();if(!r.ok)throw new Error(d.error);setMessage("Vertriebspartner gelöscht. Der Splow-Login und abgeschlossene Abrechnungsnachweise bleiben erhalten.");await load();}
    catch(e){setMessage(e instanceof Error?e.message:"Vertriebspartner konnte nicht gelöscht werden.");}
    finally{setDeletingId(null);}
  }
  return <>
    <section className="panel admin-toolbar"><div><strong>Vertriebspartner</strong><p>Jedes Partnerkonto erhält einen dauerhaften Referral-Code.</p></div><a className="btn" href="/downloads/splow-muster-vertriebspartnervereinbarung.pdf" download>Muster-Vereinbarung herunterladen</a></section>
    <form className="panel partner-create-form" onSubmit={create}>
      <label className="settings-field"><span>E-Mail eines bestehenden Splow-Kontos</span><input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@beispiel.de" /></label>
      <button className="btn btn-primary" disabled={busy}>{busy ? "Wird angelegt …" : "Partner hinzufügen"}</button>
    </form>
    {message && <p className="admin-feedback" role="status">{message}</p>}
    <section className="panel partner-admin-list">
      <div className="panel-heading admin-searchable-table-heading"><div><h2>Vertriebspartner</h2><p>{filteredPartners.length} von {partners.length} Partnern · Suche nach Name, E-Mail, Referral-Code oder zugeordnetem Bereich.</p></div><label className="admin-search admin-table-search"><span className="sr-only">Vertriebspartner suchen</span><Icon name="search" size={16}/><input value={tableQuery} onChange={event=>setTableQuery(event.target.value)} placeholder="Name, E-Mail, Code oder Bereich suchen"/></label></div>
      {partners.length === 0 ? <p className="admin-empty">Noch keine Vertriebspartner angelegt.</p> : filteredPartners.length===0 ? <p className="admin-empty">Keine Vertriebspartner für diese Suche gefunden.</p> : filteredPartners.map(p => <article className="partner-admin-row" key={p.id}>
        <div className="partner-admin-identity"><strong>{[p.firstName, p.lastName].filter(Boolean).join(" ") || p.email}</strong><small>{p.email}</small><code>Referral-Code: {p.referral_code}</code></div>
        <div className="partner-admin-metrics"><button className="btn partner-referrals-button" type="button" onClick={() => setSelectedPartner(p)}>{p.referrals.filter(referral => referral.organization_id).length} Bereiche anzeigen</button><span>{eur.format(p.commissions.filter(c => c.status !== "void").reduce((s, c) => s + c.commission_amount_cents, 0) / 100)} Provisionen</span></div>
        <div className="partner-link-copy"><code>{typeof window !== "undefined" ? `${window.location.origin}/r/${p.referral_code}` : "/r/…"}</code><button className="btn" type="button" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/r/${p.referral_code}`)}><Icon name="file" size={14}/>Link kopieren</button></div>
        <div className="partner-admin-actions"><span className={`admin-access-badge ${p.is_active ? "active" : "suspended"}`}>{p.is_active ? "Aktiv" : "Inaktiv"}</span><button className="btn" type="button" onClick={() => void active(p)}>{p.is_active ? "Deaktivieren" : "Aktivieren"}</button><button className="btn btn-danger" type="button" disabled={deletingId===p.id} onClick={() => void remove(p)}>{deletingId===p.id?"Wird gelöscht …":"Löschen"}</button></div>
        <PartnerOverrideEditor partnerId={p.id}/>
      </article>)}
    </section>
    {selectedPartner && <Modal labelledBy="partner-referrals-heading" className="panel admin-delete-dialog partner-referrals-dialog" backdropClassName="admin-delete-overlay" role="dialog" onClose={() => setSelectedPartner(null)}><button className="icon-button admin-delete-close" type="button" aria-label="Dialog schließen" onClick={() => setSelectedPartner(null)}><Icon name="close" size={16}/></button><span className="eyebrow">VERTRIEBSPARTNER</span><h2 id="partner-referrals-heading">Zugeordnete Veranstalterbereiche</h2><p>{[selectedPartner.firstName, selectedPartner.lastName].filter(Boolean).join(" ") || selectedPartner.email} · {selectedPartner.referral_code}</p>{selectedPartner.referrals.filter(referral => referral.organization_id).length === 0 ? <p className="admin-empty">Diesem Vertriebspartner sind noch keine Veranstalterbereiche zugeordnet.</p> : <div className="partner-referral-modal-list">{selectedPartner.referrals.filter(referral => referral.organization_id).map(referral => <article className="partner-referral-row" key={referral.id}><div><strong>{referral.organization_name_snapshot || "Veranstalterbereich"}</strong><small>{referral.sponso_id_snapshot || "Splow-ID nicht verfügbar"}</small></div><span>{referral.organization_created_at ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(referral.organization_created_at)) : "Bereich zugeordnet"}</span></article>)}</div>}</Modal>}
  </>;
}

function PartnerOverrideEditor({partnerId}:{partnerId:string}) {
 const[product,setProduct]=useState("all_events");const[model,setModel]=useState("percentage");const[value,setValue]=useState("");const[message,setMessage]=useState("");
 async function save(e:React.FormEvent){e.preventDefault();const r=await fetch(`/api/admin/partners/${partnerId}/commission-override`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productCode:product,model,value:Number(value)})});const d=await r.json();setMessage(r.ok?"Individueller Satz gespeichert.":d.error);}
 return <details className="partner-override"><summary>Abweichender Provisionssatz</summary><form onSubmit={save}><select aria-label="Produkt auswählen" value={product} onChange={e=>setProduct(e.target.value)}><option value="all_events">Alle Event-Tarife</option><option value="contracts_5">Starter</option><option value="contracts_7">Plus</option><option value="contracts_10">Pro</option><option value="contracts_15">Event</option><option value="enterprise">Enterprise</option></select><select aria-label="Modell auswählen" value={model} onChange={e=>setModel(e.target.value)}><option value="percentage">Prozent</option><option value="fixed">Festbetrag (€)</option></select><input aria-label="Provisionssatz" type="number" min="0.01" step="0.01" required value={value} onChange={e=>setValue(e.target.value)}/><button className="btn" type="submit">Speichern</button>{message&&<small role="status">{message}</small>}</form></details>;
}
