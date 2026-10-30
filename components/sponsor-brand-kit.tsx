"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon, SplowLogo } from "@/components/ui";
import { LogoutButton } from "@/components/logout-button";
import { formatSponsorFileSize, getSponsorFileTypeLabel } from "@/lib/sponsor-file-labels";

type BrandFile = { id: string; account_id: string; file_name: string; label: string; content_type: string; size_bytes: number; created_at: string; url: string | null };
type BrandAccount = { id: string; name: string };

export function SponsorBrandKit() {
  const [files, setFiles] = useState<BrandFile[]>([]);
  const [accounts, setAccounts] = useState<BrandAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [uploadLabel, setUploadLabel] = useState("");
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/sponsor/brand-kit", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Das Brand-Kit konnte nicht geladen werden.");
      setFiles(result.files ?? []);
      setAccounts(result.accounts ?? []);
      setAccountId((current) => current || result.accounts?.[0]?.id || "");
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Das Brand-Kit konnte nicht geladen werden."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const form = new FormData(); form.set("file", file); form.set("label", uploadLabel); if (accountId) form.set("accountId", accountId);
      const response = await fetch("/api/sponsor/brand-kit", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Die Datei konnte nicht gespeichert werden.");
      setMessage("Die Datei wurde im Brand-Kit gespeichert.");
      setUploadLabel("");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Die Datei konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  async function saveLabel(file: BrandFile) {
    const label = (labelEdits[file.id] ?? file.label).trim();
    if (!label || label.length > 100 || busy) { setError("Bitte gib ein Label mit höchstens 100 Zeichen ein."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/sponsor/brand-kit", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: file.id, label }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Das Label konnte nicht gespeichert werden.");
      setFiles((current) => current.map((item) => item.id === file.id ? { ...item, label } : item));
      setLabelEdits((current) => { const next = { ...current }; delete next[file.id]; return next; });
      setEditingLabelId(null);
      setMessage("Das Label wurde gespeichert.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Das Label konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  function startLabelEdit(file: BrandFile) {
    setLabelEdits((current) => ({ ...current, [file.id]: file.label }));
    setEditingLabelId(file.id);
    setError("");
    setMessage("");
  }

  function cancelLabelEdit(file: BrandFile) {
    setLabelEdits((current) => { const next = { ...current }; delete next[file.id]; return next; });
    setEditingLabelId(null);
    setError("");
  }

  async function remove(file: BrandFile) {
    if (busy || !window.confirm(`„${file.file_name}“ aus dem Brand-Kit entfernen? Bereits eingereichte Nachweise bleiben erhalten.`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/sponsor/brand-kit?id=${encodeURIComponent(file.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Die Datei konnte nicht entfernt werden.");
      setMessage("Die Datei wurde aus dem Brand-Kit entfernt.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Die Datei konnte nicht entfernt werden."); }
    finally { setBusy(false); }
  }

  return <main className="sponsor-portal-page"><header className="sponsor-portal-header"><Link href="/sponsor" className="brand" aria-label="Sponsor-Bereich"><SplowLogo /></Link><nav className="sponsor-portal-main-nav" aria-label="Hauptnavigation"><Link href="/sponsor">Dashboard</Link><Link href="/sponsor/events">Events</Link><Link href="/sponsor/brand-kit" className="active" aria-current="page">Brand-Kit</Link></nav><div><span className="sponsor-portal-header-caption">Sponsorportal</span><LogoutButton /></div></header>
    <section className="sponsor-portal-content sponsor-brand-kit-page"><Link className="sponsor-portal-back-link" href="/sponsor">← Meine Events</Link><div className="eyebrow">DEINE MARKENMATERIALIEN</div><h1>Brand-Kit</h1><p className="subtitle">Lade Logos und andere Dateien einmal hoch und nutze sie bei Aufgaben für verschiedene Events.</p>
      {error && <p className="field-message error" role="alert">{error}</p>}{message && <p className="field-message success" role="status">{message}</p>}
      <section className="panel sponsor-brand-kit-panel"><header><div><h2>Deine Dateien</h2><p>Nur du und Mitglieder deines Sponsor-Kontos können diese Dateien sehen. Veranstalter erhalten Zugriff, wenn du eine Datei als Aufgabennachweis einreichst.</p>{accounts.length > 1 && <label className="sponsor-brand-kit-account"><span>Sponsor-Konto</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}</div></header>
        <div className="sponsor-brand-kit-upload"><label><span>Label für die Datei</span><input value={uploadLabel} maxLength={100} onChange={(event) => setUploadLabel(event.target.value)} placeholder="z. B. Hauptlogo, Logo weiß oder Website-Banner" /></label><button className="btn btn-primary" type="button" disabled={busy || !accounts.length || !uploadLabel.trim()} onClick={() => inputRef.current?.click()}><Icon name="file" size={14}/>{busy ? "Wird gespeichert …" : "Datei auswählen und hinzufügen"}</button><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" hidden disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }}/></div>
        {loading ? <p className="task-empty">Brand-Kit wird geladen …</p> : files.filter((file) => !accountId || file.account_id === accountId).length ? <div className="sponsor-brand-kit-list">{files.filter((file) => !accountId || file.account_id === accountId).map((file) => {
          const isEditingLabel = editingLabelId === file.id;
          return <article className="sponsor-brand-kit-file" key={file.id}>
            <span className="settings-section-icon"><Icon name="file" size={16}/></span>
            <div className="sponsor-brand-kit-file-main">
              {isEditingLabel ? <label className="sponsor-brand-kit-edit-label"><span>Label bearbeiten</span><input autoFocus aria-label={`Label für ${file.file_name}`} value={labelEdits[file.id] ?? file.label} maxLength={100} onChange={(event) => setLabelEdits((current) => ({ ...current, [file.id]: event.target.value }))}/></label> : <strong className="sponsor-brand-kit-file-label">{file.label}</strong>}
              <small>Dateiname: {file.file_name} · {getSponsorFileTypeLabel(file.file_name)} · {formatSponsorFileSize(Number(file.size_bytes))}</small>
            </div>
            <div className="sponsor-brand-kit-actions">
              {file.url && <a className="btn" href={file.url} target="_blank" rel="noreferrer">Ansehen</a>}
              {isEditingLabel ? <>
                <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void saveLabel(file)}>Speichern</button>
                <button className="btn" type="button" disabled={busy} onClick={() => cancelLabelEdit(file)}>Abbrechen</button>
              </> : <>
                <button className="btn" type="button" disabled={busy} onClick={() => startLabelEdit(file)}>Bearbeiten</button>
                <button className="btn" type="button" disabled={busy} onClick={() => void remove(file)}>Entfernen</button>
              </>}
            </div>
          </article>;
        })}</div> : <div className="sponsor-brand-kit-empty"><h3>Noch keine Dateien im Brand-Kit</h3><p>Füge zum Beispiel dein Logo oder ein Banner hinzu. Bei passenden Aufgaben kannst du die Datei direkt aus dem Brand-Kit auswählen.</p></div>}
      </section>
    </section>
  </main>;
}
