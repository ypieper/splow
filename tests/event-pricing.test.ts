import assert from "node:assert/strict";
import test from "node:test";
import { eventUpgradePriceCents, sponsorSlotPriceCents } from "../lib/event-pricing";

test("additional sponsor prices follow the progressive tiers", () => {
  assert.equal(sponsorSlotPriceCents(3, 1), 600);
  assert.equal(sponsorSlotPriceCents(3, 7), 4200);
  assert.equal(sponsorSlotPriceCents(9, 2), 1000);
  assert.equal(sponsorSlotPriceCents(19, 2), 700);
  assert.equal(sponsorSlotPriceCents(3, 0), 0);
});

test("event upgrades charge the price difference plus twenty euros", () => {
  assert.equal(eventUpgradePriceCents(4900, 9900), 7000);
  assert.equal(eventUpgradePriceCents(9900, 14900), 7000);
  assert.equal(eventUpgradePriceCents(14900, 4900), 0);
});
