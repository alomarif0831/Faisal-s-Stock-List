import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, like, ne, sql } from "drizzle-orm";
import { db, hiddenSellers, images, listings, waMessages } from "@/db";
import { extractListings, type ExtractedItem } from "@/lib/ai/extract";
import { dedupeKeyFor } from "@/lib/catalog";

export { dedupeKeyFor };
import { allowedGroups, MARKUP_CENTS, PAIRING_WINDOW_MS } from "@/lib/config";
import { timeAgo } from "@/lib/format";
import { handleSellerReplies, hasOpenVerification } from "@/lib/verify";
import { downloadImage, fetchGroupName, isGroupChat, type IncomingMessage } from "./whapi";

// Sellers usually post a burst: a few photos, then the price text (or the
// other way round). Each message waits this long; if the same seller posts
// again in the meantime, the newer message takes over and handles the
// whole burst in one AI call.
export const DEBOUNCE_MS = Number(process.env.WHATSAPP_DEBOUNCE_MS ?? "15000");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function shouldCapture(m: IncomingMessage): boolean {
  if (m.fromMe || !isGroupChat(m.chatId)) return false;
  const allowed = allowedGroups();
  if (allowed.length && !allowed.includes(m.chatId)) return false;
  return Boolean(m.text?.trim() || m.image);
}

/**
 * Group posts are captured for the catalog; direct messages only when the
 * sender is a seller we're waiting on (their answer to "still available?").
 */
export async function shouldRecord(m: IncomingMessage): Promise<boolean> {
  if (isGroupChat(m.chatId)) return shouldCapture(m);
  if (m.fromMe || !(m.text?.trim() || m.image)) return false;
  return hasOpenVerification(m.senderId);
}

const groupNames = new Map<string, string | null>();

/** Store the message. Returns false when we've already seen it (gateway retry). */
export async function recordMessage(m: IncomingMessage): Promise<boolean> {
  if (isGroupChat(m.chatId) && !groupNames.has(m.chatId)) {
    groupNames.set(m.chatId, m.chatName ?? (await fetchGroupName(m.chatId)));
  }
  const inserted = await db
    .insert(waMessages)
    .values({
      id: m.id,
      chatId: m.chatId,
      chatName: groupNames.get(m.chatId) ?? m.chatName,
      senderId: m.senderId,
      senderName: m.senderName,
      type: m.type,
      text: m.text,
      raw: m.raw,
      sentAt: m.sentAt,
    })
    .onConflictDoNothing()
    .returning({ id: waMessages.id });
  if (!inserted.length) return false;

  if (m.image) {
    try {
      const img = await downloadImage(m.image);
      const [row] = await db.insert(images).values(img).returning({ id: images.id });
      await db.update(waMessages).set({ imageId: row.id }).where(eq(waMessages.id, m.id));
    } catch (err) {
      await db
        .update(waMessages)
        .set({ error: `image: ${(err as Error).message}` })
        .where(eq(waMessages.id, m.id));
    }
  }
  return true;
}

/** Called (after the webhook has responded) for each newly stored message. */
export async function processAfterQuietPeriod(messageId: string, waitMs = DEBOUNCE_MS): Promise<void> {
  if (waitMs > 0) await sleep(waitMs);
  const [msg] = await db.select().from(waMessages).where(eq(waMessages.id, messageId));
  if (!msg || msg.status !== "pending") return;
  const group = isGroupChat(msg.chatId);

  // Only the seller's newest message does the work. For group posts that
  // spans every group, so a post cross-posted to all 4 groups becomes one
  // AI call instead of 4 racing ones.
  const [newer] = await db
    .select({ id: waMessages.id })
    .from(waMessages)
    .where(
      and(
        eq(waMessages.senderId, msg.senderId),
        group ? like(waMessages.chatId, "%@g.us") : eq(waMessages.chatId, msg.chatId),
        ne(waMessages.id, msg.id),
        // Compare inside Postgres: timestamps there have microsecond
        // precision, JS Dates only milliseconds.
        sql`(${waMessages.createdAt}, ${waMessages.id}) > (select created_at, id from wa_messages where id = ${msg.id})`,
      ),
    )
    .limit(1);
  if (newer) return; // the newer message will process this burst

  if (group) await processBurst(msg.senderId);
  else await handleSellerReplies(msg.chatId, msg.senderId);
}

