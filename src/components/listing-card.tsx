import Link from "next/link";
import type { PublicListing } from "@/lib/listings";
import { SITE_NAME } from "@/lib/config";
import { formatPrice, messageSellerLink, timeAgo } from "@/lib/format";
import { ProductImage } from "./product-image";
import { WhatsAppIcon } from "./whatsapp-icon";

export function ListingCard({ listing }: { listing: PublicListing }) {
  const chat = messageSellerLink(listing, SITE_NAME);
  return (
    <div className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-lg">
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
