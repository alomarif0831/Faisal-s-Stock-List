import "server-only";
import { and, count, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db, listings, wantHits, wants } from "@/db";
import { appUrl, SITE_NAME } from "@/lib/config";
import { formatMoney, formatPrice } from "@/lib/format";
import { notifyBuyer } from "@/lib/notify";
import { queryMatcher } from "@/lib/search";

export const MAX_ALERTS_PER_USER = 20;
// WhatsApp pings per alert per day; more matches still show on /alerts.
const DAILY_PINGS_PER_ALERT = 10;

type Want = typeof wants.$inferSelect;

export function wantMatcher(w: Pick<Want, "query" | "maxPriceCents" | "condition">) {
  return queryMatcher(w.query, { maxCents: w.maxPriceCents, condition: w.condition });
}

/**
 * Check freshly created/updated listings against everyone's alerts. Each
 * (alert, listing) pair fires once, so a repost or an unrelated edit never
 * pings twice, while a price drop into someone's budget does fire.
 * Best-effort: never throws.
 */
export async function checkAlerts(listingIds: string[]): Promise<void> {
  if (!listingIds.length) return;
  try {
    const [rows, active] = await Promise.all([
      db
        .select()
        .from(listings)
        .where(and(inArray(listings.id, listingIds), eq(listings.status, "active"))),
      db.select().from(wants).where(eq(wants.active, true)),
    ]);
    if (!rows.length || !active.length) return;

    for (const want of active) {
      const matches = wantMatcher(want);
      for (const l of rows.filter(matches)) {
        const [hit] = await db
          .insert(wantHits)
          .values({ wantId: want.id, listingId: l.id })
          .onConflictDoNothing()
          .returning({ wantId: wantHits.wantId });
        if (!hit || !want.notifyWhatsapp) continue;

        const [{ n }] = await db
          .select({ n: count() })
          .from(wantHits)
          .where(
            and(
              eq(wantHits.wantId, want.id),
              eq(wantHits.notified, true),
              gte(wantHits.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
            ),
          );
        if (n >= DAILY_PINGS_PER_ALERT) continue;

        await notifyBuyer(want.notifyWhatsapp, alertText(want, l));
        await db
          .update(wantHits)
          .set({ notified: true })
          .where(and(eq(wantHits.wantId, want.id), eq(wantHits.listingId, l.id)));
      }
    }
  } catch (err) {
    console.error("[alerts]", err);
  }
}

export function alertText(
  want: Pick<Want, "query" | "maxPriceCents">,
  l: Pick<typeof listings.$inferSelect, "id" | "title" | "salePriceCents" | "currency" | "sellerName" | "chatName">,
): string {
  const price = formatPrice(l.salePriceCents, l.currency);
  const under =
    want.maxPriceCents && l.salePriceCents && l.salePriceCents < want.maxPriceCents
      ? ` (${formatMoney(want.maxPriceCents - l.salePriceCents, l.currency)} under your budget)`
      : "";
  return [
    `🔔 *${SITE_NAME} deal alert* for "${want.query}"`,
    ``,
    `*${l.title}*: ${price}${under}`,
    `Seller: ${l.sellerName ?? "unknown"}${l.chatName ? ` · ${l.chatName}` : ""}`,
    appUrl(`/listing/${l.id}`),
    ``,
    `Manage your alerts: ${appUrl("/alerts")}`,
  ].join("\n");
}

/** The number this user gave last time, to prefill the form. */
export async function lastWhatsappFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ phone: wants.notifyWhatsapp })
    .from(wants)
    .where(and(eq(wants.clerkUserId, userId), isNotNull(wants.notifyWhatsapp)))
    .orderBy(desc(wants.createdAt))
    .limit(1);
  return row?.phone ?? null;
}
