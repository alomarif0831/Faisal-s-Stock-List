// End-to-end pipeline test against a real Postgres. Runs only when
// TEST_DATABASE_URL is set (a throwaway database with migrations applied):
//   TEST_DATABASE_URL=postgres://... npm test
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = DB_URL;
process.env.WHATSAPP_DEBOUNCE_MS = "20";

const extract = vi.fn();
vi.mock("@/lib/ai/extract", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/extract")>()),
  extractListings: (...args: unknown[]) => extract(...args),
}));
vi.mock("@/lib/whatsapp/whapi", async (orig) => ({
  ...(await orig<typeof import("@/lib/whatsapp/whapi")>()),
  // Photo bytes come from the media id, so "the same photo" can be simulated.
  downloadImage: async (img: { id: string | null }) => ({ mimeType: "image/jpeg", data: Buffer.from(`jpeg:${img.id}`) }),
  fetchGroupName: async () => "Resellers 1",
  sendText: async () => {},
}));

const GROUP = "120363111@g.us";
const SELLER = "15550001111";
let n = 0;
const msg = (over: Partial<import("@/lib/whatsapp/whapi").IncomingMessage> = {}) => ({
  id: `m${++n}-${Date.now()}`,
  chatId: GROUP,
  chatName: null,
  senderId: SELLER,
  senderName: "Ali",
  fromMe: false,
  type: "text",
  text: null,
  image: null,
  sentAt: new Date(Date.now() + n),
  raw: {},
  ...over,
});
const photo = (over: Partial<import("@/lib/whatsapp/whapi").IncomingMessage> = {}, mediaId?: string) =>
  msg({ type: "image", image: { id: mediaId ?? `img${n}`, link: null, mimeType: "image/jpeg" }, ...over });
const iphone = (price: number, image_indexes: number[] = []) => ({
  title: "iPhone 16 Pro 256GB Black",
  brand: "Apple",
  category: "Phones",
  model: "iPhone 16 Pro",
  storage: "256GB",
  color: "Black",
  condition: "New sealed",
  details: null,
  quantity: 2,
  unit_price: price,
  currency: "USD",
  image_indexes,
  existing_listing_id: null as string | null,
});

