import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { customers, db, listings, orders, waMessages, type Listing, type Order } from "@/db";
import { readSellerReply, type SellerAnswer } from "@/lib/ai/verify-reply";
import { appUrl, MARKUP_CENTS, SITE_NAME } from "@/lib/config";
import { formatMoney } from "@/lib/format";
import { notifyAdmin, notifyBuyer } from "@/lib/notify";
import { cancelOrder, confirmAndCharge } from "@/lib/orders";
import { contactKey, sendImage, sendText } from "@/lib/whatsapp/whapi";

// When a buyer requests an item, the bot DMs the seller who posted it and
// asks if it's still available. Their reply (read by Claude) decides what
// happens next, so most orders need no manual step:
//   available, same or lower price -> buyer's card is charged
//   higher price / fewer units / other change -> buyer accepts or declines
//   sold out -> order cancelled (never charged), listing taken down
//   unclear or no reply -> flagged for the admin

export function autoVerifyEnabled(): boolean {
  return Boolean(process.env.WHAPI_TOKEN) && process.env.AUTO_VERIFY !== "false";
}

function autoChargeEnabled(): boolean {
  return process.env.AUTO_CHARGE !== "false";
}

export const VERIFY_REMIND_HOURS = Number(process.env.VERIFY_REMIND_HOURS ?? "2");

export function replyOverdue(askedAt: Date | null, now = new Date()): boolean {
  return Boolean(askedAt && now.getTime() - askedAt.getTime() > VERIFY_REMIND_HOURS * 3_600_000);
}

export function verificationQuestion(order: Order, listing: Listing): string {
  const original = listing.rawText?.trim();
  return [
    `Hi${listing.sellerName ? ` ${listing.sellerName}` : ""}, I have a buyer for this from ${listing.chatName ?? "the group"}:`,
    original ? `\n"${original.length > 700 ? `${original.slice(0, 700)}…` : original}"\n` : `\n${listing.title}\n`,
    listing.sourcePriceCents
      ? `Do you still have ${order.quantity > 1 ? `${order.quantity} units of ` : ""}the ${listing.title} at ${formatMoney(listing.sourcePriceCents)}${order.quantity > 1 ? " each" : ""}?`
      : `Do you still have ${order.quantity > 1 ? `${order.quantity} units of ` : ""}the ${listing.title}, and what's your best price${order.quantity > 1 ? " each" : ""}?`,
    listing.sourcePriceCents
      ? `Has anything changed (price, quantity, condition)? Just reply here. Thanks!`
      : `Just reply here. Thanks!`,
  ].join("\n");
}

/** DM the seller. Leaves the order in `requested` (manual) if anything fails. */
export async function startVerification(orderId: string): Promise<void> {
  if (!autoVerifyEnabled()) return;
  const [row] = await db
    .select({ order: orders, listing: listings })
    .from(orders)
    .innerJoin(listings, eq(orders.listingId, listings.id))
    .where(eq(orders.id, orderId));
  if (!row || !["requested", "verifying"].includes(row.order.status)) return;
  const { order, listing } = row;

  const text = verificationQuestion(order, listing);
  try {
    if (listing.imageIds[0]) {
      await sendImage(listing.sellerId, appUrl(`/api/images/${listing.imageIds[0]}`), text);
    } else {
      await sendText(listing.sellerId, text);
    }
    await db
      .update(orders)
      .set({
        status: "verifying",
        sellerContact: contactKey(listing.sellerId),
        verifyAskedAt: new Date(),
        verifyStatus: "asked",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));
  } catch (err) {
    console.error("[verify] could not message seller", err);
    await db
      .update(orders)
      .set({ verifyStatus: "failed", verifySummary: `Couldn't message seller: ${(err as Error).message}` })
      .where(eq(orders.id, order.id));
    await notifyAdmin(`Couldn't message the seller about ${listing.title}. Please check manually: ${appUrl("/admin/orders")}`);
  }
}

/** Does this WhatsApp contact owe us an answer? (Used to decide whether to store a DM.) */
export async function hasOpenVerification(senderId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.sellerContact, contactKey(senderId)), eq(orders.status, "verifying")))
    .limit(1);
  return Boolean(row);
}

