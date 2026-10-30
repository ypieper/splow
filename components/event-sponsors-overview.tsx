"use client";

import { Modal } from "@/components/modal";
import { CurrencyField } from "@/components/currency-field";
import { useEventEntitlements } from "@/components/event-entitlements";
import { emptySponsorMasterData, SponsorMasterDataFields, type PostalCodeStatus, type SponsorMasterData } from "@/components/sponsor-master-data-fields";
import { EmptyState, Icon, Progress, Status } from "@/components/ui";
import { fetchStoredBenefits } from "@/lib/benefits-storage";
import { formatContractValue, parseContractValue, parseContractValueInput } from "@/lib/event-contract-values";
import { fetchStoredEvidence } from "@/lib/evidence-storage";
import type { Sponsor,SponsorContract } from "@/lib/sponsor-types";
import { addExistingSponsorToEventRecord, createSponsorContractRecord, createSponsorRecord, fetchSponsorRecords, fetchSponsorRecordsForEvent, removeSponsorFromEventRecord, type SponsorRecord } from "@/lib/sponsors-storage";
import { createClient } from "@/lib/supabase/client";
import { fetchStoredTasks } from "@/lib/tasks-storage";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type ContractSummary = { status: "Offen" | "In Arbeit" | "Erledigt"; progress: number };
type EventBenefit = { id?: string; title: string; sponsorId: string; eventId: string };
type SponsorInvitationCode = { code: string; redeemedAt: string | null };

