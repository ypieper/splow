import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processFirmaWebhookQueue } from "@/lib/firma-webhook-jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(request: Request, secret: string) {
  const supplied = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Cron ist nicht konfiguriert." }, { status: 503 });
  if (!isAuthorized(request, secret)) return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });

  try {
    const result = await processFirmaWebhookQueue({ batchSize: 25 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Firma webhook queue worker failed", error);
    return NextResponse.json({ error: "Die Firma-Webhook-Aufträge konnten nicht verarbeitet werden." }, { status: 500 });
  }
}
