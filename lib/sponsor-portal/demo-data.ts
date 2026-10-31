import type { PortalEvent,PortalFile } from "./types";

export const demoFile: PortalFile = { id: "demo-document", file_name: "Beispiel-Nachweis.pdf", content_type: "application/pdf", created_at: "2026-10-17T12:22:00.000Z", url: "/downloads/splow-muster-vertriebspartnervereinbarung.pdf" };

export const demoPortalEvent: PortalEvent = {
  id: "demo",
  title: "Aloha Open-Air 2027",
  start_date: "2027-06-10",
  end_date: "2027-06-10",
  location: "Festivalwiese 23",
  organizer_logo_url: null,
  organizer_name: "Aloha Events",
  contact_first_name: "Jonas",
  contact_last_name: "Kastenholz",
  contact_email: "jonas@Splow.de",
  contact_phone: "0175 34396572",
  signature_addon_enabled: true,
  report_metrics: [{ id: "demo-attendance", name: "Besucherzahl", value: "12.500" }, { id: "demo-social-reach", name: "Social-Media-Reichweite", value: "85.000" }],
  sponsor_assignments: [{
    sponsor_id: "demo-sponsor",
    sponsor_name: "Elspass Autoland GmbH",
    contracts: [{ id: "demo-contract", title: "Sponsoringvertrag", sponsor_name: "Elspass Autoland GmbH", value_cents: 500000, signature_status: "signed", sponsor_signed_at: "2026-10-14T14:10:00.000Z", organizer_signed_at: "2026-10-14T14:12:00.000Z", signed_at: "2026-10-14T14:12:00.000Z", signature_declined_by: null, signature_declined_at: null, signature_decline_reason: null, signing_url: "/downloads/splow-muster-vertriebspartnervereinbarung.pdf" }],
    tasks: [
      { id: "demo-manual-upload", title: "Logo für die Event-Website bereitstellen", due_at: "2027-05-20", status: "Offen", completion_type: "sponsor_upload", requires_sponsor_approval: false, sponsor_approval_status: "pending", sponsor_approved_at: null, ready: true, files: [] },
      { id: "demo-manual-approval", title: "Social-Media-Beitrag freigeben", due_at: "2027-05-28", status: "In Bearbeitung", completion_type: "sponsor_approval", requires_sponsor_approval: true, sponsor_approval_status: "pending", sponsor_approved_at: null, ready: true, files: [demoFile] },
      { id: "demo-manual-changes-requested", title: "Social-Media-Beitrag erneut freigeben", due_at: "2027-05-30", status: "In Bearbeitung", completion_type: "sponsor_approval", requires_sponsor_approval: true, sponsor_approval_status: "changes_requested", sponsor_approved_at: null, ready: false, files: [demoFile] },
      { id: "demo-manual-completed", title: "Sponsorlogo im Programmheft freigeben", due_at: "2027-05-10", status: "Erledigt", completion_type: "sponsor_approval", requires_sponsor_approval: true, sponsor_approval_status: "approved", sponsor_approved_at: "2026-10-15T14:08:00.000Z", ready: true, files: [demoFile] },
    ],
    benefits: [{
      id: "demo-benefit",
      title: "Logo auf der Event-Website",
      benefit_type: "in_kind",
      material_logistics: null,
      description: "Platzierung des Sponsors auf der Event-Website",
      quantity: 1,
      tasks_per_unit: true,
      due_at: "2027-06-01",
      status: "In Bearbeitung",
      units: [{ instance: 1, needed_at: "2027-06-01", status: "In Bearbeitung", hasSponsorApproval: true, tasks: [
        { id: "demo-benefit-approval", benefit_id: "demo-benefit", title: "Website-Entwurf freigeben", due_at: "2027-05-25", planned_publish_date: null, status: "In Bearbeitung", completion_type: "sponsor_approval", requires_sponsor_approval: true, assigned_to_sponsor: false, sponsor_approval_status: "pending", sponsor_approved_at: null, ready: true, workflow_order: 1, workflow_instance: 1, files: [demoFile] },
      ] }],
    }],
  }],
};
