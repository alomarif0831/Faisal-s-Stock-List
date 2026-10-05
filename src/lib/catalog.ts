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
