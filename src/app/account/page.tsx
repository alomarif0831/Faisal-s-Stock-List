import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { addCard, saveProfile } from "@/app/actions";
import { OrderStatusBadge } from "@/components/order-status";
import { db, orders } from "@/db";
import { hasShipping, requireCustomer } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { stripeConfigured, syncSetupSession } from "@/lib/stripe";

export const metadata = { title: "Your account" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const sp = await searchParams;
  let customer = await requireCustomer();

  // Back from Stripe: record the card now rather than waiting for the webhook.
  const cardSession = first(sp.card_session);
  if (cardSession && !customer.hasPaymentMethod) {
    await syncSetupSession(cardSession, customer.id).catch((e) => console.error("[account] card sync", e));
    customer = await requireCustomer();
  }

  const next = first(sp.next);
  const myOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.customerId, customer.id))
    .orderBy(desc(orders.createdAt))
    .limit(50);
  const shippingDone = hasShipping(customer);
  const ready = shippingDone;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
        <p className="mt-1 text-sm text-muted">{customer.email}</p>
      </div>

      {first(sp.welcome) && (
        <Notice>
          Welcome! Add your shipping address and you can request any item. Saving a card is optional: it lets us
          charge automatically once your item is confirmed.
        </Notice>
      )}
      {first(sp.saved) && <Notice>Saved.</Notice>}
      {first(sp.card) === "cancelled" && <Notice>No card was added.</Notice>}
      {next && ready && (
        <Notice>
          You&apos;re all set. <Link href={next} className="font-medium underline">Continue to the item →</Link>
        </Notice>
      )}

      <section className="card p-5">
        <h2 className="font-semibold">Orders</h2>
        {myOrders.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            No orders yet. <Link href="/" className="underline">Browse stock</Link>.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {myOrders.map((o) => (
              <li key={o.id}>
                <Link href={`/account/orders/${o.id}`} className="flex items-center justify-between gap-4 py-3 hover:opacity-80">
                  <div>
                    <div className="text-sm font-medium">
                      {o.quantity > 1 && `${o.quantity} × `}
                      {o.title}
                    </div>
                    <OrderStatusBadge status={o.status} />
                  </div>
                  <div className="text-sm font-semibold">{formatMoney(o.totalCents)}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Payment method</h2>
          {customer.hasPaymentMethod && <span className="text-xs text-good">✓ Saved</span>}
        </div>
        <p className="mt-1 text-sm text-muted">
          Optional. A saved card is stored securely by Stripe and charged automatically once we confirm your item.
          Prefer Apple Pay, Google Pay, Klarna, Afterpay or Affirm? Choose &ldquo;Pay at checkout&rdquo; when you
          request an item.
        </p>
        {customer.hasPaymentMethod && (
          <p className="mt-3 text-sm font-medium capitalize">
            {customer.cardBrand} ending {customer.cardLast4}
          </p>
        )}
        {stripeConfigured() ? (
          <form action={addCard} className="mt-3">
            <button className={customer.hasPaymentMethod ? "btn-ghost" : "btn-primary"}>
              {customer.hasPaymentMethod ? "Replace card" : "Add a card"}
            </button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-warn">Payments aren&apos;t configured yet.</p>
        )}
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Profile &amp; shipping address</h2>
          {shippingDone && <span className="text-xs text-good">✓ Complete</span>}
        </div>
        <form action={saveProfile} className="mt-4 grid gap-3 sm:grid-cols-2">
          {next && <input type="hidden" name="next" value={next} />}
          <Field name="fullName" label="Full name" value={customer.fullName} required />
          <Field name="phone" label="Phone (for delivery updates)" value={customer.phone} type="tel" />
          <Field name="shipName" label="Ship to (name)" value={customer.shipName ?? customer.fullName} required wide />
          <Field name="shipLine1" label="Address line 1" value={customer.shipLine1} required wide />
          <Field name="shipLine2" label="Address line 2" value={customer.shipLine2} wide />
          <Field name="shipCity" label="City" value={customer.shipCity} required />
          <Field name="shipState" label="State / province" value={customer.shipState} required />
          <Field name="shipPostalCode" label="ZIP / postal code" value={customer.shipPostalCode} required />
          <Field name="shipCountry" label="Country (2-letter)" value={customer.shipCountry ?? "US"} required />
          <div className="sm:col-span-2">
            <button className="btn-primary">Save</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="card border-accent p-3 text-sm">{children}</div>;
}

function Field(props: {
  name: string;
  label: string;
  value: string | null;
  required?: boolean;
  wide?: boolean;
  type?: string;
}) {
  return (
    <label className={props.wide ? "sm:col-span-2" : ""}>
      <span className="label">{props.label}</span>
      <input
        name={props.name}
        defaultValue={props.value ?? ""}
        required={props.required}
        type={props.type ?? "text"}
        className="input"
      />
    </label>
  );
}
