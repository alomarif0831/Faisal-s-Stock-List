import { timingSafeEqual } from "node:crypto";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, hiddenSellers } from "@/db";
import { optInSeller, optOutSeller } from "@/lib/whatsapp/opt-out";

// Admin API for seller opt-outs (the same thing a seller does by texting
// "opt out" to the bot). Auth: `Authorization: Bearer <ADMIN_API_KEY>`
// (falls back to WHATSAPP_WEBHOOK_SECRET when ADMIN_API_KEY isn't set).
//
//   GET  /api/sellers/opt-out                         -> list opted-out sellers
//   POST /api/sellers/opt-out {"phone":"+1 555…"}     -> opt out
//   POST /api/sellers/opt-out {"phone":"…","action":"in"} -> opt back in

function authorized(req: Request): boolean {
  const expected = process.env.ADMIN_API_KEY || process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!expected) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const sellers = await db.select().from(hiddenSellers).orderBy(desc(hiddenSellers.createdAt));
  return NextResponse.json({ sellers });
}

export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  let body: { phone?: unknown; name?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  let digits = String(body.phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`; // US number without the 1
  if (digits.length < 11 || digits.length > 15) {
    return NextResponse.json({ error: "phone must include the country code, e.g. +1 555 123 4567" }, { status: 400 });
  }
  if (body.action === "in") {
    const restored = await optInSeller(digits);
    return NextResponse.json({ ok: true, phone: digits, optedOut: false, listingsRestored: restored });
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : null;
  const removed = await optOutSeller(digits, name);
  return NextResponse.json({ ok: true, phone: digits, optedOut: true, listingsRemoved: removed });
}
