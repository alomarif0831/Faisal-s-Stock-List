import { describe, expect, it } from "vitest";
import { sanitize } from "@/lib/ai/extract";
import { formatMoney, phoneFromJid } from "@/lib/format";
import { dedupeKeyFor, priceFields } from "@/lib/whatsapp/ingest";
import { parseWebhook } from "@/lib/whatsapp/whapi";

const item = {
  title: "iPhone 16 Pro Max 256GB Desert",
  brand: "Apple" as const,
  category: "Phones" as const,
  model: "iPhone 16 Pro Max",
  storage: "256GB",
  color: "Desert",
  condition: "New sealed" as const,
  details: null,
  quantity: 3,
  unit_price: 1015,
  currency: "usd",
  image_indexes: [],
  existing_listing_id: null,
};

describe("parseWebhook", () => {
  it("reads text and image group messages", () => {
    const msgs = parseWebhook({
      messages: [
        {
          id: "A1",
          from_me: false,
          type: "text",
          chat_id: "120363000000000000@g.us",
          timestamp: 1759700000,
          from: "15551234567",
          from_name: "Ali",
          text: { body: "16PM 256 desert sealed 1015" },
        },
        {
          id: "A2",
          type: "image",
          chat_id: "120363000000000000@g.us",
          timestamp: "1759700005",
          from: "15551234567",
          image: { id: "jpeg-abc", mime_type: "image/jpeg", caption: "S25U 512 black 900" },
        },
        { id: "bad" },
      ],
      event: { type: "messages", event: "post" },
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ id: "A1", text: "16PM 256 desert sealed 1015", senderName: "Ali", fromMe: false });
    expect(msgs[0].sentAt.toISOString()).toBe(new Date(1759700000 * 1000).toISOString());
    expect(msgs[1]).toMatchObject({ text: "S25U 512 black 900", image: { id: "jpeg-abc", mimeType: "image/jpeg" } });
  });

  it("ignores payloads without messages", () => {
    expect(parseWebhook({ statuses: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });
});

describe("sanitize (sold)", () => {
  it("keeps only sold ids that belong to the seller and doesn't re-list them", () => {
    const out = sanitize(
      { is_sale_post: true, items: [{ ...item, existing_listing_id: "a" }], sold_listing_ids: ["a", "zzz"] },
      0,
      new Set(["a", "b"]),
    );
    expect(out).toEqual({ is_sale_post: true, items: [], sold_listing_ids: ["a"] });
  });
});

describe("sanitize", () => {
  it("keeps priceless items as price-on-request and clamps quantity/indexes", () => {
    const out = sanitize(
      {
        is_sale_post: true,
        items: [
          { ...item, quantity: 0, image_indexes: [0, 0, 5] },
          { ...item, title: "No price", unit_price: 0 },
        ],
        sold_listing_ids: [],
      },
      2,
    );
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({ quantity: 1, currency: "USD", image_indexes: [0], unit_price: 1015 });
    expect(out.items[1]).toMatchObject({ title: "No price", unit_price: null });
  });

  it("gives a lone item every photo when the model didn't map them", () => {
    const out = sanitize({ is_sale_post: true, items: [item], sold_listing_ids: [] }, 3);
    expect(out.items[0].image_indexes).toEqual([0, 1, 2]);
  });

  it("returns nothing for non-sale posts", () => {
    expect(sanitize({ is_sale_post: false, items: [item], sold_listing_ids: [] }, 0)).toEqual({ is_sale_post: false, items: [], sold_listing_ids: [] });
  });
});

describe("pricing", () => {
  it("adds the $10 markup", () => {
    expect(priceFields(1015)).toEqual({ sourcePriceCents: 101500, markupCents: 1000, salePriceCents: 102500 });
    expect(priceFields(99.99).salePriceCents).toBe(10999);
  });
  it("formats money", () => {
    expect(formatMoney(102500)).toBe("$1,025");
    expect(formatMoney(10999)).toBe("$109.99");
  });
});

describe("helpers", () => {
  it("builds a stable dedupe key", () => {
    expect(dedupeKeyFor(item)).toBe(dedupeKeyFor({ ...item, title: "x" }));
    expect(dedupeKeyFor(item)).not.toBe(dedupeKeyFor({ ...item, storage: "512GB" }));
  });
  it("normalises wording differences in the product key", () => {
    const base = { brand: "Apple", model: "iPhone 16 Pro", title: "", storage: "1TB", color: "Natural Titanium", condition: "Used" };
    const key = dedupeKeyFor(base);
    expect(dedupeKeyFor({ ...base, model: "Apple iPhone 16 Pro" })).toBe(key);
    expect(dedupeKeyFor({ ...base, storage: "1 TB" })).toBe(key);
    expect(dedupeKeyFor({ ...base, storage: "1024GB" })).toBe(key);
    expect(dedupeKeyFor({ ...base, color: "natural" })).toBe(key);
    expect(dedupeKeyFor({ ...base, color: "Black Titanium" })).not.toBe(key);
    expect(dedupeKeyFor({ ...base, condition: "New sealed" })).not.toBe(key);
  });
  it("extracts phone numbers", () => {
    expect(phoneFromJid("15551234567@s.whatsapp.net")).toBe("+15551234567");
    expect(phoneFromJid("15551234567")).toBe("+15551234567");
    expect(phoneFromJid("120363000@lid")).toBe("+120363000");
    expect(phoneFromJid("abc")).toBeNull();
  });
});

describe("verification decisions", async () => {
  const { decide } = await import("@/lib/verify");
  const order = { quantity: 2, unitPriceCents: 91000 } as import("@/db").Order;
  const listing = { sourcePriceCents: 90000 } as import("@/db").Listing;
  const a = (o: Partial<import("@/lib/ai/verify-reply").SellerAnswer>) => ({
    ask_index: 0,
    outcome: "available" as const,
    unit_price: null,
    quantity_available: null,
    notes: null,
    summary: "",
    ...o,
  });
  it("proceeds when nothing changed", () => {
    expect(decide(order, listing, a({}), 1000)).toEqual({ kind: "proceed", unitPriceCents: 91000, sourcePriceCents: 90000 });
  });
  it("asks the buyer when the price rises or stock drops", () => {
    expect(decide(order, listing, a({ outcome: "changed", unit_price: 950 }), 1000)).toMatchObject({ kind: "ask_buyer", unitPriceCents: 96000 });
    expect(decide(order, listing, a({ quantity_available: 1 }), 1000)).toMatchObject({ kind: "ask_buyer", quantity: 1 });
    expect(decide(order, listing, a({ outcome: "changed", notes: "open box now" }), 1000)).toMatchObject({ kind: "ask_buyer" });
  });
  it("needs a price before a price-on-request order can go ahead", () => {
    const noPrice = { sourcePriceCents: null } as import("@/db").Listing;
    const pendingOrder = { quantity: 1, unitPriceCents: 0 } as import("@/db").Order;
    expect(decide(pendingOrder, noPrice, a({}), 1000)).toEqual({ kind: "unclear" });
    // seller names a price -> the buyer approves it before any charge
    expect(decide(pendingOrder, noPrice, a({ outcome: "changed", unit_price: 450 }), 1000)).toEqual({
      kind: "ask_buyer",
      unitPriceCents: 46000,
      sourcePriceCents: 45000,
      quantity: 1,
    });
  });
  it("treats zero stock as unavailable", () => {
    expect(decide(order, listing, a({ quantity_available: 0 }), 1000)).toEqual({ kind: "unavailable" });
  });
});
