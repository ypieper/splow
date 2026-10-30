"use client";

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Icon } from "@/components/ui";
import { contractTemplatePlaceholders } from "@/lib/contract-template-placeholders";
import { createClient } from "@/lib/supabase/client";

type EventOption = { id: string; title: string; start_date: string | null; end_date: string | null };
type ContractTemplate = { id: string; name: string; original_filename: string; storage_path: string; created_at: string };

function readableError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Die Vertragsvorlagen konnten nicht geladen werden.";
}

export function ContractTemplateSettings() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [selectedByTemplate, setSelectedByTemplate] = useState<Record<string, string[]>>({});
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setReady(false);
    try {
      const supabase = createClient();
      const [eventResult, templateResult, assignmentResult] = await Promise.all([
        supabase.from("events").select("id, title, start_date, end_date").order("start_date", { ascending: false }),
        supabase.from("contract_templates").select("id, name, original_filename, storage_path, created_at").order("created_at", { ascending: false }),
        supabase.from("event_contract_templates").select("event_id, template_id"),
      ]);
      const firstError = eventResult.error ?? templateResult.error ?? assignmentResult.error;
      if (firstError) throw firstError;
      const nextEvents = (eventResult.data ?? []) as EventOption[];
      const nextTemplates = (templateResult.data ?? []) as ContractTemplate[];
      const nextAssignments = Object.fromEntries((assignmentResult.data ?? []).map((row) => [row.event_id, row.template_id]));
      setEvents(nextEvents);
      setTemplates(nextTemplates);
      setAssignments(nextAssignments);
      setSelectedByTemplate(Object.fromEntries(nextTemplates.map((template) => [
        template.id,
        Object.entries(nextAssignments)
          .filter(([, assignedTemplateId]) => assignedTemplateId === template.id)
          .map(([eventId]) => eventId),
      ])));
      setMessage("");
    } catch (error) {
      const message = readableError(error);
      setMessage(message.includes("contract_templates") || message.includes("event_contract_templates")
        ? "Die Datenbank ist noch nicht für Vertragsvorlagen eingerichtet. Bitte führe zuerst die neue Supabase-Migration aus."
        : message);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function addTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setMessage("Bitte wähle eine DOCX-Datei aus.");
      return;
    }
    if (!file.name.toLocaleLowerCase().endsWith(".docx") || file.size > 15 * 1024 * 1024) {
      setMessage("Bitte lade eine DOCX-Datei mit maximal 15 MB hoch.");
      return;
    }
    setBusy(true);
    setMessage("");
    const supabase = createClient();
    let uploadedPath = "";
    try {
      const { data: organizationId, error: organizationError } = await supabase.rpc("current_organization_id");
      if (organizationError || typeof organizationId !== "string") throw organizationError ?? new Error("Der Veranstalterbereich konnte nicht ermittelt werden.");
      uploadedPath = `${organizationId}/contract-templates/${crypto.randomUUID()}.docx`;
      const { error: uploadError } = await supabase.storage.from("sponsorproof-files").upload(uploadedPath, file, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { error: insertError } = await supabase.from("contract_templates").insert({
        organization_id: organizationId,
        name: name.trim() || file.name.replace(/\.docx$/i, ""),
        original_filename: file.name,
        storage_path: uploadedPath,
      });
      if (insertError) throw insertError;
      setName("");
      setFile(null);
      const input = document.getElementById("contract-template-file") as HTMLInputElement | null;
      if (input) input.value = "";
      await load();
      setMessage("Vertragsvorlage wurde hochgeladen.");
    } catch (error) {
      if (uploadedPath) await supabase.storage.from("sponsorproof-files").remove([uploadedPath]);
      setMessage(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setMessage("");
  }

  function toggleEvent(templateId: string, eventId: string, checked: boolean) {
    setSelectedByTemplate((current) => {
      const selected = current[templateId] ?? [];
      return {
        ...current,
        [templateId]: checked
          ? [...new Set([...selected, eventId])]
          : selected.filter((selectedEventId) => selectedEventId !== eventId),
      };
    });
    setMessage("");
  }

  async function saveAssignments(templateId: string) {
    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const selected = selectedByTemplate[templateId] ?? [];
      const previous = Object.entries(assignments)
        .filter(([, assignedTemplateId]) => assignedTemplateId === templateId)
        .map(([eventId]) => eventId);
      const conflicts = selected.filter((eventId) => assignments[eventId] && assignments[eventId] !== templateId);
      if (conflicts.length) {
        setMessage("Mindestens eines der ausgewählten Events ist bereits einer anderen Vorlage zugeordnet.");
        return;
      }
      const previousSet = new Set(previous);
      const selectedSet = new Set(selected);
      const added = selected.filter((eventId) => !previousSet.has(eventId));
      const removed = previous.filter((eventId) => !selectedSet.has(eventId));

      if (added.length) {
        const { error } = await supabase.from("event_contract_templates").insert(
          added.map((eventId) => ({ event_id: eventId, template_id: templateId })),
        );
        if (error) throw error;
      }
      if (removed.length) {
        const { error } = await supabase.from("event_contract_templates").delete().eq("template_id", templateId).in("event_id", removed);
        if (error) throw error;
      }
      await load();
      setMessage("Event-Zuordnungen gespeichert.");
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(template: ContractTemplate) {
    if (!window.confirm(`Vertragsvorlage „${template.name}“ wirklich löschen?`)) return;
    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { error: rowError } = await supabase.from("contract_templates").delete().eq("id", template.id);
      if (rowError) throw rowError;
      const { error: fileError } = await supabase.storage.from("sponsorproof-files").remove([template.storage_path]);
      if (fileError) throw fileError;
      await load();
      setMessage("Vertragsvorlage gelöscht.");
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  return <div className="contract-template-settings">
    <div className="settings-section settings-section-card">
      <div className="settings-section-heading"><span className="settings-section-icon"><Icon name="file" size={16}/></span><div><h2>Vertragsvorlage</h2><p>Lade Word-Vorlagen hoch und verwende dieselbe Vorlage für mehrere Events.</p></div></div>
      <form className="contract-template-upload" onSubmit={(event) => { void addTemplate(event); }}>
        <label className="settings-field"><span>Name der Vorlage</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="z. B. Sponsoringvertrag Standard" /></label>
        <label className="settings-field"><span>Word-Datei (.docx) *</span><input id="contract-template-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={chooseFile} required /></label>
        <button className="btn btn-primary" type="submit" disabled={busy || !ready || !file}><Icon name="plus" size={14}/> Vorlage hochladen</button>
        <p className="subtitle contract-template-hint">Die Datei wird sicher im Veranstalterbereich gespeichert. Jedes Event kann weiterhin nur eine Vorlage verwenden.</p>
      </form>
    </div>

    <div className="settings-section settings-section-card">
      <div className="settings-section-heading"><span className="settings-section-icon"><Icon name="calendar" size={16}/></span><div><h2>Vorlagen und Event-Zuordnung</h2><p>Ordne eine Vorlage mehreren Events zu. Jedes Event kann weiterhin nur eine Vorlage verwenden.</p></div></div>
      {!ready ? <p className="task-empty">Vorlagen werden geladen …</p> : templates.length === 0 ? <div className="settings-empty-note">Noch keine Vertragsvorlagen hochgeladen.</div> : <div className="contract-template-list">{templates.map((template) => <article className="contract-template-card" key={template.id}>
        <div className="contract-template-card-heading"><span className="metric-icon"><Icon name="file" size={15}/></span><div><h3>{template.name}</h3><p>{template.original_filename}</p></div><button className="btn contract-template-delete" type="button" disabled={busy} onClick={() => { void deleteTemplate(template); }}>Löschen</button></div>
        <div className="contract-template-events">{events.length ? <fieldset className="contract-template-event-fieldset" disabled={busy}>
          <legend>Events für diese Vorlage</legend>
          <div className="contract-template-event-list">{events.map((event) => {
            const otherTemplateId = assignments[event.id];
            const assignedTemplate = templates.find((item) => item.id === otherTemplateId);
            const unavailable = Boolean(otherTemplateId && otherTemplateId !== template.id);
            const checked = (selectedByTemplate[template.id] ?? []).includes(event.id);
            return <label className={`contract-template-event ${unavailable ? "unavailable" : ""}`} key={event.id}>
              <input type="checkbox" checked={checked} disabled={unavailable} onChange={(changeEvent) => toggleEvent(template.id, event.id, changeEvent.target.checked)} />
              <span><b>{event.title}</b>{unavailable && assignedTemplate && <small>Bereits „{assignedTemplate.name}“ zugeordnet</small>}</span>
            </label>;
          })}</div>
        </fieldset> : <p className="task-empty">Lege zuerst ein Event an, um eine Vorlage zuzuordnen.</p>}</div>
        <div className="contract-template-card-footer"><span>{(selectedByTemplate[template.id] ?? []).length === 0 ? "Keinem Event zugeordnet" : (selectedByTemplate[template.id] ?? []).length === 1 ? "1 Event ausgewählt" : `${(selectedByTemplate[template.id] ?? []).length} Events ausgewählt`}</span><button className="btn btn-primary" type="button" disabled={busy || !ready} onClick={() => { void saveAssignments(template.id); }}>Zuordnungen speichern</button></div>
      </article>)}</div>}
    </div>

    <details className="settings-section settings-section-card contract-template-placeholders-disclosure">
      <summary className="settings-section-heading"><span className="settings-section-icon"><Icon name="layers" size={16}/></span><div><h2>Verfügbare Ersetzungsmarken</h2><p>Platzhalter für Daten im Vertrag.</p></div><span className="contract-template-placeholders-toggle"><Icon name="chevron" size={16}/></span></summary>
      <p className="contract-template-placeholders-note">Diese Marken stehen für Angaben, die bereits in Splow gespeichert sind – zum Beispiel zu Veranstalter, Sponsor, Event oder Vertrag. Füge eine Marke inklusive der geschweiften Klammern an der passenden Stelle deiner Word-Vorlage ein. Wenn Splow den Vertrag erstellt, ersetzt es die Marke automatisch durch den gespeicherten Wert. Mit <b>{"{{@leistungen}}"}</b> fügst du alle vereinbarten Leistungen ein; die besonderen Hinweise dazu findest du direkt unter der Liste.</p>
      <div className="contract-template-placeholders">{contractTemplatePlaceholders.map((group) => <section className="contract-template-placeholder-group" key={group.title}><h3>{group.title}</h3><div>{group.fields.map(([marker, description]) => <div className="contract-template-placeholder-row" key={marker}><code>{marker}</code><span>{description}</span></div>)}</div></section>)}</div>
      <p className="subtitle contract-template-benefits-note"><b>{"{{@leistungen}}"}</b> gibt je Leistung den Namen fett und die Beschreibung normal darunter aus. Zwischen mehreren Leistungen wird ein Absatz eingefügt. Fälligkeitsdaten werden nicht ausgegeben. Platziere die Marke in Word in einem eigenen Absatz.</p>
    </details>
    <p className="settings-feedback" role="status" aria-live="polite">{message || (ready ? "Vorlagen und Zuordnungen werden in deinem gemeinsamen Veranstalterbereich gespeichert." : "")}</p>
  </div>;
}