const normalizeText = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** Turn every pending group message from one seller (in any group) into listings. */
export async function processBurst(senderId: string): Promise<void> {
  const since = new Date(Date.now() - PAIRING_WINDOW_MS);
  const pending = await db
    .select()
    .from(waMessages)
    .where(
      and(
        like(waMessages.chatId, "%@g.us"),
        eq(waMessages.senderId, senderId),
        eq(waMessages.status, "pending"),
        gte(waMessages.createdAt, since),
      ),
    )
    .orderBy(asc(waMessages.sentAt));
  if (!pending.length) return;

  // Seller opted out of the site: don't list them (and don't pay for an AI call).
  const [optedOut] = await db.select().from(hiddenSellers).where(eq(hiddenSellers.sellerId, senderId));
  if (optedOut) {
    await db.update(waMessages).set({ status: "ignored" }).where(inArray(waMessages.id, pending.map((m) => m.id)));
    return;
  }

  // The same post copied into several groups: read it once.
  const seenText = new Set<string>();
  let texts: string[] = [];
  for (const t of pending.map((m) => m.text?.trim()).filter((t): t is string => Boolean(t))) {
    const key = normalizeText(t);
    if (!seenText.has(key)) {
      seenText.add(key);
      texts.push(t);
    }
  }
  const imageIds = pending.map((m) => m.imageId).filter((id): id is string => Boolean(id));

  // Photos that arrive after their price text was already processed:
  // re-read that text together with the photos. The upsert below updates
  // the listings it created instead of duplicating them.
  if (!texts.length) {
    const [recent] = await db
      .select({ text: waMessages.text })
      .from(waMessages)
      .where(
        and(
          like(waMessages.chatId, "%@g.us"),
          eq(waMessages.senderId, senderId),
          eq(waMessages.status, "done"),
          gte(waMessages.createdAt, since),
          ne(waMessages.text, ""),
        ),
      )
      .orderBy(desc(waMessages.sentAt))
      .limit(1);
    if (recent?.text) texts = [recent.text];
  }

  const ids = pending.map((m) => m.id);
  const imgRows = imageIds.length
    ? await db.select().from(images).where(inArray(images.id, imageIds))
    : [];
  // Keep the order the photos were posted in, and drop byte-identical
  // copies (the same photo cross-posted to several groups).
  const seenImage = new Set<string>();
  const orderedImages = imageIds
    .map((id) => imgRows.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => {
      if (!r) return false;
      const h = sha256(r.data);
      if (seenImage.has(h)) return false;
      seenImage.add(h);
      return true;
    })
    .slice(0, 20);

  // What this seller already has listed, so a repost is matched to its
  // listing even when it's worded differently.
  const existing = await db
    .select({
      id: listings.id,
      title: listings.title,
      condition: listings.condition,
      price: listings.sourcePriceCents,
      lastSeenAt: listings.lastSeenAt,
    })
    .from(listings)
    .where(and(eq(listings.sellerId, senderId), ne(listings.status, "sold")))
    .orderBy(desc(listings.lastSeenAt))
    .limit(60);

  // Free pre-filter: obvious chatter never reaches the AI.
  if (!orderedImages.length && texts.every((t) => isObviousChatter(t, existing.length > 0))) {
    await db.update(waMessages).set({ status: "ignored" }).where(inArray(waMessages.id, ids));
    return;
  }

  try {
    const result = await extractListings({
      text: texts.join("\n\n") || null,
      images: orderedImages.map((r) => ({ mimeType: r.mimeType, data: r.data })),
      existing: existing.map((e) => ({
        id: e.id,
        title: e.title,
        condition: e.condition,
        price: e.price === null ? null : e.price / 100,
        postedAgo: timeAgo(e.lastSeenAt),
      })),
    });
    if (!result.is_sale_post) {
      await db.update(waMessages).set({ status: "ignored" }).where(inArray(waMessages.id, ids));
      return;
    }
    const last = pending[pending.length - 1];
    const existingIds = new Set(existing.map((e) => e.id));
    if (result.sold_listing_ids?.length) {
      // "Sold" from the seller: take it off the storefront. Scoped to this
      // seller's own unsold listings, whatever ids the model returned.
      await db
        .update(listings)
        .set({ status: "sold", updatedAt: new Date() })
        .where(
          and(
            inArray(listings.id, result.sold_listing_ids),
            eq(listings.sellerId, senderId),
            ne(listings.status, "sold"),
          ),
        );
    }
    const touched = new Set<string>();
    for (const item of result.items) {
      // Two items in one post that resolve to the same listing: keep the first.
      const id = await upsertListing(item, {
        chatId: last.chatId,
        chatName: last.chatName,
        sellerId: senderId,
        sellerName: last.senderName,
        sourceMessageId: last.id,
        rawText: texts.join("\n\n"),
        imageIds: item.image_indexes.map((i) => orderedImages[i]?.id).filter(Boolean) as string[],
      }, existingIds, touched);
      touched.add(id);
    }
    await db.update(waMessages).set({ status: "done", error: null }).where(inArray(waMessages.id, ids));
  } catch (err) {
    console.error("[whatsapp] extraction failed", err);
    await db
      .update(waMessages)
      .set({ status: "failed", error: (err as Error).message.slice(0, 500) })
      .where(inArray(waMessages.id, ids));
  }
}

type Source = {
  chatId: string;
  chatName: string | null;
  sellerId: string;
  sellerName: string | null;
  sourceMessageId: string;
  rawText: string;
  imageIds: string[];
};

