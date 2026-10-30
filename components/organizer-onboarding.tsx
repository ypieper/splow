"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Icon, SplowLogo } from "@/components/ui";
import { LogoutButton } from "@/components/logout-button";

type OnboardingData = {
  firstName: string;
  lastName: string;
  requiresOrganizationDetails: boolean;
  organization: { organization: string; street: string; streetNumber: string; postalCode: string; city: string };
};

type PostalCodeStatus = "idle" | "loading" | "valid" | "invalid" | "unavailable";

const emptyData: OnboardingData = {
  firstName: "",
  lastName: "",
  requiresOrganizationDetails: true,
  organization: { organization: "", street: "", streetNumber: "", postalCode: "", city: "" },
};

export function OrganizerOnboarding() {
  const [data, setData] = useState<OnboardingData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [postalCodeStatus, setPostalCodeStatus] = useState<PostalCodeStatus>("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/onboarding", { cache: "no-store" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Deine Angaben konnten nicht geladen werden.");
      if (active) setData(result as OnboardingData);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Deine Angaben konnten nicht geladen werden.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loading || !data.requiresOrganizationDetails) return;
    const postalCode = data.organization.postalCode;
    if (!/^\d{5}$/.test(postalCode)) {
      setPostalCodeStatus(postalCode ? "invalid" : "idle");
      if (data.organization.city) setData((current) => ({ ...current, organization: { ...current.organization, city: "" } }));
      return;
    }

    const controller = new AbortController();
    setPostalCodeStatus("loading");
    const timeout = window.setTimeout(() => {
      void fetch(`/api/postal-code?postalCode=${encodeURIComponent(postalCode)}`, { signal: controller.signal })
        .then(async (response) => ({ response, result: await response.json() as { valid?: boolean; city?: string } }))
        .then(({ response, result }) => {
          if (controller.signal.aborted) return;
          if (!response.ok || !result.valid || !result.city) {
            setPostalCodeStatus(response.status === 503 ? "unavailable" : "invalid");
            setData((current) => current.organization.postalCode === postalCode ? { ...current, organization: { ...current.organization, city: "" } } : current);
            return;
          }
          setPostalCodeStatus("valid");
          setData((current) => current.organization.postalCode === postalCode ? { ...current, organization: { ...current.organization, city: result.city! } } : current);
        }).catch(() => {
          if (!controller.signal.aborted) setPostalCodeStatus("unavailable");
        });
    }, 300);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [data.organization.postalCode, data.requiresOrganizationDetails, loading]);

  function updateOrganization(field: keyof OnboardingData["organization"], value: string) {
    setData((current) => ({ ...current, organization: { ...current.organization, [field]: value } }));
  }

  function updatePostalCode(value: string) {
    updateOrganization("postalCode", value.replace(/\D/g, "").slice(0, 5));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (data.requiresOrganizationDetails && postalCodeStatus !== "valid" && !(postalCodeStatus === "unavailable" && data.organization.city.trim())) {
      setError(postalCodeStatus === "unavailable" ? "Bitte trage den Ort manuell ein, wenn die PLZ-Prüfung gerade nicht verfügbar ist." : "Bitte gib eine gültige PLZ ein.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: data.firstName, lastName: data.lastName, ...(data.requiresOrganizationDetails ? data.organization : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Die Angaben konnten nicht gespeichert werden.");
      window.location.replace("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Die Angaben konnten nicht gespeichert werden.");
      setSaving(false);
    }
  }

  const postalMessage = postalCodeStatus === "invalid" ? "Bitte gib eine gültige PLZ ein."
    : postalCodeStatus === "unavailable" ? "Die PLZ-Prüfung ist gerade nicht verfügbar. Trage den Ort bitte manuell ein."
      : postalCodeStatus === "loading" ? "PLZ wird geprüft …"
        : postalCodeStatus === "valid" ? "Ort wurde automatisch übernommen."
          : "";
  const onboardingDescription = data.requiresOrganizationDetails
    ? "Ergänze bitte deine Unternehmensdaten und deinen Namen."
    : "Ergänze bitte deinen Namen für dein persönliches Login.";

  return <main className="onboarding-page"><section className="panel onboarding-card">
    <div className="onboarding-topbar"><div className="onboarding-brand"><SplowLogo/></div><LogoutButton/></div>
    <div className="onboarding-heading"><span className="eyebrow">SCHÖN, DASS DU DA BIST</span><h1>Richte deinen Zugang ein</h1><p>{onboardingDescription}</p></div>
    {loading ? <p className="onboarding-status">Deine Angaben werden geladen …</p> : error && !data.firstName && !data.lastName && !data.organization.organization ? <div className="onboarding-error-block"><p className="field-message error" role="alert">{error}</p><button className="btn" type="button" onClick={() => window.location.reload()}>Erneut versuchen</button></div> : <form className="onboarding-form" onSubmit={submit}>
      {data.requiresOrganizationDetails ? <>
        <div className="onboarding-section-heading"><span className="onboarding-section-icon"><Icon name="stack" size={16}/></span><div><strong>Unternehmen</strong><small>Diese Angaben erscheinen in deinen Verträgen.</small></div></div>
        <label className="settings-field onboarding-full"><span>Bezeichnung des Unternehmens *</span><input autoComplete="organization" required maxLength={180} value={data.organization.organization} onChange={(event) => updateOrganization("organization", event.target.value)} /></label>
        <div className="onboarding-address-row"><label className="settings-field"><span>Straße *</span><input autoComplete="address-line1" required maxLength={160} value={data.organization.street} onChange={(event) => updateOrganization("street", event.target.value)} /></label><label className="settings-field"><span>Hausnummer *</span><input autoComplete="address-line2" required maxLength={30} value={data.organization.streetNumber} onChange={(event) => updateOrganization("streetNumber", event.target.value)} /></label></div>
        <div className="onboarding-address-row"><label className="settings-field"><span>PLZ *</span><input autoComplete="postal-code" inputMode="numeric" required maxLength={5} value={data.organization.postalCode} onChange={(event) => updatePostalCode(event.target.value)} /><small className={`onboarding-postal-message ${postalCodeStatus === "invalid" || postalCodeStatus === "unavailable" ? "error" : postalCodeStatus === "valid" ? "success" : ""}`} aria-live="polite">{postalMessage}</small></label><label className="settings-field"><span>Ort *</span><input autoComplete="address-level2" required value={data.organization.city} onChange={(event) => updateOrganization("city", event.target.value)} placeholder={postalCodeStatus === "loading" ? "Wird ermittelt …" : "Ort"} /></label></div>
      </> : <section className="onboarding-existing-organization"><span className="onboarding-section-icon"><Icon name="stack" size={16}/></span><div><strong>{data.organization.organization || "Dein Veranstalterbereich"}</strong>{(data.organization.street || data.organization.postalCode || data.organization.city) && <small>{[`${data.organization.street} ${data.organization.streetNumber}`.trim(), `${data.organization.postalCode} ${data.organization.city}`.trim()].filter(Boolean).join(" · ")}</small>}<p>Dein Veranstalterbereich ist bereits eingerichtet. Ergänze nur noch deinen Namen für dein persönliches Login.</p></div></section>}
      <div className="onboarding-section-heading onboarding-personal-heading"><span className="onboarding-section-icon"><Icon name="users" size={16}/></span><div><strong>Dein Profil</strong><small>So wirst du im Veranstalterbereich angezeigt.</small></div></div>
      <div className="onboarding-address-row"><label className="settings-field"><span>Vorname *</span><input autoComplete="given-name" required maxLength={80} value={data.firstName} onChange={(event) => setData((current) => ({ ...current, firstName: event.target.value }))} /></label><label className="settings-field"><span>Nachname *</span><input autoComplete="family-name" required maxLength={80} value={data.lastName} onChange={(event) => setData((current) => ({ ...current, lastName: event.target.value }))} /></label></div>
      {error && <p className="field-message error" role="alert">{error}</p>}
      <button className="btn btn-primary onboarding-submit" type="submit" disabled={saving || loading || (data.requiresOrganizationDetails && postalCodeStatus !== "valid" && !(postalCodeStatus === "unavailable" && data.organization.city.trim()))}>{saving ? "Angaben werden gespeichert …" : "Angaben speichern und weiter"}<Icon name="arrow" size={15}/></button>
    </form>}
  </section><p className="onboarding-footer">Deine Angaben werden sicher in Splow gespeichert.</p></main>;
}