export function EventSponsorsOverview({ eventId, eventTitle = "Event", sponsors, contracts, benefits, databaseBacked = false }: {
  eventId: string;
  eventTitle?: string;
  sponsors: Sponsor[];
  contracts: SponsorContract[];
  benefits: EventBenefit[];
  databaseBacked?: boolean;
}) {
  const { getEntitlement, loadEntitlement, requestUpgrade, ensureFeature } = useEventEntitlements();
  const [summaries, setSummaries] = useState<Record<string, ContractSummary>>({});
  const [databaseRecords, setDatabaseRecords] = useState<SponsorRecord[]>([]);
  const [databaseLoading, setDatabaseLoading] = useState(databaseBacked);
  const [addingSponsor, setAddingSponsor] = useState(false);
  const [addMode, setAddMode] = useState<"existing" | "new">("existing");
  const [libraryRecords, setLibraryRecords] = useState<SponsorRecord[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [sponsorSearch, setSponsorSearch] = useState("");
  const [selectedSponsorId, setSelectedSponsorId] = useState("");
  const [masterData, setMasterData] = useState<SponsorMasterData>(emptySponsorMasterData);
  const [postalCodeStatus, setPostalCodeStatus] = useState<PostalCodeStatus>("idle");
  const [contractValue, setContractValue] = useState("");
  const [sponsorLogoFile, setSponsorLogoFile] = useState<File | null>(null);
  const [sponsorWizardStep, setSponsorWizardStep] = useState(1);
  const [savingSponsor, setSavingSponsor] = useState(false);
  const [addedSponsor, setAddedSponsor] = useState<SponsorRecord | null>(null);
  const [databaseError, setDatabaseError] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<Sponsor | null>(null);
  const [removingSponsor, setRemovingSponsor] = useState(false);
  const [contractSponsor, setContractSponsor] = useState<Sponsor | null>(null);
  const [contractValueDraft, setContractValueDraft] = useState("");
  const [savingContract, setSavingContract] = useState(false);
  const [contractsEnabled, setContractsEnabled] = useState(false);
  const [invitationCodes, setInvitationCodes] = useState<Record<string, SponsorInvitationCode>>({});
  const [creatingCodeFor, setCreatingCodeFor] = useState("");
  const [copiedCodeFor, setCopiedCodeFor] = useState("");
  const displaySponsors = useMemo(() => databaseBacked ? databaseRecords.map((record) => record.sponsor) : sponsors, [databaseBacked, databaseRecords, sponsors]);
  const displayContracts = useMemo(() => databaseBacked ? databaseRecords.flatMap((record) => record.contracts) : contracts, [databaseBacked, databaseRecords, contracts]);
  const availableLibrarySponsors = libraryRecords.filter((record) => !record.sponsor.eventIds.includes(eventId));
  const normalizedSearch = sponsorSearch.trim().toLocaleLowerCase("de-DE");
  const filteredLibrarySponsors = availableLibrarySponsors.filter(({ sponsor }) =>
    !normalizedSearch || [sponsor.name, sponsor.email, sponsor.contactFirstName, sponsor.contactLastName]
      .some((value) => value?.toLocaleLowerCase("de-DE").includes(normalizedSearch)),
  );

  useEffect(() => {
    if (!databaseBacked) return;
    fetchSponsorRecordsForEvent(eventId).then(({ data, error }) => {
      if (error) setDatabaseError(`Sponsoren konnten nicht geladen werden: ${error.message}`);
      else setDatabaseRecords(data ?? []);
    }).catch(() => setDatabaseError("Sponsoren konnten nicht aus Supabase geladen werden.")).finally(() => setDatabaseLoading(false));
  }, [databaseBacked, eventId]);

  useEffect(() => {
    if (!databaseBacked || databaseLoading) return;
    let active = true;
    void fetch(`/api/events/${eventId}/sponsor-invitation-codes`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Einladungscodes konnten nicht geladen werden.");
        return result as { codes?: Array<{ sponsorId: string; code: string; redeemedAt: string | null }> };
      })
      .then(({ codes }) => {
        if (!active) return;
        setInvitationCodes((current) => {
          const next = { ...current };
          Object.keys(next).filter((key) => key.startsWith(`${eventId}:`)).forEach((key) => delete next[key]);
          (codes ?? []).forEach(({ sponsorId, code, redeemedAt }) => { next[`${eventId}:${sponsorId}`] = { code, redeemedAt }; });
          return next;
        });
      })
      .catch(() => { if (active) setDatabaseError("Einladungscodes konnten nicht geladen werden."); });
    return () => { active = false; };
  }, [databaseBacked, databaseLoading, displaySponsors, eventId]);

  useEffect(() => {
    if (!addingSponsor || !databaseBacked) return;
    setLibraryLoading(true);
    fetchSponsorRecords().then(({ data, error }) => {
      if (error) setDatabaseError(`Sponsorenbibliothek konnte nicht geladen werden: ${error.message}`);
      else setLibraryRecords(data ?? []);
    }).catch(() => setDatabaseError("Sponsorenbibliothek konnte nicht geladen werden.")).finally(() => setLibraryLoading(false));
  }, [addingSponsor, databaseBacked]);

  useEffect(() => {
    let active = true;
    const loadAccess = async () => {
      const entitlement = getEntitlement(eventId) ?? await loadEntitlement(eventId);
      if (active) setContractsEnabled(Boolean(entitlement?.entitlement_status === "active" && entitlement.plan.features.contracts));
    };
    void loadAccess();
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ eventId?: string }>).detail;
      if (!detail?.eventId || detail.eventId === eventId) void loadAccess();
    };
    window.addEventListener("sponso:event-entitlement-updated", refresh);
    return () => { active = false; window.removeEventListener("sponso:event-entitlement-updated", refresh); };
  }, [eventId, getEntitlement, loadEntitlement]);

  function openAddSponsorForm() {
    setAddedSponsor(null);
    setDatabaseError("");
    setAddMode("existing");
    setSelectedSponsorId("");
    setSponsorSearch("");
    setMasterData(emptySponsorMasterData);
    setPostalCodeStatus("idle");
    setContractValue("");
    setSponsorLogoFile(null);
    setSponsorWizardStep(1);
    setAddingSponsor(true);
  }

  async function saveSponsor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = contractValue.trim() ? parseContractValueInput(contractValue) : null;
    if (sponsorLogoFile && (!sponsorLogoFile.type.startsWith("image/") || sponsorLogoFile.size > 5 * 1024 * 1024)) {
      setDatabaseError("Bitte wähle ein Bild bis maximal 5 MB.");
      return;
    }
    if (addMode === "new" && postalCodeStatus !== "valid" && !(postalCodeStatus === "unavailable" && masterData.city.trim())) {
      setDatabaseError(postalCodeStatus === "invalid" ? "Bitte gib eine gültige PLZ ein." : postalCodeStatus === "unavailable" ? "Bitte trage den Ort manuell ein, wenn die PLZ-Prüfung gerade nicht verfügbar ist." : "Bitte warte, bis die PLZ geprüft wurde.");
      return;
    }
    if ((addMode === "new" && !masterData.name.trim()) || (addMode === "existing" && !selectedSponsorId) || (amount !== null && (!Number.isFinite(amount) || amount < 0)) || savingSponsor) return;
    setSavingSponsor(true);
    setDatabaseError("");
    try {
      const result = addMode === "existing"
        ? await addExistingSponsorToEventRecord(eventId, selectedSponsorId, contractsEnabled && amount !== null ? Math.round(amount * 100) : undefined)
        : await createSponsorRecord({ ...masterData, eventId, name: masterData.name.trim(), valueCents: contractsEnabled && amount !== null ? Math.round(amount * 100) : undefined });
      if (result.error || !result.data) {
        if (result.error?.message.includes("SPONSOR_LIMIT_REACHED")) requestUpgrade(eventId, eventTitle, "Das Sponsorenlimit dieses Tarifs ist erreicht.");
        setDatabaseError(result.error?.message.includes("SPONSOR_LIMIT_REACHED") ? "Das Sponsorenlimit dieses Events ist erreicht. Wähle im Dialog einen höheren Tarif oder löse einen Code ein." : `Sponsor konnte nicht gespeichert werden: ${result.error?.message ?? "Bitte versuche es erneut."}`);
        return;
      }
      let savedRecord = result.data;
      const supabase = createClient();
      if (addMode === "existing") {
        const { error: contactError } = await supabase.from("sponsors").update({
          contact_first_name: masterData.contactFirstName.trim() || null,
          contact_last_name: masterData.contactLastName.trim() || null,
          email: masterData.email.trim() || null,
          phone: masterData.phone.trim() || null,
        }).eq("id", savedRecord.sponsor.id);
        if (contactError) throw contactError;
        savedRecord = { ...savedRecord, sponsor: { ...savedRecord.sponsor, contactFirstName: masterData.contactFirstName, contactLastName: masterData.contactLastName, email: masterData.email, phone: masterData.phone } };
      }
      if (sponsorLogoFile) {
        const { data: organizationId, error: organizationError } = await supabase.rpc("current_organization_id");
        if (organizationError || typeof organizationId !== "string") throw organizationError ?? new Error("Der Veranstalterbereich konnte nicht ermittelt werden.");
        const extension = sponsorLogoFile.type === "image/png" ? "png" : sponsorLogoFile.type === "image/webp" ? "webp" : "jpg";
        const logoPath = `${organizationId}/sponsors/${savedRecord.sponsor.id}/branding/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("sponsorproof-files").upload(logoPath, sponsorLogoFile, { contentType: sponsorLogoFile.type, upsert: false });
        if (uploadError) throw uploadError;
        const { error: logoError } = await supabase.from("sponsors").update({ logo_path: logoPath }).eq("id", savedRecord.sponsor.id);
        if (logoError) {
          await supabase.storage.from("sponsorproof-files").remove([logoPath]);
          throw logoError;
        }
        savedRecord = { ...savedRecord, sponsor: { ...savedRecord.sponsor, logoPath } };
      }
      setDatabaseRecords((current) => [...current, savedRecord].sort((a, b) => a.sponsor.name.localeCompare(b.sponsor.name, "de")));
      window.dispatchEvent(new CustomEvent("sponsorproof:event-sponsors-updated", { detail: { eventId, record: savedRecord } }));
      setAddedSponsor(savedRecord);
      setMasterData(emptySponsorMasterData);
      setPostalCodeStatus("idle");
      setContractValue("");
      setSponsorLogoFile(null);
      setSelectedSponsorId("");
      setSponsorSearch("");
      setAddMode("existing");
    } catch {
      setDatabaseError("Sponsor konnte nicht gespeichert werden. Bitte prüfe deine Verbindung.");
    } finally {
      setSavingSponsor(false);
    }
  }

  function advanceSponsorWizard() {
    setDatabaseError("");
    if (sponsorWizardStep === 1) {
      if (addMode === "existing" && !selectedSponsorId) return;
      if (addMode === "new" && (!masterData.name.trim() || !masterData.street.trim() || !masterData.streetNumber.trim() || !masterData.postalCode.trim() || !masterData.city.trim())) {
        setDatabaseError("Bitte ergänze die Pflichtangaben zu Sponsor und Anschrift.");
        return;
      }
      if (addMode === "new" && postalCodeStatus !== "valid" && !(postalCodeStatus === "unavailable" && masterData.city.trim())) {
        setDatabaseError(postalCodeStatus === "invalid" ? "Bitte gib eine gültige PLZ ein." : "Bitte warte, bis die PLZ geprüft wurde.");
        return;
      }
    }
    if (sponsorWizardStep === 2 && (!masterData.contactFirstName.trim() || !masterData.contactLastName.trim() || !masterData.email.trim())) {
      setDatabaseError("Bitte ergänze Name und E-Mail der Ansprechperson.");
      return;
    }
    setSponsorWizardStep((step) => Math.min(4, step + 1));
  }

  async function openContractCreation(sponsor: Sponsor) {
    if (!(await ensureFeature(eventId, eventTitle, "contracts"))) return;
    setContractValueDraft("");
    setContractSponsor(sponsor);
  }

  async function saveContractForSponsor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contractSponsor || savingContract) return;
    const amount = parseContractValueInput(contractValueDraft);
    if (!Number.isFinite(amount) || amount < 0) return;
    if (!(await ensureFeature(eventId, eventTitle, "contracts"))) return;
    setSavingContract(true);
    const result = await createSponsorContractRecord(eventId, contractSponsor.id, Math.round(amount * 100));
    if (result.error || !result.data) {
      if (result.error?.message.includes("EVENT_FEATURE_REQUIRED")) requestUpgrade(eventId, eventTitle, "Verträge erstellen und verwalten");
      setDatabaseError("Der Vertrag konnte nicht angelegt werden. Prüfe den Basic-Tarif und versuche es erneut.");
    } else {
      setDatabaseRecords((current) => current.map((record) => record.sponsor.id === contractSponsor.id ? { ...record, contracts: [...record.contracts, result.data!] } : record));
      setContractSponsor(null);
      setDatabaseError("");
      window.dispatchEvent(new CustomEvent("sponsorproof:event-sponsors-updated", { detail: { eventId } }));
    }
    setSavingContract(false);
  }

  async function confirmRemoveSponsor() {
    if (!pendingRemoval || removingSponsor) return;
    setRemovingSponsor(true);
    setDatabaseError("");
    try {
      const result = await removeSponsorFromEventRecord(eventId, pendingRemoval.id);
      if (result.error) {
        setDatabaseError(`Sponsor konnte nicht aus dem Event entfernt werden: ${result.error.message}`);
        return;
      }
      if (!result.removed) {
        setDatabaseError("Der Sponsor ist diesem Event nicht mehr zugeordnet.");
        return;
      }
      setDatabaseRecords((current) => current.filter((record) => record.sponsor.id !== pendingRemoval.id));
      setPendingRemoval(null);
      window.dispatchEvent(new CustomEvent("sponsorproof:event-sponsors-updated", { detail: { eventId } }));
    } catch {
      setDatabaseError("Sponsor konnte nicht aus dem Event entfernt werden. Bitte prüfe deine Verbindung.");
    } finally {
      setRemovingSponsor(false);
    }
  }

  async function createInvitationCode(sponsorId: string) {
    if (creatingCodeFor) return;
    setCreatingCodeFor(sponsorId);
    setDatabaseError("");
    try {
      const { data, error } = await createClient().rpc("create_sponsor_event_code", {
        target_event_id: eventId,
        target_sponsor_id: sponsorId,
        target_expires_at: null,
      });
      if (error || typeof data !== "string") throw error ?? new Error("Der Einladungscode konnte nicht erstellt werden.");
      setInvitationCodes((current) => ({ ...current, [`${eventId}:${sponsorId}`]: { code: data, redeemedAt: null } }));
    } catch {
      setDatabaseError("Der Einladungscode konnte nicht erstellt werden. Bitte prüfe deine Verbindung und den Zugriff auf das Event.");
    } finally {
      setCreatingCodeFor("");
    }
  }

  async function copyInvitationCode(sponsorId: string, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCodeFor(sponsorId);
      window.setTimeout(() => setCopiedCodeFor((current) => current === sponsorId ? "" : current), 1800);
    } catch {
      setDatabaseError("Der Code konnte nicht kopiert werden. Bitte markiere ihn und kopiere ihn manuell.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadSummaries() {
      try {
        const [evidenceResult, benefitResult, taskResult] = await Promise.all([fetchStoredEvidence(), fetchStoredBenefits(eventId), fetchStoredTasks(eventId)]);
        if (evidenceResult.error || benefitResult.error || taskResult.error) throw new Error("Eventfortschritt konnte nicht geladen werden.");
        const evidence = new Set((evidenceResult.data ?? []).map((item) => item.taskId));
        const next: Record<string, ContractSummary> = {};
        for (const contract of displayContracts) {
          const signedOn = contract.signedAt;
          if (!signedOn) {
            next[contract.id] = { status: "Offen", progress: 0 };
            continue;
          }
          const contractBenefits = (benefitResult.data ?? []).filter((benefit) => benefit.eventId === eventId && benefit.sponsorId === contract.sponsorId);
          const contractTasks = (taskResult.data ?? []).filter((task) => task.event_id === eventId && (task.sponsor_id === contract.sponsorId || (!task.sponsor_id && task.sponsor_name === displaySponsors.find((item) => item.id === contract.sponsorId)?.name)));
          const benefitsWithSubtasks = new Set(contractTasks.filter((task) => task.source === "Leistung" && task.benefit_id).map((task) => task.benefit_id));
          const legacyBenefits = contractBenefits.filter((benefit) => !benefitsWithSubtasks.has(benefit.id));
          const taskIds = [
            ...legacyBenefits.map((benefit) => `benefit-${benefit.id}`),
            ...contractTasks.map((task) => task.id),
          ];
          const completed = taskIds.filter((id) => evidence.has(id) || contractTasks.some((task) => task.id === id && task.status === "Erledigt") || legacyBenefits.some((benefit) => `benefit-${benefit.id}` === id && (benefit.status === "Erfüllt" || benefit.status === "Erledigt"))).length;
          const progress = taskIds.length ? Math.round(completed / taskIds.length * 100) : 0;
          next[contract.id] = { status: taskIds.length > 0 && completed === taskIds.length ? "Erledigt" : "In Arbeit", progress };
        }
        if (!cancelled) {
          setSummaries(next);
        }
      } catch {
        if (!cancelled) {
          setSummaries(Object.fromEntries(displayContracts.map((contract) => {
            const signedOn = contract.signedAt;
            const status = !signedOn ? "Offen" : contract.progress >= 100 ? "Erledigt" : "In Arbeit";
            return [contract.id, { status, progress: status === "Offen" ? 0 : contract.progress }];
          })) as Record<string, ContractSummary>);
        }
      }
    }
    void loadSummaries();
    return () => { cancelled = true; };
  }, [eventId, displaySponsors, displayContracts, benefits]);

  return <><section className="panel table-panel event-sponsors-panel"><div className="table-head"><div><h2>Sponsoren im Überblick</h2><p className="subtitle" style={{ fontSize: 11, marginTop: 4 }}>Wähle einen Sponsor, um Vertrag und vereinbarte Einzelleistungen dieses Events zu sehen.</p></div>{databaseBacked && <button className="btn btn-primary" type="button" onClick={openAddSponsorForm}><Icon name="plus" size={14}/> Sponsor hinzufügen</button>}</div>{databaseError && <p className="field-message error" role="alert">{databaseError}</p>}{databaseBacked && databaseLoading ? <p className="task-empty">Sponsoren werden geladen …</p> : displaySponsors.length === 0 ? <EmptyState className="empty-state-compact" title="Noch keine Sponsoren" description="Füge den ersten Sponsor zu diesem Event hinzu, um Vereinbarungen festzuhalten." action={databaseBacked ? <button className="btn btn-primary" type="button" onClick={openAddSponsorForm}><Icon name="plus" size={14}/> Sponsor hinzufügen</button> : undefined} /> : <div className="adaptive-table-wrap event-sponsor-table-wrap"><table className="table adaptive-data-table event-sponsor-data-table"><thead><tr><th>Sponsor</th><th>Vertragswert netto</th><th>Erfüllung</th><th>Status</th><th>Einladungscode</th><th>Aktionen</th></tr></thead><tbody>{displaySponsors.map((sponsor) => {
    const contract = displayContracts.find((item) => item.sponsorId === sponsor.id);
    const sponsorContract = contract;
    const initialSignedOn = sponsorContract?.signedAt;
    const codeKey = `${eventId}:${sponsor.id}`;
    const invitationCode = invitationCodes[codeKey];
    const codeControl = <div className="event-sponsor-invitation-code">{invitationCode ? <button className="btn event-sponsor-code-copy" type="button" onClick={() => void copyInvitationCode(sponsor.id, invitationCode.code)}>{copiedCodeFor === sponsor.id ? "Kopiert" : "Kopieren"}</button> : <button className="btn" type="button" disabled={Boolean(creatingCodeFor)} onClick={() => { void createInvitationCode(sponsor.id); }}>{creatingCodeFor === sponsor.id ? "Code wird erstellt …" : "Einladungscode erstellen"}</button>}</div>;
    if (!sponsorContract) return <tr key={sponsor.id}><td data-label="Sponsor"><Link href={`/events/${eventId}?tab=sponsoren&sponsor=${sponsor.id}`} className="sponsor-name"><span className="sponsor-mark" style={{ background: sponsor.color, color: "white" }}>{sponsor.initials}</span><b>{sponsor.name}</b></Link></td><td data-label="Vertragswert netto">—</td><td data-label="Erfüllung">—</td><td data-label="Status"><span className="status status-locked">Daten unvollständig</span></td><td data-label="Einladungscode">{codeControl}</td><td data-label="Aktionen"><div className="event-sponsor-table-actions"><button className="btn btn-primary" type="button" onClick={() => { void openContractCreation(sponsor); }}>{contractsEnabled ? "Sponsor vervollständigen" : "Freischalten"}</button><button className="btn btn-danger event-sponsor-remove" type="button" onClick={() => { setDatabaseError(""); setPendingRemoval(sponsor); }}>Entfernen</button></div></td></tr>;
    const summary = summaries[sponsorContract.id] ?? { status: !initialSignedOn ? "Offen" as const : "In Arbeit" as const, progress: initialSignedOn ? sponsorContract.progress : 0 };
    const contractAmount = parseContractValue(sponsorContract.value);
    return <tr key={sponsorContract.id}><td data-label="Sponsor"><Link href={`/events/${eventId}?tab=sponsoren&sponsor=${sponsor.id}`} className="sponsor-name"><span className="sponsor-mark" style={{ background: sponsor.color, color: "white" }}>{sponsor.initials}</span><b>{sponsor.name}</b></Link></td><td data-label="Vertragswert netto">{formatContractValue(contractAmount)}</td><td data-label="Erfüllung"><Progress value={summary.progress}/></td><td data-label="Status"><Status value={summary.status}/></td><td data-label="Einladungscode">{codeControl}</td><td data-label="Aktionen"><div className="event-sponsor-table-actions"><button className="btn btn-danger event-sponsor-remove" type="button" onClick={() => { setDatabaseError(""); setPendingRemoval(sponsor); }}>Entfernen</button></div></td></tr>;
  })}</tbody></table></div>}</section>{addingSponsor && <Modal labelledBy="add-event-sponsor-title" className="create-modal add-event-sponsor-modal" backdropClassName="modal-backdrop" role="dialog" busy={savingSponsor} onClose={() => setAddingSponsor(false)}>
      <div className="create-modal-head">
        <div><h2 id="add-event-sponsor-title">{addedSponsor ? "Sponsor ist zugeordnet" : "Sponsor zum Event hinzufügen"}</h2><p>{addedSponsor ? "Als Nächstes legst du die vereinbarten Leistungen fest. Daraus kannst du anschließend Aufgaben ableiten und den Vertrag vervollständigen." : "Ordne einen Sponsor zu, trage den Vertragswert optional ein und ergänze danach die Leistungen – alles in einem geführten Ablauf."}</p></div>
        <button className="icon-button" type="button" aria-label="Dialog schließen" disabled={savingSponsor} onClick={() => setAddingSponsor(false)}><Icon name="close" size={16}/></button>
      </div>
      {addedSponsor ? <div className="add-sponsor-success">
        <ol className="sponsor-wizard-progress" aria-label="Schritt 5 von 5">{["Stammdaten Event", "Ansprechperson", "Logo · optional", "Vertragswert", "Leistungen öffnen"].map((label, index) => <li key={label} className={index < 4 ? "complete" : "active"}><span>{index < 4 ? <Icon name="check" size={12}/> : 5}</span><small>{label}</small></li>)}</ol>
        <div className="add-sponsor-success-summary"><span className="sponsor-mark" style={{ background: addedSponsor.sponsor.color, color: "white" }}>{addedSponsor.sponsor.initials}</span><div><b>{addedSponsor.sponsor.name}</b><span>{addedSponsor.contracts.length ? `Vertragswert: ${formatContractValue(parseContractValue(addedSponsor.contracts[0].value))}` : "Sponsor dem Event zugeordnet"}</span></div><span className="add-sponsor-assignment-status"><Icon name="check" size={13}/> Zugeordnet</span></div>
        <ol className="add-sponsor-next-steps" aria-label="Nächste Schritte"><li className="complete"><span>1</span>Stammdaten</li><li className="complete"><span>2</span>Ansprechperson</li><li className="complete"><span>3</span>Logo optional</li><li className={addedSponsor.contracts.length ? "complete" : "pending"}><span>4</span>{addedSponsor.contracts.length ? "Vertragswert festgelegt" : "Vertragswert hinterlegt"}</li><li className="pending"><span>5</span>Leistungen öffnen</li></ol>
        <div className="create-modal-actions"><button className="btn" type="button" onClick={() => setAddingSponsor(false)}>Später</button>{addedSponsor.contracts.length ? <Link className="btn btn-primary" href={`/events/${eventId}?tab=sponsoren&sponsor=${addedSponsor.sponsor.id}`}>Leistungen öffnen <Icon name="chevron" size={14}/></Link> : <button className="btn btn-primary" type="button" onClick={() => { setAddingSponsor(false); void openContractCreation(addedSponsor.sponsor); }}>Vertragswert hinterlegen <Icon name="chevron" size={14}/></button>}</div>
      </div> : <form onSubmit={saveSponsor}>
        <ol className="sponsor-wizard-progress" aria-label={`Schritt ${sponsorWizardStep} von 5`}>
          {["Stammdaten Event", "Ansprechperson", "Logo · optional", "Vertragswert", "Leistungen öffnen"].map((label, index) => <li key={label} className={index + 1 === sponsorWizardStep ? "active" : index + 1 < sponsorWizardStep ? "complete" : ""}><span>{index + 1 < sponsorWizardStep ? <Icon name="check" size={12}/> : index + 1}</span><small>{label}</small></li>)}
        </ol>
        <div className="add-event-sponsor-content">
          {sponsorWizardStep === 1 && <>
          {addMode === "existing" ? <>
            <div className="add-sponsor-step-heading"><span>1</span><div><h3>Sponsor auswählen</h3><p>Wähle einen bestehenden Eintrag oder lege neue Stammdaten an.</p></div></div>
            <label className="settings-field add-sponsor-search"><span>Bibliothek durchsuchen</span><input type="search" value={sponsorSearch} onChange={(event) => setSponsorSearch(event.target.value)} placeholder="Name oder Ansprechperson" /></label>
            {libraryLoading ? <p className="task-empty">Sponsorenbibliothek wird geladen …</p> : filteredLibrarySponsors.length ? <div className="add-sponsor-library-list" role="radiogroup" aria-label="Sponsor aus der Bibliothek auswählen">
              {filteredLibrarySponsors.map(({ sponsor }) => {
                const contact = [sponsor.contactFirstName, sponsor.contactLastName].filter(Boolean).join(" ");
                return <label key={sponsor.id} className={`add-sponsor-library-option ${selectedSponsorId === sponsor.id ? "selected" : ""}`}>
                  <input type="radio" name="library-sponsor" value={sponsor.id} checked={selectedSponsorId === sponsor.id} onChange={() => { setSelectedSponsorId(sponsor.id); setMasterData({ ...emptySponsorMasterData, name: sponsor.name, contactFirstName: sponsor.contactFirstName ?? "", contactLastName: sponsor.contactLastName ?? "", email: sponsor.email ?? "", phone: sponsor.phone ?? "" }); }} />
                  <span className="sponsor-mark" style={sponsor.color ? { background: sponsor.color, color: "white" } : undefined}>{sponsor.initials}</span>
                  <span className="add-sponsor-library-copy"><b>{sponsor.name}</b><small>{contact || sponsor.email || "Keine Ansprechperson hinterlegt"}</small></span>
                </label>;
              })}
            </div> : availableLibrarySponsors.length ? <p className="add-sponsor-no-results">Keine passenden Sponsoren gefunden.</p> : <div className="add-sponsor-library-empty"><p>Alle Sponsoren der Bibliothek sind diesem Event bereits zugeordnet.</p><button className="btn" type="button" onClick={() => setAddMode("new")}>Neuen Sponsor anlegen</button></div>}
            {availableLibrarySponsors.length > 0 && !libraryLoading && <button className="add-sponsor-new-link" type="button" onClick={() => { setAddMode("new"); setDatabaseError(""); }}>Neuen Sponsor anlegen</button>}
          </> : <>
            <div className="add-sponsor-new-heading"><div><div className="add-sponsor-step-heading"><span>1</span><div><h3>Neuen Sponsor anlegen</h3><p>Die Stammdaten werden deiner Bibliothek hinzugefügt.</p></div></div></div><button className="add-sponsor-new-link" type="button" onClick={() => setAddMode("existing")}>Zur Bibliothek</button></div>
            <SponsorMasterDataFields section="company" value={masterData} onChange={setMasterData} onPostalCodeStatusChange={setPostalCodeStatus} />
          </>}
          </>}
          {sponsorWizardStep === 2 && <>
            <div className="add-sponsor-step-heading"><span>2</span><div><h3>Ansprechperson hinzufügen</h3><p>So lassen sich Rückfragen und Vertragsunterlagen direkt zuordnen.</p></div></div>
            <SponsorMasterDataFields section="contact" value={masterData} onChange={setMasterData} onPostalCodeStatusChange={setPostalCodeStatus} />
          </>}
          {sponsorWizardStep === 3 && <section className="sponsor-logo-step">
            <div className="add-sponsor-step-heading"><span>3</span><div><h3>Logo hinzufügen <small>Optional</small></h3><p>Ein Logo hilft, den Sponsor in Übersichten schnell wiederzuerkennen.</p></div></div>
            <label className="settings-field"><span>Bilddatei (PNG, JPG oder WebP; bis 5 MB)</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(uploadEvent) => { setDatabaseError(""); setSponsorLogoFile(uploadEvent.target.files?.[0] ?? null); }} /></label>
            {sponsorLogoFile && <p className="sponsor-logo-selected"><Icon name="check" size={13}/> {sponsorLogoFile.name}</p>}
            <button className="add-sponsor-new-link" type="button" onClick={() => { setSponsorLogoFile(null); setSponsorWizardStep(4); }}>Ohne Logo fortfahren <Icon name="chevron" size={12}/></button>
          </section>}
          {sponsorWizardStep === 4 && (contractsEnabled ? <section className="add-sponsor-contract-section">
            <div className="add-sponsor-step-heading"><span>4</span><div><h3>Vertragswert für dieses Event</h3><p>Du kannst den Nettobetrag jetzt eintragen oder später im Vertrag ergänzen.</p></div></div>
            <label className="settings-field"><span>Vertragswert netto (€) · optional</span><CurrencyField ariaLabel="Vertragswert netto in Euro" value={contractValue} onChange={setContractValue} /></label>
          </section> : <section className="add-sponsor-contract-section add-sponsor-upgrade-note"><div className="add-sponsor-step-heading"><span><Icon name="lock" size={14}/></span><div><h3>Vertrag und Vertragswert</h3><p>Ein Vertrag kann nach der Freischaltung eines Tarifs für dieses Event angelegt werden.</p></div></div><button className="btn" type="button" onClick={() => requestUpgrade(eventId, eventTitle, "Verträge und Vertragswerte")}>Tarife ansehen</button></section>)}
        </div>
        {databaseError && <p className="field-message error" role="alert" style={{ marginTop: 14 }}>{databaseError}</p>}
        <div className="create-modal-actions"><button className="btn" type="button" disabled={savingSponsor} onClick={() => sponsorWizardStep === 1 ? setAddingSponsor(false) : (setDatabaseError(""), setSponsorWizardStep((step) => Math.max(1, step - 1)))}>{sponsorWizardStep === 1 ? "Abbrechen" : "Zurück"}</button>{sponsorWizardStep < 4 ? <button className="btn btn-primary" type="button" disabled={sponsorWizardStep === 1 && (libraryLoading || (addMode === "existing" && (!selectedSponsorId || !availableLibrarySponsors.some((record) => record.sponsor.id === selectedSponsorId))))} onClick={advanceSponsorWizard}>Weiter <Icon name="chevron" size={14}/></button> : <button className="btn btn-primary" type="submit" disabled={savingSponsor}>{savingSponsor ? "Wird gespeichert …" : "Sponsor hinzufügen"}</button>}</div>
      </form>}
    </Modal>}{contractSponsor && <Modal labelledBy="create-sponsor-contract-title" className="create-modal" backdropClassName="modal-backdrop" role="dialog" busy={savingContract} onClose={() => setContractSponsor(null)}><div className="create-modal-head"><div><h2 id="create-sponsor-contract-title">Sponsor vervollständigen</h2><p>Lege für {contractSponsor.name} den Vertragswert für dieses Event fest. Danach kannst du den Vertrag und die vereinbarten Leistungen ergänzen.</p></div><button className="icon-button" type="button" aria-label="Dialog schließen" disabled={savingContract} onClick={() => setContractSponsor(null)}><Icon name="close" size={16}/></button></div><form onSubmit={saveContractForSponsor}><label className="settings-field"><span>Vertragswert netto (€) *</span><CurrencyField ariaLabel="Vertragswert netto in Euro" required value={contractValueDraft} onChange={setContractValueDraft}/></label>{databaseError && <p className="field-message error" role="alert">{databaseError}</p>}<div className="create-modal-actions"><button className="btn" type="button" disabled={savingContract} onClick={() => setContractSponsor(null)}>Abbrechen</button><button className="btn btn-primary" type="submit" disabled={savingContract || !contractValueDraft.trim()}>{savingContract ? "Wird gespeichert …" : "Vertrag anlegen"}</button></div></form></Modal>}{pendingRemoval && <Modal labelledBy="remove-event-sponsor-title" className="create-modal" backdropClassName="modal-backdrop" role="dialog" busy={removingSponsor} onClose={() => setPendingRemoval(null)}><div className="create-modal-head"><div><h2 id="remove-event-sponsor-title">Sponsor aus Event entfernen?</h2><p>„{pendingRemoval.name}“ wird aus diesem Event entfernt. Der Vertrag und die zugehörigen Leistungen und Aufgaben werden gelöscht; die Sponsor-Stammdaten bleiben erhalten.</p></div><button className="icon-button" type="button" aria-label="Dialog schließen" disabled={removingSponsor} onClick={() => setPendingRemoval(null)}><Icon name="close" size={16}/></button></div>{databaseError && <p className="field-message error" role="alert">{databaseError}</p>}<div className="create-modal-actions"><button className="btn" type="button" disabled={removingSponsor} onClick={() => setPendingRemoval(null)}>Abbrechen</button><button className="btn btn-danger" type="button" disabled={removingSponsor} onClick={() => void confirmRemoveSponsor()}>{removingSponsor ? "Wird entfernt …" : "Aus Event entfernen"}</button></div></Modal>}</>;
}
