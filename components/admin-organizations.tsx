"use client";

import { Modal } from "@/components/modal";
import { Icon } from "@/components/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

type OrganizerArea = {
  id: string;
  name: string;
  sponsoId: string;
  createdAt: string;
  memberCount: number;
  owners: { name: string; email: string }[];
  salesPartner: { name: string; email: string; referralCode: string } | null;
};
type PendingDeletion = { id: string; organization_id: string; organization_name: string; sponso_id: string; created_at: string };

const confirmationPhrase = "VERANSTALTERBEREICH LÖSCHEN";
const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

export function AdminOrganizations() {
  const [organizations, setOrganizations] = useState<OrganizerArea[]>([]);
  const [pendingDeletions, setPendingDeletions] = useState<PendingDeletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<OrganizerArea | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryingJob, setRetryingJob] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const [tableQuery, setTableQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/organizations", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Veranstalterbereiche konnten nicht geladen werden.");
      setOrganizations(result.organizations ?? []);
      setPendingDeletions(result.pendingDeletions ?? []);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Veranstalterbereiche konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredOrganizations = useMemo(() => {
    const needle = tableQuery.trim().toLocaleLowerCase("de-DE");
    if (!needle) return organizations;
    return organizations.filter((organization) => [organization.name, organization.sponsoId, ...organization.owners.flatMap((owner) => [owner.name, owner.email]), organization.salesPartner?.name, organization.salesPartner?.email, organization.salesPartner?.referralCode].some((value) => value?.toLocaleLowerCase("de-DE").includes(needle)));
  }, [organizations, tableQuery]);

  function closeDialog() {
    if (busy) return;
    setDeleteTarget(null);
    setConfirmation("");
    setActionError("");
  }

  async function deleteOrganization() {
    if (!deleteTarget || confirmation !== confirmationPhrase || busy) return;
    setBusy(true);
    setActionError("");
    setFeedback("");
    try {
      const response = await fetch("/api/admin/organizations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: deleteTarget.id, confirmationPhrase: confirmation }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Der Veranstalterbereich konnte nicht gelöscht werden.");
      setFeedback(result.softDeletedUserCount > 0
        ? `„${deleteTarget.name}“ und die Bereichsdaten wurden gelöscht. ${result.softDeletedUserCount} Benutzerkonto(en) wurden aus technischen Gründen anonymisiert und deaktiviert.`
        : `„${deleteTarget.name}“ und die zugehörigen Bereichsdaten wurden gelöscht.`);
      setDeleteTarget(null);
      setConfirmation("");
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Der Veranstalterbereich konnte nicht gelöscht werden.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function retryDeletion(job: PendingDeletion) {
    if (retryingJob) return;
    setRetryingJob(job.id);
    setActionError("");
    setFeedback("");
    try {
      const response = await fetch("/api/admin/organizations/deletion-jobs/" + job.id, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Die Bereinigung ist noch nicht abgeschlossen.");
      setFeedback(result.softDeletedUserCount > 0
        ? `Die Löschung von „${job.organization_name}“ wurde abgeschlossen. ${result.softDeletedUserCount} Benutzerkonto(en) wurden aus technischen Gründen anonymisiert und deaktiviert.`
        : `Die Löschung von „${job.organization_name}“ wurde vollständig abgeschlossen.`);
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Die Bereinigung ist noch nicht abgeschlossen.");
      await load();
    } finally {
      setRetryingJob(null);
    }
  }

  return <>
      {feedback && <p className="admin-feedback" role="status">{feedback}</p>}
      {actionError && !deleteTarget && <p className="field-message error" role="alert">{actionError}</p>}
      {pendingDeletions.length > 0 && <section className="panel admin-pending-deletions"><div><h2>Ausstehende Bereinigungen</h2><p>Der Veranstalterbereich wurde bereits entfernt. Dateien und Benutzerkonten werden noch fertig bereinigt.</p></div>{pendingDeletions.map((job) => <div className="admin-pending-deletion-row" key={job.id}><div><strong>{job.organization_name}</strong><small>{job.sponso_id} · gestartet am {dateFormat.format(new Date(job.created_at))}</small></div><button className="btn" type="button" disabled={retryingJob === job.id} onClick={() => void retryDeletion(job)}><Icon name="refresh" size={14}/>{retryingJob === job.id ? "Wird fortgesetzt …" : "Löschung fortsetzen"}</button></div>)}</section>}
      <section className="panel admin-organization-panel">
        <div className="panel-heading admin-searchable-table-heading"><div><h2>Alle Veranstalterbereiche</h2><p>{filteredOrganizations.length} von {organizations.length} Bereichen · Suche nach Name, Splow-ID, Inhaber oder Vertriebspartner.</p></div><div className="admin-table-heading-actions"><label className="admin-search admin-table-search"><span className="sr-only">Veranstalterbereiche suchen</span><Icon name="search" size={16}/><input value={tableQuery} onChange={(event) => setTableQuery(event.target.value)} placeholder="Name, Splow-ID oder Partner suchen"/></label><button className="btn" type="button" onClick={() => void load()} disabled={loading}><Icon name="refresh" size={14}/>Aktualisieren</button></div></div>
        {loading ? <p className="task-empty">Veranstalterbereiche werden geladen …</p>
          : loadError ? <p className="field-message error" role="alert">{loadError}</p>
          : organizations.length === 0 ? <p className="task-empty">Es sind keine Veranstalterbereiche vorhanden.</p>
            : filteredOrganizations.length === 0 ? <p className="task-empty">Keine Veranstalterbereiche für diese Suche gefunden.</p>
              : <div className="admin-organizations-table-wrap"><table className="table admin-organizations-table table-card-list">
                <thead><tr><th>VERANSTALTERBEREICH</th><th>SPLOW-ID</th><th>INHABER</th><th>VERTRIEBSPARTNER</th><th>MITGLIEDER</th><th>ERSTELLT</th><th>AKTION</th></tr></thead>
                <tbody>{filteredOrganizations.map((organization) => <tr key={organization.id}>
                  <td data-label="Veranstalterbereich"><strong>{organization.name}</strong></td>
                  <td data-label="Splow-ID"><code className="admin-organization-id">{organization.sponsoId}</code></td>
                  <td data-label="Inhaber"><div className="admin-organization-owners">{organization.owners.length ? organization.owners.map((owner) => <span key={owner.email + "-" + owner.name}><strong>{owner.name}</strong><small>{owner.email || "E-Mail nicht hinterlegt"}</small></span>) : <span>Kein Inhaber hinterlegt</span>}</div></td>
                  <td data-label="Vertriebspartner">{organization.salesPartner ? <div className="admin-organization-owners"><span><strong>{organization.salesPartner.name}</strong><small>{organization.salesPartner.email || "E-Mail nicht hinterlegt"}</small><small>Code: {organization.salesPartner.referralCode}</small></span></div> : <span>—</span>}</td>
                  <td data-label="Mitglieder">{organization.memberCount}</td>
                  <td data-label="Erstellt">{dateFormat.format(new Date(organization.createdAt))}</td>
                  <td data-label="Aktion"><button className="btn btn-danger-soft admin-organization-delete" type="button" aria-label={organization.name + " löschen"} onClick={() => { setDeleteTarget(organization); setConfirmation(""); setActionError(""); }}><Icon name="trash" size={14}/>Löschen</button></td>
                </tr>)}</tbody>
              </table></div>}
      </section>
    {deleteTarget && <Modal labelledBy="delete-organization-heading" describedBy="delete-organization-description" className="panel admin-delete-dialog admin-organization-delete-dialog" backdropClassName="admin-delete-overlay" role="alertdialog" busy={busy} onClose={closeDialog}>
      <button className="icon-button admin-delete-close" type="button" aria-label="Dialog schließen" disabled={busy} onClick={closeDialog}><Icon name="close" size={16}/></button>
      <span className="eyebrow">UNWIDERRUFLICHE LÖSCHUNG</span>
      <h2 id="delete-organization-heading">Veranstalterbereich endgültig löschen?</h2>
      <p id="delete-organization-description">Der Bereich <strong>{deleteTarget.name}</strong> mit der Splow-ID <strong>{deleteTarget.sponsoId}</strong> wird einschließlich Events, Sponsoren, Verträgen, Aufgaben, Nachweisen, Dateien und Mitgliedschaften dauerhaft gelöscht. Zugehörige Mitgliederkonten werden ebenfalls entfernt. Globale Plattform-Admins behalten ihr Admin-Konto; ihre Bereichszuordnung wird aufgehoben.</p>
      <label className="settings-field admin-delete-phrase"><span>Gib zur Bestätigung exakt <b>{confirmationPhrase}</b> ein.</span><input autoComplete="off" spellCheck={false} value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (confirmation === confirmationPhrase) void deleteOrganization(); } }} /></label>
      {actionError && <p className="field-message error" role="alert">{actionError}</p>}
      <div className="admin-delete-actions"><button className="btn" type="button" disabled={busy} onClick={closeDialog}>Abbrechen</button><button className="btn btn-danger-soft" type="button" disabled={busy || confirmation !== confirmationPhrase} onClick={() => void deleteOrganization()}><Icon name="trash" size={14}/>{busy ? "Wird gelöscht …" : "Bereich und Konten löschen"}</button></div>
    </Modal>}
  </>;
}
