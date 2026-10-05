import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requestToBuy } from "@/app/actions";
import { ProductImage } from "@/components/product-image";
import { clerkConfigured, getCustomer, hasShipping } from "@/lib/auth";
import { formatMoney, timeAgo } from "@/lib/format";
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
  const ready = customer && hasShipping(customer) && customer.hasPaymentMethod;
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
            <div className="mt-3 text-3xl font-semibold">{formatMoney(listing.salePriceCents, listing.currency)}</div>
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

          <div className="card space-y-3 p-4">
            <h2 className="font-semibold">How buying works</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Send a request. Nothing is charged yet.</li>
              <li>We check with our supplier that it&apos;s still available, usually within the hour.</li>
              <li>Your saved card is charged and the item ships to your address.</li>
            </ol>
            {!clerkConfigured() ? (
              <p className="text-sm text-muted">Ordering opens soon.</p>
            ) : !customer ? (
              <Link href={`/sign-in?redirect_url=/listing/${listing.id}`} className="btn-primary w-full">
                Sign in to request
              </Link>
            ) : !ready ? (
              <Link href={`/account?next=/listing/${listing.id}`} className="btn-primary w-full">
                Add shipping address &amp; card to request
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
                <button className="btn-primary w-full">Request to buy</button>
                <p className="text-xs text-muted">
                  Ships to {customer.shipCity}, {customer.shipState}. Card ending {customer.cardLast4} is charged
                  only after we confirm.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
