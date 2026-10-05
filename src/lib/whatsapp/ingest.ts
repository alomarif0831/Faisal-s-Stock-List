import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db, images, listings, waMessages } from "@/db";
import { extractListings, type ExtractedItem } from "@/lib/ai/extract";
import { normalizeKey } from "@/lib/catalog";
import { allowedGroups, MARKUP_CENTS, PAIRING_WINDOW_MS } from "@/lib/config";
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

  const [newer] = await db
    .select({ id: waMessages.id })
    .from(waMessages)
    .where(
      and(
        eq(waMessages.chatId, msg.chatId),
        eq(waMessages.senderId, msg.senderId),
        ne(waMessages.id, msg.id),
        // Compare inside Postgres: timestamps there have microsecond
        // precision, JS Dates only milliseconds.
        sql`(${waMessages.createdAt}, ${waMessages.id}) > (select created_at, id from wa_messages where id = ${msg.id})`,
      ),
    )
    .limit(1);
  if (newer) return; // the newer message will process this burst

  if (isGroupChat(msg.chatId)) await processBurst(msg.chatId, msg.senderId);
  else await handleSellerReplies(msg.chatId, msg.senderId);
}

/** Turn every pending message from one seller in one group into listings. */
export async function processBurst(chatId: string, senderId: string): Promise<void> {
  const since = new Date(Date.now() - PAIRING_WINDOW_MS);
  const pending = await db
    .select()
    .from(waMessages)
    .where(
      and(
        eq(waMessages.chatId, chatId),
        eq(waMessages.senderId, senderId),
        eq(waMessages.status, "pending"),
        gte(waMessages.createdAt, since),
      ),
    )
    .orderBy(asc(waMessages.sentAt));
  if (!pending.length) return;

  let texts = pending.map((m) => m.text?.trim()).filter((t): t is string => Boolean(t));
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
          eq(waMessages.chatId, chatId),
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
  // keep the order the photos were posted in
  const orderedImages = imageIds
    .map((id) => imgRows.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .slice(0, 20);

  try {
    const result = await extractListings({
      text: texts.join("\n\n") || null,
      images: orderedImages.map((r) => ({ mimeType: r.mimeType, data: r.data })),
    });
    if (!result.is_sale_post) {
      await db.update(waMessages).set({ status: "ignored" }).where(inArray(waMessages.id, ids));
      return;
    }
    const last = pending[pending.length - 1];
    for (const item of result.items) {
      await upsertListing(item, {
        chatId,
        chatName: last.chatName,
        sellerId: senderId,
        sellerName: last.senderName,
        sourceMessageId: last.id,
        rawText: texts.join("\n\n"),
        imageIds: item.image_indexes.map((i) => orderedImages[i]?.id).filter(Boolean) as string[],
      });
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

export function dedupeKeyFor(item: ExtractedItem): string {
  return normalizeKey(item.brand, item.model ?? item.title, item.storage, item.color, item.condition);
}

export function priceFields(unitPrice: number) {
  const sourcePriceCents = Math.round(unitPrice * 100);
  return {
    sourcePriceCents,
    markupCents: MARKUP_CENTS,
    salePriceCents: sourcePriceCents + MARKUP_CENTS,
  };
}

async function upsertListing(item: ExtractedItem, src: Source): Promise<void> {
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

  const [existing] = await db
    .select({ id: listings.id, imageIds: listings.imageIds })
    .from(listings)
    .where(
      and(
        eq(listings.sellerId, src.sellerId),
        eq(listings.dedupeKey, dedupeKey),
        ne(listings.status, "sold"),
      ),
    )
    .orderBy(desc(listings.lastSeenAt))
    .limit(1);

  if (existing) {
    await db
      .update(listings)
      .set({
        ...product,
        imageIds: src.imageIds.length ? src.imageIds : existing.imageIds,
        chatId: src.chatId,
        chatName: src.chatName,
        sellerName: src.sellerName,
        sourceMessageId: src.sourceMessageId,
        rawText: src.rawText,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(listings.id, existing.id));
    return;
  }

  await db.insert(listings).values({ ...product, ...src, dedupeKey, lastSeenAt: now });
}
