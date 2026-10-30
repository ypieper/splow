"use client";

import { Modal } from "@/components/modal";
import { EmptyState, Icon, iconNames, PageHeading } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { useEffect, useRef, useState, type FormEvent } from "react";

type BenefitType = "monetary" | "in_kind";
type CompletionType = "file_required" | "organizer_approval" | "sponsor_approval" | "sponsor_upload";
type DefaultCompletionType = "file_required" | "organizer_approval" | "none_required";
type Block = { title: string; category: string; description: string; detail: string; icon?: string; benefit_type?: BenefitType; material_logistics?: string | null; internal_comment?: string | null; default_completion_type?: DefaultCompletionType; tasks_per_unit?: boolean };
type TemplateSubtask = { id: string; title: string; sort_order: number; completion_type: CompletionType };
type DraftSubtask = { key: string; title: string; completionType: CompletionType };
type LibraryBlock = Block & { id: string; origin: "custom"; subtasks: TemplateSubtask[] };
type DatabaseBlock = { id: string; title: string; category: string; description: string; detail: string; icon: string | null; benefit_type?: BenefitType; material_logistics?: string | null; internal_comment?: string | null; default_completion_type?: DefaultCompletionType; tasks_per_unit?: boolean | null };
const defaultCategories = ["Werbung", "Social Media", "Hospitality"];
const blockIconLabels: Record<string, string> = {
  grid: "Kacheln", stack: "Drei Quadrate", calendar: "Kalender", users: "Personen", check: "Häkchen",
  layers: "Ebenen", settings: "Einstellungen", bell: "Glocke", plus: "Plus", arrow: "Pfeil",
  camera: "Kamera", pin: "Standort", menu: "Menü", close: "Schließen", chevron: "Pfeil rechts",
  clock: "Uhr", spark: "Social Media", file: "Dokument",
};
const emptyDraft = { title: "", category: "Werbung", description: "", icon: "stack", benefitType: "monetary" as BenefitType, materialLogistics: "", internalComment: "", defaultCompletionType: "file_required" as DefaultCompletionType, tasksPerUnit: true, subtasks: [] as DraftSubtask[] };
const completionOptions: Array<{ value: CompletionType; label: string }> = [
  { value: "file_required", label: "Veranstalter lädt eine Datei hoch" },
  { value: "organizer_approval", label: "Veranstalter bestätigt den Schritt" },
  { value: "sponsor_approval", label: "Sponsor prüft und gibt frei" },
  { value: "sponsor_upload", label: "Sponsor lädt eine Datei hoch" },
];

function completionOwner(type: CompletionType) {
  return type === "sponsor_approval" || type === "sponsor_upload" ? "Sponsor" : "Veranstalter";
}

function allowedCompletionTypesAfter(previous: CompletionType): CompletionType[] {
  if (previous === "file_required") return ["file_required", "organizer_approval", "sponsor_upload"];
  if (previous === "sponsor_approval") return ["file_required", "organizer_approval", "sponsor_upload"];
  if (previous === "sponsor_upload") return ["file_required", "organizer_approval"];
  return completionOptions.map((option) => option.value);
}

function invalidWorkflowTransitionIndex(subtasks: DraftSubtask[]) {
  return subtasks.findIndex((task, index) => index === 0
    ? task.completionType === "sponsor_approval"
    : !allowedCompletionTypesAfter(subtasks[index - 1].completionType).includes(task.completionType));
}
let pendingLibraryLoad: Promise<{ items: LibraryBlock[]; subtasksUnavailable?: boolean }> | null = null;

function defaultIconForCategory(categoryName: string) {
  if (categoryName === "Social Media") return "spark";
  if (categoryName === "Hospitality") return "users";
  return "stack";
}

