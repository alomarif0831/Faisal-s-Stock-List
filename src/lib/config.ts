// Business knobs, all overridable from the environment.

// Prices are shown exactly as sellers posted them. (Set MARKUP_DOLLARS to add one.)
export const MARKUP_CENTS = Math.round(Number(process.env.MARKUP_DOLLARS ?? "0") * 100);

// A listing drops off the public catalog if the seller hasn't re-posted
// it in this many days (stock in these groups moves fast).
export const LISTING_TTL_DAYS = Number(process.env.LISTING_TTL_DAYS ?? "7");

/** Listings last seen before this are off the site. */
export function listingCutoff(): Date {
  return new Date(Date.now() - LISTING_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// How long an image waits for its seller's text (and vice versa) before
// we stop trying to pair them.
export const PAIRING_WINDOW_MS = 5 * 60 * 1000;

export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "Onyx Stock List";

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Comma-separated WhatsApp group ids (…@g.us). Empty = every group the
// bot's number is in.
export function allowedGroups(): string[] {
  return (process.env.WHATSAPP_GROUP_IDS ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}

export function appUrl(path = "/"): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  return new URL(path, base).toString();
}
