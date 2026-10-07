import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requestToBuy } from "@/app/actions";
import { CHECKOUT_MARKS, PaymentBadges } from "@/components/payment-badges";
import { ProductImage } from "@/components/product-image";
import { SessionResync } from "@/components/session-resync";
import { clerkConfigured, getCustomer, hasShipping } from "@/lib/auth";
import { formatPrice, timeAgo } from "@/lib/format";
import { getPublicListing } from "@/lib/listings";

export async function generateMetadata({ params }: PageProps<"/listing/[id]">): Promise<Metadata> {
  const listing = await getPublicListing((await params).id).catch(() => null);
  return { title: listing?.title ?? "Item" };
}

export default async function ListingPage({ params }: PageProps<"/listing/[id]">) {
  const { id } = await params;
  const listing = await getPublicListing(id);
  if (!listing) notFound();

  const customer = await getCustomer();
  const ready = customer && hasShipping(customer);
  const specs = [
    ["Brand", listing.brand],
    ["Model", listing.model],
    ["Storage", listing.storage],
    ["Color", listing.color],
    ["Condition", listing.condition],
    ["Available", String(listing.quantity)],
  ].filter((s): s is [string, string] => Boolean(s[1]));

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        ← Back to all stock
      </Link>
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-3">
          <ProductImage
            id={listing.imageIds[0]}
            alt={listing.title}
            fallbackLabel={listing.brand}
            category={listing.category}
            className="card aspect-square w-full object-contain p-4"
          />
          {listing.imageIds.length > 1 && (
            <div className="grid grid-cols-4 gap-2">
              {listing.imageIds.slice(1, 9).map((img) => (
                <a key={img} href={`/api/images/${img}`} target="_blank">
                  <ProductImage id={img} alt={listing.title} className="card aspect-square w-full object-cover" />
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              {listing.category} · listed {timeAgo(listing.lastSeenAt)}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{listing.title}</h1>
            <div className="mt-3 text-3xl font-semibold">{formatPrice(listing.salePriceCents, listing.currency)}</div>
            {!listing.salePriceCents && (
              <p className="mt-1 text-sm text-muted">
                The supplier didn&apos;t post a price. Request it and we&apos;ll get you a price to approve before
                anything is charged.
              </p>
            )}
          </div>

          <dl className="card divide-y divide-line text-sm">
            {specs.map(([k, v]) => (
              <div key={k} className="flex justify-between px-4 py-2.5">
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {listing.details && <p className="text-sm leading-relaxed text-muted">{listing.details}</p>}

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted">Pay your way</div>
            <PaymentBadges />
          </div>

          <div className="card space-y-3 p-4">
            <h2 className="font-semibold">How buying works</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Send a request. Nothing is charged yet.</li>
              <li>We check with our supplier that it&apos;s still available, usually within the hour.</li>
              <li>You pay (saved card, Apple Pay, Klarna and more) and it ships to your address.</li>
            </ol>
            {!clerkConfigured() ? (
              <p className="text-sm text-muted">Ordering opens soon.</p>
            ) : !customer ? (
              <>
                <SessionResync />
                <Link href={`/sign-in?redirect_url=/listing/${listing.id}`} className="btn-primary w-full">
                  Sign in to request
                </Link>
              </>
            ) : !ready ? (
              <Link href={`/account?next=/listing/${listing.id}`} className="btn-primary w-full">
                Add your shipping address to request
              </Link>
            ) : (
              <form action={requestToBuy} className="space-y-3">
                <input type="hidden" name="listingId" value={listing.id} />
                {listing.quantity > 1 && (
                  <label className="block">
                    <span className="label">Quantity</span>
                    <input
                      type="number"
                      name="quantity"
                      min={1}
                      max={listing.quantity}
                      defaultValue={1}
                      className="input w-24"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="label">Note (optional)</span>
                  <input name="note" maxLength={500} className="input" placeholder="Anything we should know?" />
                </label>
                <fieldset className="space-y-2">
                  <legend className="label">How do you want to pay?</legend>
                  {customer.hasPaymentMethod && (
                    <PayOption value="saved_card" defaultChecked>
                      <span className="font-medium capitalize">
                        Saved {customer.cardBrand} ending {customer.cardLast4}
                      </span>
                      <span className="block text-xs text-muted">Charged automatically once it&apos;s confirmed.</span>
                    </PayOption>
                  )}
                  <PayOption value="checkout" defaultChecked={!customer.hasPaymentMethod}>
                    <span className="font-medium">Pay at checkout</span>
                    <span className="block text-xs text-muted">
                      Once it&apos;s confirmed you get a Pay button: Apple Pay, Google Pay, Klarna, Afterpay, Affirm,
                      Amazon Pay, Cash App Pay or any card.
                    </span>
                    <PaymentBadges marks={CHECKOUT_MARKS} className="mt-2" />
                  </PayOption>
                </fieldset>
                <button className="btn-primary w-full">{listing.salePriceCents ? "Request to buy" : "Request a price"}</button>
                <p className="text-xs text-muted">
                  Ships to {customer.shipCity}, {customer.shipState}. Nothing is charged until we confirm.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PayOption({
  value,
  defaultChecked,
  children,
}: {
  value: "saved_card" | "checkout";
  defaultChecked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-xl border border-line p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-background">
      <input type="radio" name="payment" value={value} defaultChecked={defaultChecked} className="mt-1 accent-[var(--accent)]" />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}
