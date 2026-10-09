import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { parseWebhook } from "@/lib/whatsapp/whapi";
import { processAfterQuietPeriod, recordMessage, shouldRecord } from "@/lib/whatsapp/ingest";
import { handleOptCommand } from "@/lib/whatsapp/opt-out";

// The debounce sleep + AI call run after the response, inside this budget.
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const expected = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!expected) return false;
  const given = new URL(req.url).searchParams.get("secret") ?? req.headers.get("x-webhook-secret") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const fresh: string[] = [];
  for (const m of parseWebhook(body)) {
    // "opt out" / "opt in" from a seller, by DM or in a group
    if (await handleOptCommand(m)) continue;
    if (!(await shouldRecord(m))) continue;
    if (await recordMessage(m)) fresh.push(m.id);
  }

  // Answer the gateway right away so it doesn't retry; parse afterwards.
  for (const id of fresh) {
    after(() => processAfterQuietPeriod(id).catch((err) => console.error("[whatsapp]", err)));
  }
  return NextResponse.json({ ok: true, captured: fresh.length });
}
