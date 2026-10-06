import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import Stripe from "stripe";
import { customers, db, listings, orders, type Customer, type Order, type PaymentChoice, type ShippingAddress } from "@/db";
import { appUrl } from "@/lib/config";
import { formatMoney } from "@/lib/format";
import { ensureStripeCustomer, getStripe } from "@/lib/stripe";
import { notifyAdmin } from "@/lib/notify";

export function shippingFrom(c: Customer): ShippingAddress {
  return {
    name: c.shipName ?? c.fullName ?? "",
    line1: c.shipLine1 ?? "",
    line2: c.shipLine2,
    city: c.shipCity ?? "",
    state: c.shipState ?? "",
    postalCode: c.shipPostalCode ?? "",
    country: c.shipCountry ?? "US",
    phone: c.phone,
  };
}

export async function createOrderRequest(
  customer: Customer,
  listingId: string,
  quantity: number,
  note: string | null,
  paymentChoice: PaymentChoice = "saved_card",
): Promise<Order> {
  const [listing] = await db
    .select()
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.status, "active")));
  if (!listing) throw new Error("This item is no longer available.");
  const qty = Math.min(Math.max(1, Math.floor(quantity)), listing.quantity);

  const [order] = await db
    .insert(orders)
    .values({
      customerId: customer.id,
      listingId: listing.id,
      quantity: qty,
      title: listing.title,
      // 0 = price on request: the seller is asked, the buyer approves it.
      unitPriceCents: listing.salePriceCents ?? 0,
      totalCents: (listing.salePriceCents ?? 0) * qty,
      sourcePriceCents: listing.sourcePriceCents ?? 0,
      shipping: shippingFrom(customer),
      buyerNote: note,
      paymentChoice: customer.hasPaymentMethod ? paymentChoice : "checkout",
    })
    .returning();

  await notifyAdmin(
    `New order request: ${qty} x ${listing.title} for ${formatMoney(order.totalCents)}.\n` +
      `Seller: ${listing.sellerName ?? listing.sellerId} (${listing.chatName ?? listing.chatId}) asked ${listing.sourcePriceCents ? formatMoney(listing.sourcePriceCents) : "no price yet"}.\n` +
      `Review: ${appUrl("/admin/orders")}`,
  );
  return order;
}

const CHARGEABLE: Order["status"][] = ["requested", "verifying", "awaiting_payment"];

export type ChargeResult = { ok: true } | { ok: false; reason: string };

/**
 * You've confirmed with the seller that the item is available: charge the
 * buyer's saved card. If the bank wants the buyer present (3-D Secure) or
 * declines, the order moves to awaiting_payment with a Stripe Checkout
 * link the buyer can pay from their account page.
 */
export async function confirmAndCharge(orderId: string): Promise<ChargeResult> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { ok: false, reason: "Order not found" };
  if (!CHARGEABLE.includes(order.status)) {
    return { ok: false, reason: `Order is already ${order.status}` };
  }
  if (order.totalCents <= 0) {
    return { ok: false, reason: "No price yet. Get the seller's price first (Ask seller again), then the buyer approves it." };
  }
  const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId));
  const stripe = getStripe();
  const stripeCustomer = await ensureStripeCustomer(customer);

  if (customer.paymentMethodId && order.paymentChoice === "saved_card") {
    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: order.totalCents,
          currency: "usd",
          customer: stripeCustomer,
          payment_method: customer.paymentMethodId,
          off_session: true,
          confirm: true,
          description: `${order.quantity} x ${order.title}`,
          metadata: { orderId: order.id },
        },
        // same order + same attempt state => Stripe returns the original result
        { idempotencyKey: `order-${order.id}-${order.updatedAt.getTime()}` },
      );
      if (pi.status === "succeeded" || pi.status === "processing") {
        await markPaid(order.id, pi.id);
        return { ok: true };
      }
    } catch (err) {
      if (!(err instanceof Stripe.errors.StripeCardError)) throw err;
      await db
        .update(orders)
        .set({ paymentError: err.message, updatedAt: new Date() })
        .where(eq(orders.id, order.id));
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomer,
    line_items: [
      {
        quantity: order.quantity,
        price_data: {
          currency: "usd",
          unit_amount: order.unitPriceCents,
          product_data: { name: order.title },
        },
      },
    ],
    payment_intent_data: { metadata: { orderId: order.id } },
    metadata: { orderId: order.id },
    success_url: appUrl(`/account/orders/${order.id}?paid=1`),
    cancel_url: appUrl(`/account/orders/${order.id}`),
  });
  await db
    .update(orders)
    .set({ status: "awaiting_payment", checkoutUrl: session.url, updatedAt: new Date() })
    .where(eq(orders.id, order.id));
  return {
    ok: false,
    reason:
      order.paymentChoice === "checkout"
        ? "The buyer chose to pay at checkout. They now have a Pay button on their order."
        : customer.paymentMethodId
          ? "The saved card needs the buyer's approval. They now have a Pay button on their order."
          : "The buyer has no saved card. They now have a Pay button on their order.",
  };
}

/** Idempotent: safe to call from the charge path and from Stripe webhooks. */
export async function markPaid(orderId: string, paymentIntentId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(orders)
      .set({ status: "paid", paymentIntentId, paymentError: null, checkoutUrl: null, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), inArray(orders.status, CHARGEABLE)))
      .returning();
    if (!updated) return;
    // Take the units off the storefront; sold out => marked sold.
    await tx
      .update(listings)
      .set({
        quantity: sql`greatest(${listings.quantity} - ${updated.quantity}, 0)`,
        status: sql`case when ${listings.quantity} - ${updated.quantity} <= 0 then 'sold' else ${listings.status} end`,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, updated.listingId));
  });
}

export async function cancelOrder(orderId: string, note: string | null): Promise<void> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.status === "cancelled" || order.status === "delivered") return;
  if (order.paymentIntentId && (order.status === "paid" || order.status === "shipped")) {
    await getStripe().refunds.create(
      { payment_intent: order.paymentIntentId },
      { idempotencyKey: `refund-${order.id}` },
    );
    // put the units back on the storefront
    await db
      .update(listings)
      .set({ quantity: sql`${listings.quantity} + ${order.quantity}`, status: "active", updatedAt: new Date() })
      .where(eq(listings.id, order.listingId));
  }
  await db
    .update(orders)
    .set({ status: "cancelled", adminNote: note ?? order.adminNote, checkoutUrl: null, updatedAt: new Date() })
    .where(eq(orders.id, order.id));
}
