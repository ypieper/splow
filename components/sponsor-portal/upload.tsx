"use client";

import { Icon } from "@/components/ui";
import { formatPortalDate } from "@/lib/sponsor-portal/format";
import type { PortalTask } from "@/lib/sponsor-portal/types";
import { useState } from "react";
import { SponsorEvidenceHistory } from "./evidence";

export function SponsorTaskUpload({ taskId, busy, disabled, onUpload, onBrandKitSelect }: { taskId: string; busy: boolean; disabled: boolean; onUpload: (file: File) => void; onBrandKitSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<Array<{ id: string; file_name: string; label: string; content_type: string; url: string | null }>>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function showBrandKit() {
    if (open) { setOpen(false); return; }
    setOpen(true); setLoading(true); setError("");
    try {
      const response = await fetch(`/api/sponsor/brand-kit?taskId=${encodeURIComponent(taskId)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Das Brand-Kit konnte nicht geladen werden.");
      setFiles(result.files ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Das Brand-Kit konnte nicht geladen werden."); }
    finally { setLoading(false); }
  }
  const selectedFile = files.find((file) => file.id === selected);
  return <div className="sponsor-task-upload-options"><div><label className="btn btn-primary sponsor-task-upload-button"><Icon name="file" size={14}/>{busy ? "Wird hochgeladen …" : "Datei hochladen"}<input type="file" accept="image/jpeg,image/png,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" hidden disabled={disabled || busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onUpload(file); }}/></label><button className="btn" type="button" disabled={disabled || busy} onClick={() => void showBrandKit()}>Aus Brand-Kit auswählen</button></div>
    {open && <div className="sponsor-task-brand-kit-picker" role="group" aria-label="Datei aus Brand-Kit auswählen">
      {loading ? <small>Brand-Kit wird geladen …</small> : error ? <small className="field-message error">{error}</small> : files.length ? <>
        <label className="sponsor-task-brand-kit-select"><span>Bezeichnung der Datei</span><select value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}><option value="">Bezeichnung wählen …</option>{files.map((file) => <option key={file.id} value={file.id}>{file.label}</option>)}</select></label>
        {selectedFile && <div className="sponsor-task-brand-kit-preview">
          <small>Dateiname: {selectedFile.file_name}</small>
          {selectedFile.url && <a href={selectedFile.url} target="_blank" rel="noreferrer">Datei vorab ansehen</a>}
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => { if (window.confirm(`„${selectedFile.label}“ als Nachweis für diese Aufgabe einreichen?`)) onBrandKitSelect(selectedFile.id); }}>{busy ? "Wird eingereicht …" : "Auswahl bestätigen und einreichen"}</button>
        </div>}
      </> : <small>Im Brand-Kit sind noch keine Dateien vorhanden. Du kannst zuerst eine Datei direkt hochladen.</small>}
    </div>}
  </div>;
}

export function SponsorUploadTaskCard({ task, benefitName, busy, disabled, onUpload, onBrandKitSelect }: { task: Pick<PortalTask, "id" | "title" | "due_at" | "status" | "ready" | "blocked_by" | "files">; benefitName?: string; busy: boolean; disabled: boolean; onUpload: (file: File) => void; onBrandKitSelect: (id: string) => void }) {
  const done = task.status === "Erledigt";
  const inProgress = task.status === "In Bearbeitung";
  return <article className="sponsor-portal-benefit-task sponsor-portal-approval-card sponsor-portal-manual-approval sponsor-portal-upload-card">
    <div className="sponsor-portal-approval-placeholder" aria-hidden="true"><Icon name="file" size={25}/><span>Upload</span></div>
    <div className="sponsor-portal-approval-content">
      <header><div className="sponsor-portal-review-copy"><span className="sponsor-portal-approval-eyebrow">Datei vom Sponsor</span><b>{task.title}</b><small>{task.due_at ? `Fällig am ${formatPortalDate(task.due_at)}` : "Bitte lade den vereinbarten Nachweis hoch."}</small>{benefitName && <small className="sponsor-portal-task-benefit-label">Leistung: {benefitName}</small>}</div><span className={`sponsor-benefit-status sponsor-benefit-status-${done ? "done" : inProgress ? "progress" : "open"}`}>{done ? "Abgeschlossen" : inProgress ? "In Bearbeitung" : "Upload offen"}</span></header>
      <div className="sponsor-portal-review-footer">{done ? task.files.length ? <SponsorEvidenceHistory files={task.files} disabled={disabled}/> : <small className="sponsor-portal-unit-wait">Nachweis hochgeladen</small> : task.ready ? <SponsorTaskUpload taskId={task.id} busy={busy} disabled={disabled} onUpload={onUpload} onBrandKitSelect={onBrandKitSelect}/> : <small className="sponsor-portal-unit-wait">{task.blocked_by ? `Wird nach Abschluss von „${task.blocked_by}“ freigeschaltet.` : "Wird nach dem vorherigen Schritt freigeschaltet."}</small>}</div>
    </div>
  </article>;
}
