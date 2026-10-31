import type { PortalContract } from "./types";

export function statusLabel(status: PortalContract["signature_status"]) {
  if (status === "signed") return "Vollständig gezeichnet";
  if (status === "declined") return "Abgelehnt";
  if (status === "cancelled") return "Zeichnung abgebrochen";
  if (status === "pending_organizer") return "Wartet auf Veranstalter";
  if (status === "pending_sponsor") return "Deine Zeichnung steht aus";
  return "Noch nicht freigegeben";
}

export function formatPortalDate(value: string | null) {
  if (!value) return "Noch nicht geplant";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}
