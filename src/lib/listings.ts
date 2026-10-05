import "server-only";
import { and, asc, count, desc, eq, gte, ilike, or, type SQL } from "drizzle-orm";
import { db, listings } from "@/db";
import { LISTING_TTL_DAYS } from "@/lib/config";

// Columns safe to show buyers. Seller identity, group, and the seller's
// price never leave the server on public pages.
const publicColumns = {
  id: listings.id,
  title: listings.title,
  brand: listings.brand,
  category: listings.category,
  model: listings.model,
  storage: listings.storage,
  color: listings.color,
  condition: listings.condition,
  details: listings.details,
  quantity: listings.quantity,
  salePriceCents: listings.salePriceCents,
  currency: listings.currency,
  imageIds: listings.imageIds,
  lastSeenAt: listings.lastSeenAt,
};

export type PublicListing = {
  [K in keyof typeof publicColumns]: (typeof listings.$inferSelect)[K];
};

export type CatalogFilters = {
  q?: string;
  brand?: string;
  category?: string;
  condition?: string;
  sort?: string;
};

function visible(): SQL {
  const cutoff = new Date(Date.now() - LISTING_TTL_DAYS * 24 * 60 * 60 * 1000);
  return and(eq(listings.status, "active"), gte(listings.lastSeenAt, cutoff))!;
}

export async function searchCatalog(f: CatalogFilters) {
  const where: SQL[] = [visible()];
  if (f.brand) where.push(eq(listings.brand, f.brand));
  if (f.category) where.push(eq(listings.category, f.category));
  if (f.condition) where.push(eq(listings.condition, f.condition));
  for (const word of (f.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
    const like = `%${word.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(listings.title, like), ilike(listings.details, like), ilike(listings.color, like))!);
  }
  const order =
    f.sort === "price_asc"
      ? [asc(listings.salePriceCents)]
      : f.sort === "price_desc"
        ? [desc(listings.salePriceCents)]
        : [desc(listings.lastSeenAt)];

  return db
    .select(publicColumns)
    .from(listings)
    .where(and(...where))
    .orderBy(...order)
    .limit(240);
}

export async function facetCounts() {
  const [brands, categories] = await Promise.all([
    db.select({ value: listings.brand, n: count() }).from(listings).where(visible()).groupBy(listings.brand),
    db.select({ value: listings.category, n: count() }).from(listings).where(visible()).groupBy(listings.category),
  ]);
  return { brands, categories };
}

export async function getPublicListing(id: string): Promise<PublicListing | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select(publicColumns)
    .from(listings)
    .where(and(eq(listings.id, id), visible()));
  return row ?? null;
}
