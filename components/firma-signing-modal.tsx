"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modal";

export function FirmaSigningModal({ contractId, onClose, onCompleted }: { contractId: string; onClose: () => void; onCompleted?: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  const [statusConfirmed, setStatusConfirmed] = useState(false);
  const [statusNotice, setStatusNotice] = useState("");
  const [initialStatus, setInitialStatus] = useState<string | null>(null);
  const notifiedRef = useRef(false);
  const onCompletedRef = useRef(onCompleted);

  useEffect(() => { onCompletedRef.current = onCompleted; }, [onCompleted]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/contracts/${contractId}/simple-signature`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Die Signaturansicht konnte nicht geladen werden.");
        if (!cancelled) setInitialStatus(result.signatureStatus ?? null);
        if (typeof result.signingUrl !== "string" || !result.signingUrl.startsWith("https://app.firma.dev/signing/")) {
          if (result.signatureStatus === "declined" || result.signatureStatus === "cancelled") {
            if (!cancelled) {
              const declinedBy = result.signatureDeclinedBy === "sponsor" ? "Der Sponsor" : "Der Veranstalter";
              setStatusNotice(result.signatureStatus === "declined" ? `${declinedBy} hat diese Vertragsfassung abgelehnt.${result.signatureDeclineReason ? ` Grund: ${result.signatureDeclineReason}` : ""}` : "Die Zeichnung dieser Vertragsfassung wurde abgebrochen.");
              notifiedRef.current = true;
              onCompletedRef.current?.();
            }
            return;
          }
          if (result.signatureStatus === "pending_organizer" || result.signatureStatus === "signed") {
            if (!cancelled) {
              notifiedRef.current = true;
              setStatusConfirmed(true);
              onCompletedRef.current?.();
            }
            return;
          }
          throw new Error("Für diesen Vertrag wurde kein gültiger Firma-Signaturlink gefunden.");
        }
        if (!cancelled) setUrl(result.signingUrl);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Die Signaturansicht konnte nicht geladen werden."); });
    return () => { cancelled = true; };
  }, [contractId]);

  useEffect(() => {
    if (!initialStatus || (initialStatus !== "pending_sponsor" && initialStatus !== "pending_organizer")) return;
    let cancelled = false;
    const checkStatus = async () => {
      try {
        const response = await fetch(`/api/contracts/${contractId}/simple-signature`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || cancelled || typeof result.signatureStatus !== "string") return;
        if (result.signatureStatus === "declined" || result.signatureStatus === "cancelled") {
          if (!notifiedRef.current) {
            notifiedRef.current = true;
            const declinedBy = result.signatureDeclinedBy === "sponsor" ? "Der Sponsor" : "Der Veranstalter";
            setStatusNotice(result.signatureStatus === "declined" ? `${declinedBy} hat diese Vertragsfassung abgelehnt.${result.signatureDeclineReason ? ` Grund: ${result.signatureDeclineReason}` : ""}` : "Die Zeichnung dieser Vertragsfassung wurde abgebrochen.");
            onCompletedRef.current?.();
          }
          return;
        }
        const sponsorSigned = initialStatus === "pending_sponsor" && result.signatureStatus !== "pending_sponsor";
        const organizerSigned = initialStatus === "pending_organizer" && result.signatureStatus === "signed";
        if ((sponsorSigned || organizerSigned) && !notifiedRef.current) {
          notifiedRef.current = true;
          setStatusConfirmed(true);
          onCompletedRef.current?.();
        }
      } catch {
        // The Firma webhook can arrive later; keep checking while the dialog is open.
      }
    };
    const timer = window.setInterval(() => { void checkStatus(); }, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [contractId, initialStatus]);

  useEffect(() => {
    const receiveFirmaMessage = (event: MessageEvent) => {
      if (event.origin !== "https://app.firma.dev" || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "signing.completed") {
        setCompleted(true);
      }
    };
    window.addEventListener("message", receiveFirmaMessage);
    return () => window.removeEventListener("message", receiveFirmaMessage);
  }, []);

  const closeAndSync = () => {
    void fetch(`/api/contracts/${contractId}/simple-signature`, { cache: "no-store" })
      .catch(() => undefined)
      .finally(onClose);
  };

  return <Modal labelledBy="firma-signing-title" describedBy="firma-signing-description" onClose={closeAndSync} className="create-modal firma-signing-modal">
    <header><div><h2 id="firma-signing-title">Vertrag bei Firma zeichnen</h2><p id="firma-signing-description">Die Signaturansicht bleibt in Splow geöffnet.</p></div><button className="btn" type="button" onClick={closeAndSync} aria-label="Signaturansicht schließen">Schließen</button></header>
    {error ? <p role="alert">{error}</p> : url ? <iframe src={url} title="Firma Signaturansicht" allow="camera;microphone;clipboard-write" /> : <p role="status">Signaturansicht wird geladen …</p>}
    {statusNotice ? <p role="status">{statusNotice}</p> : statusConfirmed ? <p role="status">Unterschrift erfolgreich übernommen. Der Vertragsstatus wurde aktualisiert.</p> : completed && <p role="status">Unterschrift erfasst. Splow gleicht den Status mit Firma ab …</p>}
  </Modal>;
}
