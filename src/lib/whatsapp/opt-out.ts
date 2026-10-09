import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, hiddenSellers, listings, waMessages } from "@/db";
import { appUrl, SITE_NAME } from "@/lib/config";
import { notifyAdmin } from "@/lib/notify";
import { contactKey, sendText, type IncomingMessage } from "./whapi";

// Sellers text the bot's number (or post in a group) "opt out" to keep
// their stock off the site, and "opt in" to come back. Short messages only,
// so a sale post that happens to mention "opt out" is never caught.
const OPT_OUT = /^\W*(opt[\s-]*out|stop listing( me)?|remove me|unlist me|unsubscribe)\W*$/i;
const OPT_IN = /^\W*(opt[\s-]*in|list me( again)?)\W*$/i;

export function optCommand(text: string | null | undefined): "out" | "in" | null {
  const t = (text ?? "").trim();
  if (!t || t.length > 40) return null;
  if (OPT_OUT.test(t)) return "out";
  if (OPT_IN.test(t)) return "in";
  return null;
}

/** Both spellings of a seller id ("15551234567" and "15551234567@s.whatsapp.net"). */
const idsFor = (sellerId: string) => [...new Set([sellerId, contactKey(sellerId)])];

/** Hide a seller everywhere on the site. Returns how many live listings came down. */
export async function optOutSeller(sellerId: string, sellerName: string | null): Promise<number> {
  const key = contactKey(sellerId);
  await db
    .insert(hiddenSellers)
    .values({ sellerId: key, sellerName })
    .onConflictDoUpdate({ target: hiddenSellers.sellerId, set: { sellerName: sql`coalesce(${sellerName}, ${hiddenSellers.sellerName})` } });
  const hidden = await db
    .update(listings)
    .set({ status: "hidden", updatedAt: new Date() })
    .where(and(inArray(listings.sellerId, idsFor(sellerId)), eq(listings.status, "active")))
    .returning({ id: listings.id });
  return hidden.length;
}

/** Undo an opt-out: list new posts again and bring back their hidden listings. */
export async function optInSeller(sellerId: string): Promise<number> {
  await db.delete(hiddenSellers).where(inArray(hiddenSellers.sellerId, idsFor(sellerId)));
  const restored = await db
    .update(listings)
    .set({ status: "active", updatedAt: new Date() })
    .where(and(inArray(listings.sellerId, idsFor(sellerId)), eq(listings.status, "hidden")))
    .returning({ id: listings.id });
  return restored.length;
}

export async function isOptedOut(sellerId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: hiddenSellers.sellerId })
    .from(hiddenSellers)
    .where(inArray(hiddenSellers.sellerId, idsFor(sellerId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Handles an "opt out" / "opt in" message from the webhook. Returns true when
 * the message was a command (so it isn't also treated as a stock post).
 */
export async function handleOptCommand(m: IncomingMessage): Promise<boolean> {
  if (m.fromMe) return false;
  const cmd = optCommand(m.text);
  if (!cmd) return false;

  // Record it so a gateway retry doesn't act (and reply) twice.
  const fresh = await db
    .insert(waMessages)
    .values({
      id: m.id,
      chatId: m.chatId,
      chatName: m.chatName,
      senderId: m.senderId,
      senderName: m.senderName,
      type: m.type,
      text: m.text,
      status: "done",
      error: `opt-${cmd}`,
      raw: m.raw,
      sentAt: m.sentAt,
    })
    .onConflictDoNothing()
    .returning({ id: waMessages.id });
  if (!fresh.length) return true;

  const who = m.senderName ?? `+${contactKey(m.senderId)}`;
  // Always answer privately, even when they typed it in a group.
  const to = contactKey(m.senderId);
  if (cmd === "out") {
    const n = await optOutSeller(m.senderId, m.senderName);
    await reply(
      to,
      [
        `✅ You're opted out of ${SITE_NAME}.`,
        `Your posts in the groups won't be listed on ${appUrl("/").replace(/\/$/, "")}${n ? `, and your ${n} current listing${n === 1 ? " was" : "s were"} removed` : ""}.`,
        ``,
        `Changed your mind? Reply *OPT IN* anytime.`,
      ].join("\n"),
    );
    await notifyAdmin(`🚫 ${who} opted out of ${SITE_NAME} (${n} listing${n === 1 ? "" : "s"} removed).`);
  } else {
    const n = await optInSeller(m.senderId);
    await reply(
      to,
      [
        `✅ You're back on ${SITE_NAME}.`,
        `Your posts in the groups will be listed again${n ? `, and ${n} recent listing${n === 1 ? " is" : "s are"} back up` : ""}.`,
        ``,
        `Reply *OPT OUT* anytime to be removed.`,
      ].join("\n"),
    );
    await notifyAdmin(`✅ ${who} opted back in to ${SITE_NAME}.`);
  }
  return true;
}

async function reply(to: string, text: string): Promise<void> {
  if (!process.env.WHAPI_TOKEN) return;
  await sendText(to, text).catch((err) => console.warn("[opt-out] reply", err));
}
