// Seller auto-verification, end to end against Postgres (TEST_DATABASE_URL).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SellerAnswer } from "@/lib/ai/verify-reply";

const DB_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = DB_URL;
process.env.WHAPI_TOKEN = "test";
process.env.NEXT_PUBLIC_APP_URL = "https://shop.example";

const sent: { kind: string; to: string; body: string }[] = [];
vi.mock("@/lib/whatsapp/whapi", async (orig) => ({
  ...(await orig<typeof import("@/lib/whatsapp/whapi")>()),
  sendText: async (to: string, body: string) => void sent.push({ kind: "text", to, body }),
  sendImage: async (to: string, url: string, body: string) => void sent.push({ kind: "image", to, body: `${url}\n${body}` }),
  fetchGroupName: async () => "Resellers 1",
}));
const readReply = vi.fn();
vi.mock("@/lib/ai/verify-reply", () => ({ readSellerReply: (...a: unknown[]) => readReply(...a) }));
const charges: number[] = [];
vi.mock("@/lib/stripe", () => ({
  ensureStripeCustomer: async () => "cus_test",
  getStripe: () => ({
    paymentIntents: {
      create: async (p: { amount: number }) => {
        charges.push(p.amount);
        return { id: `pi_${charges.length}`, status: "succeeded" };
      },
    },
  }),
}));

const SELLER = "15550002222";
const answer = (over: Partial<SellerAnswer>): SellerAnswer => ({
  ask_index: 0,
  outcome: "available",
  unit_price: null,
  quantity_available: null,
  notes: null,
  summary: "Seller confirmed",
  ...over,
});

