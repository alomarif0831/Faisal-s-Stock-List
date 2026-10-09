import Link from "next/link";
import type { CatalogItem, PublicListing } from "@/lib/listings";
import { SITE_NAME } from "@/lib/config";
import { formatPrice, messageSellerLink, timeAgo } from "@/lib/format";
import { ProductImage } from "./product-image";
import { WhatsAppIcon } from "./whatsapp-icon";

export function ListingCard({
  listing,
  note,
}: {
  listing: PublicListing & Partial<Pick<CatalogItem, "sellerCount" | "highCents" | "isNew">>;
  /** extra line under the price, e.g. "$120 under your budget" */
  note?: React.ReactNode;
}) {
  const chat = messageSellerLink(listing, SITE_NAME);
  const sellers = listing.sellerCount ?? 1;
  return (
    <div className="card group relative flex flex-col overflow-hidden transition-shadow hover:shadow-lg">
      {listing.isNew && (
        <span className="absolute left-2 top-2 z-10 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-ink">
          New
        </span>
      )}
      <Link href={`/listing/${listing.id}`} className="flex flex-1 flex-col">
        <ProductImage
          id={listing.imageIds[0]}
          alt={listing.title}
          className="aspect-square w-full bg-background object-contain p-3 transition-transform group-hover:scale-[1.02]"
          fallbackLabel={listing.brand}
          category={listing.category}
        />
        <div className="flex flex-1 flex-col gap-1 border-t border-line p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {listing.brand} · {listing.condition}
          </div>
          <div className="line-clamp-2 text-sm font-medium leading-snug">{listing.title}</div>
          {listing.sellerName && <div className="truncate text-xs text-muted">by {listing.sellerName}</div>}
          <div className="mt-auto flex items-end justify-between pt-2">
            <span className={listing.salePriceCents ? "text-lg font-semibold" : "text-sm font-semibold text-accent"}>
              {formatPrice(listing.salePriceCents, listing.currency)}
            </span>
            <span className="text-[11px] text-muted">
              {listing.quantity > 1 ? `${listing.quantity} avail · ` : ""}
              {timeAgo(listing.lastSeenAt)}
            </span>
          </div>
          {sellers > 1 && (
            <div className="text-[11px] font-medium text-accent">
              {sellers} sellers{listing.salePriceCents ? " · lowest shown" : ""}
              {listing.highCents && listing.salePriceCents && listing.highCents > listing.salePriceCents
                ? ` (up to ${formatPrice(listing.highCents, listing.currency)})`
                : ""}
            </div>
          )}
          {note && <div className="text-[11px] font-medium text-good">{note}</div>}
        </div>
      </Link>
      {chat && (
        <div className="px-3 pb-3">
          <a href={chat} target="_blank" rel="noopener noreferrer" className="btn-primary w-full gap-1.5 whitespace-nowrap px-2 py-2 text-sm">
            <WhatsAppIcon /> Message Seller
          </a>
        </div>
      )}
    </div>
  );
}
