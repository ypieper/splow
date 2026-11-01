export type EventPlanLabelCode = "free" | "event" | "event_pro" | "starter" | "professional" | "business" | "enterprise";

const eventPlanLabels: Record<EventPlanLabelCode, string> = {
  free: "Free",
  event: "Basic",
  event_pro: "Pro",
  starter: "Starter",
  professional: "Professional",
  business: "Business",
  enterprise: "Enterprise",
};

export function eventPlanLabel(code: EventPlanLabelCode) {
  return eventPlanLabels[code];
}
