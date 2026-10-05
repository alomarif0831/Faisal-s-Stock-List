import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { db, orders } from "@/db";
import { markPaid } from "@/lib/orders";
import { getStripe, syncSetupSession } from "@/lib/stripe";

// Stripe Dashboard -> Developers -> Webhooks -> add endpoint
//   https://<your-domain>/api/stripe/webhook
// events: checkout.session.completed, payment_intent.succeeded

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode === "setup") {
        await syncSetupSession(session.id);
      } else if (session.mode === "payment" && session.metadata?.orderId) {
        const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
        if (pi && session.payment_status === "paid") await settle(session.metadata.orderId, pi);
      }
      break;
    }
    case "payment_intent.succeeded": {
      const pi = event.data.object;
      if (pi.metadata?.orderId) await settle(pi.metadata.orderId, pi.id);
      break;
    }
  }
  return NextResponse.json({ received: true });
}

async function settle(orderId: string, paymentIntentId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return;
  if (order.status === "cancelled") {
    // Buyer paid from an old link after the order was cancelled: give it back.
    await getStripe().refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `refund-late-${paymentIntentId}` },
    );
    return;
  }
  await markPaid(orderId, paymentIntentId);
}
