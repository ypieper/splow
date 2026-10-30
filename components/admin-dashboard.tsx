"use client";

import { Modal } from "@/components/modal";
import { AdminActivationCodes } from "@/components/admin-activation-codes";
import { AdminCommissionRules } from "@/components/admin-commission-rules";
import { AdminCommissions } from "@/components/admin-commissions";
import { AdminContactRequests } from "@/components/admin-contact-requests";
import { AdminEnterpriseAccess } from "@/components/admin-enterprise-access";
import { AdminOrganizations } from "@/components/admin-organizations";
import { AdminPartners } from "@/components/admin-partners";
import { AdminTransactions } from "@/components/admin-transactions";
import { Icon, PageHeading } from "@/components/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

type AdminUser = {
  id: string;
  accountType: "admin" | "sponsor" | "organizer";
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string | null;
  organizationName: string;
  organizationSponsoId: string | null;
  workspaceRole: "owner" | "member" | null;
  platformAdmin: boolean;
  suspended: boolean;
  lastSignInAt: string | null;
};

export type AdminSection = "users" | "transactions" | "codes" | "enterprise" | "contacts" | "organizations" | "partners" | "commissions" | "commission-rules";

const sectionDetails: Record<AdminSection, { title: string; subtitle: string }> = {
  users: { title: "Benutzer", subtitle: "Plattformzugänge, Veranstalterrollen und Adminrechte verwalten." },
  transactions: { title: "Transaktionen", subtitle: "Paketkäufe und manuelle Enterprise-Freischaltungen nachvollziehen." },
  codes: { title: "Freischaltcodes", subtitle: "Plattformweite Codes erstellen und verwalten." },
  enterprise: { title: "Enterprise", subtitle: "Enterprise-Freischaltungen über alle Veranstalterbereiche verwalten." },
  contacts: { title: "Kontaktanfragen", subtitle: "Eingehende Anfragen an Splow verwalten." },
  organizations: { title: "Veranstalterbereiche", subtitle: "Bereiche, Splow-IDs und Inhaberschaften verwalten." },
  partners: { title: "Vertriebspartner", subtitle: "Partnerkonten, Referral-Links und Vermittlungen verwalten." },
  commissions: { title: "Provisionen", subtitle: "Bestätigte Zahlungseingänge prüfen, Provisionen freigeben und Auszahlungen dokumentieren." },
  "commission-rules": { title: "Provisionsregeln", subtitle: "Attributionsfenster und Provisionssätze zentral konfigurieren." },
};

