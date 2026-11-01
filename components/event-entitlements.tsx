"use client";

import { Modal } from "@/components/modal";
import { Icon } from "@/components/ui";
import { eventPlanLabel } from "@/lib/event-plan-labels";
import { eventUpgradePriceCents, sponsorSlotPriceCents } from "@/lib/event-pricing";
import { createClient } from "@/lib/supabase/client";
import Script from "next/script";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

export type EventPlanCode = "free" | "event" | "event_pro" | "starter" | "professional" | "business" | "enterprise";
export type EventFeature = "contracts" | "benefits" | "tasks" | "evidence" | "reports" | "sponsor_management" | "manual_benefits" | "internal_tasks" | "standard_reporting" | "advanced_analytics" | "automated_closing_report" | "contract_upload" | "contract_generation" | "benefit_library" | "sponsor_portal" | "sponsor_task_evidence" | "reports_tab";
export type EventPlan = { code: EventPlanCode; name: string; price_cents: number | null; max_events: number | null; max_sponsors: number | null; included_sponsors: number; tier_order: number; features: Partial<Record<EventFeature, boolean>> };
export type EventEntitlement = { event_id: string; plan_code: EventPlanCode; entitlement_status: "active" | "revoked"; activated_at: string; activation_source: string; paid_amount_cents: number | null; payment_reference: string | null; payment_provider: string | null; plan: EventPlan };
export type EventProductState = { plan_code: EventPlanCode; plan_name: string; base_price_cents: number; included_sponsors: number; purchased_sponsor_slots: number; assigned_sponsors: number; available_sponsors: number; can_view_reports: boolean };
type EmbeddedCheckout = { mount: (target: HTMLElement) => void; destroy: () => void };
type StripeClient = { createEmbeddedCheckoutPage: (options: { fetchClientSecret: () => Promise<string>; onComplete: () => void }) => Promise<EmbeddedCheckout> };

type Entry = { data: EventEntitlement | null; productState: EventProductState | null; loading: boolean; error?: string };
type EventEntitlementsContextValue = {
  getEntitlement: (eventId: string) => EventEntitlement | null;
  getProductState: (eventId: string) => EventProductState | null;
  loadEntitlement: (eventId: string) => Promise<EventEntitlement | null>;
  ensureFeature: (eventId: string, eventTitle: string, feature: EventFeature) => Promise<boolean>;
  hasFeature: (eventId: string, feature: EventFeature) => Promise<boolean>;
  requestUpgrade: (eventId: string, eventTitle: string, reason?: string) => void;
};

const EventEntitlementsContext = createContext<EventEntitlementsContextValue | null>(null);
const featureNames: Record<EventFeature, string> = {
  contracts: "Verträge erstellen und verwalten",
  benefits: "Leistungsbausteine zuweisen",
  tasks: "Aufgaben aus Leistungen erzeugen",
  evidence: "Nachweise hochladen",
  reports: "Standardberichte ansehen",
  sponsor_management: "Sponsorenverwaltung",
  manual_benefits: "Manuelle Leistungen erfassen",
  internal_tasks: "Internes Aufgabenmanagement",
  standard_reporting: "Standardreporting",
  advanced_analytics: "Erweiterte Auswertungen",
  automated_closing_report: "Automatische Abschlussberichte",
  contract_upload: "Verträge hochladen",
  contract_generation: "Verträge automatisch erstellen",
  benefit_library: "Leistungsbibliothek nutzen",
  sponsor_portal: "Sponsorportal freischalten",
  sponsor_task_evidence: "Aufgaben und Nachweise im Sponsorportal",
  reports_tab: "Reports und Abschlussberichte",
};

function packageFeatures(plan: EventPlan) {
  return (Object.entries(plan.features) as [EventFeature, boolean | undefined][])
    .filter(([feature, enabled]) => enabled && featureNames[feature] && !["contracts", "benefits", "tasks", "evidence", "reports"].includes(feature))
    .map(([feature]) => featureNames[feature]);
}

