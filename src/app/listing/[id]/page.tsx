import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductImage } from "@/components/product-image";
import { SITE_NAME } from "@/lib/config";
import { formatPrice, timeAgo, whatsappLink } from "@/lib/format";
import { getPublicListing } from "@/lib/listings";

export async function generateMetadata({ params }: PageProps<"/listing/[id]">): Promise<Metadata> {
  const listing = await getPublicListing((await params).id).catch(() => null);
  return { title: listing?.title ?? "Item" };
}

export default async function ListingPage({ params }: PageProps<"/listing/[id]">) {
  const { id } = await params;
  const listing = await getPublicListing(id);
  if (!listing) notFound();

  const price = formatPrice(listing.salePriceCents, listing.currency);
  const seller = listing.sellerName ?? "the seller";
  const chat = whatsappLink(
    listing.sellerId,
    `Hi ${listing.sellerName ?? ""}, I saw your ${listing.title}${listing.salePriceCents ? ` for ${price}` : ""} on ${SITE_NAME}${listing.chatName ? ` (posted in ${listing.chatName})` : ""}. Is it still available?`.replace("Hi ,", "Hi,"),
  );
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
                <WhatsAppIcon /> Message seller on WhatsApp
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

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.4-.3Z" />
    </svg>
  );
}