export default function AdminPage({ section }: { section: AdminSection }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [accountTypeFilter, setAccountTypeFilter] = useState<"all" | AdminUser["accountType"]>("all");
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) {
        setConfigured(response.status !== 503);
        setIsAdmin(response.status !== 403);
        setMessage(result.error ?? "Die Benutzer konnten nicht geladen werden.");
        return;
      }
      setUsers(result.users);
      setCurrentUserId(result.currentUserId ?? "");
      setConfigured(true);
      setIsAdmin(true);
    } catch {
      setMessage("Die Benutzer konnten nicht geladen werden. Bitte versuche es erneut.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (section === "users") void loadUsers(); }, [loadUsers, section]);

  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("de-DE");
    return users.filter((user) => {
      const matchesQuery = !normalized || `${user.firstName} ${user.lastName} ${user.email} ${user.organizationName} ${user.organizationSponsoId ?? ""}`.toLocaleLowerCase("de-DE").includes(normalized);
      return matchesQuery && (accountTypeFilter === "all" || user.accountType === accountTypeFilter);
    });
  }, [accountTypeFilter, query, users]);

  async function saveUser(user: AdminUser) {
    setSaving(user.id);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: user.firstName, lastName: user.lastName, ...(user.organizationId && user.workspaceRole ? { organizationId: user.organizationId, workspaceRole: user.workspaceRole } : {}), platformAdmin: user.platformAdmin, suspended: user.suspended }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Änderungen konnten nicht gespeichert werden.");
      setMessage("Änderungen wurden gespeichert.");
      await loadUsers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Änderungen konnten nicht gespeichert werden.");
    } finally {
      setSaving(null);
    }
  }

  function updateUser(id: string, updates: Partial<AdminUser>) {
    setUsers((current) => current.map((user) => user.id === id ? { ...user, ...updates } : user));
  }

  function closeDeleteDialog() {
    if (deleting) return;
    setDeleteTarget(null);
    setDeletePhrase("");
    setDeleteConfirmed(false);
    setDeleteError("");
  }

  async function deleteUser() {
    if (!deleteTarget || deletePhrase !== "BENUTZERKONTO LÖSCHEN" || !deleteConfirmed || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/admin/users/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationPhrase: deletePhrase, confirmed: deleteConfirmed }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Das Benutzerkonto konnte nicht gelöscht werden.");
      const deletedEmail = deleteTarget.email;
      setDeleteTarget(null);
      setDeletePhrase("");
      setDeleteConfirmed(false);
      await loadUsers();
      setMessage(`Das Konto ${deletedEmail} wurde gelöscht.`);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Das Benutzerkonto konnte nicht gelöscht werden.");
    } finally {
      setDeleting(false);
    }
  }

  return <main className="content admin-content">
    <PageHeading eyebrow="PLATTFORM" title={sectionDetails[section].title} subtitle={sectionDetails[section].subtitle} />
    {section === "users" ? <>
      {!configured ? <section className="panel admin-notice"><span className="metric-icon"><Icon name="settings" size={16}/></span><div><strong>Admin-Verwaltung noch nicht eingerichtet</strong><p>Hinterlege den serverseitigen Supabase Service-Role-Key in der lokalen Umgebung und in Vercel. Der Schlüssel bleibt ausschließlich auf dem Server.</p></div></section>
        : !isAdmin ? <section className="panel admin-notice"><span className="metric-icon"><Icon name="users" size={16}/></span><div><strong>Kein Zugriff</strong><p>Dieser Bereich ist nur für plattformweite Admins verfügbar.</p></div></section>
          : <>
            <section className="panel admin-toolbar"><div><strong>{filteredUsers.length} von {users.length} Benutzerkonten</strong><p>Profil, Veranstalterrolle und Zugang zentral verwalten.</p></div><div className="admin-user-filters"><label className="admin-user-type-filter"><span className="sr-only">Kontotyp filtern</span><select value={accountTypeFilter} onChange={(event) => setAccountTypeFilter(event.target.value as typeof accountTypeFilter)}><option value="all">Alle Kontotypen</option><option value="admin">Admin</option><option value="organizer">Veranstalter</option><option value="sponsor">Sponsor</option></select></label><label className="admin-search"><span className="sr-only">Benutzer suchen</span><Icon name="users" size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, E-Mail, Veranstalter oder Splow-ID suchen" /></label></div></section>
            {message && <p className="admin-feedback" role="status">{message}</p>}
            {loading ? <section className="panel admin-empty">Benutzer werden geladen …</section> : filteredUsers.length === 0 ? <section className="panel admin-empty">Keine passenden Benutzer gefunden.</section> : <div className="panel admin-users-table-wrap"><table className="table table-card-list admin-users-table">
              <thead><tr><th>Benutzer</th><th>Kontotyp</th><th>Veranstalterbereich</th><th>Plattform-Admin</th><th>Zugang</th><th>Aktion</th></tr></thead>
              <tbody>{filteredUsers.map((user) => <tr key={user.id}>
                <td data-label="Benutzer"><div className="admin-table-identity"><div className="admin-table-name-fields"><input aria-label={`Vorname für ${user.email}`} value={user.firstName} onChange={(event) => updateUser(user.id, { firstName: event.target.value })} /><input aria-label={`Nachname für ${user.email}`} value={user.lastName} onChange={(event) => updateUser(user.id, { lastName: event.target.value })} /></div><span>{user.email}</span></div></td>
                <td data-label="Kontotyp"><span className={`admin-account-type-badge ${user.accountType}`}>{user.accountType === "admin" ? "Admin" : user.accountType === "sponsor" ? "Sponsor" : "Veranstalter"}</span></td>
                <td data-label="Veranstalterbereich"><div className="admin-table-workspace"><strong>{user.organizationName}</strong>{user.organizationId && <small className="admin-table-Splow-id">Splow-ID: {user.organizationSponsoId ?? "—"}</small>}{user.organizationId ? <select aria-label={`Veranstalterrolle für ${user.email}`} value={user.workspaceRole ?? "member"} onChange={(event) => updateUser(user.id, { workspaceRole: event.target.value as "owner" | "member" })}><option value="owner">Inhaber</option><option value="member">Mitglied</option></select> : <small>—</small>}</div></td>
                <td data-label="Plattform-Admin"><label className="admin-table-toggle"><input type="checkbox" checked={user.platformAdmin} disabled={user.id === currentUserId} onChange={(event) => updateUser(user.id, { platformAdmin: event.target.checked })} /><span>Admin</span></label></td>
                <td data-label="Zugang"><div className="admin-access-control"><span className={`admin-access-badge ${user.suspended ? "suspended" : "active"}`}>{user.suspended ? "Inaktiv" : "Aktiv"}</span><button className="admin-access-action" type="button" disabled={user.id === currentUserId || saving === user.id} aria-label={`Zugang ${user.suspended ? "aktivieren" : "inaktivieren"} für ${user.email}`} title={user.id === currentUserId ? "Das eigene Admin-Konto kann hier nicht inaktiviert werden" : "Die Änderung wird mit Speichern übernommen"} onClick={() => updateUser(user.id, { suspended: !user.suspended })}>{user.suspended ? "Aktivieren" : "Inaktivieren"}</button></div></td>
                <td data-label="Aktionen"><div className="admin-user-row-actions"><button className="btn btn-danger-soft admin-delete-user" type="button" disabled={user.id === currentUserId || deleting} aria-label={`Konto ${user.email} löschen`} title={user.id === currentUserId ? "Das eigene Admin-Konto kann hier nicht gelöscht werden" : "Benutzerkonto löschen"} onClick={() => { setDeleteTarget(user); setDeletePhrase(""); setDeleteConfirmed(false); setDeleteError(""); }}><Icon name="trash" size={13}/></button><button className="btn btn-primary admin-save-user" type="button" disabled={saving === user.id} onClick={() => void saveUser(user)}><Icon name="check" size={13}/>{saving === user.id ? "Speichert …" : "Speichern"}</button></div></td>
              </tr>)}</tbody>
            </table></div>}
          </>}
    </> : section === "transactions" ? <AdminTransactions/> : section === "codes" ? <AdminActivationCodes/> : section === "enterprise" ? <AdminEnterpriseAccess/> : section === "contacts" ? <AdminContactRequests/> : section === "organizations" ? <AdminOrganizations/> : section === "partners" ? <AdminPartners/> : section === "commissions" ? <AdminCommissions/> : <AdminCommissionRules/>}
    {deleteTarget && <Modal labelledBy="admin-delete-heading" describedBy="admin-delete-description" className="panel admin-delete-dialog" backdropClassName="admin-delete-overlay" role="alertdialog" busy={deleting} onClose={closeDeleteDialog}><button className="icon-button admin-delete-close" type="button" aria-label="Dialog schließen" disabled={deleting} onClick={closeDeleteDialog}><Icon name="close" size={16}/></button><span className="eyebrow">BENUTZERKONTO ENTFERNEN</span><h2 id="admin-delete-heading">Konto dauerhaft löschen?</h2><p id="admin-delete-description">Das Konto <strong>{deleteTarget.email}</strong> und seine Anmeldedaten werden unwiderruflich entfernt. Veranstalterdaten bleiben für die übrigen Mitglieder bestehen. Ein Konto kann nicht gelöscht werden, wenn dadurch der letzte Inhaber oder der letzte Plattform-Admin wegfällt.</p><label className="settings-field admin-delete-phrase"><span>Zur Bestätigung gib <b>BENUTZERKONTO LÖSCHEN</b> ein.</span><input autoComplete="off" spellCheck={false} value={deletePhrase} disabled={deleting} onChange={(event) => setDeletePhrase(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} /></label><label className="account-delete-check"><input type="checkbox" checked={deleteConfirmed} disabled={deleting} onChange={(event) => setDeleteConfirmed(event.target.checked)} /><span>Ich bestätige, dass das Konto unwiderruflich gelöscht werden soll.</span></label>{deleteError && <p className="field-message error" role="alert">{deleteError}</p>}<div className="admin-delete-actions"><button className="btn" type="button" disabled={deleting} onClick={closeDeleteDialog}>Abbrechen</button><button className="btn btn-danger-soft" type="button" disabled={deleting || deletePhrase !== "BENUTZERKONTO LÖSCHEN" || !deleteConfirmed} onClick={() => void deleteUser()}><Icon name="trash" size={14}/>{deleting ? "Wird gelöscht …" : "Konto löschen"}</button></div></Modal>}
  </main>;
}
