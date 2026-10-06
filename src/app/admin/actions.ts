"use server";

import { and, eq, gte, inArray, like } from "drizzle-orm";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, listings, orders, waMessages } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { MARKUP_CENTS } from "@/lib/config";
import { cancelOrder, confirmAndCharge } from "@/lib/orders";
import { startVerification } from "@/lib/verify";
import { processAfterQuietPeriod, processBurst } from "@/lib/whatsapp/ingest";

const id = (fd: FormData, k = "id") => String(fd.get(k) ?? "");
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim().slice(0, 300) || null;

export async function setListingStatus(fd: FormData) {
  await requireAdmin();
  const status = String(fd.get("status"));
  if (!["active", "hidden", "sold"].includes(status)) return;
  await db.update(listings).set({ status, updatedAt: new Date() }).where(eq(listings.id, id(fd)));
  revalidatePath("/admin");
}

export async function updateListing(fd: FormData) {
  await requireAdmin();
  const source = Number(fd.get("sourcePrice"));
  const qty = Number(fd.get("quantity"));
  const patch: Partial<typeof listings.$inferInsert> = { updatedAt: new Date() };
  const title = text(fd, "title");
  if (title) patch.title = title;
  if (Number.isFinite(source) && source > 0) {
    patch.sourcePriceCents = Math.round(source * 100);
    patch.markupCents = MARKUP_CENTS;
    patch.salePriceCents = patch.sourcePriceCents + MARKUP_CENTS;
  }
  if (Number.isInteger(qty) && qty >= 0) patch.quantity = qty;
  await db.update(listings).set(patch).where(eq(listings.id, id(fd)));
  revalidatePath("/admin");
}

export async function deleteListing(fd: FormData) {
  await requireAdmin();
  // Listings with orders are kept (orders reference them); hide those instead.
  const [hasOrder] = await db.select({ id: orders.id }).from(orders).where(eq(orders.listingId, id(fd))).limit(1);
  if (hasOrder) {
    await db.update(listings).set({ status: "hidden" }).where(eq(listings.id, id(fd)));
  } else {
    await db.delete(listings).where(eq(listings.id, id(fd)));
  }
  revalidatePath("/admin");
}

export async function confirmOrder(fd: FormData) {
  await requireAdmin();
  const result = await confirmAndCharge(id(fd));
  revalidatePath("/admin/orders");
  redirect(`/admin/orders?msg=${encodeURIComponent(result.ok ? "Charged successfully." : result.reason)}`);
}

export async function cancelOrderAdmin(fd: FormData) {
  await requireAdmin();
  await cancelOrder(id(fd), text(fd, "note"));
  revalidatePath("/admin/orders");
}

export async function askSellerAgain(fd: FormData) {
  await requireAdmin();
  await startVerification(id(fd));
  revalidatePath("/admin/orders");
}

export async function markShipped(fd: FormData) {
  await requireAdmin();
  await db
    .update(orders)
    .set({
      status: "shipped",
      carrier: text(fd, "carrier"),
      trackingNumber: text(fd, "tracking"),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, id(fd)));
  revalidatePath("/admin/orders");
}

export async function markDelivered(fd: FormData) {
  await requireAdmin();
  await db.update(orders).set({ status: "delivered", updatedAt: new Date() }).where(eq(orders.id, id(fd)));
  revalidatePath("/admin/orders");
}

/**
 * Run the last day's skipped group posts through the current rules again
 * (e.g. after the bot learned to capture posts without a price).
 */
export async function recheckIgnored() {
  await requireAdmin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .update(waMessages)
    .set({ status: "pending", error: null, createdAt: new Date() })
    .where(
      and(
        inArray(waMessages.status, ["ignored", "failed"]),
        like(waMessages.chatId, "%@g.us"),
        gte(waMessages.sentAt, since),
      ),
    )
    .returning({ senderId: waMessages.senderId });
  const senders = [...new Set(rows.map((r) => r.senderId))];
  // Finish after the response; a few sellers at a time keeps AI usage smooth.
  after(async () => {
    for (let i = 0; i < senders.length; i += 4) {
      await Promise.all(
        senders.slice(i, i + 4).map((s) => processBurst(s).catch((err) => console.error("[recheck]", err))),
      );
    }
  });
  redirect(`/admin/inbox?rechecking=${rows.length}`);
}

export async function reprocessMessage(fd: FormData) {
  await requireAdmin();
  const [msg] = await db.select().from(waMessages).where(eq(waMessages.id, id(fd)));
  if (!msg) return;
  await db
    .update(waMessages)
    .set({ status: "pending", error: null, createdAt: new Date() })
    .where(eq(waMessages.id, msg.id));
  await processAfterQuietPeriod(msg.id, 0);
  revalidatePath("/admin/inbox");
}