/** Read every pending DM from one seller and apply it to their open questions. */
export async function handleSellerReplies(chatId: string, senderId: string): Promise<void> {
  const msgs = await db
    .select()
    .from(waMessages)
    .where(and(eq(waMessages.chatId, chatId), eq(waMessages.status, "pending")))
    .orderBy(asc(waMessages.sentAt));
  if (!msgs.length) return;
  const ids = msgs.map((m) => m.id);

  const open = await db
    .select({ order: orders, listing: listings })
    .from(orders)
    .innerJoin(listings, eq(orders.listingId, listings.id))
    .where(and(eq(orders.sellerContact, contactKey(senderId)), eq(orders.status, "verifying")))
    .orderBy(asc(orders.createdAt));
  if (!open.length) {
    await db.update(waMessages).set({ status: "ignored" }).where(inArray(waMessages.id, ids));
    return;
  }

  const reply = msgs.map((m) => m.text?.trim() || (m.imageId ? "[sent a photo]" : "")).filter(Boolean).join("\n");
  let answers: SellerAnswer[];
  try {
    answers = await readSellerReply(
      open.map(({ order, listing }) => ({
        title: listing.title,
        quantity: order.quantity,
        unitPrice: listing.sourcePriceCents === null ? null : listing.sourcePriceCents / 100,
        originalMessage: listing.rawText,
      })),
      reply,
    );
  } catch (err) {
    await db
      .update(waMessages)
      .set({ status: "failed", error: (err as Error).message.slice(0, 500) })
      .where(inArray(waMessages.id, ids));
    for (const { order } of open) await recordReply(order, reply, "needs_review", "Couldn't read the seller's reply");
    await notifyAdmin(`Seller replied but I couldn't read it: "${reply.slice(0, 300)}" ${appUrl("/admin/orders")}`);
    return;
  }

  for (const [i, { order, listing }] of open.entries()) {
    const answer = answers.find((a) => a.ask_index === i) ?? {
      ask_index: i,
      outcome: "unclear" as const,
      unit_price: null,
      quantity_available: null,
      notes: null,
      summary: "Seller's reply didn't mention this item",
    };
    await applyAnswer(order, listing, answer, reply);
  }
  await db.update(waMessages).set({ status: "done", error: null }).where(inArray(waMessages.id, ids));
}

async function recordReply(order: Order, reply: string, verifyStatus: string, summary: string) {
  await db
    .update(orders)
    .set({
      sellerReply: order.sellerReply ? `${order.sellerReply}\n${reply}` : reply,
      verifyStatus,
      verifySummary: summary,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id));
}

export type Decision =
  | { kind: "unclear" }
  | { kind: "unavailable" }
  | { kind: "proceed"; unitPriceCents: number; sourcePriceCents: number }
  | { kind: "ask_buyer"; unitPriceCents: number; sourcePriceCents: number; quantity: number };

/** Pure decision logic, separated so it can be unit-tested. */
export function decide(order: Order, listing: Listing, a: SellerAnswer, markupCents = MARKUP_CENTS): Decision {
  if (a.outcome === "unclear") return { kind: "unclear" };
  if (a.outcome === "unavailable" || (a.quantity_available !== null && a.quantity_available <= 0)) {
    return { kind: "unavailable" };
  }
  const sourcePriceCents = a.unit_price && a.unit_price > 0 ? Math.round(a.unit_price * 100) : listing.sourcePriceCents;
  // Price on request and the seller still hasn't named one: we can't sell it yet.
  if (!sourcePriceCents) return { kind: "unclear" };
  const unitPriceCents = sourcePriceCents + markupCents;
  const quantity = Math.min(order.quantity, a.quantity_available ?? order.quantity);
  const buyerMustAgree =
    order.unitPriceCents <= 0 || // the buyer never saw a price: they always approve it first
    unitPriceCents > order.unitPriceCents ||
    quantity < order.quantity ||
    (a.outcome === "changed" && Boolean(a.notes));
  return buyerMustAgree
    ? { kind: "ask_buyer", unitPriceCents, sourcePriceCents, quantity }
    : { kind: "proceed", unitPriceCents: Math.min(unitPriceCents, order.unitPriceCents), sourcePriceCents };
}

