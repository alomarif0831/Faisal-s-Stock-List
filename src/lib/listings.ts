import "server-only";
import { and, countDistinct, eq, gte, type SQL } from "drizzle-orm";
import { db, listings } from "@/db";
import { listingCutoff } from "@/lib/config";
import { dollars, parseQuery, queryMatcher, textMatcher } from "@/lib/search";

// Columns shown on the public site. The site is a directory: visitors
// contact sellers directly, so the seller, their group and the original
// post are public.
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
  sellerId: listings.sellerId,
  sellerName: listings.sellerName,
  chatName: listings.chatName,
  rawText: listings.rawText,
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
  seller?: string;
  min?: string; // dollars
  max?: string; // dollars
  fresh?: string; // "1" = posted in the last 24h
};

/** One product as shown in the grid: the cheapest offer, plus how many sellers have it. */
export type CatalogItem = PublicListing & {
  createdAt: Date;
  /** first posted in the last 24 hours */
  isNew: boolean;
  sellerCount: number;
  lowCents: number | null;
  highCents: number | null;
};

function visible(): SQL {
  return and(eq(listings.status, "active"), gte(listings.lastSeenAt, listingCutoff()))!;
}

type Row = PublicListing & { dedupeKey: string; createdAt: Date };

// The live catalog is a few thousand rows at most, so word matching runs in
// JS (see search.ts) where it can understand reseller shorthand.
async function visibleRows(extra: SQL[] = []): Promise<Row[]> {
  return db
    .select({ ...publicColumns, dedupeKey: listings.dedupeKey, createdAt: listings.createdAt })
    .from(listings)
    .where(and(visible(), ...extra))
    .limit(5000);
}

const byPrice = (a: { salePriceCents: number | null }, b: { salePriceCents: number | null }) =>
  (a.salePriceCents ?? Infinity) - (b.salePriceCents ?? Infinity);

/**
 * Several sellers can offer the same product: show it once, at the cheapest
 * offer, with the seller count and price range. (Admins see every listing.)
 */
export function groupOffers(rows: Row[]): CatalogItem[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const g = groups.get(r.dedupeKey);
    if (g) g.push(r);
    else groups.set(r.dedupeKey, [r]);
  }
  const newSince = Date.now() - 24 * 60 * 60 * 1000;
  return [...groups.values()].map((g) => {
    g.sort((a, b) => byPrice(a, b) || b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
    const prices = g.map((r) => r.salePriceCents).filter((p): p is number => p != null);
    const { dedupeKey: _key, ...best } = g[0];
    // "new" = the newest first-post among the sellers offering it
    const createdAt = new Date(Math.max(...g.map((r) => r.createdAt.getTime())));
    return {
      ...best,
      createdAt,
      isNew: createdAt.getTime() > newSince,
      sellerCount: new Set(g.map((r) => r.sellerId)).size,
      lowCents: prices.length ? Math.min(...prices) : null,
      highCents: prices.length ? Math.max(...prices) : null,
    };
  });
}

function sortItems(items: CatalogItem[], sort?: string): CatalogItem[] {
  if (sort === "price_asc") return items.sort(byPrice);
  if (sort === "price_desc") return items.sort((a, b) => (b.salePriceCents ?? -1) - (a.salePriceCents ?? -1));
  return items.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}

const cents = (v?: string) => (v ? dollars(v) : null);

export async function searchCatalog(f: CatalogFilters): Promise<CatalogItem[]> {
  const where: SQL[] = [];
  if (f.brand) where.push(eq(listings.brand, f.brand));
  if (f.category) where.push(eq(listings.category, f.category));
  if (f.condition) where.push(eq(listings.condition, f.condition));
  if (f.seller) where.push(eq(listings.sellerId, f.seller));
  if (f.fresh) where.push(gte(listings.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const match = queryMatcher(f.q ?? "", { minCents: cents(f.min), maxCents: cents(f.max) });
  const rows = (await visibleRows(where)).filter(match);
  return sortItems(groupOffers(rows), f.sort).slice(0, 240);
}

export type DealResults = {
  /** at or under the budget, cheapest first */
  under: CatalogItem[];
  /** a little over budget (up to 15%), worth a counter-offer */
  near: CatalogItem[];
  /** matching posts with no price: ask the seller */
  noPrice: CatalogItem[];
};

/**
 * Find a Deal: everything matching `q` around a budget. `searches` are extra
 * phrasings (from the AI) that also count as a match.
 */
export async function findDeals(
  q: string,
  maxCents: number | null,
  condition?: string,
  searches: string[] = [],
): Promise<DealResults> {
  const parsed = parseQuery(q);
  const budget = maxCents ?? parsed.maxCents;
  const matchers = [parsed.tokens, ...searches.map((s) => parseQuery(s).tokens)]
    .filter((t, i) => t.length > 0 || i === 0)
    .map(textMatcher);
  const text = (r: Row) => matchers.some((m) => m(r));
  const rows = (await visibleRows(condition ? [eq(listings.condition, condition)] : [])).filter(text);
  const priced = rows.filter((r) => r.salePriceCents != null);
  const inBudget = (r: Row) => budget == null || r.salePriceCents! <= budget;
  const nearBudget = (r: Row) => budget != null && r.salePriceCents! > budget && r.salePriceCents! <= budget * 1.15;
  return {
    under: groupOffers(priced.filter(inBudget)).sort(byPrice).slice(0, 60),
    near: groupOffers(priced.filter(nearBudget)).sort(byPrice).slice(0, 24),
    noPrice: groupOffers(rows.filter((r) => r.salePriceCents == null)).slice(0, 12),
  };
}

/** Distinct "Brand Model" names on the site now, to help the AI map vague requests. */
export async function inStockModels(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ brand: listings.brand, model: listings.model, title: listings.title })
    .from(listings)
    .where(visible())
    .limit(3000);
  const names = rows.map((r) => {
    const m = r.model ?? r.title;
    return m.toLowerCase().startsWith(r.brand.toLowerCase()) ? m : `${r.brand} ${m}`;
  });
  return [...new Set(names)].sort();
}

/** Every live offer for the same product as `id` (including itself), cheapest first. */
export async function offersForListing(id: string): Promise<PublicListing[]> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return [];
  const [row] = await db.select({ key: listings.dedupeKey }).from(listings).where(eq(listings.id, id));
  if (!row) return [];
  const rows = await db
    .select(publicColumns)
    .from(listings)
    .where(and(visible(), eq(listings.dedupeKey, row.key)))
    .limit(50);
  return rows.sort(byPrice);
}

export async function facetCounts() {
  const [brands, categories] = await Promise.all([
    db
      .select({ value: listings.brand, n: countDistinct(listings.dedupeKey) })
      .from(listings)
      .where(visible())
      .groupBy(listings.brand),
    db
      .select({ value: listings.category, n: countDistinct(listings.dedupeKey) })
      .from(listings)
      .where(visible())
      .groupBy(listings.category),
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
