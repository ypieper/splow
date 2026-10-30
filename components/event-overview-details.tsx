"use client";

import { DatePicker } from "@/components/date-picker";

import { Modal } from "@/components/modal";
import { EventLocationFields } from "@/components/event-location-fields";
import { Icon } from "@/components/ui";
import { updateStoredEventDetails } from "@/lib/events-storage";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

type EventDetails = { title: string; startDate: string; endDate: string; location: string; locationStreet: string; locationPostalCode: string; locationCity: string; responsible: string; contactFirstName: string; contactLastName: string; contactEmail: string; contactPhone: string; organizerLogoPath: string | null; organizerLogoUrl?: string | null };
const maxLogoSize = 5 * 1024 * 1024;
const organizerLogoWidth = 1200;
const organizerLogoHeight = 400;

async function fitLogoToContainer(file: File) {
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = organizerLogoWidth;
    canvas.height = organizerLogoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Das Logo konnte nicht verarbeitet werden.");
    if (file.type === "image/jpeg") {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, organizerLogoWidth, organizerLogoHeight);
    }
    const scale = Math.min(organizerLogoWidth / image.width, organizerLogoHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, (organizerLogoWidth - width) / 2, (organizerLogoHeight - height) / 2, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Das Logo konnte nicht verarbeitet werden.")), file.type));
    return new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
  } finally {
    image.close();
  }
}

function formatDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : value;
}