async function applyAnswer(order: Order, listing: Listing, a: SellerAnswer, reply: string): Promise<void> {
  const [buyer] = await db.select().from(customers).where(eq(customers.id, order.customerId));
  const orderUrl = appUrl(`/account/orders/${order.id}`);
  const d = decide(order, listing, a);

  if (d.kind === "unclear") {
    await recordReply(order, reply, "needs_review", a.summary);
    await notifyAdmin(`Seller reply about ${listing.title} needs you: "${reply.slice(0, 300)}" ${appUrl("/admin/orders")}`);
    return;
  }

  if (d.kind === "unavailable") {
    await recordReply(order, reply, "unavailable", a.summary);
    await db.update(listings).set({ status: "sold", quantity: 0, updatedAt: new Date() }).where(eq(listings.id, listing.id));
    await cancelOrder(order.id, "Sorry, the supplier just sold out of this item. You were not charged.");
    await notifyBuyer(buyer?.phone ?? null, `${SITE_NAME}: sorry, the ${listing.title} just sold out. You were not charged.`);
    await notifyAdmin(`Seller says ${listing.title} is sold out. Order cancelled automatically.`);
    return;
  }

  // Seller is still selling it: refresh the listing with what they told us.
  await db
    .update(listings)
    .set({
      sourcePriceCents: d.sourcePriceCents,
      markupCents: MARKUP_CENTS,
      salePriceCents: d.sourcePriceCents + MARKUP_CENTS,
      ...(a.quantity_available !== null ? { quantity: a.quantity_available } : {}),
      ...(a.notes ? { details: [listing.details, a.notes].filter(Boolean).join(" · ") } : {}),
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listing.id));

  if (d.kind === "ask_buyer") {
    await db
      .update(orders)
      .set({
        status: "needs_buyer_approval",
        sellerReply: order.sellerReply ? `${order.sellerReply}\n${reply}` : reply,
        verifyStatus: "changed",
        verifySummary: a.notes ? `${a.summary} ${a.notes}` : a.summary,
        proposedUnitPriceCents: d.unitPriceCents,
        proposedQuantity: d.quantity,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));
    await notifyBuyer(
      buyer?.phone ?? null,
      `${SITE_NAME}: the ${listing.title} is available but something changed. Please review and accept or cancel: ${orderUrl}`,
    );
    await notifyAdmin(`Seller changed ${listing.title}: ${a.summary} Waiting on the buyer.`);
    return;
  }

  // Confirmed. If the price dropped the buyer pays the lower price.
  await db
    .update(orders)
    .set({
      unitPriceCents: d.unitPriceCents,
      totalCents: d.unitPriceCents * order.quantity,
      sourcePriceCents: d.sourcePriceCents,
      sellerReply: order.sellerReply ? `${order.sellerReply}\n${reply}` : reply,
      verifyStatus: "confirmed",
      verifySummary: a.summary,
      ...(autoChargeEnabled() ? {} : { status: "requested" as const }),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id));

  if (!autoChargeEnabled()) {
    await notifyAdmin(`Seller confirmed ${listing.title}. Ready to charge: ${appUrl("/admin/orders")}`);
    return;
  }
  const result = await confirmAndCharge(order.id);
  await notifyAdmin(
    result.ok
      ? `Seller confirmed ${listing.title} and the buyer was charged ${formatMoney(d.unitPriceCents * order.quantity)}. Buy it from ${listing.sellerName ?? "the seller"} and ship: ${appUrl("/admin/orders")}`
      : `Seller confirmed ${listing.title}, but the charge didn't go through: ${result.reason}`,
  );
  if (result.ok) {
    await notifyBuyer(buyer?.phone ?? null, `${SITE_NAME}: good news, your ${listing.title} is confirmed and paid. We'll send tracking soon. ${orderUrl}`);
  } else {
    await notifyBuyer(buyer?.phone ?? null, `${SITE_NAME}: your ${listing.title} is available. Please complete payment: ${orderUrl}`);
  }
}

/** Buyer accepted the seller's new price/quantity. */
export async function acceptChange(order: Order): Promise<void> {
  if (order.status !== "needs_buyer_approval" || !order.proposedUnitPriceCents) return;
  const quantity = order.proposedQuantity ?? order.quantity;
  await db
    .update(orders)
    .set({
      status: "requested",
      unitPriceCents: order.proposedUnitPriceCents,
      quantity,
      totalCents: order.proposedUnitPriceCents * quantity,
      sourcePriceCents: order.proposedUnitPriceCents - MARKUP_CENTS,
      verifyStatus: "confirmed",
      proposedUnitPriceCents: null,
      proposedQuantity: null,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, order.id), eq(orders.status, "needs_buyer_approval")));
  if (autoChargeEnabled()) {
    const result = await confirmAndCharge(order.id);
    await notifyAdmin(
      result.ok
        ? `Buyer accepted the new terms for ${order.title} and was charged. Buy it and ship: ${appUrl("/admin/orders")}`
        : `Buyer accepted the new terms for ${order.title}, but the charge didn't go through: ${result.reason}`,
    );
  } else {
    await notifyAdmin(`Buyer accepted the new terms for ${order.title}. Ready to charge: ${appUrl("/admin/orders")}`);
  }
}