export function EventEntitlementsProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const [dialog, setDialog] = useState<{ eventId: string; title: string; reason?: string } | null>(null);
  const [productPlans, setProductPlans] = useState<EventPlan[]>([]);
  const [code, setCode] = useState("");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutClientSecret, setCheckoutClientSecret] = useState("");
  const [checkoutSessionId, setCheckoutSessionId] = useState("");
  const [checkoutType, setCheckoutType] = useState<"initial" | "upgrade" | "sponsor_slots">("initial");
  const [sponsorSlots, setSponsorSlots] = useState(1);
  const [stripeScriptReady, setStripeScriptReady] = useState(false);
  const embeddedCheckoutRef = useRef<HTMLDivElement>(null);
  const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  const embeddedCheckoutInstanceRef = useRef<EmbeddedCheckout | null>(null);
  const [dialogMessage, setDialogMessage] = useState("");
  const [dialogError, setDialogError] = useState("");
  const currentEntitlement = dialog ? entries[dialog.eventId]?.data : null;
  const currentProductState = dialog ? entries[dialog.eventId]?.productState ?? null : null;
  const selectedPackageDetails = productPlans.find((item) => item.code === selectedPackage) ?? null;

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
              setDialogMessage("Zahlung erfolgreich. Dein Eventpaket wurde aktualisiert.");
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
    setEntries((current) => ({ ...current, [eventId]: { data: current[eventId]?.data ?? null, productState: current[eventId]?.productState ?? null, loading: true } }));
    try {
      const supabase = createClient();
      const [{ data: entitlement, error: entitlementError }, { data: catalog, error: plansError }, { data: event, error: eventError }, { data: packages, error: packagesError }, { data: productStateRows, error: productStateError }] = await Promise.all([
        supabase.from("event_entitlements").select("event_id, plan_code, entitlement_status, activated_at, activation_source, paid_amount_cents, payment_reference, payment_provider").eq("event_id", eventId).maybeSingle(),
        supabase.from("event_plans").select("code, name, price_cents, max_events, max_sponsors, included_sponsors, tier_order, features").order("tier_order"),
        supabase.from("events").select("organization_id").eq("id", eventId).maybeSingle(),
        supabase.from("event_plans").select("code, name, price_cents, max_events, max_sponsors, included_sponsors, tier_order, features").in("code", ["starter", "professional", "business"]).order("tier_order"),
        supabase.rpc("get_event_product_state", { target_event_id: eventId }),
      ]);
      if (plansError) throw plansError;
      if (packagesError) throw packagesError;
      if (productStateError) throw productStateError;
      if (eventError) throw eventError;
      if (packages) {
        const packageList = packages as EventPlan[];
        setProductPlans(packageList);
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
          const enterprisePlan: EventPlan = { code: "enterprise", name: "Enterprise", price_cents: null, max_events: null, max_sponsors: null, included_sponsors: 0, tier_order: 4, features: allFeatures };
          const data: EventEntitlement = {
            event_id: eventId, plan_code: "enterprise", entitlement_status: "active",
            activated_at: organizationEntitlement.activated_at, activation_source: "admin",
            paid_amount_cents: organizationEntitlement.annual_fee_cents,
            payment_reference: organizationEntitlement.invoice_reference, payment_provider: "invoice", plan: enterprisePlan,
          };
          const existingProductState = productStateRows?.[0] as EventProductState | undefined;
          const enterpriseState = existingProductState ? { ...existingProductState, plan_code: "enterprise" as const, plan_name: "Enterprise", base_price_cents: 0, available_sponsors: Number.MAX_SAFE_INTEGER } : null;
          setEntries((current) => ({ ...current, [eventId]: { data, productState: enterpriseState, loading: false } }));
          return data;
        }
      }
      const plan = (catalog as EventPlan[] | null)?.find((item) => item.code === entitlement?.plan_code);
      const data = entitlement && plan ? { ...entitlement, plan } as EventEntitlement : null;
      setEntries((current) => ({ ...current, [eventId]: { data, productState: (productStateRows?.[0] as EventProductState | undefined) ?? null, loading: false } }));
      return data;
    } catch (error) {
      setEntries((current) => ({ ...current, [eventId]: { data: current[eventId]?.data ?? null, productState: current[eventId]?.productState ?? null, loading: false, error: error instanceof Error ? error.message : "Tarif konnte nicht geladen werden." } }));
      return null;
    }
  }, []);

  const requestUpgrade = useCallback((eventId: string, title: string, reason?: string) => {
    setDialog({ eventId, title, reason });
    setCode("");
    setSelectedPackage("");
    setCheckoutType("initial");
    setSponsorSlots(1);
    setCheckoutClientSecret("");
    setCheckoutSessionId("");
    setDialogMessage("");
    setDialogError("");
    void loadEntitlement(eventId);
  }, [loadEntitlement]);

  const hasFeature = useCallback(async (eventId: string, feature: EventFeature) => {
    try {
      const { data: allowed, error } = await createClient().rpc("event_feature_enabled", {
        target_event_id: eventId,
        target_feature: feature,
      });
      if (!error && allowed === true) return true;
    } catch {
      // Fail closed if the central server-side entitlement check is unavailable.
    }
    return false;
  }, []);

  const ensureFeature = useCallback(async (eventId: string, title: string, feature: EventFeature) => {
    if (!entries[eventId]?.data || entries[eventId]?.loading) await loadEntitlement(eventId);
    if (await hasFeature(eventId, feature)) return true;
    requestUpgrade(eventId, title, featureNames[feature]);
    return false;
  }, [entries, hasFeature, loadEntitlement, requestUpgrade]);

  const getEntitlement = useCallback((eventId: string) => entriesRef.current[eventId]?.data ?? null, []);
  const getProductState = useCallback((eventId: string) => entriesRef.current[eventId]?.productState ?? null, []);

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
      const activatedPackage = productPlans.find((item) => item.code === (result.packageCode ?? result.plan));
      setDialogMessage(result.packageCode
        ? `Event freigeschaltet. Das Paket ${activatedPackage?.name ?? result.packageCode} ist jetzt aktiv.`
        : `Event freigeschaltet. Der Tarif ${eventPlanLabel(result.plan)} ist jetzt aktiv.`);
      window.dispatchEvent(new CustomEvent("sponso:event-entitlement-updated", { detail: { eventId: dialog.eventId } }));
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Der Freischaltcode konnte nicht eingelöst werden.");
    } finally {
      setRedeeming(false);
    }
  }

  async function startPackageCheckout(type: "initial" | "upgrade" | "sponsor_slots" = checkoutType) {
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
        body: JSON.stringify({ packageCode: selectedPackageDetails.code, paymentType: type, sponsorSlots: type === "sponsor_slots" ? sponsorSlots : 0 }),
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
    getProductState,
    loadEntitlement,
    ensureFeature,
    hasFeature,
    requestUpgrade,
  }), [getEntitlement, getProductState, ensureFeature, hasFeature, loadEntitlement, requestUpgrade]);

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
        {currentProductState?.plan_code === "enterprise" ? <section className="entitlement-package-current"><div><strong>Enterprise aktiv</strong><span>Alle Eventfunktionen sind für deine Organisation freigeschaltet.</span></div><p>Für dieses Event musst du kein zusätzliches Paket buchen.</p></section> : currentProductState && ["starter", "professional", "business"].includes(currentProductState.plan_code) ? <>
          <section className="entitlement-package-current"><div><strong>Aktuelles Paket: {currentProductState.plan_name}</strong><span>{currentProductState.assigned_sponsors} von {currentProductState.included_sponsors + currentProductState.purchased_sponsor_slots} Sponsorenplätzen belegt</span></div><p>{currentProductState.available_sponsors} Plätze verfügbar. Das Kontingent und die Rechte gelten nur für dieses Event.</p></section>
          <div className="entitlement-package-grid" role="radiogroup" aria-label="Upgrade auswählen">{productPlans.filter((item) => item.tier_order > (currentEntitlement?.plan.tier_order ?? 0)).map((item) => {
            const amount = eventUpgradePriceCents(currentProductState.base_price_cents, item.price_cents ?? 0);
            return <button key={item.code} className={`entitlement-package-card${selectedPackage === item.code ? " selected" : ""}`} type="button" role="radio" aria-checked={selectedPackage === item.code} onClick={() => { setSelectedPackage(item.code); setCheckoutType("upgrade"); }}><span className="entitlement-package-card-heading"><span>{item.name}</span></span><strong>{new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount / 100)}</strong><small>Upgrade inklusive 20 € Gebühr</small><span className="entitlement-package-features">{packageFeatures(item).map((description) => <span key={description}>{description}</span>)}</span></button>;
          })}</div>
          {selectedPackageDetails && checkoutType === "upgrade" && <button className="btn btn-primary entitlement-package-checkout" type="button" disabled={checkoutLoading} onClick={() => void startPackageCheckout("upgrade")}>{checkoutLoading ? "Zahlung wird vorbereitet …" : `Auf ${selectedPackageDetails.name} upgraden`}</button>}
          <section className="entitlement-package-current entitlement-sponsor-slots"><div><strong>Zusätzliche Sponsorenplätze</strong><span>Progressive Staffel: Plätze 4–10 je 6 €, 11–20 je 4 €, ab Platz 21 je 3 €</span></div><label className="settings-field"><span>Anzahl</span><input type="number" min="1" max="500" step="1" value={sponsorSlots} onChange={(event) => { setSponsorSlots(Math.min(500, Math.max(1, Number(event.target.value) || 1))); setCheckoutType("sponsor_slots"); setSelectedPackage(currentProductState.plan_code); }}/></label><p>Einmalig zusätzlich: {new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(sponsorSlotPriceCents(currentProductState.included_sponsors + currentProductState.purchased_sponsor_slots, sponsorSlots) / 100)}</p><button className="btn btn-primary" type="button" disabled={checkoutLoading} onClick={() => { setSelectedPackage(currentProductState.plan_code); void startPackageCheckout("sponsor_slots"); }}>{checkoutLoading ? "Zahlung wird vorbereitet …" : "Kontingent kaufen"}</button></section>
        </> : <>
          <div className="entitlement-package-grid" role="radiogroup" aria-label="Paket auswählen">{productPlans.map((item) => <button key={item.code} className={`entitlement-package-card${selectedPackage === item.code ? " selected" : ""}`} type="button" role="radio" aria-checked={selectedPackage === item.code} onClick={() => { setSelectedPackage(item.code); setCheckoutType("initial"); }}><span className="entitlement-package-card-heading"><span>{item.name}</span></span><strong>{new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format((item.price_cents ?? 0) / 100)}</strong><small>einmalig pro Event · 3 Sponsoren inklusive</small><span className="entitlement-package-features">{packageFeatures(item).map((description) => <span key={description}>{description}</span>)}</span></button>)}</div>
          {selectedPackageDetails && <div className="entitlement-package-total"><span>Grundpreis für dieses Event</span><strong>{new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format((selectedPackageDetails.price_cents ?? 0) / 100)}</strong></div>}
          <button className="btn btn-primary entitlement-package-checkout" type="button" disabled={!selectedPackageDetails || checkoutLoading} onClick={() => void startPackageCheckout("initial")}>{checkoutLoading ? "Zahlung wird vorbereitet …" : selectedPackageDetails ? "Mit Stripe bezahlen" : "Pakete werden geladen …"}</button>
        </>}
        {dialogError && <p className="field-message error" role="alert">{dialogError}</p>}{dialogMessage && <p className="field-message success" role="status">{dialogMessage}</p>}
        <form className="entitlement-code-form" onSubmit={redeemCode}><label className="settings-field"><span>Du hast einen Freischaltcode?</span><input autoComplete="off" autoCapitalize="characters" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder={`S-${new Date().getFullYear()}-00000000 (Beispiel, nicht einlösbar)`} maxLength={80} /></label><button className="btn btn-primary" type="submit" disabled={redeeming || !code.trim()}>{redeeming ? "Wird eingelöst …" : "Einlösen"}</button></form>
        <p className="entitlement-payment-note">Zahlung per Stripe direkt in Splow. Freigeschaltet wird erst nach bestätigtem Zahlungseingang. Upgrades kosten die Preisdifferenz plus 20 €.</p>
        </>}
      </Modal>}
  </EventEntitlementsContext.Provider>;
}

export function useEventEntitlements() {
  const context = useContext(EventEntitlementsContext);
  if (!context) throw new Error("EventEntitlementsProvider fehlt.");
  return context;
}
