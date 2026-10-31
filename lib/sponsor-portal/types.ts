export type PortalContract = {
  id: string;
  title: string;
  sponsor_name: string;
  value_cents: number;
  signature_status: "draft" | "pending_sponsor" | "pending_organizer" | "signed" | "declined" | "cancelled";
  sponsor_signed_at: string | null;
  organizer_signed_at: string | null;
  signed_at: string | null;
  signature_declined_by: "sponsor" | "organizer" | null;
  signature_declined_at: string | null;
  signature_decline_reason: string | null;
  signing_url: string | null;
};

export type PortalFile = { id: string; file_name: string; content_type: string; created_at: string; url: string };

export type PortalTask = { id: string; benefit_id: string | null; title: string; due_at: string | null; planned_publish_date: string | null; status: string; completion_type: string; requires_sponsor_approval: boolean; assigned_to_sponsor: boolean; sponsor_approval_status: string; sponsor_approved_at: string | null; ready: boolean; blocked_by?: string | null; workflow_order: number | null; workflow_instance: number; files: PortalFile[] };

export type PortalStandaloneTask = { id: string; title: string; due_at: string | null; status: string; completion_type: string; requires_sponsor_approval: boolean; sponsor_approval_status: string; sponsor_approved_at: string | null; ready: boolean; blocked_by?: string | null; files: PortalFile[] };

export type PortalBenefit = { id: string; title: string; benefit_type: "monetary" | "in_kind"; material_logistics: string | null; description: string; quantity: number; tasks_per_unit: boolean; due_at: string | null; status: "Offen" | "In Bearbeitung" | "Abgeschlossen"; units: Array<{ instance: number; needed_at: string | null; status: "Offen" | "In Bearbeitung" | "Abgeschlossen"; hasSponsorApproval: boolean; tasks: PortalTask[] }> };

export type PortalApproval = PortalTask;

export type PortalPartnership = { sponsor_id: string; sponsor_name: string; tasks: PortalStandaloneTask[]; contracts: PortalContract[]; benefits: PortalBenefit[]; tab_updates?: { invoices: Array<{ id: string; updated_at: string }>; documents: Array<{ id: string; uploaded_at: string | null }> } };

export type PortalEvent = { id: string; title: string; start_date: string | null; end_date: string | null; location: string; organizer_logo_url: string | null; organizer_name: string; contact_first_name: string; contact_last_name: string; contact_email: string; contact_phone: string; signature_addon_enabled: boolean; report_metrics?: Array<{ id: string; name: string; value: string }>; sponsor_assignments: PortalPartnership[] };

export type PortalEventSummary = Pick<PortalEvent, "id" | "title" | "start_date" | "end_date" | "location" | "organizer_logo_url"> & { benefit_count: number; signed_volume_cents: number };

export type SponsorPortalTab = "contract" | "invoice" | "benefits" | "tasks" | "documents" | "leistungsnachweis";
