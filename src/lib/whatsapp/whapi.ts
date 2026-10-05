// Adapter for Whapi.cloud (https://whapi.cloud), a WhatsApp gateway that
// keeps a linked-device session for our number online and POSTs each
// message to our webhook. Vercel functions can't hold that socket open
// themselves, which is why a gateway sits in front.
//
// The parser is deliberately tolerant: anything it can't read is still
// stored raw in wa_messages so nothing is lost.

const API = process.env.WHAPI_API_URL ?? "https://gate.whapi.cloud";

export type IncomingMessage = {
  id: string;
  chatId: string;
  chatName: string | null;
  senderId: string;
  senderName: string | null;
  fromMe: boolean;
  type: string;
  text: string | null;
  image: { id: string | null; link: string | null; mimeType: string } | null;
  sentAt: Date;
  raw: unknown;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function parseWebhook(body: unknown): IncomingMessage[] {
  if (!isObj(body) || !Array.isArray(body.messages)) return [];
  const out: IncomingMessage[] = [];
  for (const m of body.messages) {
    if (!isObj(m)) continue;
    const id = str(m.id);
    const chatId = str(m.chat_id);
    if (!id || !chatId) continue;
    const type = str(m.type) ?? "unknown";

    const media = isObj(m.image) ? m.image : null;
    const text =
      (isObj(m.text) ? str(m.text.body) : null) ??
      (isObj(m.link_preview) ? str(m.link_preview.body) : null) ??
      (media ? str(media.caption) : null) ??
      (isObj(m.document) ? str(m.document.caption) : null);

    const ts = typeof m.timestamp === "number" ? m.timestamp : Number(m.timestamp);
    out.push({
      id,
      chatId,
      chatName: str(m.chat_name),
      senderId: str(m.from) ?? chatId,
      senderName: str(m.from_name),
      fromMe: m.from_me === true,
      type,
      text,
      image: media
        ? { id: str(media.id), link: str(media.link), mimeType: str(media.mime_type) ?? "image/jpeg" }
        : null,
      sentAt: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
      raw: m,
    });
  }
  return out;
}

export function isGroupChat(chatId: string): boolean {
  return chatId.endsWith("@g.us");
}

function token(): string {
  const t = process.env.WHAPI_TOKEN;
  if (!t) throw new Error("WHAPI_TOKEN is not set");
  return t;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function downloadImage(
  image: NonNullable<IncomingMessage["image"]>,
): Promise<{ mimeType: string; data: Buffer }> {
  // Prefer the gateway's media endpoint (authenticated, always available);
  // fall back to the direct link when auto-download is on.
  const url = image.id ? `${API}/media/${encodeURIComponent(image.id)}` : image.link;
  if (!url) throw new Error("Image has neither id nor link");
  const res = await fetch(url, {
    headers: image.id ? { Authorization: `Bearer ${token()}` } : {},
  });
  if (!res.ok) throw new Error(`Media download failed: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_IMAGE_BYTES) throw new Error("Image too large");
  const mimeType = (res.headers.get("content-type") ?? image.mimeType).split(";")[0];
  return { mimeType: mimeType.startsWith("image/") ? mimeType : image.mimeType, data };
}

export async function fetchGroupName(chatId: string): Promise<string | null> {
  try {
    const res = await fetch(`${API}/groups/${encodeURIComponent(chatId)}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) return null;
    const g: unknown = await res.json();
    return isObj(g) ? (str(g.name) ?? str(g.subject)) : null;
  } catch {
    return null;
  }
}

export async function listGroups(): Promise<{ id: string; name: string | null }[]> {
  const res = await fetch(`${API}/groups?count=100`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`Listing groups failed: HTTP ${res.status}`);
  const body: unknown = await res.json();
  const groups = isObj(body) && Array.isArray(body.groups) ? body.groups : [];
  return groups
    .filter(isObj)
    .map((g) => ({ id: str(g.id) ?? "", name: str(g.name) ?? str(g.subject) }))
    .filter((g) => g.id);
}

/** Send a plain text WhatsApp message (used to ping the admin about new orders). */
export async function sendText(to: string, body: string): Promise<void> {
  const res = await fetch(`${API}/messages/text`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: to.replace(/[^\d@.a-z-]/gi, ""), body }),
  });
  if (!res.ok) throw new Error(`Send failed: HTTP ${res.status}`);
}

/** Send a photo (by public URL) with a caption. */
export async function sendImage(to: string, imageUrl: string, caption: string): Promise<void> {
  const res = await fetch(`${API}/messages/image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: to.replace(/[^\d@.a-z-]/gi, ""), media: imageUrl, caption }),
  });
  if (!res.ok) throw new Error(`Send image failed: HTTP ${res.status}`);
}

/**
 * The part of a WhatsApp id that identifies the person, so a seller seen
 * as "15551234567" in a group matches "15551234567@s.whatsapp.net" in a DM.
 */
export function contactKey(id: string): string {
  return id.split("@")[0].split(":")[0];
}
