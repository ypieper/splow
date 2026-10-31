import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyFirmaWebhookSignature } from "../lib/firma-webhook-signature";

const secret = "firma-test-secret";
const now = 1_800_000_000_000;
const body = "{\"id\":\"evt_test\",\"type\":\"signing_request.completed\"}";

function signatureFor(payload: string, signingSecret = secret, timestamp = Math.floor(now / 1000)) {
  const digest = createHmac("sha256", signingSecret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

test("accepts a valid Firma signature over the exact raw body", () => {
  assert.equal(verifyFirmaWebhookSignature(body, signatureFor(body), secret, now), true);
  assert.equal(verifyFirmaWebhookSignature(`${body} `, signatureFor(body), secret, now), false);
});

test("rejects malformed signatures and missing secrets", () => {
  assert.equal(verifyFirmaWebhookSignature(body, null, secret, now), false);
  assert.equal(verifyFirmaWebhookSignature(body, signatureFor(body), "", now), false);
  assert.equal(verifyFirmaWebhookSignature(body, "t=not-a-time,v1=abcd", secret, now), false);
  assert.equal(verifyFirmaWebhookSignature(body, `t=${Math.floor(now / 1000)},v1=abcd`, secret, now), false);
});

test("rejects signatures outside the five-minute clock tolerance", () => {
  const seconds = Math.floor(now / 1000);
  assert.equal(verifyFirmaWebhookSignature(body, signatureFor(body, secret, seconds - 301), secret, now), false);
  assert.equal(verifyFirmaWebhookSignature(body, signatureFor(body, secret, seconds + 301), secret, now), false);
});

test("supports Firma's previous secret during a rotation window", () => {
  const oldSecret = "firma-old-test-secret";
  const oldSignature = signatureFor(body, oldSecret);
  assert.equal(verifyFirmaWebhookSignature(body, oldSignature, oldSecret, now), true);
  assert.equal(verifyFirmaWebhookSignature(body, oldSignature, secret, now), false);
});
