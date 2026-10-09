export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function timeAgo(date: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// "15551234567@s.whatsapp.net" -> "+15551234567"
export function phoneFromJid(jid: string): string | null {
  const digits = jid.split("@")[0]?.split(":")[0] ?? "";
  return /^\d{7,15}$/.test(digits) ? `+${digits}` : null;
}

/** Price as posted, or "Ask seller" for listings posted without one. */
export function formatPrice(cents: number | null | undefined, currency = "USD"): string {
  return cents ? formatMoney(cents, currency) : "Ask seller";
}

/**
 * wa.me link to chat with a seller, or null when their WhatsApp id isn't a
 * phone number (WhatsApp sometimes only exposes an anonymous id in groups).
 */
export function whatsappLink(sellerId: string, message?: string): string | null {
  const digits = sellerId.split("@")[0].split(":")[0];
  if (!/^\d{10,13}$/.test(digits)) return null;
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

/** "Message Seller" link with a prefilled "is it still available?" message. */
export function messageSellerLink(
  l: {
    sellerId: string;
    sellerName: string | null;
    title: string;
    salePriceCents: number | null;
    currency: string;
    chatName: string | null;
  },
  siteName: string,
): string | null {
  const greeting = l.sellerName ? `Hi ${l.sellerName}` : "Hi";
  const price = l.salePriceCents ? ` for ${formatMoney(l.salePriceCents, l.currency)}` : "";
  const group = l.chatName ? ` (posted in ${l.chatName})` : "";
  return whatsappLink(
    l.sellerId,
    `${greeting}, I saw your ${l.title}${price} on ${siteName}${group}. Is it still available?`,
  );
}
