import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// Every webhook the WhatsApp gateway sends us, verbatim. Keyed by the
// WhatsApp message id so gateway retries are no-ops, and kept so a bad
// parse can be replayed after the prompt is fixed.
export const waMessages = pgTable(
  "wa_messages",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    chatName: text("chat_name"),
    senderId: text("sender_id").notNull(),
    senderName: text("sender_name"),
    type: text("type").notNull(),
    text: text("text"),
    imageId: uuid("image_id"),
    // pending  -> image waiting for a text message from the same sender
    // done     -> turned into listings (or attached to one)
    // ignored  -> not a sale post (chatter, wanted-to-buy, etc.)
    // failed   -> AI or download error; see `error`
    status: text("status").notNull().default("pending"),
    error: text("error"),
    raw: jsonb("raw"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wa_messages_sender_idx").on(t.chatId, t.senderId, t.sentAt)],
);

// Sellers who asked not to be listed. Their posts are skipped (no AI call)
// and their existing listings are hidden.
export const hiddenSellers = pgTable("hidden_sellers", {
  sellerId: text("seller_id").primaryKey(),
  sellerName: text("seller_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const images = pgTable("images", {
  id: uuid("id").primaryKey().defaultRandom(),
  mimeType: text("mime_type").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Product
    title: text("title").notNull(),
    brand: text("brand").notNull(),
    category: text("category").notNull(),
    model: text("model"),
    storage: text("storage"),
    color: text("color"),
    condition: text("condition").notNull(),
    details: text("details"),
    quantity: integer("quantity").notNull().default(1),
    // Money, in cents. salePrice = sourcePrice + markup at capture time.
    // Both null when the seller posted without a price ("send offers"):
    // the storefront shows "Ask for price" and the bot asks the seller.
    sourcePriceCents: integer("source_price_cents"),
    markupCents: integer("markup_cents").notNull(),
    salePriceCents: integer("sale_price_cents"),
    currency: text("currency").notNull().default("USD"),
    imageIds: uuid("image_ids").array().notNull().default([]),
    // Source (admin-only, never rendered on public pages)
    chatId: text("chat_id").notNull(),
    chatName: text("chat_name"),
    sellerId: text("seller_id").notNull(),
    sellerName: text("seller_name"),
    sourceMessageId: text("source_message_id").notNull(),
    rawText: text("raw_text"),
    // Same seller re-posting the same product updates this row instead
    // of creating a duplicate.
    dedupeKey: text("dedupe_key").notNull(),
    // active | hidden | sold
    status: text("status").notNull().default("active"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("listings_catalog_idx").on(t.status, t.lastSeenAt),
    // One live listing per seller per product. Sold listings are excluded
    // so a seller restocking an item they sold out of starts a new listing.
    uniqueIndex("listings_seller_product_uniq")
      .on(t.sellerId, t.dedupeKey)
      .where(sql`${t.status} <> 'sold'`),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email"),
    fullName: text("full_name"),
    phone: text("phone"),
    shipName: text("ship_name"),
    shipLine1: text("ship_line1"),
    shipLine2: text("ship_line2"),
    shipCity: text("ship_city"),
    shipState: text("ship_state"),
    shipPostalCode: text("ship_postal_code"),
    shipCountry: text("ship_country").default("US"),
    stripeCustomerId: text("stripe_customer_id"),
    paymentMethodId: text("payment_method_id"),
    cardBrand: text("card_brand"),
    cardLast4: text("card_last4"),
    hasPaymentMethod: boolean("has_payment_method").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customers_clerk_idx").on(t.clerkUserId),
    index("customers_stripe_idx").on(t.stripeCustomerId),
  ],
);

export type ShippingAddress = {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string | null;
};

export type PaymentChoice = "saved_card" | "checkout";

export const ORDER_STATUSES = [
  "requested", // buyer asked; waiting on you (manual check, or bot unsure)
  "verifying", // bot DM'd the seller and is waiting for their reply
  "needs_buyer_approval", // seller changed price/quantity; buyer must accept
  "awaiting_payment", // available, but the saved card needs the buyer (3DS / decline)
  "paid", // card charged, buy from the seller and ship
  "shipped",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    quantity: integer("quantity").notNull().default(1),
    // Snapshots taken when the buyer requested, so later edits to the
    // listing never change what they agreed to pay.
    title: text("title").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    sourcePriceCents: integer("source_price_cents").notNull(),
    shipping: jsonb("shipping").$type<ShippingAddress>().notNull(),
    buyerNote: text("buyer_note"),
    // saved_card: charged automatically once confirmed.
    // checkout: buyer pays through a Stripe Checkout link (Apple Pay,
    // Google Pay, Klarna, Afterpay, Affirm, Amazon Pay, Cash App, cards).
    paymentChoice: text("payment_choice").$type<PaymentChoice>().notNull().default("saved_card"),
    status: text("status").$type<OrderStatus>().notNull().default("requested"),
    paymentIntentId: text("payment_intent_id"),
    paymentError: text("payment_error"),
    checkoutUrl: text("checkout_url"),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    adminNote: text("admin_note"),
    // Automatic seller verification
    sellerContact: text("seller_contact"), // phone digits / WhatsApp id the bot DM'd
    verifyAskedAt: timestamp("verify_asked_at", { withTimezone: true }),
    // asked | confirmed | changed | unavailable | needs_review | failed
    verifyStatus: text("verify_status"),
    sellerReply: text("seller_reply"),
    verifySummary: text("verify_summary"),
    proposedUnitPriceCents: integer("proposed_unit_price_cents"),
    proposedQuantity: integer("proposed_quantity"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_seller_contact_idx").on(t.sellerContact, t.status),
    index("orders_customer_idx").on(t.customerId, t.createdAt),
    index("orders_status_idx").on(t.status, t.createdAt),
  ],
);

export type Listing = typeof listings.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Order = typeof orders.$inferSelect;

// Find a Deal alerts: "tell me when a 16 Pro Max 256 is posted under $900".
// Checked against every listing the bot creates or updates (price drops too).
export const wants = pgTable(
  "wants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    query: text("query").notNull(),
    maxPriceCents: integer("max_price_cents"),
    condition: text("condition"),
    // WhatsApp number for alerts (digits); null = see matches on /alerts only
    notifyWhatsapp: text("notify_whatsapp"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wants_user_idx").on(t.clerkUserId)],
);

// One row per (alert, listing) match, so nobody is pinged twice for the same post.
export const wantHits = pgTable(
  "want_hits",
  {
    wantId: uuid("want_id")
      .notNull()
      .references(() => wants.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    notified: boolean("notified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.wantId, t.listingId] })],
);
