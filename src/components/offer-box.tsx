"use client";

import { useState } from "react";
import { formatMoney, whatsappLink } from "@/lib/format";
import { WhatsAppIcon } from "./whatsapp-icon";

/** Type a price, get a WhatsApp chat with the seller with the offer already written. */
export function OfferBox({
  sellerId,
  sellerName,
  title,
  priceCents,
  currency,
  siteName,
}: {
  sellerId: string;
  sellerName: string | null;
  title: string;
  priceCents: number | null;
  currency: string;
  siteName: string;
}) {
  const [offer, setOffer] = useState("");
  const cents = Math.round(Number(offer.replace(/[$,\s]/g, "")) * 100);
  const valid = Number.isFinite(cents) && cents > 0;
  const greeting = sellerName ? `Hi ${sellerName}` : "Hi";
  const listed = priceCents ? ` listed at ${formatMoney(priceCents, currency)}` : "";
  const link = valid
    ? whatsappLink(
        sellerId,
        `${greeting}, I saw your ${title}${listed} on ${siteName}. Would you take ${formatMoney(cents, currency)}? Is it still available?`,
      )
    : null;
  const pct = valid && priceCents ? Math.round((1 - cents / priceCents) * 100) : null;

  return (
    <div className="space-y-2">
      <label className="label" htmlFor="offer">
        Make an offer
      </label>
      <div className="flex gap-2">
        <input
          id="offer"
          value={offer}
          onChange={(e) => setOffer(e.target.value)}
          inputMode="decimal"
          placeholder={priceCents ? `$ ${Math.round((priceCents * 0.95) / 100)}` : "$ your price"}
          className="input"
        />
        <a
          href={link ?? undefined}
          aria-disabled={!link}
          target="_blank"
          rel="noopener noreferrer"
          className={`btn-ghost shrink-0 ${link ? "" : "pointer-events-none opacity-50"}`}
        >
          <WhatsAppIcon /> Send offer
        </a>
      </div>
      {pct !== null && pct > 0 && (
        <p className="text-xs text-muted">
          That&apos;s {pct}% under the listed price{pct > 20 ? ", which may be a stretch" : ""}.
        </p>
      )}
    </div>
  );
}