export function priceFields(unitPrice: number | null) {
  if (unitPrice === null) return { sourcePriceCents: null, markupCents: MARKUP_CENTS, salePriceCents: null };
  const sourcePriceCents = Math.round(unitPrice * 100);
  return {
    sourcePriceCents,
    markupCents: MARKUP_CENTS,
    salePriceCents: sourcePriceCents + MARKUP_CENTS,
  };
}

/** Insert or update one listing; returns its id. */
async function upsertListing(
  item: ExtractedItem,
  src: Source,
  sellersListingIds: Set<string>,
  alreadyTouched: Set<string>,
): Promise<string> {
  const dedupeKey = dedupeKeyFor(item);
  const product = {
    title: item.title,
    brand: item.brand,
    category: item.category,
    model: item.model,
    storage: item.storage,
    color: item.color,
    condition: item.condition,
    details: item.details,
    quantity: item.quantity,
    currency: item.currency,
    ...priceFields(item.unit_price),
  };
  const now = new Date();

  // 1. Claude matched it to one of this seller's existing listings (a
  //    repost, or a follow-up like "$450 shipped" / "price drop 1570").
  const matchId = item.existing_listing_id;
  if (matchId && sellersListingIds.has(matchId) && !alreadyTouched.has(matchId)) {
    const [row] = await db.select().from(listings).where(eq(listings.id, matchId));
    if (row) {
      // A short follow-up carries less detail than the original post, so
      // only overwrite what it actually states. The row keeps its own
      // dedupe key: rewriting it could collide with another listing.
      const keepPrice = item.unit_price === null;
      await db
        .update(listings)
        .set({
          title: product.title || row.title,
          category: product.category,
          model: product.model ?? row.model,
          storage: product.storage ?? row.storage,
          color: product.color ?? row.color,
          condition: product.condition,
          details: product.details ?? row.details,
          quantity: product.quantity,
          sourcePriceCents: keepPrice ? row.sourcePriceCents : product.sourcePriceCents,
          markupCents: keepPrice ? row.markupCents : product.markupCents,
          salePriceCents: keepPrice ? row.salePriceCents : product.salePriceCents,
          imageIds: src.imageIds.length ? src.imageIds : row.imageIds,
          chatId: src.chatId,
          chatName: src.chatName,
          sellerName: src.sellerName,
          sourceMessageId: src.sourceMessageId,
          rawText: mergeText(row.rawText, src.rawText),
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(listings.id, matchId));
      return matchId;
    }
  }

  // 2. Same seller + same product key. The unique index makes this atomic,
  //    so two posts processed at the same moment can't both insert.
  const [row] = await db
    .insert(listings)
    .values({ ...product, ...src, dedupeKey, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [listings.sellerId, listings.dedupeKey],
      targetWhere: sql`${listings.status} <> 'sold'`,
      set: {
        ...product,
        // a repost without a price keeps the price we already have
        ...(item.unit_price === null
          ? {
              sourcePriceCents: sql`${listings.sourcePriceCents}`,
              markupCents: sql`${listings.markupCents}`,
              salePriceCents: sql`${listings.salePriceCents}`,
            }
          : {}),
        details: product.details ?? sql`${listings.details}`,
        // keep the old photos when this post has none
        imageIds: src.imageIds.length ? src.imageIds : sql`${listings.imageIds}`,
        chatId: src.chatId,
        chatName: src.chatName,
        sellerName: src.sellerName,
        sourceMessageId: src.sourceMessageId,
        rawText: src.rawText,
        lastSeenAt: now,
        updatedAt: now,
      },
    })
    .returning({ id: listings.id });
  return row.id;
}

/** Keep the original post and add the follow-up below it (once). */
export function mergeText(previous: string | null, next: string): string {
  if (!previous) return next;
  if (previous.includes(next)) return previous;
  return `${previous}\n\n${next}`.slice(-4000);
}

const BUYING = /^(wtb|want(ing)? to buy|looking for|lf\b|need\b|anyone (have|has|got|selling)|who (has|have|got|buys|is buying|pays|is paying|wants))/i;
const SOLD_WORDS = /\b(sold|gone|no more|out of stock|sold out|pending)\b/i;

/**
 * Text-only messages that can't contain stock for sale, so they're skipped
 * without an AI call: buy requests ("WTB…"), questions with no numbers,
 * and short no-number replies ("take", "ship", "dm me", "bumpp", @mentions).
 * When the sender already has listings, "sold"-type replies still go to
 * the AI so the listing can be taken down.
 */
export function isObviousChatter(text: string, senderHasListings: boolean): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (senderHasListings && SOLD_WORDS.test(t)) return false;
  if (BUYING.test(t)) return true;
  const hasNumber = /\d/.test(t.replace(/@\d+/g, ""));
  if (hasNumber) return false;
  const words = t.split(" ").filter((w) => !w.startsWith("@"));
  if (words.length === 0) return true; // only @mentions
  if (t.endsWith("?")) return true;
  return words.length <= 4;
}
