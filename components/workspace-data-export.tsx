"use client";

import { useState } from "react";
import PizZip from "pizzip";
import { Icon } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type ExportRow = Record<string, unknown>;
type ExportQuery = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
type ExportFile = { storagePath: string; name: string; contentType: string; source: string };
const tableOrderColumn: Record<string, string> = {
  organizations: "id",
  organization_members: "user_id",
  organization_settings: "organization_id",
  events: "id",
  sponsors: "id",
  event_sponsors: "sponsor_id",
  contracts: "id",
  benefits: "id",
  tasks: "id",
  evidence_files: "id",
  benefit_templates: "id",
  organization_benefit_categories: "id",
  contract_templates: "id",
  event_contract_templates: "event_id",
  contract_documents: "id",
  contract_reports: "contract_id",
  event_plans: "code",
  event_entitlements: "event_id",
  organization_entitlements: "organization_id",
};

async function loadAllRows(makeQuery: (start: number, end: number) => ExportQuery) {
  const rows: ExportRow[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await makeQuery(start, start + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as ExportRow[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function getString(row: ExportRow, key: string) {
  return typeof row[key] === "string" ? row[key] as string : "";
}

function safeFilename(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "veranstalterbereich";
}

export function WorkspaceDataExport() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function exportWorkspace() {
    if (busy || !isSupabaseConfigured) return;
    setBusy(true);
    setError(false);
    setMessage("Veranstalterdaten werden zusammengestellt …");

    try {
      const supabase = createClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error("Dein Konto konnte nicht geprüft werden. Bitte melde dich erneut an.");
      const { data: organizationId, error: organizationError } = await supabase.rpc("current_organization_id");
      if (organizationError || typeof organizationId !== "string") throw new Error("Dein Veranstalterbereich konnte nicht ermittelt werden.");

      const byOrganization = (table: string) => (start: number, end: number) => supabase.from(table).select("*").eq("organization_id", organizationId).order(tableOrderColumn[table]).range(start, end);
      const byEvents = (table: string, eventIds: string[]) => (start: number, end: number) => supabase.from(table).select("*").in("event_id", eventIds).order(tableOrderColumn[table]).range(start, end);

      const [organization, members, settings, events, sponsors, benefitTemplates, benefitCategories, contractTemplates, enterpriseEntitlement, plans] = await Promise.all([
        loadAllRows((start, end) => supabase.from("organizations").select("*").eq("id", organizationId).order("id").range(start, end)),
        loadAllRows(byOrganization("organization_members")),
        loadAllRows(byOrganization("organization_settings")),
        loadAllRows(byOrganization("events")),
        loadAllRows(byOrganization("sponsors")),
        loadAllRows(byOrganization("benefit_templates")),
        loadAllRows(byOrganization("organization_benefit_categories")),
        loadAllRows(byOrganization("contract_templates")),
        loadAllRows(byOrganization("organization_entitlements")),
        loadAllRows((start, end) => supabase.from("event_plans").select("*").order("code").range(start, end)),
      ]);

      const eventIds = events.map((event) => getString(event, "id"));
      const relatedTables = eventIds.length ? await Promise.all([
        loadAllRows(byEvents("event_sponsors", eventIds)),
        loadAllRows(byEvents("contracts", eventIds)),
        loadAllRows(byEvents("benefits", eventIds)),
        loadAllRows(byEvents("tasks", eventIds)),
        loadAllRows(byEvents("evidence_files", eventIds)),
        loadAllRows(byEvents("event_contract_templates", eventIds)),
        loadAllRows(byEvents("event_entitlements", eventIds)),
      ]) : [[], [], [], [], [], [], []] as ExportRow[][];
      const [eventSponsors, contracts, benefits, tasks, evidenceFiles, eventContractTemplates, eventEntitlements] = relatedTables;
      const [contractDocuments, contractReports] = await Promise.all([
        loadAllRows(byOrganization("contract_documents")),
        loadAllRows(byOrganization("contract_reports")),
      ]);

      const tables: Record<string, ExportRow[]> = {
        organizations: organization,
        organization_members: members,
        organization_settings: settings,
        events,
        sponsors,
        event_sponsors: eventSponsors,
        contracts,
        benefits,
        tasks,
        evidence_files: evidenceFiles,
        benefit_templates: benefitTemplates,
        organization_benefit_categories: benefitCategories,
        contract_templates: contractTemplates,
        event_contract_templates: eventContractTemplates,
        contract_documents: contractDocuments,
        contract_reports: contractReports,
        event_plans: plans,
        event_entitlements: eventEntitlements,
        organization_entitlements: enterpriseEntitlement,
      };

      const files: ExportFile[] = [
        ...evidenceFiles.map((row) => ({ storagePath: getString(row, "storage_path"), name: getString(row, "file_name"), contentType: getString(row, "content_type"), source: "evidence_files" })),
        ...contractDocuments.map((row) => ({ storagePath: getString(row, "storage_path"), name: getString(row, "file_name"), contentType: getString(row, "content_type"), source: "contract_documents" })),
        ...contractTemplates.map((row) => ({ storagePath: getString(row, "storage_path"), name: getString(row, "original_filename"), contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", source: "contract_templates" })),
      ].filter((file) => file.storagePath);
      const zip = new PizZip();
      const fileManifest: Array<Record<string, string>> = [];
      for (const [index, file] of files.entries()) {
        if (!file.storagePath.startsWith(`${organizationId}/`)) throw new Error("Eine Datei liegt außerhalb deines Veranstalterbereichs. Der Export wurde zum Schutz der Daten abgebrochen.");
        setMessage(`Dateien werden geladen … ${index + 1} von ${files.length}`);
        const { data, error: downloadError } = await supabase.storage.from("sponsorproof-files").download(file.storagePath);
        if (downloadError || !data) throw new Error(`Die Datei „${file.name || "ohne Namen"}“ konnte nicht exportiert werden.`);
        const relativePath = file.storagePath.slice(organizationId.length + 1);
        const pathParts = relativePath.split("/");
        if (pathParts.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) throw new Error("Ein Dateipfad ist ungültig. Der Export wurde zum Schutz der Daten abgebrochen.");
        const archivePath = `Dateien/${pathParts.map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/g, "_")).join("/")}`;
        zip.file(archivePath, new Uint8Array(await data.arrayBuffer()));
        fileManifest.push({ archive_path: archivePath, storage_path: file.storagePath, file_name: file.name, content_type: file.contentType, source_table: file.source });
      }

      const exportedAt = new Date().toISOString();
      const organizationName = getString(organization[0] ?? {}, "name") || "Veranstalterbereich";
      zip.file("daten.json", JSON.stringify({
        format: "sponso-workspace-export",
        version: 1,
        exported_at: exportedAt,
        organization_id: organizationId,
        account: { user_id: user.id, email: user.email ?? "", first_name: user.user_metadata?.first_name ?? "", last_name: user.user_metadata?.last_name ?? "" },
        tables,
        files: fileManifest,
      }, null, 2));
      zip.file("LESE-MICH.txt", [
        "Splow – vollständiger Datenexport",
        `Veranstalterbereich: ${organizationName}`,
        `Erstellt am: ${new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short" }).format(new Date(exportedAt))}`,
        "",
        "daten.json enthält die Datensätze und Dateizuordnungen. Der Ordner Dateien enthält die zugehörigen Nachweise, Verträge und Word-Vorlagen.",
        "Bewahre dieses Archiv sicher auf. Es enthält vertrauliche Veranstalter-, Sponsoren- und Vertragsdaten.",
      ].join("\n"));

      setMessage("Exportarchiv wird erstellt …");
      const blob = zip.generate({ type: "blob", mimeType: "application/zip", compression: "DEFLATE", compressionOptions: { level: 3 } });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Splow-export-${new Date().toISOString().slice(0, 10)}-${safeFilename(organizationName)}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage(`Export abgeschlossen: ${Object.values(tables).reduce((sum, rows) => sum + rows.length, 0)} Datensätze und ${files.length} Dateien.`);
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : "Der Datenexport konnte nicht erstellt werden.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="settings-section workspace-data-export" aria-labelledby="workspace-export-heading">
    <div className="settings-section-heading"><span className="settings-section-icon"><Icon name="download" size={16}/></span><div><h2 id="workspace-export-heading">Datenexport</h2><p>Lade Veranstalterdaten, Events, Sponsoren, Verträge und alle gespeicherten Dateien herunter.</p></div></div>
    <div className="workspace-data-export-action">
      <button className="btn btn-primary" type="button" disabled={busy || !isSupabaseConfigured} onClick={() => void exportWorkspace()}><Icon name="download" size={15}/>{busy ? "Export wird erstellt …" : "Vollständigen Export herunterladen"}</button>
      <p className={`field-message ${error ? "error" : "hint"}`} role={error ? "alert" : "status"}>{message || "Der Export enthält eine JSON-Datei mit den Daten sowie die zugehörigen Dateien als ZIP-Archiv."}</p>
    </div>
  </section>;
}
