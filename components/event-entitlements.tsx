"use client";

import { Modal } from "@/components/modal";
import { Icon } from "@/components/ui";
import { eventContractPackageLabel } from "@/lib/event-contract-package-labels";
import { eventPlanLabel } from "@/lib/event-plan-labels";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import Script from "next/script";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

export type EventPlanCode = "free" | "event" | "event_pro" | "enterprise";
export type EventFeature = "contracts" | "benefits" | "tasks" | "evidence" | "reports";
export type EventPlan = { code: EventPlanCode; name: string; price_cents: number | null; max_events: number | null; max_sponsors: number | null; features: Partial<Record<EventFeature, boolean>> };
export type EventEntitlement = { event_id: string; plan_code: EventPlanCode; entitlement_status: "active" | "revoked"; activated_at: string; activation_source: string; paid_amount_cents: number | null; payment_reference: string | null; payment_provider: string | null; plan: EventPlan };
type EventContractPackage = { code: string; name: string; max_contracts: number; base_amount_cents: number; signature_addon_per_contract_cents: number };
type EventContractPackageBooking = { package_code: string; max_contracts: number; base_amount_cents: number; signature_addon_selected: boolean; signature_addon_amount_cents: number; total_amount_cents: number; payment_status: "paid" | "comped"; payment_confirmed_at: string };
type EmbeddedCheckout = { mount: (target: HTMLElement) => void; destroy: () => void };
type StripeClient = { createEmbeddedCheckoutPage: (options: { fetchClientSecret: () => Promise<string>; onComplete: () => void }) => Promise<EmbeddedCheckout> };

type Entry = { data: EventEntitlement | null; packageBooking: EventContractPackageBooking | null; loading: boolean; error?: string };
type EventEntitlementsContextValue = {
  getEntitlement: (eventId: string) => EventEntitlement | null;
  getPackageBooking: (eventId: string) => EventContractPackageBooking | null;
  loadEntitlement: (eventId: string) => Promise<EventEntitlement | null>;
  ensureFeature: (eventId: string, eventTitle: string, feature: EventFeature) => Promise<boolean>;
  requestUpgrade: (eventId: string, eventTitle: string, reason?: string) => void;
};

const EventEntitlementsContext = createContext<EventEntitlementsContextValue | null>(null);
const featureNames: Record<EventFeature, string> = {
  contracts: "Verträge erstellen und verwalten",
  benefits: "Leistungsbausteine zuweisen",
  tasks: "Aufgaben aus Leistungen erzeugen",
  evidence: "Nachweise hochladen",
  reports: "Sponsorberichte erstellen",
};

function packageDescription(maxContracts: number, packageCode?: string) {
  const packageName = eventContractPackageLabel(maxContracts, packageCode);
  if (packageName === "Starter") {
    return [
      `Bis zu ${maxContracts} Sponsoren`,
      "Sponsoren und Vereinbarungen verwalten",
      "Verträge aus Bausteinen erstellen",
      "Aufgaben ableiten und Nachweise inklusive Fotos dokumentieren",
      "Leistungsnachweis für jeden Sponsor erstellen",
    ];
  }
  return [
    `Bis zu ${maxContracts} Sponsoren`,
    "Alle Kernfunktionen enthalten",
  ];
}

