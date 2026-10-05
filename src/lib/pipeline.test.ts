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
  downloadImage: async () => ({ mimeType: "image/jpeg", data: Buffer.from("fake-jpeg") }),
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
const photo = () => msg({ type: "image", image: { id: `img${n}`, link: null, mimeType: "image/jpeg" } });
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
  });

  it("pairs a photo burst with the price text in one AI call, and retries are no-ops", async () => {
    const a = photo();
    const b = photo();
    const t = msg({ text: "16 Pro 256 black sealed x2 900" });
    for (const x of [a, b, t]) expect(await ingest.recordMessage(x)).toBe(true);
    expect(await ingest.recordMessage(t)).toBe(false); // gateway retry

    extract.mockResolvedValueOnce({ is_sale_post: true, items: [iphone(900, [0, 1])] });
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
    extract.mockResolvedValueOnce({ is_sale_post: true, items: [iphone(900)] });
    await ingest.processBurst(GROUP, SELLER);

    const late = photo();
    await ingest.recordMessage(late);
    extract.mockResolvedValueOnce({ is_sale_post: true, items: [iphone(880, [0])] });
    await ingest.processBurst(GROUP, SELLER);
    // the earlier text was re-read alongside the photo
    expect(extract.mock.calls[1][0].text).toContain("16 Pro 256 black 900");

    const rows = await m.db.select().from(m.listings);
    expect(rows).toHaveLength(1);
    expect(rows[0].salePriceCents).toBe(89000);
    expect(rows[0].imageIds).toHaveLength(1);
  });

  it("marks chatter as ignored and AI errors as failed", async () => {
    await ingest.recordMessage(msg({ text: "anyone have S24 Ultra?" }));
    extract.mockResolvedValueOnce({ is_sale_post: false, items: [] });
    await ingest.processBurst(GROUP, SELLER);
    await ingest.recordMessage(msg({ text: "15 pro 700" }));
    extract.mockRejectedValueOnce(new Error("boom"));
    await ingest.processBurst(GROUP, SELLER);
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
    extract.mockResolvedValueOnce({ is_sale_post: true, items: [iphone(900)] });
    await ingest.processBurst(GROUP, SELLER);
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
});
