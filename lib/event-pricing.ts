export type PaidEventPlanCode = "starter" | "professional" | "business";

export const EVENT_PLAN_NAMES: Record<PaidEventPlanCode, string> = {
  starter: "Starter",
  professional: "Professional",
  business: "Business",
};

export function sponsorSlotPriceCents(startingSlots: number, quantity: number) {
  const first = Math.max(4, Math.floor(startingSlots) + 1);
  const last = Math.floor(startingSlots) + Math.max(0, Math.floor(quantity));
  let total = 0;
  for (let slot = first; slot <= last; slot += 1) {
    total += slot <= 10 ? 600 : slot <= 20 ? 400 : 300;
  }
  return total;
}

export function eventUpgradePriceCents(currentPriceCents: number, targetPriceCents: number) {
  return targetPriceCents > currentPriceCents ? targetPriceCents - currentPriceCents + 2000 : 0;
}
