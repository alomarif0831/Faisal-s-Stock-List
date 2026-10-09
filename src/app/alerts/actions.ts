"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, listings, wantHits, wants } from "@/db";
import { MAX_ALERTS_PER_USER, wantMatcher } from "@/lib/alerts";
import { currentUserId } from "@/lib/auth";
import { CONDITIONS } from "@/lib/catalog";
import { dollars } from "@/lib/search";

async function userIdOrSignIn(): Promise<string> {
  const id = await currentUserId();
  if (!id) redirect("/sign-in?redirect_url=/alerts");
  return id;
}

/** US numbers can be typed without the 1; anything else needs its country code. */
function whatsappDigits(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.length === 10) d = `1${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

export async function createWant(fd: FormData) {
  const userId = await userIdOrSignIn();
  const query = String(fd.get("q") ?? "").trim().slice(0, 120);
  const max = String(fd.get("max") ?? "").trim();
  const conditionRaw = String(fd.get("condition") ?? "");
  const phoneRaw = String(fd.get("whatsapp") ?? "").trim();
  const back = (err: string) =>
    redirect(`/find?${new URLSearchParams({ q: query, max, condition: conditionRaw, error: err })}`);

  if (query.length < 2) back("Tell us what you're looking for.");
  const maxPriceCents = max ? dollars(max) : null;
  if (max && !maxPriceCents) back("Enter your max price as a number, like 900.");
  const condition = (CONDITIONS as readonly string[]).includes(conditionRaw) ? conditionRaw : null;
  const notifyWhatsapp = phoneRaw ? whatsappDigits(phoneRaw) : null;
  if (phoneRaw && !notifyWhatsapp) back("That WhatsApp number doesn't look right. Include the country code.");

  const [{ n }] = await db
    .select({ n: count() })
    .from(wants)
    .where(and(eq(wants.clerkUserId, userId), eq(wants.active, true)));
  if (n >= MAX_ALERTS_PER_USER) back(`You can have up to ${MAX_ALERTS_PER_USER} alerts. Delete one first.`);

  const [want] = await db
    .insert(wants)
    .values({ clerkUserId: userId, query, maxPriceCents, condition, notifyWhatsapp })
    .returning();

  // What's already listed shows on /alerts straight away; only posts from
  // now on trigger a WhatsApp message.
  const live = await db.select().from(listings).where(eq(listings.status, "active"));
  const already = live.filter(wantMatcher(want)).slice(0, 200);
  if (already.length) {
    await db
      .insert(wantHits)
      .values(already.map((l) => ({ wantId: want.id, listingId: l.id, notified: true })))
      .onConflictDoNothing();
  }
  revalidatePath("/alerts");
  redirect("/alerts?created=1");
}

export async function deleteWant(fd: FormData) {
  const userId = await userIdOrSignIn();
  const id = String(fd.get("id") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    await db.delete(wants).where(and(eq(wants.id, id), eq(wants.clerkUserId, userId)));
  }
  revalidatePath("/alerts");
}

