import "server-only";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { customers, db, type Customer } from "@/db";
import { appUrl } from "@/lib/config";

let _stripe: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set. See .env.example.");
  _stripe = new Stripe(key);
  return _stripe;
}

export async function ensureStripeCustomer(c: Customer): Promise<string> {
  if (c.stripeCustomerId) return c.stripeCustomerId;
  const created = await getStripe().customers.create(
    {
      email: c.email ?? undefined,
      name: c.fullName ?? undefined,
      metadata: { customerId: c.id, clerkUserId: c.clerkUserId },
    },
    { idempotencyKey: `customer-${c.id}` },
  );
  await db.update(customers).set({ stripeCustomerId: created.id }).where(eq(customers.id, c.id));
  return created.id;
}

/** Hosted Stripe page where the buyer saves a card for later charges. */
export async function createCardSetupSession(c: Customer): Promise<string> {
  const customer = await ensureStripeCustomer(c);
  const session = await getStripe().checkout.sessions.create({
    mode: "setup",
    customer,
    currency: "usd",
    success_url: appUrl("/account?card_session={CHECKOUT_SESSION_ID}"),
    cancel_url: appUrl("/account?card=cancelled"),
    metadata: { customerId: c.id },
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

/**
 * Copy the card saved by a completed setup session onto the customer row
 * and make it the Stripe default. Called from both the webhook and the
 * account page redirect, so it must be idempotent.
 */
export async function syncSetupSession(sessionId: string, expectedCustomerId?: string): Promise<void> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
  if (session.mode !== "setup" || session.status !== "complete") return;
  const customerId = session.metadata?.customerId;
  if (!customerId || (expectedCustomerId && customerId !== expectedCustomerId)) return;

  const si = session.setup_intent as Stripe.SetupIntent | null;
  const pmId = typeof si?.payment_method === "string" ? si.payment_method : si?.payment_method?.id;
  if (!pmId) return;
  await savePaymentMethod(customerId, pmId);
}

export async function savePaymentMethod(customerId: string, pmId: string): Promise<void> {
  const stripe = getStripe();
  const pm = await stripe.paymentMethods.retrieve(pmId);
  const stripeCustomer = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
  if (stripeCustomer) {
    await stripe.customers.update(stripeCustomer, {
      invoice_settings: { default_payment_method: pm.id },
    });
  }
  await db
    .update(customers)
    .set({
      paymentMethodId: pm.id,
      cardBrand: pm.card?.brand ?? pm.type,
      cardLast4: pm.card?.last4 ?? null,
      hasPaymentMethod: true,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId));
}
