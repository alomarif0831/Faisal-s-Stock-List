import { desc, eq, inArray } from "drizzle-orm";
import { OrderStatusBadge } from "@/components/order-status";
import { customers, db, listings, orders, ORDER_STATUSES, type OrderStatus } from "@/db";
import { formatMoney, phoneFromJid, timeAgo } from "@/lib/format";
import { replyOverdue } from "@/lib/verify";
import { askSellerAgain, cancelOrderAdmin, confirmOrder, markDelivered, markShipped } from "../actions";

const OPEN: OrderStatus[] = ["requested", "verifying", "needs_buyer_approval", "awaiting_payment", "paid", "shipped"];

export default async function AdminOrders({ searchParams }: PageProps<"/admin/orders">) {
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : "open";
  const rows = await db
    .select({ order: orders, customer: customers, listing: listings })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .innerJoin(listings, eq(orders.listingId, listings.id))
    .where(inArray(orders.status, view === "all" ? [...ORDER_STATUSES] : OPEN))
    .orderBy(desc(orders.createdAt))
    .limit(200);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm">
        <a href="/admin/orders" className={view === "open" ? "font-semibold" : "text-muted"}>Open</a>
        <a href="/admin/orders?view=all" className={view === "all" ? "font-semibold" : "text-muted"}>All</a>
      </div>
      {typeof sp.msg === "string" && <div className="card border-accent p-3 text-sm">{sp.msg}</div>}

      {rows.map(({ order: o, customer: c, listing: l }) => {
        const sellerPhone = phoneFromJid(l.sellerId);
        const s = o.shipping;
        return (
          <div key={o.id} className="card space-y-3 p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-semibold">
                  {o.quantity} × {o.title}
                </div>
                <OrderStatusBadge status={o.status} />{" "}
                <span className="text-xs text-muted">· {timeAgo(o.createdAt)}</span>
              </div>
              <div className="text-right">
                <div className="font-semibold">{o.totalCents ? formatMoney(o.totalCents) : "Price pending"}</div>
                <div className="text-xs text-muted">
                  you pay seller {formatMoney(o.sourcePriceCents * o.quantity)} · margin{" "}
                  {formatMoney(o.totalCents - o.sourcePriceCents * o.quantity)}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl bg-background p-3">
                <div className="label">Seller (confirm availability)</div>
                <div>{l.sellerName ?? l.sellerId}</div>
                <div className="text-xs text-muted">{l.chatName ?? l.chatId}</div>
                {sellerPhone && (
                  <a
                    className="text-xs text-accent underline"
                    target="_blank"
                    href={`https://wa.me/${sellerPhone.slice(1)}?text=${encodeURIComponent(l.sourcePriceCents
                        ? `Hi, is the ${l.title} for $${l.sourcePriceCents / 100} still available? I'd like ${o.quantity}.`
                        : `Hi, is the ${l.title} still available? What's your best price for ${o.quantity}?`)}`}
                  >
                    Message seller on WhatsApp
                  </a>
                )}
              </div>
              <div className="rounded-xl bg-background p-3">
                <div className="label">Buyer · ship to</div>
                <div>
                  {s.name} · {c.email} {c.phone && `· ${c.phone}`}
                </div>
                <div className="text-xs text-muted">
                  {s.line1}
                  {s.line2 && `, ${s.line2}`}, {s.city}, {s.state} {s.postalCode}, {s.country}
                </div>
                <div className="text-xs text-muted">
                  Card: {c.hasPaymentMethod ? `${c.cardBrand} •••• ${c.cardLast4}` : "none saved"}
                </div>
                {o.buyerNote && <div className="mt-1 text-xs">Note: {o.buyerNote}</div>}
              </div>
            </div>
            {(o.verifyStatus || o.status === "verifying") && (
              <div className="rounded-xl border border-line p-3 text-xs">
                <div className="label">Automatic seller check</div>
                <div>
                  <span className="font-medium">{o.verifyStatus ?? "asked"}</span>
                  {o.verifyAskedAt && <> · asked {timeAgo(o.verifyAskedAt)}</>}
                  {o.status === "verifying" &&
                    !o.sellerReply &&
                    replyOverdue(o.verifyAskedAt) && (
                      <span className="text-bad"> · no reply yet, follow up or cancel</span>
                    )}
                </div>
                {o.verifySummary && <div className="mt-1">{o.verifySummary}</div>}
                {o.sellerReply && (
                  <div className="mt-1 whitespace-pre-wrap text-muted">Seller said: &ldquo;{o.sellerReply}&rdquo;</div>
                )}
                {o.status === "needs_buyer_approval" && o.proposedUnitPriceCents && (
                  <div className="mt-1">
                    Waiting on buyer to accept {o.proposedQuantity ?? o.quantity} × {formatMoney(o.proposedUnitPriceCents)}
                  </div>
                )}
              </div>
            )}
            {o.paymentError && <div className="text-xs text-bad">Last charge attempt: {o.paymentError}</div>}
            {o.trackingNumber && (
              <div className="text-xs">
                Tracking: {o.carrier} {o.trackingNumber}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
              {(o.status === "requested" || o.status === "verifying" || o.status === "awaiting_payment") && (
                <form action={confirmOrder}>
                  <input type="hidden" name="id" value={o.id} />
                  <button className="btn-primary">
                    {o.status === "awaiting_payment" ? "Retry charge" : "Available: charge"} {formatMoney(o.totalCents)}
                  </button>
                </form>
              )}
              {(o.status === "requested" || o.status === "verifying") && (
                <form action={askSellerAgain}>
                  <input type="hidden" name="id" value={o.id} />
                  <button className="btn-ghost">{o.verifyAskedAt ? "Ask seller again" : "Ask seller on WhatsApp"}</button>
                </form>
              )}
              {o.status === "paid" && (
                <form action={markShipped} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={o.id} />
                  <input name="carrier" placeholder="Carrier" className="input w-28" />
                  <input name="tracking" placeholder="Tracking #" className="input w-48" />
                  <button className="btn-primary">Mark shipped</button>
                </form>
              )}
              {o.status === "shipped" && (
                <form action={markDelivered}>
                  <input type="hidden" name="id" value={o.id} />
                  <button className="btn-ghost">Mark delivered</button>
                </form>
              )}
              {o.status !== "cancelled" && o.status !== "delivered" && (
                <form action={cancelOrderAdmin} className="ml-auto flex items-end gap-2">
                  <input type="hidden" name="id" value={o.id} />
                  <input name="note" placeholder="Reason (buyer sees this)" className="input w-56" />
                  <button className="btn-danger">
                    {o.status === "paid" || o.status === "shipped" ? "Cancel & refund" : "Cancel"}
                  </button>
                </form>
              )}
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <div className="card p-8 text-center text-sm text-muted">No orders.</div>}
    </div>
  );
}
