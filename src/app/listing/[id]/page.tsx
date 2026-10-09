import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductImage } from "@/components/product-image";
import { SITE_NAME } from "@/lib/config";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { formatPrice, messageSellerLink, timeAgo } from "@/lib/format";
import { getPublicListing } from "@/lib/listings";

export async function generateMetadata({ params }: PageProps<"/listing/[id]">): Promise<Metadata> {
  const listing = await getPublicListing((await params).id).catch(() => null);
  return { title: listing?.title ?? "Item" };
}

export default async function ListingPage({ params }: PageProps<"/listing/[id]">) {
  const { id } = await params;
  const listing = await getPublicListing(id);
  if (!listing) notFound();

  const seller = listing.sellerName ?? "the seller";
  const chat = messageSellerLink(listing, SITE_NAME);
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
              <p className="mt-1 text-sm text-muted">No price was posted. Message the seller for their price.</p>
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

          <div className="card space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="label">Seller</div>
                <div className="font-semibold">{seller}</div>
                <div className="text-xs text-muted">
                  {listing.chatName ? `Posted in ${listing.chatName} · ` : ""}
                  {timeAgo(listing.lastSeenAt)}
                </div>
              </div>
              <Link href={`/?seller=${encodeURIComponent(listing.sellerId)}`} className="text-xs text-accent underline">
                More from this seller
              </Link>
            </div>
            {chat ? (
              <a href={chat} target="_blank" rel="noopener noreferrer" className="btn-primary w-full">
                <WhatsAppIcon /> Message Seller
              </a>
            ) : (
              <p className="rounded-lg bg-background p-3 text-sm text-muted">
                This seller&apos;s number isn&apos;t shared. Reply to their post in {listing.chatName ?? "the group"}.
              </p>
            )}
            <p className="text-xs text-muted">
              Deals are made directly with the seller. {SITE_NAME} only lists what&apos;s posted in the groups. Check
              the item and the seller before you pay.
            </p>
          </div>

          {listing.rawText && (
            <details className="card p-4 text-sm" open>
              <summary className="cursor-pointer font-medium">Original post</summary>
              <p className="mt-2 whitespace-pre-wrap text-muted">{listing.rawText}</p>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