export function EventEntitlementsProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const [dialog, setDialog] = useState<{ eventId: string; title: string; reason?: string } | null>(null);
  const [contractPackages, setContractPackages] = useState<EventContractPackage[]>([]);
  const [code, setCode] = useState("");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutClientSecret, setCheckoutClientSecret] = useState("");
  const [checkoutSessionId, setCheckoutSessionId] = useState("");
  const [stripeScriptReady, setStripeScriptReady] = useState(false);
  const embeddedCheckoutRef = useRef<HTMLDivElement>(null);
  const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  const embeddedCheckoutInstanceRef = useRef<EmbeddedCheckout | null>(null);
  const [dialogMessage, setDialogMessage] = useState("");
  const [dialogError, setDialogError] = useState("");
  const currentEntitlement = dialog ? entries[dialog.eventId]?.data : null;
  const currentPackageBooking = dialog ? entries[dialog.eventId]?.packageBooking ?? null : null;
  const selectedPackageDetails = contractPackages.find((item) => item.code === selectedPackage) ?? contractPackages[0] ?? null;

  useEffect(() => {
    if (!dialog || !checkoutClientSecret || !checkoutSessionId || !stripeScriptReady) return;
    const target = embeddedCheckoutRef.current;
    if (!target) return;
    let disposed = false;
    let checkout: EmbeddedCheckout | null = null;
    setCheckoutLoading(true);
    void (async () => {
      try {
        if (!stripePublishableKey) throw new Error("Der Stripe-Schlüssel fehlt. Hinterlege NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in Vercel und veröffentliche die Änderung erneut.");
        const stripe = (window as unknown as { Stripe?: (publishableKey: string) => StripeClient }).Stripe?.(stripePublishableKey);
        if (!stripe) throw new Error("Stripe konnte nicht geladen werden. Bitte prüfe deine Verbindung und versuche es erneut.");
        checkout = await stripe.createEmbeddedCheckoutPage({
          fetchClientSecret: async () => checkoutClientSecret,
          onComplete: () => {
            if (!dialog || !checkoutSessionId) return;
            setCheckoutLoading(true);
            void fetch(`/api/events/${dialog.eventId}/package-payment/confirm`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: checkoutSessionId }),
            }).then(async (response) => {
              const result = await response.json();
              if (!response.ok) throw new Error(result.error ?? "Das Eventpaket konnte nicht bestätigt werden.");
              setCheckoutClientSecret("");
              setCheckoutSessionId("");
              setCheckoutLoading(false);
              setDialogMessage("Zahlung erfolgreich. Das Eventpaket ist jetzt freigeschaltet.");
              window.dispatchEvent(new CustomEvent("sponso:event-entitlement-updated", { detail: { eventId: dialog.eventId } }));
            }).catch((error: unknown) => {
              setDialogError(error instanceof Error ? error.message : "Das Eventpaket konnte nicht bestätigt werden.");
              setCheckoutLoading(false);
            });
          },
        });
        if (disposed) { checkout.destroy(); return; }
        embeddedCheckoutInstanceRef.current = checkout;
        checkout.mount(target);
        setCheckoutLoading(false);
      } catch (error) {
        if (disposed) return;
        setDialogError(error instanceof Error ? error.message : "Der Bezahlvorgang konnte nicht angezeigt werden.");
        setCheckoutLoading(false);
      }
    })();
    return () => { disposed = true; checkout?.destroy(); embeddedCheckoutInstanceRef.current = null; };
  }, [checkoutClientSecret, checkoutSessionId, dialog, stripePublishableKey, stripeScriptReady]);
  const loadEntitlement = useCallback(async (eventId: string) => {
    setEntries((current) => ({ ...current, [eventId]: { data: current[eventId]?.data ?? null, packageBooking: current[eventId]?.packageBooking ?? null, loading: true } }));
    try {
      const supabase = createClient();
      const [{ data: entitlement, error: entitlementError }, { data: catalog, error: plansError }, { data: event, error: eventError }, { data: packages, error: packagesError }, { data: packageBooking, error: packageBookingError }] = await Promise.all([
        supabase.from("event_entitlements").select("event_id, plan_code, entitlement_status, activated_at, activation_source, paid_amount_cents, payment_reference, payment_provider").eq("event_id", eventId).maybeSingle(),
        supabase.from("event_plans").select("code, name, price_cents, max_events, max_sponsors, features").order("price_cents"),
        supabase.from("events").select("organization_id").eq("id", eventId).maybeSingle(),
        supabase.from("event_contract_packages").select("code, name, max_contracts, base_amount_cents, signature_addon_per_contract_cents").eq("is_active", true).order("max_contracts"),
        supabase.from("event_contract_package_bookings").select("package_code, max_contracts, base_amount_cents, signature_addon_selected, signature_addon_amount_cents, total_amount_cents, payment_status, payment_confirmed_at").eq("event_id", eventId).maybeSingle(),
      ]);
      if (plansError) throw plansError;
      if (packagesError) throw packagesError;
      if (packageBookingError) throw packageBookingError;
      if (eventError) throw eventError;
      if (packages) {
        const packageList = packages as EventContractPackage[];
        setContractPackages(packageList);
        if (packageList.length) setSelectedPackage((current) => current || packageList[0].code);
      }
      if (entitlementError) throw entitlementError;
      if (event?.organization_id) {
        const { data: organizationEntitlement, error: organizationEntitlementError } = await supabase
          .from("organization_entitlements")
          .select("is_active, activated_at, expires_at, annual_fee_cents, invoice_reference")
          .eq("organization_id", event.organization_id)
          .maybeSingle();
        if (organizationEntitlementError) throw organizationEntitlementError;
        if (organizationEntitlement?.is_active && new Date(organizationEntitlement.expires_at).getTime() > Date.now()) {
          const allFeatures = Object.fromEntries((Object.keys(featureNames) as EventFeature[]).map((feature) => [feature, true])) as Record<EventFeature, boolean>;
          const enterprisePlan: EventPlan = { code: "enterprise", name: "Enterprise", price_cents: null, max_events: null, max_sponsors: null, features: allFeatures };
          const data: EventEntitlement = {
            event_id: eventId, plan_code: "enterprise", entitlement_status: "active",
            activated_at: organizationEntitlement.activated_at, activation_source: "admin",
            paid_amount_cents: organizationEntitlement.annual_fee_cents,
            payment_reference: organizationEntitlement.invoice_reference, payment_provider: "invoice", plan: enterprisePlan,
          };
          setEntries((current) => ({ ...current, [eventId]: { data, packageBooking: packageBooking as EventContractPackageBooking | null, loading: false } }));
          return data;
        }
      }
      const plan = (catalog as EventPlan[] | null)?.find((item) => item.code === entitlement?.plan_code);
      const data = entitlement && plan ? { ...entitlement, plan } as EventEntitlement : null;
      setEntries((current) => ({ ...current, [eventId]: { data, packageBooking: packageBooking as EventContractPackageBooking | null, loading: false } }));
      return data;
    } catch (error) {
      setEntries((current) => ({ ...current, [eventId]: { data: current[eventId]?.data ?? null, packageBooking: current[eventId]?.packageBooking ?? null, loading: false, error: error instanceof Error ? error.message : "Tarif konnte nicht geladen werden." } }));
      return null;
    }
  }, []);

  const requestUpgrade = useCallback((eventId: string, title: string, reason?: string) => {
    setDialog({ eventId, title, reason });
    setCode("");
    setSelectedPackage("");
    setCheckoutClientSecret("");
    setCheckoutSessionId("");
    setDialogMessage("");
    setDialogError("");
    void loadEntitlement(eventId);
  }, [loadEntitlement]);

  const ensureFeature = useCallback(async (eventId: string, title: string, feature: EventFeature) => {
    if (!entries[eventId]?.data || entries[eventId]?.loading) await loadEntitlement(eventId);
    try {
      const { data: allowed, error } = await createClient().rpc("event_feature_enabled", {
        target_event_id: eventId,
        target_feature: feature,
      });
      if (!error && allowed === true) return true;
    } catch {
      // Fail closed if the central server-side entitlement check is unavailable.
    }
    requestUpgrade(eventId, title, featureNames[feature]);
    return false;
  }, [entries, loadEntitlement, requestUpgrade]);

  const getEntitlement = useCallback((eventId: string) => entriesRef.current[eventId]?.data ?? null, []);
  const getPackageBooking = useCallback((eventId: string) => entriesRef.current[eventId]?.packageBooking ?? null, []);

  async function redeemCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || !code.trim() || redeeming) return;
    setRedeeming(true);
    setDialogError("");
    setDialogMessage("");
    try {
      const response = await fetch(`/api/events/${dialog.eventId}/redeem-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Der Freischaltcode konnte nicht eingelöst werden.");
      await loadEntitlement(dialog.eventId);
      setCode("");
      const activatedPackage = contractPackages.find((item) => item.code === result.packageCode);
      setDialogMessage(result.packageCode
        ? `Event freigeschaltet. Das Paket ${activatedPackage?.name ?? eventContractPackageLabel(activatedPackage?.max_contracts ?? Number(String(result.packageCode).split("_")[1]), result.packageCode)} ist jetzt aktiv.`
        : `Event freigeschaltet. Der Tarif ${eventPlanLabel(result.plan)} ist jetzt aktiv.`);
      window.dispatchEvent(new CustomEvent("sponso:event-entitlement-updated", { detail: { eventId: dialog.eventId } }));
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Der Freischaltcode konnte nicht eingelöst werden.");
    } finally {
      setRedeeming(false);
    }
  }

  async function startPackageCheckout() {
    if (!dialog || !selectedPackageDetails || checkoutLoading) return;
    if (!stripePublishableKey) {
      setDialogError("Der Stripe-Schlüssel fehlt. Hinterlege NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in Vercel und veröffentliche die Änderung erneut.");
      return;
    }
    setCheckoutLoading(true);
    setCheckoutClientSecret("");
    setCheckoutSessionId("");
    setDialogError("");
    setDialogMessage("");
    try {
      const response = await fetch(`/api/events/${dialog.eventId}/package-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageCode: selectedPackageDetails.code }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Der Bezahlvorgang konnte nicht gestartet werden.");
      if (typeof result.clientSecret !== "string" || !result.clientSecret.startsWith("cs_") || typeof result.sessionId !== "string" || !result.sessionId.startsWith("cs_")) {
        throw new Error("Stripe hat keinen gültigen eingebetteten Bezahlvorgang zurückgegeben.");
      }
      setCheckoutSessionId(result.sessionId);
      setCheckoutClientSecret(result.clientSecret);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Der Bezahlvorgang konnte nicht gestartet werden.");
      setCheckoutLoading(false);
    }
  }

  function closeDialog() {
    setDialog(null);
    setCheckoutClientSecret("");
    setCheckoutSessionId("");
    setCheckoutLoading(false);
  }

  function returnToPackageSelection() {
    setCheckoutClientSecret("");
    setCheckoutSessionId("");
    setDialogError("");
    setCheckoutLoading(false);
  }

  const value = useMemo<EventEntitlementsContextValue>(() => ({
    getEntitlement,
    getPackageBooking,
    loadEntitlement,
    ensureFeature,
    requestUpgrade,
  }), [getEntitlement, getPackageBooking, ensureFeature, loadEntitlement, requestUpgrade]);

  return <EventEntitlementsContext.Provider value={value}>
    {children}
    {dialog && <Modal labelledBy="entitlement-title" className={`create-modal entitlement-modal${checkoutClientSecret ? " entitlement-modal-checkout" : ""}`} backdropClassName="modal-backdrop entitlement-backdrop" role="dialog" busy={redeeming || checkoutLoading} onClose={closeDialog}>
        <div className="create-modal-head"><div><div className="eyebrow">EVENT FREISCHALTEN</div><h2 id="entitlement-title">{checkoutClientSecret ? "Paket sicher bezahlen" : "Splow für dieses Event freischalten"}</h2><p>{checkoutClientSecret && selectedPackageDetails ? `${selectedPackageDetails.name} · ` : ""}{dialog.title}{dialog.reason ? ` · ${dialog.reason}` : ""}</p></div><button className="icon-button" type="button" aria-label="Dialog schließen" disabled={redeeming || checkoutLoading} onClick={closeDialog}><Icon name="close" size={16}/></button></div>
        {checkoutClientSecret ? <section className="entitlement-checkout-section" aria-label="Stripe-Bezahlung">
          <p>Du bleibst in Splow angemeldet. Die Zahlung wird sicher direkt hier über Stripe abgewickelt.</p>
          {checkoutLoading && <p className="task-empty" role="status">Sichere Bezahlung wird geladen …</p>}
          {dialogError && <p className="field-message" role="alert">{dialogError}</p>}
          <div className="entitlement-checkout-embed" ref={embeddedCheckoutRef}/>
          <div className="create-modal-actions"><button className="btn" type="button" disabled={checkoutLoading} onClick={returnToPackageSelection}>Zur Paketauswahl</button></div>
          <Script src="https://js.stripe.com/v3/" strategy="afterInteractive" onReady={() => setStripeScriptReady(true)} onError={() => { setDialogError("Stripe konnte nicht geladen werden. Bitte prüfe deine Verbindung und versuche es erneut."); setCheckoutLoading(false); }}/>
        </section> : <>
        {currentPackageBooking ? <section className="entitlement-package-current"><div><strong>Paket gebucht: {eventContractPackageLabel(currentPackageBooking.max_contracts, currentPackageBooking.package_code)}</strong><span>{currentPackageBooking.payment_status === "comped" ? "Über Freischaltcode aktiviert" : `Gesamtbetrag ${new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(currentPackageBooking.total_amount_cents / 100)}`}</span></div><p>Digitale Vertragszeichnungen werden einzeln vor der Freigabe bezahlt.</p></section> : currentEntitlement?.plan_code === "event" || currentEntitlement?.plan_code === "event_pro" ? <section className="entitlement-package-current"><div><strong>Bestehender Tarif: {eventPlanLabel(currentEntitlement.plan_code)}</strong><span>Für dieses Event wurde bereits ein Tarif freigeschaltet.</span></div><p>Die neuen Vertragspakete gelten für neu gebuchte Events. Digitale Vertragszeichnungen werden separat pro Vertrag bezahlt.</p></section> : <>
          <div className="entitlement-package-grid" role="radiogroup" aria-label="Paket auswählen">{contractPackages.map((item) => {
            const packageName = item.name || eventContractPackageLabel(item.max_contracts, item.code);
            return <button key={item.code} className={`entitlement-package-card${selectedPackage === item.code ? " selected" : ""}`} type="button" role="radio" aria-checked={selectedPackage === item.code} onClick={() => setSelectedPackage(item.code)}><span className="entitlement-package-card-heading"><span>{packageName}</span>{packageName === "Pro" && <span className="entitlement-package-popular">Meistgewählt</span>}</span><strong>{new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(item.base_amount_cents / 100)}</strong><small>einmalig pro Event</small><span className="entitlement-package-features">{packageDescription(item.max_contracts, item.code).map((description) => <span key={description}>{description}</span>)}</span></button>;
          })}</div>
          <aside className="entitlement-enterprise-plan"><div><strong>Enterprise</strong><span>Für Veranstalter mit mehreren Events</span></div><ul className="entitlement-enterprise-features"><li>Individuelle Anzahl an Sponsoren und Verträgen</li><li>Alle Kernfunktionen enthalten</li><li>Umfang und Preis auf Anfrage</li></ul><Link className="btn btn-primary" href="/kontakt?anliegen=enterprise">Enterprise anfragen</Link></aside>
          {selectedPackageDetails && <div className="entitlement-signature-addon"><span>Digitale Vertragszeichnung</span><strong>Einzelzahlung pro Vertrag</strong><small>Die Zahlung wird vor der Freigabe zur Unterschrift durchgeführt.</small></div>}
          {selectedPackageDetails && <div className="entitlement-package-total"><span>Gesamtbetrag für das Eventpaket</span><strong>{new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(selectedPackageDetails.base_amount_cents / 100)}</strong></div>}
          <button className="btn btn-primary entitlement-package-checkout" type="button" disabled={!selectedPackageDetails || checkoutLoading} onClick={() => void startPackageCheckout()}>{checkoutLoading ? "Zahlung wird vorbereitet …" : selectedPackageDetails ? "Mit Stripe bezahlen" : "Pakete werden geladen …"}</button>
        </>}
        {dialogError && <p className="field-message error" role="alert">{dialogError}</p>}{dialogMessage && <p className="field-message success" role="status">{dialogMessage}</p>}
        <form className="entitlement-code-form" onSubmit={redeemCode}><label className="settings-field"><span>Du hast einen Freischaltcode?</span><input autoComplete="off" autoCapitalize="characters" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder={`S-${new Date().getFullYear()}-00000000 (Beispiel, nicht einlösbar)`} maxLength={80} /></label><button className="btn btn-primary" type="submit" disabled={redeeming || !code.trim()}>{redeeming ? "Wird eingelöst …" : "Einlösen"}</button></form>
        <p className="entitlement-payment-note">Die Zahlung erfolgt sicher über Stripe direkt in Splow. Die digitale Vertragszeichnung wird separat pro Vertrag bezahlt.</p>
        </>}
      </Modal>}
  </EventEntitlementsContext.Provider>;
}

export function useEventEntitlements() {
  const context = useContext(EventEntitlementsContext);
  if (!context) throw new Error("EventEntitlementsProvider fehlt.");
  return context;
}