describe.skipIf(!DB_URL)("whatsapp -> listings -> orders", () => {
  let m: typeof import("@/db");
  let ingest: typeof import("@/lib/whatsapp/ingest");
  let orders: typeof import("@/lib/orders");

  beforeAll(async () => {
    m = await import("@/db");
    ingest = await import("@/lib/whatsapp/ingest");
    orders = await import("@/lib/orders");
  });

  beforeEach(async () => {
    extract.mockReset();
    await m.db.delete(m.orders);
    await m.db.delete(m.customers);
    await m.db.delete(m.listings);
    await m.db.delete(m.waMessages);
    await m.db.delete(m.images);
    await m.db.delete(m.hiddenSellers);
  });

  it("pairs a photo burst with the price text in one AI call, and retries are no-ops", async () => {
    const a = photo();
    const b = photo();
    const t = msg({ text: "16 Pro 256 black sealed x2 900" });
    for (const x of [a, b, t]) expect(await ingest.recordMessage(x)).toBe(true);
    expect(await ingest.recordMessage(t)).toBe(false); // gateway retry

    extract.mockResolvedValueOnce({ sold_listing_ids: [], is_sale_post: true, items: [iphone(900, [0, 1])] });
    // Only the newest message of the burst does the work.
    await Promise.all([a, b, t].map((x) => ingest.processAfterQuietPeriod(x.id)));
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0][0].images).toHaveLength(2);

    const rows = await m.db.select().from(m.listings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sourcePriceCents: 90000, salePriceCents: 91000, quantity: 2, chatName: "Resellers 1" });
    expect(rows[0].imageIds).toHaveLength(2);
    const statuses = (await m.db.select().from(m.waMessages)).map((r) => r.status);
    expect(statuses).toEqual(["done", "done", "done"]);
  });

  it("updates the existing listing when the seller reposts, and attaches late photos", async () => {
    const t1 = msg({ text: "16 Pro 256 black 900" });
    await ingest.recordMessage(t1);
    extract.mockResolvedValueOnce({ sold_listing_ids: [], is_sale_post: true, items: [iphone(900)] });
    await ingest.processBurst(SELLER);

    const late = photo();
    await ingest.recordMessage(late);
    extract.mockResolvedValueOnce({ sold_listing_ids: [], is_sale_post: true, items: [iphone(880, [0])] });
    await ingest.processBurst(SELLER);
    // the earlier text was re-read alongside the photo
    expect(extract.mock.calls[1][0].text).toContain("16 Pro 256 black 900");

    const rows = await m.db.select().from(m.listings);
    expect(rows).toHaveLength(1);
    expect(rows[0].salePriceCents).toBe(89000);
    expect(rows[0].imageIds).toHaveLength(1);
  });

  it("marks chatter as ignored (without an AI call) and AI errors as failed", async () => {
    await ingest.recordMessage(msg({ text: "anyone have S24 Ultra?" }));
    await ingest.processBurst(SELLER);
    expect(extract).not.toHaveBeenCalled(); // filtered for free
    await ingest.recordMessage(msg({ text: "15 pro 700" }));
    extract.mockRejectedValueOnce(new Error("boom"));
    await ingest.processBurst(SELLER);
    expect(extract).toHaveBeenCalledTimes(1);
    const rows = await m.db.select().from(m.waMessages).orderBy(m.waMessages.sentAt);
    expect(rows.map((r) => r.status)).toEqual(["ignored", "failed"]);
    expect(rows[1].error).toBe("boom");
    expect(await m.db.select().from(m.listings)).toHaveLength(0);
  });

  it("skips own messages, DMs, and groups outside the allow-list", () => {
    expect(ingest.shouldCapture(msg({ text: "x 1", fromMe: true }))).toBe(false);
    expect(ingest.shouldCapture(msg({ text: "x 1", chatId: "1555@s.whatsapp.net" }))).toBe(false);
    process.env.WHATSAPP_GROUP_IDS = "other@g.us";
    expect(ingest.shouldCapture(msg({ text: "x 1" }))).toBe(false);
    process.env.WHATSAPP_GROUP_IDS = "";
    expect(ingest.shouldCapture(msg({ text: "x 1" }))).toBe(true);
  });

  it("order request -> paid takes stock off; cancel puts it back", async () => {
    await ingest.recordMessage(msg({ text: "16 Pro 256 black 900" }));
    extract.mockResolvedValueOnce({ sold_listing_ids: [], is_sale_post: true, items: [iphone(900)] });
    await ingest.processBurst(SELLER);
    const [listing] = await m.db.select().from(m.listings);

    const [customer] = await m.db
      .insert(m.customers)
      .values({ clerkUserId: "user_1", shipName: "Sam", shipLine1: "1 Main", shipCity: "Austin", shipState: "TX", shipPostalCode: "78701" })
      .returning();
    const order = await orders.createOrderRequest(customer, listing.id, 5, "fast please");
    expect(order).toMatchObject({ quantity: 2, unitPriceCents: 91000, totalCents: 182000, sourcePriceCents: 90000 });
    expect(order.shipping.city).toBe("Austin");

    await orders.markPaid(order.id, "pi_test");
    await orders.markPaid(order.id, "pi_test"); // idempotent
    let [l] = await m.db.select().from(m.listings);
    expect(l).toMatchObject({ quantity: 0, status: "sold" });

    await expect(orders.createOrderRequest(customer, listing.id, 1, null)).rejects.toThrow(/no longer available/);

    // cancelling an unpaid order doesn't touch Stripe
    const [c2] = await m.db.update(m.listings).set({ status: "active", quantity: 1 }).returning();
    const o2 = await orders.createOrderRequest(customer, c2.id, 1, null);
    await orders.cancelOrder(o2.id, "seller sold out");
    const [after] = await m.db.select().from(m.orders).where((await import("drizzle-orm")).eq(m.orders.id, o2.id));
    expect(after).toMatchObject({ status: "cancelled", adminNote: "seller sold out" });
    [l] = await m.db.select().from(m.listings);
    expect(l.quantity).toBe(1);
  });

  it("a post cross-posted to several groups becomes one listing from one AI call", async () => {
    const copies = ["120363111@g.us", "120363222@g.us", "120363333@g.us"].flatMap((chatId) => [
      photo({ chatId }, "same-photo"),
      msg({ chatId, text: "16 Pro 256 black sealed x2 900" }),
    ]);
    for (const c of copies) await ingest.recordMessage(c);
    extract.mockResolvedValue({ sold_listing_ids: [], is_sale_post: true, items: [iphone(900, [0])] });
    await Promise.all(copies.map((c) => ingest.processAfterQuietPeriod(c.id)));

    expect(extract).toHaveBeenCalledTimes(1);
    const input = extract.mock.calls[0][0];
    expect(input.text).toBe("16 Pro 256 black sealed x2 900"); // read once, not 3 times
    expect(input.images).toHaveLength(1); // identical photos collapsed
    expect(await m.db.select().from(m.listings)).toHaveLength(1);
    expect((await m.db.select().from(m.waMessages)).every((r) => r.status === "done")).toBe(true);
  });

  it("two bursts racing for the same seller still produce one listing", async () => {
    await ingest.recordMessage(msg({ text: "16 Pro 256 black 900" }));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    extract.mockImplementation(async () => {
      await gate; // both calls are in flight before either writes
      return { is_sale_post: true, items: [iphone(900)], sold_listing_ids: [] };
    });
    const both = Promise.all([ingest.processBurst(SELLER), ingest.processBurst(SELLER)]);
    await new Promise((r) => setTimeout(r, 50));
    release();
    await both;
    expect(await m.db.select().from(m.listings)).toHaveLength(1);
  });

  it("matches a reworded repost to the seller's existing listing", async () => {
    await ingest.recordMessage(msg({ text: "iPhone 16 Pro 256 Black Titanium sealed 900" }));
    extract.mockResolvedValueOnce({ sold_listing_ids: [], is_sale_post: true, items: [iphone(900)] });
    await ingest.processBurst(SELLER);
    const [first] = await m.db.select().from(m.listings);
    // The AI was shown the existing listing...
    await ingest.recordMessage(msg({ text: "16P 256 blk NIB 880" }));
    extract.mockResolvedValueOnce({
      is_sale_post: true,
      items: [{ ...iphone(880), title: "iPhone 16 Pro 256GB Blk", color: "Blk", existing_listing_id: first.id }],
    });
    await ingest.processBurst(SELLER);
    expect(extract.mock.calls[1][0].existing).toEqual([
      { id: first.id, title: first.title, condition: "New sealed", price: 900, postedAgo: "just now" },
    ]);
    // ...and its match updated that listing instead of adding one.
    const rows = await m.db.select().from(m.listings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, sourcePriceCents: 88000 });
  });

  it("ignores a match pointing at another seller's listing", async () => {
    await ingest.recordMessage(msg({ text: "16 Pro 256 black 900" }));
    extract.mockResolvedValueOnce({ sold_listing_ids: [], is_sale_post: true, items: [iphone(900)] });
    await ingest.processBurst(SELLER);
    const [theirs] = await m.db.select().from(m.listings);

    await ingest.recordMessage(msg({ senderId: "15559998888", text: "16 Pro 256 black 870" }));
    extract.mockResolvedValueOnce({
      is_sale_post: true,
      items: [{ ...iphone(870), existing_listing_id: theirs.id }],
      sold_listing_ids: [],
    });
    await ingest.processBurst("15559998888");
    const rows = await m.db.select().from(m.listings).orderBy(m.listings.createdAt);
    expect(rows).toHaveLength(2);
    expect(rows[0].sourcePriceCents).toBe(90000); // untouched
  });

  it("shows a product offered by several sellers once, at the cheapest price", async () => {
    const { searchCatalog, facetCounts } = await import("@/lib/listings");
    for (const [seller, price] of [["15550001111", 900], ["15550002222", 860], ["15550003333", 950]] as const) {
      await ingest.recordMessage(msg({ senderId: seller, text: `16 Pro 256 black ${price}` }));
      extract.mockResolvedValueOnce({ sold_listing_ids: [], is_sale_post: true, items: [iphone(price)] });
      await ingest.processBurst(seller);
    }
    expect(await m.db.select().from(m.listings)).toHaveLength(3); // every offer kept for the admin
    const shown = await searchCatalog({});
    expect(shown).toHaveLength(1);
    expect(shown[0].salePriceCents).toBe(87000);
    expect((await facetCounts()).brands).toEqual([{ value: "Apple", n: 1 }]);
  });

  it("lists stock posted without a price as price-on-request", async () => {
    const { searchCatalog } = await import("@/lib/listings");
    await ingest.recordMessage(msg({ text: "WTS 2x S25 Ultra ATT 256GB A grade, send offers" }));
    extract.mockResolvedValueOnce({ sold_listing_ids: [], is_sale_post: true, items: [iphone(900)] });
    await ingest.processBurst(SELLER);
    await ingest.recordMessage(msg({ senderId: "15557770000", text: "WTS 16 Pro 256 black, DM for price" }));
    extract.mockResolvedValueOnce({
      is_sale_post: true,
      items: [{ ...iphone(0), title: "iPhone 16 Pro 256GB Black (B)", color: "Blue", unit_price: null }],
      sold_listing_ids: [],
    });
    await ingest.processBurst("15557770000");
    const noPrice = (await m.db.select().from(m.listings)).find((l) => l.sellerId === "15557770000")!;
    expect(noPrice).toMatchObject({ sourcePriceCents: null, salePriceCents: null, status: "active" });
    // priced items sort ahead of "Ask for price" ones
    const shown = await searchCatalog({ sort: "price_asc" });
    expect(shown.map((l) => l.salePriceCents)).toEqual([91000, null]);
  });

  it("applies a price posted after the photos to that listing", async () => {
    await ingest.recordMessage(msg({ text: "iPhone 16 Pro grade B, battery 90%, send best offer" }));
    extract.mockResolvedValueOnce({
      is_sale_post: true,
      items: [{ ...iphone(0), unit_price: null, details: "Grade B, battery 90%" }],
      sold_listing_ids: [],
    });
    await ingest.processBurst(SELLER);
    const [first] = await m.db.select().from(m.listings);
    expect(first.sourcePriceCents).toBeNull();

    await ingest.recordMessage(msg({ text: "$450 Shipped" }));
    extract.mockResolvedValueOnce({
      is_sale_post: true,
      items: [{ ...iphone(450), details: null, existing_listing_id: first.id }],
      sold_listing_ids: [],
    });
    await ingest.processBurst(SELLER);
    expect(extract.mock.calls[1][0].existing[0]).toMatchObject({ id: first.id, price: null });
    const rows = await m.db.select().from(m.listings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sourcePriceCents: 45000, salePriceCents: 46000, details: "Grade B, battery 90%" });
    expect(rows[0].rawText).toContain("send best offer");
    expect(rows[0].rawText).toContain("$450 Shipped");
  });

  it("a repost without a price keeps the price already known", async () => {
    await ingest.recordMessage(msg({ text: "16 Pro 256 black 900" }));
    extract.mockResolvedValueOnce({ sold_listing_ids: [], is_sale_post: true, items: [iphone(900)] });
    await ingest.processBurst(SELLER);
    await ingest.recordMessage(msg({ text: "16 Pro 256 black still available, offers" }));
    extract.mockResolvedValueOnce({ is_sale_post: true, items: [{ ...iphone(0), unit_price: null }], sold_listing_ids: [] });
    await ingest.processBurst(SELLER);
    const rows = await m.db.select().from(m.listings);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourcePriceCents).toBe(90000);
  });

  it('"Sold" takes the seller\'s listing off the storefront, but never another seller\'s', async () => {
    await ingest.recordMessage(msg({ text: "16 Pro 256 black 900" }));
    extract.mockResolvedValueOnce({ sold_listing_ids: [], is_sale_post: true, items: [iphone(900)] });
    await ingest.processBurst(SELLER);
    const [mine] = await m.db.select().from(m.listings);

    await ingest.recordMessage(msg({ senderId: "15556660000", text: "15 pro 700" }));
    extract.mockResolvedValueOnce({
      is_sale_post: true,
      items: [{ ...iphone(700), model: "iPhone 15 Pro" }],
      sold_listing_ids: [],
    });
    await ingest.processBurst("15556660000");
    const theirs = (await m.db.select().from(m.listings)).find((l) => l.sellerId === "15556660000")!;

    await ingest.recordMessage(msg({ text: "Sold" }));
    // even if the model returned someone else's id, only the sender's listing changes
    extract.mockResolvedValueOnce({ is_sale_post: true, items: [], sold_listing_ids: [mine.id, theirs.id] });
    await ingest.processBurst(SELLER);
    const after = await m.db.select().from(m.listings);
    expect(after.find((l) => l.id === mine.id)!.status).toBe("sold");
    expect(after.find((l) => l.id === theirs.id)!.status).toBe("active");
    expect((await m.db.select().from(m.waMessages)).every((r) => r.status === "done")).toBe(true);
  });

  it("skips sellers who opted out, without an AI call", async () => {
    await m.db.insert(m.hiddenSellers).values({ sellerId: SELLER, sellerName: "Ali" });
    await ingest.recordMessage(msg({ text: "16 Pro 256 black 900" }));
    await ingest.processBurst(SELLER);
    expect(extract).not.toHaveBeenCalled();
    expect(await m.db.select().from(m.listings)).toHaveLength(0);
    expect((await m.db.select().from(m.waMessages))[0].status).toBe("ignored");
  });

  it("shows the seller's own price with no markup by default", async () => {
    const { priceFields } = await import("@/lib/whatsapp/ingest");
    // tests run with MARKUP_DOLLARS=10; production default is 0
    expect(priceFields(900)).toMatchObject({ sourcePriceCents: 90000, salePriceCents: 91000 });
  });
});
