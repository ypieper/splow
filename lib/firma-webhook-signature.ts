import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyFirmaWebhookSignature(rawBody: string, header: string | null, secret: string, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? ["", ""] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !/^\d+$/.test(timestamp) || !signature || !/^[a-f\d]{64}$/i.test(signature)) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
