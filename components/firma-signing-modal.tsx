"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/modal";

export function FirmaSigningModal({ contractId, onClose, onCompleted }: { contractId: string; onClose: () => void; onCompleted?: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/contracts/${contractId}/simple-signature`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Die Signaturansicht konnte nicht geladen werden.");
        if (typeof result.signingUrl !== "string" || !result.signingUrl.startsWith("https://app.firma.dev/signing/")) {
          throw new Error("Für diesen Vertrag wurde kein gültiger Firma-Signaturlink gefunden.");
        }
        if (!cancelled) setUrl(result.signingUrl);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Die Signaturansicht konnte nicht geladen werden."); });
    return () => { cancelled = true; };
  }, [contractId]);

  useEffect(() => {
    const receiveFirmaMessage = (event: MessageEvent) => {
      if (event.origin !== "https://app.firma.dev" || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "signing.completed") {
        setCompleted(true);
        onCompleted?.();
      }
    };
    window.addEventListener("message", receiveFirmaMessage);
    return () => window.removeEventListener("message", receiveFirmaMessage);
  }, [onCompleted]);

  return <Modal labelledBy="firma-signing-title" describedBy="firma-signing-description" onClose={onClose} className="create-modal firma-signing-modal">
    <header><div><h2 id="firma-signing-title">Vertrag bei Firma zeichnen</h2><p id="firma-signing-description">Die Signaturansicht bleibt in Splow geöffnet.</p></div><button className="btn" type="button" onClick={onClose} aria-label="Signaturansicht schließen">Schließen</button></header>
    {error ? <p role="alert">{error}</p> : url ? <iframe src={url} title="Firma Signaturansicht" allow="camera;microphone;clipboard-write" /> : <p role="status">Signaturansicht wird geladen …</p>}
    {completed && <p role="status">Unterschrift erfasst. Splow aktualisiert den Vertragsstatus, sobald Firma die Bestätigung übermittelt.</p>}
  </Modal>;
}