export default function LibraryPage() {
  const [category, setCategory] = useState("Alle Bausteine");
  const [items, setItems] = useState<LibraryBlock[]>([]);
  const [categories, setCategories] = useState(defaultCategories);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [categoryToDelete, setCategoryToDelete] = useState("");
  const [moveToCategory, setMoveToCategory] = useState(defaultCategories[0]);
  const [ready, setReady] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [deletingBlock, setDeletingBlock] = useState<LibraryBlock | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [message, setMessage] = useState("");
  const [libraryError, setLibraryError] = useState(false);
  const [subtasksUnavailable, setSubtasksUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const iconPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        let customItems: LibraryBlock[];
        if (isSupabaseConfigured) {
          if (!pendingLibraryLoad) {
            pendingLibraryLoad = (async () => {
              const supabase = createClient();
              const { data: authData, error: authError } = await supabase.auth.getUser();
              if (authError || !authData.user) throw new Error("Bitte melde dich an, um deine Bausteine zu laden.");

              const { data: existingRows, error: loadError } = await supabase.from("benefit_templates")
                .select("id, title, category, description, detail, icon, benefit_type, material_logistics, internal_comment, default_completion_type, tasks_per_unit")
                .order("created_at", { ascending: true });
              if (loadError) throw loadError;

              const rows = (existingRows ?? []) as DatabaseBlock[];
              const templateIds = rows.map((block) => block.id);
              const { data: subtaskRows, error: subtaskError } = templateIds.length
                ? await supabase.from("benefit_template_tasks").select("id, benefit_template_id, title, sort_order, completion_type").in("benefit_template_id", templateIds).order("sort_order")
                : { data: [], error: null };
              if (subtaskError) {
                return { items: rows.map((block) => ({ ...block, tasks_per_unit: block.tasks_per_unit !== false, icon: block.icon ?? undefined, origin: "custom" as const, subtasks: [] })), subtasksUnavailable: true };
              }
              const subtasksByTemplate = new Map<string, TemplateSubtask[]>();
              for (const task of subtaskRows ?? []) {
                const current = subtasksByTemplate.get(task.benefit_template_id) ?? [];
                current.push({ id: task.id, title: task.title, sort_order: task.sort_order, completion_type: task.completion_type });
                subtasksByTemplate.set(task.benefit_template_id, current);
              }
              return { items: rows.map((block) => ({ ...block, benefit_type: block.benefit_type ?? "monetary", tasks_per_unit: block.tasks_per_unit !== false, icon: block.icon ?? undefined, origin: "custom" as const, subtasks: subtasksByTemplate.get(block.id) ?? [] })) };
            })();
          }
          const pending = pendingLibraryLoad;
          if (!pending) throw new Error("Die Bausteine konnten nicht geladen werden.");
          try {
            const loadResult = await pending;
            customItems = loadResult.items;
            if (loadResult.subtasksUnavailable) {
              setSubtasksUnavailable(true);
              setMessage("Die Bausteine wurden geladen. Unteraufgaben sind erst verfügbar, wenn die aktuelle Datenbankmigration eingespielt ist.");
            }
          } finally {
            if (pendingLibraryLoad === pending) pendingLibraryLoad = null;
          }
        } else customItems = [];
        if (active) setItems(customItems);
        if (isSupabaseConfigured) {
          const { data: categoryRows, error: categoryError } = await createClient().from("organization_benefit_categories").select("name").order("name");
          if (categoryError) throw categoryError;
          if (active) setCategories([...new Set([...defaultCategories, ...(categoryRows ?? []).map((row) => row.name)])]);
        }
      } catch (error) {
        if (active) {
          setLibraryError(true);
          setMessage(error instanceof Error && error.message.includes("benefit_templates") ? "Die Baustein-Tabelle fehlt in Supabase noch. Bitte führe zuerst die Datenbankmigration aus." : error instanceof Error ? error.message : "Bausteine konnten nicht aus der Datenbank geladen werden.");
        }
      } finally {
        if (active) setReady(true);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!iconPickerOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (!iconPickerRef.current?.contains(event.target as Node)) setIconPickerOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [iconPickerOpen]);

  const shown = items.filter((block) => category === "Alle Bausteine" || block.category === category);

  function editBlock(block: LibraryBlock) {
    setMessage("");
    setEditingBlockId(block.id);
    setDraft({ title: block.title, category: block.category, description: block.description, icon: block.icon ?? defaultIconForCategory(block.category), benefitType: block.benefit_type ?? "monetary", materialLogistics: block.material_logistics ?? "", internalComment: block.internal_comment ?? "", defaultCompletionType: block.default_completion_type ?? "file_required", tasksPerUnit: block.tasks_per_unit !== false, subtasks: block.subtasks.map((task) => ({ key: task.id, title: task.title, completionType: task.completion_type })) });
    setShowCreate(true);
  }

  async function saveBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (subtasksUnavailable && draft.subtasks.length > 0) {
      setMessage("Unteraufgaben können erst gespeichert werden, wenn die aktuelle Datenbankmigration eingespielt ist.");
      return;
    }
    const invalidTransition = invalidWorkflowTransitionIndex(draft.subtasks);
    if (invalidTransition >= 0) {
      setMessage(invalidTransition === 0
        ? "Die erste Unteraufgabe kann keine Sponsor-Freigabe sein, da dafür zuerst ein Dokument vorliegen muss."
        : "Diese Aufgabenfolge ist nicht möglich. Nach einem Sponsor-Upload kann nur eine Veranstalter-Bestätigung oder ein Datei-Upload durch den Veranstalter folgen.");
      return;
    }
    setSaving(true);
    const details = { title: draft.title.trim(), category: draft.category, description: draft.description.trim(), detail: "", icon: draft.icon, benefit_type: draft.benefitType, material_logistics: draft.materialLogistics.trim() || null, internal_comment: draft.internalComment.trim() || null, default_completion_type: draft.defaultCompletionType, tasks_per_unit: draft.tasksPerUnit };
    try {
      let updatedItems: LibraryBlock[];
      if (isSupabaseConfigured) {
        const supabase = createClient();
        const query = editingBlockId
          ? supabase.from("benefit_templates").update(details).eq("id", editingBlockId).select("id, title, category, description, detail, icon, benefit_type, material_logistics, internal_comment, default_completion_type, tasks_per_unit").single()
          : supabase.from("benefit_templates").insert(details).select("id, title, category, description, detail, icon, benefit_type, material_logistics, internal_comment, default_completion_type, tasks_per_unit").single();
        const { data, error } = await query;
        if (error || !data) throw error ?? new Error("Baustein konnte nicht gespeichert werden.");
        let savedSubtasks: TemplateSubtask[] = [];
        if (!subtasksUnavailable) {
          const subtasks = draft.subtasks.map((task) => ({ title: task.title.trim(), completion_type: task.completionType })).filter((task) => task.title);
          const { error: deleteSubtasksError } = await supabase.from("benefit_template_tasks").delete().eq("benefit_template_id", data.id);
          if (deleteSubtasksError) throw deleteSubtasksError;
          if (subtasks.length) {
            const { data: insertedSubtasks, error: insertSubtasksError } = await supabase.from("benefit_template_tasks")
              .insert(subtasks.map((task, index) => ({ benefit_template_id: data.id, ...task, sort_order: index })))
              .select("id, title, sort_order, completion_type");
            if (insertSubtasksError) throw insertSubtasksError;
            savedSubtasks = (insertedSubtasks ?? []) as TemplateSubtask[];
          }
        }
        const saved = { ...data, icon: data.icon ?? undefined, origin: "custom" as const, subtasks: savedSubtasks } as LibraryBlock;
        updatedItems = editingBlockId ? items.map((block) => block.id === editingBlockId ? saved : block) : [...items, saved];
      } else throw new Error("Supabase ist nicht eingerichtet.");
      setItems(updatedItems);
      setCategory("Alle Bausteine");
      setDraft(emptyDraft);
      setIconPickerOpen(false);
      setEditingBlockId(null);
      setShowCreate(false);
      setMessage(editingBlockId ? "Baustein aktualisiert." : "Baustein gespeichert.");
    } catch (error) {
      setMessage(error instanceof Error && error.message.includes("TASK_WORKFLOW_INVALID_TRANSITION")
        ? "Diese Aufgabenfolge ist nicht möglich. Bitte passe die Abschlussarten der Unteraufgaben an."
        : "Der Baustein konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  function addDraftSubtask() {
    setDraft((current) => ({ ...current, defaultCompletionType: current.defaultCompletionType === "none_required" ? "file_required" : current.defaultCompletionType, subtasks: [...current.subtasks, { key: crypto.randomUUID(), title: "", completionType: "file_required" }] }));
  }

  function updateDraftSubtask(key: string, title: string) {
    setDraft((current) => ({ ...current, subtasks: current.subtasks.map((task) => task.key === key ? { ...task, title } : task) }));
  }

  function removeDraftSubtask(key: string) {
    setMessage("");
    setDraft((current) => ({ ...current, subtasks: current.subtasks.filter((task) => task.key !== key) }));
  }

  function canMoveDraftSubtask(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= draft.subtasks.length) return false;
    const reordered = [...draft.subtasks];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    return invalidWorkflowTransitionIndex(reordered) < 0;
  }

  function canSetCompletionType(index: number, completionType: CompletionType) {
    const proposed = draft.subtasks.map((task, taskIndex) => taskIndex === index ? { ...task, completionType } : task);
    return invalidWorkflowTransitionIndex(proposed) < 0;
  }

  function moveDraftSubtask(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= draft.subtasks.length) return;
    const reordered = [...draft.subtasks];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    if (invalidWorkflowTransitionIndex(reordered) >= 0) return;
    setMessage("");
    setDraft((current) => ({ ...current, subtasks: reordered }));
  }

  function deleteBlock(block: LibraryBlock) {
    setDeletingBlock(block);
  }

  async function confirmDeleteBlock() {
    if (!deletingBlock) return;
    const updatedItems = items.filter((item) => item.id !== deletingBlock.id);
    try {
      if (isSupabaseConfigured) {
        const { error } = await createClient().from("benefit_templates").delete().eq("id", deletingBlock.id);
        if (error) throw error;
      } else throw new Error("Supabase ist nicht eingerichtet.");
      setItems(updatedItems);
      setMessage(`Baustein „${deletingBlock.title}“ gelöscht.`);
      setDeletingBlock(null);
    } catch {
      setMessage("Der Baustein konnte nicht gelöscht werden.");
    }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = newCategory.trim();
    if (!label || categories.some((item) => item.toLocaleLowerCase("de-DE") === label.toLocaleLowerCase("de-DE"))) return;
    const updated = [...categories, label];
    try {
      if (!isSupabaseConfigured) throw new Error("Supabase ist nicht eingerichtet.");
      const { data: organizationId, error: organizationError } = await createClient().rpc("current_organization_id");
      if (organizationError || typeof organizationId !== "string") throw organizationError ?? new Error("Veranstalterbereich nicht gefunden.");
      const { error } = await createClient().from("organization_benefit_categories").insert({ organization_id: organizationId, name: label });
      if (error) throw error;
      setCategories(updated);
      setCategory(label);
      setDraft((current) => ({ ...current, category: label }));
      setNewCategory("");
      setShowCategoryForm(false);
      setMessage(`Kategorie „${label}“ hinzugefügt.`);
    } catch {
      setMessage("Die Kategorie konnte nicht gespeichert werden.");
    }
  }

  async function removeCategory(categoryName: string) {
    if (!categoryName) return;
    const customCategories = categories.filter((item) => item !== categoryName);
    const fallback = categories.find((item) => item !== categoryName) ?? "Werbung";
    const destination = moveToCategory || fallback;
    const movedCount = items.filter((item) => item.category === categoryName).length;
    const updatedItems = items.map((item) => item.category === categoryName ? { ...item, category: destination } : item);
    try {
      if (isSupabaseConfigured) {
        const movedBlocks = updatedItems.filter((item) => item.category === destination && items.find((previous) => previous.id === item.id)?.category === categoryName);
        const updates = await Promise.all(movedBlocks.map((item) => createClient().from("benefit_templates").update({ category: destination }).eq("id", item.id)));
        if (updates.some(({ error }) => error)) throw new Error("Die Bausteine konnten nicht verschoben werden.");
      } else throw new Error("Supabase ist nicht eingerichtet.");
      const { data: organizationId, error: organizationError } = await createClient().rpc("current_organization_id");
      if (organizationError || typeof organizationId !== "string") throw organizationError ?? new Error("Veranstalterbereich nicht gefunden.");
      const { error: deleteError } = await createClient().from("organization_benefit_categories").delete().eq("organization_id", organizationId).eq("name", categoryName);
      if (deleteError) throw deleteError;
      setItems(updatedItems);
      setCategories(customCategories);
      setCategory((current) => current === categoryName ? "Alle Bausteine" : current);
      setDraft((current) => current.category === categoryName ? { ...current, category: destination } : current);
      setCategoryToDelete("");
      setMessage(movedCount > 0 ? `Kategorie „${categoryName}“ entfernt. ${movedCount} Baustein${movedCount === 1 ? " wurde" : "e wurden"} nach „${destination}“ verschoben.` : `Kategorie „${categoryName}“ entfernt.`);
    } catch {
      setMessage("Die Kategorie konnte nicht entfernt werden.");
    }
  }

  return <main className="content">
    <PageHeading eyebrow="VORLAGEN" title="Leistungsbausteine" subtitle="Wiederverwendbare Leistungen für deine Sponsoringverträge." action={<button className="btn btn-primary" type="button" onClick={() => { setMessage(""); setEditingBlockId(null); setDraft(emptyDraft); setIconPickerOpen(false); setShowCreate(true); }}><Icon name="plus" size={16}/> Baustein erstellen</button>}/>
    <p className="subtitle library-message" role="status" aria-live="polite">{message || (ready ? "Deine Bausteine werden sicher in deinem Konto gespeichert." : "Bausteine werden geladen …")}</p>
    <div className="library-filter" aria-label="Bausteine filtern"><button type="button" onClick={() => setCategory("Alle Bausteine")} aria-pressed={category === "Alle Bausteine"} className={`filter-chip ${category === "Alle Bausteine" ? "active" : ""}`}>Alle Bausteine</button>{categories.map((item) => <span className={`category-filter-chip ${category === item ? "active" : ""}`} key={item}><button type="button" onClick={() => setCategory(item)} aria-pressed={category === item} className="filter-chip">{item}</button>{!defaultCategories.includes(item) && <button type="button" className="category-remove-button" aria-label={`Kategorie ${item} entfernen`} title={`Kategorie ${item} entfernen`} onClick={() => { if (items.some((block) => block.category === item)) { setCategoryToDelete(item); setMoveToCategory(categories.find((other) => other !== item) ?? "Werbung"); } else removeCategory(item); }}>Entfernen</button>}</span>)}<button className="btn" type="button" onClick={() => { setShowCategoryForm((value) => !value); setMessage(""); }}><Icon name="plus" size={13}/> Kategorie hinzufügen</button></div>
    {showCategoryForm && <form className="category-create-form" onSubmit={createCategory}><label className="settings-field"><span>Neue Kategorie</span><input autoFocus required maxLength={35} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="z. B. Printwerbung" /></label><button className="btn btn-primary" type="submit">Hinzufügen</button><button className="btn" type="button" onClick={() => setShowCategoryForm(false)}>Abbrechen</button></form>}
    {categoryToDelete && <div className="category-delete-form"><div><strong>Kategorie „{categoryToDelete}“ entfernen?</strong><p>Zugehörige Bausteine bleiben erhalten und werden einer anderen Kategorie zugeordnet.</p></div><label className="settings-field"><span>Zielkategorie</span><select value={moveToCategory} onChange={(event) => setMoveToCategory(event.target.value)}>{categories.filter((item) => item !== categoryToDelete).map((item) => <option key={item}>{item}</option>)}</select></label><button className="btn btn-primary" type="button" onClick={() => removeCategory(categoryToDelete)}>Bausteine verschieben und Kategorie entfernen</button><button className="btn" type="button" onClick={() => setCategoryToDelete("")}>Abbrechen</button></div>}
    <div className="library-grid">
      {shown.map((block) => <article className="block-card" key={block.id}>
        <span className="block-icon"><Icon name={block.icon ?? defaultIconForCategory(block.category)} size={17}/></span>
        <h3>{block.title}</h3>
        <p>{block.description}</p>
        <div className="block-footer"><span>{block.category} · {block.benefit_type === "in_kind" ? "Sachleistung" : "Geldleistung"}</span><div className="block-actions">
          <button className="btn block-edit-button" type="button" onClick={() => editBlock(block)}>Bearbeiten</button>
          <button className="btn block-delete-button" type="button" onClick={() => deleteBlock(block)} aria-label={`${block.title} löschen`}>Löschen</button>
        </div></div>
      </article>)}
      {ready && !libraryError && shown.length === 0 && <EmptyState className="empty-state-fill" title={category === "Alle Bausteine" ? "Noch keine Bausteine" : `Noch keine Bausteine in „${category}“`} description="Erstelle deinen ersten Baustein für wiederverwendbare Sponsoringleistungen." action={<button className="btn btn-primary" type="button" onClick={() => { setDraft({ ...emptyDraft, category: category === "Alle Bausteine" ? defaultCategories[0] : category, icon: defaultIconForCategory(category === "Alle Bausteine" ? defaultCategories[0] : category) }); setEditingBlockId(null); setShowCreate(true); }}><Icon name="plus" size={14}/> Baustein erstellen</button>} />}
    </div>
    {showCreate && (
      <Modal labelledBy="create-block-title" className="create-modal block-create-modal" backdropClassName="modal-backdrop" role="dialog" onClose={() => {
              setShowCreate(false);
              setEditingBlockId(null);
              setIconPickerOpen(false);
            }}>
          <div className="create-modal-head">
            <div>
              <h2 id="create-block-title">{editingBlockId ? "Baustein bearbeiten" : "Baustein erstellen"}</h2>
              <p>{editingBlockId ? "Passe die Leistung und ihre Aufgabenfolge an." : "Lege eine wiederverwendbare Leistung für deine Sponsoringverträge an."}</p>
            </div>
            <button className="icon-button" type="button" aria-label="Dialog schließen" onClick={() => {
              setShowCreate(false);
              setEditingBlockId(null);
              setIconPickerOpen(false);
            }}><Icon name="close" size={16}/></button>
          </div>

          <form className="block-editor-form" onSubmit={saveBlock}>
            <aside className="library-info" aria-label="Information zu Leistungsbausteinen">
              <span className="library-info-icon"><Icon name="layers" size={16}/></span>
              <p>Aus den Angaben hier entstehen später im Event die vereinbarte Leistung und ihre Aufgaben.</p>
            </aside>

            <section className="block-editor-section">
              <header className="block-editor-section-heading">
                <span>01</span><div><h3>Leistung</h3><p>Grundangaben, die im Vertrag und im Event angezeigt werden.</p></div>
              </header>
              <div className="settings-grid">
                <label className="settings-field settings-field-full"><span>Name *</span><input autoFocus required maxLength={70} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="z. B. Freikarten oder Logo auf der Event-Website" /></label>
                <label className="settings-field"><span>Kategorie *</span><select value={draft.category} onChange={(event) => {
                  const nextCategory = event.target.value;
                  setDraft((current) => ({ ...current, category: nextCategory, icon: defaultIconForCategory(nextCategory) }));
                }}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label className="settings-field"><span>Leistungsart *</span><select value={draft.benefitType} onChange={(event) => setDraft((current) => ({ ...current, benefitType: event.target.value as BenefitType }))}><option value="monetary">Geldleistung</option><option value="in_kind">Sachleistung</option></select></label>
                <div className="settings-field">
                  <span>Icon</span>
                  <div className="icon-picker" ref={iconPickerRef} onKeyDown={(event) => {
                    if (event.key === "Escape" && iconPickerOpen) {
                      event.preventDefault();
                      event.stopPropagation();
                      setIconPickerOpen(false);
                    }
                  }}>
                    <button className="icon-picker-trigger" type="button" aria-haspopup="true" aria-expanded={iconPickerOpen} aria-label={`Icon auswählen, aktuell ${blockIconLabels[draft.icon] ?? draft.icon}`} onClick={() => setIconPickerOpen((open) => !open)}>
                      <span className="icon-picker-current"><span className="block-icon"><Icon name={draft.icon} size={18}/></span><span>{blockIconLabels[draft.icon] ?? draft.icon}</span></span><Icon name="chevron" size={15}/>
                    </button>
                    {iconPickerOpen && <div className="icon-picker-options" role="group" aria-label="Verfügbare Icons">{iconNames.map((iconName) => <button key={iconName} type="button" className={`icon-picker-option ${draft.icon === iconName ? "selected" : ""}`} aria-label={blockIconLabels[iconName] ?? iconName} aria-pressed={draft.icon === iconName} title={blockIconLabels[iconName] ?? iconName} onClick={() => {
                      setDraft((current) => ({ ...current, icon: iconName }));
                      setIconPickerOpen(false);
                    }}><Icon name={iconName} size={18}/></button>)}</div>}
                  </div>
                </div>
                <label className="settings-field settings-field-full"><span>Beschreibung *</span><textarea required maxLength={240} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Was ist vereinbart und was erhält der Sponsor?" /></label>
              </div>
            </section>

            <section className="block-editor-section block-editor-optional-section">
              <header className="block-editor-section-heading">
                <span>02</span><div><h3>Zusätzliche Angaben <small>optional</small></h3><p>Interne Hinweise und Materiallogistik für die spätere Planung.</p></div>
              </header>
              <div className="block-editor-extra-fields">
                <label className="settings-field benefit-template-material-logistics"><span>Materiallogistik</span><input maxLength={160} value={draft.materialLogistics} onChange={(event) => setDraft((current) => ({ ...current, materialLogistics: event.target.value }))} placeholder="z. B. Banner beim Sponsor abholen"/><small>Wird zusätzlich zur Leistung für die interne Planung im Event angezeigt.</small></label>
                <label className="settings-field benefit-template-internal-comment"><span>Interner Kommentar</span><textarea maxLength={500} value={draft.internalComment} onChange={(event) => setDraft((current) => ({ ...current, internalComment: event.target.value }))} placeholder="Hinweis für die Auswahl dieser Leistung im Event"/><small>Nur Veranstalter sehen diesen Kommentar.</small></label>
              </div>
            </section>

            <section className="block-editor-section block-editor-workflow-section">
              <header className="block-editor-section-heading">
                <span>03</span><div><h3>Aufgaben &amp; Abschluss</h3><p>Lege fest, wie diese Leistung abgeschlossen und nachgewiesen wird.</p></div>
              </header>
              {draft.subtasks.length === 0 && <div className="benefit-template-main-completion block-editor-completion">
                <label className="settings-field"><span>Abschlussart</span><select value={draft.defaultCompletionType} onChange={(event) => setDraft((current) => ({ ...current, defaultCompletionType: event.target.value as DefaultCompletionType }))}><option value="file_required">Datei-Upload durch Veranstalter</option><option value="organizer_approval">Bestätigung durch Veranstalter</option><option value="none_required">Keine Aufgabe erforderlich</option></select></label>
                <small>Diese Abschlussart gilt für die gesamte Leistung, solange keine Unteraufgaben angelegt sind.</small>
              </div>}
              <label className="settings-checkbox benefit-template-task-frequency"><input type="checkbox" checked={draft.tasksPerUnit} onChange={(event) => setDraft((current) => ({ ...current, tasksPerUnit: event.target.checked }))}/><span><b>Eigene Aufgabenfolge für jede Einheit</b><small>{draft.tasksPerUnit ? "Aktiv: Bei mehreren Einheiten wird dieser Ablauf für jede einzeln erstellt." : "Aus: Eine Aufgabenfolge gilt für die gesamte Menge, zum Beispiel ein Upload für 20 Freikarten."} Die Anzahl legst du später im Event fest.</small></span></label>
              <div className="benefit-template-subtasks">
                <div className="benefit-template-subtasks-heading">
                  <div><b>Aufgabenfolge</b><p>Jeder Schritt wird nach dem vorherigen freigeschaltet. Zuständigkeiten und Fälligkeiten planst du später im Event.</p></div>
                  <button className="btn" type="button" onClick={() => { setMessage(""); addDraftSubtask(); }} disabled={subtasksUnavailable}><Icon name="plus" size={14}/> Schritt hinzufügen</button>
                </div>
                {subtasksUnavailable && <p className="block-editor-migration-note">Unteraufgaben sind verfügbar, sobald die aktuelle Datenbankmigration eingespielt ist.</p>}
                <div className="benefit-template-workflow-warning block-editor-workflow-warning"><b>So funktioniert die Reihenfolge</b><span>Der erste Schritt startet nach der Zuordnung im Event. Jeder weitere wird nach Abschluss des vorherigen freigeschaltet. Nicht unterstützte Übergänge werden automatisch verhindert.</span></div>
                {draft.subtasks.length > 0 && <div className="benefit-template-subtask-list">{draft.subtasks.map((task, index) => {
                  return <div className="benefit-template-subtask-row" key={task.key}>
                    <span className="block-editor-subtask-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <div className="benefit-template-subtask-card">
                      <div className="benefit-template-step-heading"><div><b>Schritt {index + 1}</b><small>{index === 0 ? "Startet nach Zuordnung im Event" : `Wird nach Schritt ${index} freigeschaltet${draft.subtasks[index - 1].title ? ` · ${draft.subtasks[index - 1].title}` : ""}`}</small></div><span className={`benefit-template-step-owner ${completionOwner(task.completionType) === "Sponsor" ? "sponsor" : "organizer"}`}>{completionOwner(task.completionType)}</span></div>
                      <div className="benefit-template-subtask-fields">
                      <div className="benefit-template-subtask-title">
                        <label className="settings-field"><span>Was soll passieren? *</span><input aria-label={`Aufgabe in Schritt ${index + 1}`} required maxLength={100} value={task.title} onChange={(event) => updateDraftSubtask(task.key, event.target.value)} placeholder="z. B. Logo für die Website bereitstellen"/></label>
                      </div>
                      <label className="settings-field"><span>Wer erledigt und schließt ab?</span><select value={task.completionType} onChange={(event) => setDraft((current) => ({ ...current, subtasks: current.subtasks.map((item) => item.key === task.key ? { ...item, completionType: event.target.value as CompletionType } : item) }))}>{completionOptions.map((option) => { const allowed = canSetCompletionType(index, option.value); return <option key={option.value} value={option.value} disabled={!allowed}>{option.label}{!allowed ? " · in dieser Reihenfolge nicht möglich" : ""}</option>; })}</select></label>
                      </div>
                    </div>
                    <div className="benefit-template-step-controls"><button className="icon-button" type="button" aria-label={`Schritt ${index + 1} nach oben verschieben`} title="Nach oben verschieben" disabled={!canMoveDraftSubtask(index, -1)} onClick={() => moveDraftSubtask(index, -1)}><Icon name="chevron" size={14}/></button><button className="icon-button" type="button" aria-label={`Schritt ${index + 1} nach unten verschieben`} title="Nach unten verschieben" disabled={!canMoveDraftSubtask(index, 1)} onClick={() => moveDraftSubtask(index, 1)}><Icon name="chevron" size={14}/></button><button className="icon-button benefit-template-step-remove" type="button" aria-label={`Schritt ${index + 1} entfernen`} title="Schritt entfernen" onClick={() => removeDraftSubtask(task.key)}><Icon name="trash" size={14}/></button></div>
                  </div>;
                })}</div>}
                {draft.subtasks.length > 0 && <div className="benefit-template-workflow-preview"><b>Ablaufvorschau</b><ol>{draft.subtasks.map((task, index) => <li key={task.key}><span>{index + 1}</span><div><strong>{task.title.trim() || `Schritt ${index + 1}`}</strong><small>{completionOwner(task.completionType)}</small></div></li>)}</ol><small>Im Event wird zuerst Schritt 1 freigeschaltet. Weitere Schritte folgen nacheinander.</small></div>}
                {invalidWorkflowTransitionIndex(draft.subtasks) >= 0 && <p className="form-error" role="alert">{invalidWorkflowTransitionIndex(draft.subtasks) === 0 ? "Die erste Unteraufgabe kann keine Sponsor-Freigabe sein, da dafür zuerst ein Dokument vorliegen muss." : "Diese Aufgabenfolge ist nicht möglich. Nach einem Sponsor-Upload kann nur eine Veranstalter-Bestätigung oder ein Datei-Upload folgen."}</p>}
              </div>
            </section>

            <div className="create-modal-actions block-editor-actions">
              <button className="btn" type="button" onClick={() => { setShowCreate(false); setEditingBlockId(null); setIconPickerOpen(false); }}>Abbrechen</button>
              <button className="btn btn-primary" type="submit" disabled={!ready || saving}>{saving ? "Wird gespeichert …" : editingBlockId ? "Änderungen speichern" : "Baustein speichern"}</button>
            </div>
          </form>
        </Modal>
    )}
    {deletingBlock && <Modal labelledBy="delete-block-title" className="create-modal block-delete-modal" backdropClassName="modal-backdrop" onClose={() => setDeletingBlock(null)}><div className="create-modal-head"><div><h2 id="delete-block-title">Baustein löschen?</h2><p>„{deletingBlock.title}“ wird aus der Bibliothek entfernt. Bereits erstellte Vertragsleistungen bleiben erhalten.</p></div></div><div className="create-modal-actions"><button className="btn" type="button" onClick={() => setDeletingBlock(null)}>Abbrechen</button><button className="btn block-delete-confirm" type="button" onClick={confirmDeleteBlock}>Baustein löschen</button></div></Modal>}
  </main>;
}