describe.skipIf(!DB_URL)("automatic seller verification", () => {
  let m: typeof import("@/db");
  let verify: typeof import("@/lib/verify");
  let ingest: typeof import("@/lib/whatsapp/ingest");
  let orders: typeof import("@/lib/orders");

  beforeAll(async () => {
    m = await import("@/db");
    verify = await import("@/lib/verify");
    ingest = await import("@/lib/whatsapp/ingest");
    orders = await import("@/lib/orders");
  });

  let n = 0;
  async function setup(quantity = 1) {
    sent.length = 0;
    charges.length = 0;
    readReply.mockReset();
    await m.db.delete(m.orders);
    await m.db.delete(m.customers);
    await m.db.delete(m.listings);
    await m.db.delete(m.waMessages);
    await m.db.delete(m.images);
    const [img] = await m.db.insert(m.images).values({ mimeType: "image/jpeg", data: Buffer.from("x") }).returning();
    const [listing] = await m.db
      .insert(m.listings)
      .values({
        title: "Galaxy S25 Ultra 512GB Black",
        brand: "Samsung",
        category: "Phones",
        condition: "New sealed",
        quantity: 3,
        sourcePriceCents: 90000,
        markupCents: 1000,
        salePriceCents: 91000,
        imageIds: [img.id],
        chatId: "120363222@g.us",
        chatName: "Resellers 1",
        sellerId: SELLER,
        sellerName: "Omar",
        sourceMessageId: "src1",
        rawText: "S25U 512 black sealed x3 900",
        dedupeKey: "k",
      })
      .returning();
    const [customer] = await m.db
      .insert(m.customers)
      .values({
        clerkUserId: `user_${++n}`,
        shipName: "Sam",
        shipLine1: "1 Main",
        shipCity: "Austin",
        shipState: "TX",
        shipPostalCode: "78701",
        paymentMethodId: "pm_test",
        hasPaymentMethod: true,
      })
      .returning();
    const order = await orders.createOrderRequest(customer, listing.id, quantity, null);
    await verify.startVerification(order.id);
    return { listing, order };
  }

  async function sellerSays(text: string) {
    const dm = {
      id: `dm${++n}`,
      chatId: `${SELLER}@s.whatsapp.net`,
      chatName: null,
      senderId: SELLER,
      senderName: "Omar",
      fromMe: false,
      type: "text",
      text,
      image: null,
      sentAt: new Date(),
      raw: {},
    };
    expect(await ingest.shouldRecord(dm)).toBe(true);
    await ingest.recordMessage(dm);
    await ingest.processAfterQuietPeriod(dm.id, 0);
  }

  const getOrder = async (id: string) => (await m.db.select().from(m.orders).where((await import("drizzle-orm")).eq(m.orders.id, id)))[0];
  const getListing = async () => (await m.db.select().from(m.listings))[0];

  beforeEach(() => {
    process.env.AUTO_CHARGE = "";
  });

  it("DMs the seller their original post + photo", async () => {
    const { order } = await setup();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "image", to: SELLER });
    expect(sent[0].body).toContain("https://shop.example/api/images/");
    expect(sent[0].body).toContain("S25U 512 black sealed x3 900");
    expect(sent[0].body).toContain("$900");
    expect(await getOrder(order.id)).toMatchObject({ status: "verifying", sellerContact: SELLER, verifyStatus: "asked" });
  });

  it("seller confirms -> buyer charged automatically, stock reduced", async () => {
    const { order } = await setup(2);
    readReply.mockResolvedValueOnce([answer({})]);
    await sellerSays("yes still have");
    expect(charges).toEqual([182000]);
    expect(await getOrder(order.id)).toMatchObject({ status: "paid", verifyStatus: "confirmed", sellerReply: "yes still have" });
    expect((await getListing()).quantity).toBe(1);
  });

  it("seller lowers the price -> buyer pays the lower price", async () => {
    const { order } = await setup();
    readReply.mockResolvedValueOnce([answer({ outcome: "changed", unit_price: 850 })]);
    await sellerSays("yes 850 now");
    expect(charges).toEqual([86000]);
    expect(await getOrder(order.id)).toMatchObject({ status: "paid", totalCents: 86000, sourcePriceCents: 85000 });
    expect((await getListing()).salePriceCents).toBe(86000);
  });

  it("seller raises the price -> buyer must accept before any charge", async () => {
    const { order } = await setup();
    readReply.mockResolvedValueOnce([answer({ outcome: "changed", unit_price: 950, summary: "Price went up to $950" })]);
    await sellerSays("available but 950");
    expect(charges).toEqual([]);
    const pending = await getOrder(order.id);
    expect(pending).toMatchObject({ status: "needs_buyer_approval", proposedUnitPriceCents: 96000, proposedQuantity: 1 });
    expect((await getListing()).salePriceCents).toBe(96000);

    await verify.acceptChange(pending);
    expect(charges).toEqual([96000]);
    expect(await getOrder(order.id)).toMatchObject({ status: "paid", totalCents: 96000, proposedUnitPriceCents: null });
  });

  it("seller sold out -> order cancelled, listing down, nobody charged", async () => {
    const { order } = await setup();
    readReply.mockResolvedValueOnce([answer({ outcome: "unavailable", summary: "Sold" })]);
    await sellerSays("sorry sold");
    expect(charges).toEqual([]);
    expect(await getOrder(order.id)).toMatchObject({ status: "cancelled", verifyStatus: "unavailable" });
    expect(await getListing()).toMatchObject({ status: "sold", quantity: 0 });
  });

  it("unclear reply -> flagged for admin, still verifying", async () => {
    const { order } = await setup();
    readReply.mockResolvedValueOnce([answer({ outcome: "unclear", summary: "Seller said they'd check" })]);
    await sellerSays("let me check");
    expect(charges).toEqual([]);
    expect(await getOrder(order.id)).toMatchObject({ status: "verifying", verifyStatus: "needs_review" });
    // admin got pinged? only if ADMIN_WHATSAPP_NUMBER set — not here
  });

  it("AUTO_CHARGE=false leaves confirmed orders for the admin", async () => {
    process.env.AUTO_CHARGE = "false";
    const { order } = await setup();
    readReply.mockResolvedValueOnce([answer({})]);
    await sellerSays("yes");
    expect(charges).toEqual([]);
    expect(await getOrder(order.id)).toMatchObject({ status: "requested", verifyStatus: "confirmed" });
  });

  it("ignores DMs from people we aren't waiting on", async () => {
    await setup();
    expect(
      await ingest.shouldRecord({
        id: "x",
        chatId: "19998887777@s.whatsapp.net",
        chatName: null,
        senderId: "19998887777",
        senderName: null,
        fromMe: false,
        type: "text",
        text: "hello",
        image: null,
        sentAt: new Date(),
        raw: {},
      }),
    ).toBe(false);
  });
});
