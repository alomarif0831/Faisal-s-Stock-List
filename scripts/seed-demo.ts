// Fills an EMPTY local database with sample listings so you can see the
// storefront before the bot has captured anything. Refuses to run if
// listings already exist.  Usage: npm run db:seed:demo
import "dotenv/config";
import { count } from "drizzle-orm";
import { db, listings } from "../src/db";

const demo: [string, string, string, string | null, string | null, string, number, number][] = [
  ["iPhone 16 Pro Max 256GB Desert Titanium", "Apple", "Phones", "256GB", "Desert Titanium", "New sealed", 1015, 4],
  ["iPhone 16 Pro 128GB Black Titanium", "Apple", "Phones", "128GB", "Black Titanium", "New sealed", 880, 2],
  ["iPhone 15 128GB Blue", "Apple", "Phones", "128GB", "Blue", "Like new", 520, 1],
  ["Galaxy S25 Ultra 512GB Titanium Black", "Samsung", "Phones", "512GB", "Titanium Black", "New sealed", 990, 3],
  ["Galaxy Z Fold6 256GB Navy", "Samsung", "Phones", "256GB", "Navy", "New open box", 1180, 1],
  ["iPad Pro 11\" M4 256GB Wi-Fi Space Black", "Apple", "Tablets", "256GB", "Space Black", "New sealed", 899, 2],
  ["MacBook Air 13\" M3 16GB/512GB Midnight", "Apple", "Laptops", "512GB", "Midnight", "New sealed", 1099, 5],
  ["Apple Watch Ultra 2 49mm Black Titanium", "Apple", "Watches", null, "Black", "New sealed", 690, 6],
  ["AirPods Pro 2 (USB-C)", "Apple", "Audio", null, "White", "New sealed", 168, 20],
  ["Galaxy Watch7 44mm Green", "Samsung", "Watches", null, "Green", "Used", 160, 1],
  ["Pixel 9 Pro 256GB Obsidian", "Google", "Phones", "256GB", "Obsidian", "New sealed", 760, 2],
  ["PlayStation 5 Pro", "Sony", "Gaming", "2TB", null, "New sealed", 640, 3],
];

async function main() {
  const [{ n }] = await db.select({ n: count() }).from(listings);
  if (n > 0) throw new Error(`Refusing to seed: ${n} listings already exist.`);
  await db.insert(listings).values(
    demo.map(([title, brand, category, storage, color, condition, price, quantity], i) => ({
      title,
      brand,
      category,
      model: title.split(/ \d/)[0],
      storage,
      color,
      condition,
      quantity,
      sourcePriceCents: price * 100,
      markupCents: 1000,
      salePriceCents: price * 100 + 1000,
      chatId: "demo@g.us",
      chatName: "Demo group",
      sellerId: `1555000000${i % 4}`,
      sellerName: ["Ali", "Omar", "Sara", "Mike"][i % 4],
      sourceMessageId: `demo-${i}`,
      rawText: `${title} ${price}`,
      dedupeKey: `demo-${i}`,
      lastSeenAt: new Date(Date.now() - i * 47 * 60 * 1000),
    })),
  );
  console.log(`Seeded ${demo.length} demo listings.`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