export function EventOverviewDetails({ eventId, initialDetails, onDetailsSaved }: { eventId: string; initialDetails: EventDetails; onDetailsSaved: (details: EventDetails) => void }) {
  const [details, setDetails] = useState(initialDetails);
  const [draft, setDraft] = useState(initialDetails);
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoFilePreview, setLogoFilePreview] = useState("");
  const [removeLogo, setRemoveLogo] = useState(false);

  useEffect(() => {
    setDetails(initialDetails);
    setDraft(initialDetails);
    setLogoFile(null);
    setRemoveLogo(false);
    setReady(true);
  }, [eventId, initialDetails.title, initialDetails.startDate, initialDetails.endDate, initialDetails.location, initialDetails.locationStreet, initialDetails.locationPostalCode, initialDetails.locationCity, initialDetails.responsible, initialDetails.contactFirstName, initialDetails.contactLastName, initialDetails.contactEmail, initialDetails.contactPhone, initialDetails.organizerLogoPath, initialDetails.organizerLogoUrl]);

  useEffect(() => {
    if (!logoFile) { setLogoFilePreview(""); return; }
    const previewUrl = URL.createObjectURL(logoFile);
    setLogoFilePreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [logoFile]);

  function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setLogoFile(null);
      setMessage("Bitte wähle ein PNG-, JPG- oder WebP-Bild aus.");
      return;
    }
    if (file.size > maxLogoSize) {
      setLogoFile(null);
      setMessage("Das Logo darf höchstens 5 MB groß sein.");
      return;
    }
    setLogoFile(file);
    setRemoveLogo(false);
    setMessage("");
  }

  function updateLocation(value: Partial<Pick<EventDetails, "locationStreet" | "locationPostalCode" | "locationCity">>) {
    setDraft((current) => {
      const parts = { locationStreet: current.locationStreet, locationPostalCode: current.locationPostalCode, locationCity: current.locationCity, ...value };
      const location = [parts.locationStreet.trim(), [parts.locationPostalCode.trim(), parts.locationCity.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      return { ...current, ...parts, location };
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.locationStreet.trim() || !/^\d{5}$/.test(draft.locationPostalCode) || !draft.locationCity.trim()) {
      setMessage("Bitte trage Straße, eine fünfstellige PLZ und den ermittelten Ort ein.");
      return;
    }
    setSaving(true);
    setMessage("");
    let uploadedLogoPath = "";
    try {
      const title = draft.title.trim();
      const supabase = createClient();
      const previousLogoPath = details.organizerLogoPath;
      let organizerLogoPath = removeLogo ? null : draft.organizerLogoPath;
      if (logoFile) {
        const fittedLogoFile = await fitLogoToContainer(logoFile);
        if (fittedLogoFile.size > maxLogoSize) throw new Error("Das bearbeitete Logo ist größer als 5 MB. Bitte wähle eine kleinere Datei.");
        const { data: organizationId, error: organizationError } = await supabase.rpc("current_organization_id");
        if (organizationError || typeof organizationId !== "string") throw organizationError ?? new Error("Der Veranstalterbereich konnte nicht ermittelt werden.");
        const extension = fittedLogoFile.type === "image/png" ? "png" : fittedLogoFile.type === "image/webp" ? "webp" : "jpg";
        uploadedLogoPath = `${organizationId}/events/${eventId}/branding/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("sponsorproof-files").upload(uploadedLogoPath, fittedLogoFile, { contentType: fittedLogoFile.type, upsert: false });
        if (uploadError) throw uploadError;
        organizerLogoPath = uploadedLogoPath;
      }
      const locationStreet = draft.locationStreet.trim();
      const locationPostalCode = draft.locationPostalCode.trim();
      const locationCity = draft.locationCity.trim();
      const savedDraft = { ...draft, title, locationStreet, locationPostalCode, locationCity, location: [locationStreet, `${locationPostalCode} ${locationCity}`].join(", "), contactFirstName: draft.contactFirstName.trim(), contactLastName: draft.contactLastName.trim(), contactEmail: draft.contactEmail.trim(), contactPhone: draft.contactPhone.trim(), organizerLogoPath };
      const { error } = await updateStoredEventDetails(eventId, savedDraft);
      if (error) throw error;
      let organizerLogoUrl: string | null = removeLogo ? null : draft.organizerLogoUrl ?? null;
      if (organizerLogoPath) {
        const { data: signedLogo } = await supabase.storage.from("sponsorproof-files").createSignedUrl(organizerLogoPath, 60 * 60 * 24);
        organizerLogoUrl = signedLogo?.signedUrl ?? null;
      }
      const updatedDetails = { ...savedDraft, organizerLogoUrl };
      setDetails(updatedDetails);
      setDraft(updatedDetails);
      setLogoFile(null);
      setRemoveLogo(false);
      onDetailsSaved(updatedDetails);
      if (previousLogoPath && previousLogoPath !== organizerLogoPath) await supabase.storage.from("sponsorproof-files").remove([previousLogoPath]);
      setEditing(false);
      setMessage("Event-Details gespeichert.");
    } catch (error) {
      if (uploadedLogoPath) await createClient().storage.from("sponsorproof-files").remove([uploadedLogoPath]);
      const errorMessage = error instanceof Error ? error.message : "";
      setMessage(errorMessage ? `Die Änderungen konnten nicht gespeichert werden: ${errorMessage}` : "Die Änderungen konnten nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <section className="panel event-overview-details">
      <div className="event-details-heading"><div><div className="eyebrow">VERANSTALTUNG</div><h2>Event-Details</h2><p>Zeitraum, Veranstaltungsort, Ansprechperson und Logo.</p></div><button className="btn btn-primary" type="button" onClick={() => { setDraft(details); setLogoFile(null); setRemoveLogo(false); setEditing(true); }}><Icon name="settings" size={15}/> Details bearbeiten</button></div>
      <div className="event-details-grid"><div><span>Zeitraum</span><b>{formatDate(details.startDate)} – {formatDate(details.endDate)}</b></div><div><span>Veranstaltungsort</span><b>{details.location || "Noch nicht hinterlegt"}</b></div><div><span>Ansprechperson</span><b>{[details.contactFirstName, details.contactLastName].filter(Boolean).join(" ") || "Noch nicht hinterlegt"}</b><small>{[details.contactEmail, details.contactPhone].filter(Boolean).join(" · ")}</small></div></div>
      {message && <p className="event-details-message" role="status">{message}</p>}
    </section>
    {editing && <Modal labelledBy="event-details-title" className="create-modal event-details-edit-modal" backdropClassName="modal-backdrop" role="dialog" busy={saving} onClose={() => setEditing(false)}>
        <div className="create-modal-head">
          <div><h2 id="event-details-title">Event-Stammdaten bearbeiten</h2><p>Veranstaltungsdaten und Kontakt für Sponsoren aktualisieren.</p></div>
          <button className="icon-button" type="button" aria-label="Dialog schließen" disabled={saving} onClick={() => setEditing(false)}><Icon name="close" size={16}/></button>
        </div>
        <form onSubmit={save}>
          <section className="event-edit-section">
            <div className="event-edit-section-heading"><h3>Veranstaltung</h3><p>Name, Zeitraum und Ort</p></div>
            <div className="settings-grid">
              <label className="settings-field settings-field-full"><span>Event-Name *</span><input autoFocus autoComplete="off" required maxLength={100} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label className="settings-field"><span>Beginn</span><DatePicker value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} required /></label>
              <label className="settings-field"><span>Ende</span><DatePicker value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} required /></label>
              <EventLocationFields required value={{ street: draft.locationStreet, postalCode: draft.locationPostalCode, city: draft.locationCity }} onChange={(location) => updateLocation({ ...(location.street !== undefined ? { locationStreet: location.street } : {}), ...(location.postalCode !== undefined ? { locationPostalCode: location.postalCode } : {}), ...(location.city !== undefined ? { locationCity: location.city } : {}) })} />
            </div>
          </section>
          <section className="event-edit-section event-edit-contact-section">
            <div className="settings-section-heading"><span className="settings-section-icon"><Icon name="users" size={16}/></span><div><h3>Ansprechperson für Sponsoren</h3><p>Diese Kontaktdaten sehen Sponsoren, wenn sie das Event öffnen.</p></div></div>
            <div className="settings-grid">
              <label className="settings-field"><span>Vorname *</span><input autoComplete="given-name" required value={draft.contactFirstName} onChange={(event) => setDraft({ ...draft, contactFirstName: event.target.value })} /></label>
              <label className="settings-field"><span>Nachname *</span><input autoComplete="family-name" required value={draft.contactLastName} onChange={(event) => setDraft({ ...draft, contactLastName: event.target.value })} /></label>
              <label className="settings-field"><span>E-Mail *</span><input type="email" autoComplete="email" required value={draft.contactEmail} onChange={(event) => setDraft({ ...draft, contactEmail: event.target.value })} /></label>
              <label className="settings-field"><span>Telefon</span><input type="tel" autoComplete="tel" value={draft.contactPhone} onChange={(event) => setDraft({ ...draft, contactPhone: event.target.value })} /></label>
            </div>
          </section>
          <section className="event-edit-section event-edit-logo-section">
            <div className="event-edit-section-heading"><h3>Veranstalter-Logo</h3><p>Wird im Sponsorenbereich bei diesem Event angezeigt.</p></div>
            <div className="event-logo-editor-body">
              <div className="event-logo-preview">{!removeLogo && (logoFilePreview || draft.organizerLogoUrl) ? <img src={logoFilePreview || draft.organizerLogoUrl || ""} alt="Vorschau Veranstalter-Logo"/> : <Icon name="file" size={22}/>}</div>
              <div className="event-logo-controls">
                <label className="btn" htmlFor={`event-logo-${eventId}`}>{logoFile || (!removeLogo && draft.organizerLogoPath) ? "Logo ersetzen" : "Logo auswählen"}<input id={`event-logo-${eventId}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={saving} onChange={chooseLogo}/></label>
                {(logoFile || (!removeLogo && draft.organizerLogoPath)) && <button className="btn" type="button" disabled={saving} onClick={() => { setLogoFile(null); setRemoveLogo(true); }}>Logo entfernen</button>}
                <small>Das Logo wird beim Speichern proportional in einen 1200 × 400-Pixel-Container eingepasst · PNG, JPG oder WebP · maximal 5 MB.</small>
              </div>
            </div>
          </section>
          {message && <p className="field-message error" role="alert" style={{ marginTop: 12 }}>{message}</p>}
          <div className="create-modal-actions"><button className="btn" type="button" disabled={saving} onClick={() => setEditing(false)}>Abbrechen</button><button className="btn btn-primary" type="submit" disabled={!ready || saving}>{saving ? "Wird gespeichert …" : "Speichern"}</button></div>
        </form>
      </Modal>}
  </>;
}
