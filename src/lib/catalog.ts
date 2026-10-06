// Fixed vocabularies shared by the AI parser and the storefront filters.

export const BRANDS = ["Apple", "Samsung", "Google", "Sony", "Microsoft", "Nintendo", "Dyson", "Other"] as const;
export type Brand = (typeof BRANDS)[number];

export const CATEGORIES = [
  "Phones",
  "Tablets",
  "Laptops",
  "Watches",
  "Audio",
  "Gaming",
  "Accessories",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CONDITIONS = ["New sealed", "New open box", "Like new", "Used", "Refurbished", "Unknown"] as const;
export type Condition = (typeof CONDITIONS)[number];

export function normalizeKey(...parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean)
    .join("|");
}

export type ProductIdentity = {
  brand: string;
  model: string | null;
  title: string;
  storage: string | null;
  color: string | null;
  condition: string;
};

/**
 * Identity of a product variant, independent of who sells it. Normalised so
 * small wording differences ("Natural Titanium" vs "natural", "1 TB" vs
 * "1TB", "Apple iPhone 16" vs "iPhone 16") give the same key.
 */
export function dedupeKeyFor(item: ProductIdentity): string {
  const brandWords = new Set(item.brand.toLowerCase().split(/\s+/));
  const model = (item.model ?? item.title)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !brandWords.has(w))
    .join(" ");
  const storage = (item.storage ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^1024gb$/, "1tb")
    .replace(/^2048gb$/, "2tb");
  const color = (item.color ?? "")
    .toLowerCase()
    .replace(/\b(titanium|color|colour)\b/g, "")
    .replace(/\bgrey\b/g, "gray");
  return normalizeKey(item.brand, model, storage, color, item.condition);
}
