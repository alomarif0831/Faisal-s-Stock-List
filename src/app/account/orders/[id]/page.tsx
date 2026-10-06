import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { acceptSellerChange, cancelMyOrder } from "@/app/actions";
import { OrderStatusBadge } from "@/components/order-status";
import { db, orders } from "@/db";
import { requireCustomer } from "@/lib/auth";
import { formatMoney } from "@/lib/format";

const STEPS = ["requested", "paid", "shipped", "delivered"] as const;
const STEP_OF: Record<string, (typeof STEPS)[number]> = { verifying: "requested", needs_buyer_approval: "requested" };

export default async function OrderPage({ params, searchParams }: PageProps<"/account/orders/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const customer = await requireCustomer();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.customerId, customer.id)));
  if (!order) notFound();

  const stepIndex = STEPS.indexOf(STEP_OF[order.status] ?? (order.status as (typeof STEPS)[number]));
  const s = order.shipping;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/account" className="text-sm text-muted hover:text-foreground">
        ← Your account
      </Link>
      {sp.requested && (
        <div className="card border-accent p-3 text-sm">
          Request sent! We&apos;re confirming availability with our supplier. Your card is charged only once it&apos;s
          confirmed.
        </div>
      )}
      {sp.paid && <div className="card border-good p-3 text-sm">Payment received. Thank you!</div>}

      <div className="card space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">
              {order.quantity > 1 && `${order.quantity} × `}
              {order.title}
            </h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <div className="text-right">
            <div className="text-xl font-semibold">
              {order.totalCents ? formatMoney(order.totalCents) : "Price pending"}
            </div>
            {order.quantity > 1 && order.unitPriceCents > 0 && <div className="text-xs text-muted">{formatMoney(order.unitPriceCents)} each</div>}
          </div>
        </div>

        {order.status !== "cancelled" && order.status !== "awaiting_payment" && (
          <ol className="grid grid-cols-4 gap-2 text-center text-[11px]">
            {["Requested", "Paid", "Shipped", "Delivered"].map((label, i) => (
              <li key={label} className={i <= stepIndex ? "font-medium text-foreground" : "text-muted"}>
                <div className={`mb-1 h-1 rounded-full ${i <= stepIndex ? "bg-accent" : "bg-line"}`} />
                {label}
              </li>
            ))}
          </ol>
        )}

        {order.status === "verifying" && (
          <p className="rounded-xl bg-background p-4 text-sm text-muted">
            We&apos;ve asked our supplier to confirm this item is still available. You&apos;ll be charged only once
            it&apos;s confirmed. This usually takes under an hour.
          </p>
        )}

        {order.status === "needs_buyer_approval" && order.proposedUnitPriceCents && (
          <div className="space-y-3 rounded-xl border border-warn bg-background p-4 text-sm">
            <p className="font-medium">
              {order.unitPriceCents > 0 ? "It\u2019s available, but something changed:" : "It\u2019s available! Here\u2019s your price:"}
            </p>
            {order.verifySummary && <p className="text-muted">{order.verifySummary}</p>}
            <dl className="grid grid-cols-2 gap-1">
              <dt className="text-muted">Price</dt>
              <dd>
                {order.unitPriceCents > 0 && order.proposedUnitPriceCents !== order.unitPriceCents && (
                  <s className="mr-1 text-muted">{formatMoney(order.unitPriceCents)}</s>
                )}
                {formatMoney(order.proposedUnitPriceCents)} each
              </dd>
              <dt className="text-muted">Quantity</dt>
              <dd>
                {order.proposedQuantity !== null && order.proposedQuantity !== order.quantity && (
                  <s className="mr-1 text-muted">{order.quantity}</s>
                )}
                {order.proposedQuantity ?? order.quantity}
              </dd>
              <dt className="text-muted">New total</dt>
              <dd className="font-semibold">
                {formatMoney(order.proposedUnitPriceCents * (order.proposedQuantity ?? order.quantity))}
              </dd>
            </dl>
            <div className="flex gap-2">
              <form action={acceptSellerChange}>
                <input type="hidden" name="orderId" value={order.id} />
                <button className="btn-primary">Accept &amp; pay</button>
              </form>
              <form action={cancelMyOrder}>
                <input type="hidden" name="orderId" value={order.id} />
                <button className="btn-ghost">No thanks, cancel</button>
              </form>
            </div>
          </div>
        )}

        {order.status === "awaiting_payment" && order.checkoutUrl && (
          <div className="rounded-xl bg-background p-4 text-sm">
            <p>Good news, it&apos;s available! Your bank needs you to approve the payment.</p>
            {order.paymentError && <p className="mt-1 text-muted">{order.paymentError}</p>}
            <a href={order.checkoutUrl} className="btn-primary mt-3">
              Pay {formatMoney(order.totalCents)}
            </a>
          </div>
        )}

        {order.trackingNumber && (
          <div className="text-sm">
            <span className="text-muted">Tracking: </span>
            <span className="font-medium">
              {order.carrier} {order.trackingNumber}
            </span>
          </div>
        )}
        {order.adminNote && order.status === "cancelled" && (
          <p className="text-sm text-muted">Note: {order.adminNote}</p>
        )}

        <div className="border-t border-line pt-4 text-sm">
          <div className="label">Shipping to</div>
          <p>
            {s.name}
            <br />
            {s.line1}
            {s.line2 && <>, {s.line2}</>}
            <br />
            {s.city}, {s.state} {s.postalCode}, {s.country}
          </p>
        </div>

        {(order.status === "requested" || order.status === "verifying") && (
          <form action={cancelMyOrder}>
            <input type="hidden" name="orderId" value={order.id} />
            <button className="btn-danger">Withdraw request</button>
          </form>
        )}
      </div>
    </div>
  );
}
