import Link from "next/link";
import type { PublicListing } from "@/lib/listings";
import { formatMoney, timeAgo } from "@/lib/format";
import { ProductImage } from "./product-image";

export function ListingCard({ listing }: { listing: PublicListing }) {
  return (
    <Link
      href={`/listing/${listing.id}`}
      className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-lg"
    >
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
        <div className="mt-auto flex items-end justify-between pt-2">
          <span className="text-lg font-semibold">{formatMoney(listing.salePriceCents, listing.currency)}</span>
          <span className="text-[11px] text-muted">
            {listing.quantity > 1 ? `${listing.quantity} avail · ` : ""}
            {timeAgo(listing.lastSeenAt)}
          </span>
        </div>
      </div>
    </Link>
  );
}
