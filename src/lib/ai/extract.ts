import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { BRANDS, CATEGORIES, CONDITIONS } from "@/lib/catalog";
import { anthropic, MODEL, modelOptions } from "./client";

const ItemSchema = z.object({
  title: z.string().describe('Short storefront title, e.g. "iPhone 16 Pro Max 256GB Natural Titanium"'),
  brand: z.enum(BRANDS),
  category: z.enum(CATEGORIES),
  model: z.string().nullable().describe('Model without storage/color, e.g. "iPhone 16 Pro Max"'),
  storage: z.string().nullable().describe('e.g. "256GB", "1TB"; null if not applicable or unknown'),
  color: z.string().nullable(),
  condition: z.enum(CONDITIONS),
  details: z
    .string()
    .nullable()
    .describe("Other buyer-relevant facts: carrier/unlocked, region, battery health, warranty, accessories"),
  quantity: z.number().int().describe("Units available; 1 if not stated"),
  unit_price: z
    .number()
    .nullable()
    .describe('Seller\'s asking price for ONE unit, in the stated currency; null when no price is given ("send offers", "DM for price")'),
  currency: z.string().describe('ISO code, "USD" unless another currency is clearly stated'),
  image_indexes: z
    .array(z.number().int())
    .describe("0-based indexes of the attached images that show THIS item; empty if none"),
  existing_listing_id: z
    .string()
    .nullable()
    .describe("id of the seller's existing listing that is this same product (a repost or price update), else null"),
});

const ExtractionSchema = z.object({
  is_sale_post: z
    .boolean()
    .describe("true if the seller is offering specific items for sale (with or without a price), or updating/marking sold their own listings"),
  items: z.array(ItemSchema),
  sold_listing_ids: z
    .array(z.string())
    .describe("ids of the seller's current listings that this message says are sold / gone / no longer available"),
});

export type ExtractedItem = z.infer<typeof ItemSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM = `You read messages posted in WhatsApp groups where electronics resellers (Apple, Samsung, and other brands) advertise stock they have for sale. Turn each message into structured listings for a storefront.

Rules:
- Capture every specific item the sender is SELLING ("WTS", "have", "available", a stock list), with or without a price. If they say "send offers", "DM for price", "best offer" or give no price, set unit_price to null.
- Not a sale post (chatter, questions, "WTB"/"want to buy"/"looking for"/"need"/"who has", someone else's item, "take"/"ship"/"pm me" replies): set is_sale_post=false and return no items.
- A vague post with no specific item ("pm for list", "good stock check it out") has no items, unless the attached image shows the specific items.
- A single message can list many items, often one per line ("15 Pro 256 blue 720"). Make one item per distinct product/variant/price.
- Resellers abbreviate heavily: "15PM" = iPhone 15 Pro Max, "S24U" = Galaxy S24 Ultra, "AW" = Apple Watch, "APP2" = AirPods Pro 2, "NIB"/"sealed" = New sealed, "OB" = New open box, "CPO" = Refurbished, "A stock"/"grade A" = Used (put the grade in details).
- Prices: a bare number next to an item is the per-unit USD price. With tiered prices ("1pc 700 / 10pcs 680") use the single-unit price. With "x5 @ 650" quantity is 5 and unit_price is 650. Never invent a price.
- Use the images to confirm the model, color, condition, and quantity when the text is vague, and to map photos to items. A photo with no text: list the items it clearly shows for sale (e.g. a price list screenshot); a plain product photo with no text yet gives no items.
- Follow-ups about the seller's own current listings (you may be given them):
  - A price for an earlier post ("$450 shipped", "price drop 1570", "now 880"): return that listing as an item with existing_listing_id set and the new unit_price. Only do this when it is clear which listing is meant (e.g. the seller has one recent listing, or the message names it).
  - "Sold", "gone", "no more", "sold out": put the clearly-meant listing ids in sold_listing_ids (empty when unclear) and set is_sale_post=true.
- Title: brand-recognizable product name + key variant, no price, no emojis.
- You may be given the seller's current listings. If an item is the same product as one of them (same model, storage, color and condition, even if worded differently or the price changed), set existing_listing_id to that listing's id and reuse its title. Different storage, color or condition is a different product. Never put the same existing_listing_id on two items.`;

export type ExtractInput = {
  text: string | null;
  images: { mimeType: string; data: Buffer }[];
  /** The seller's current listings (newest first), so reposts, price follow-ups and "sold" map onto them. */
  existing?: { id: string; title: string; condition: string; price: number | null; postedAgo: string }[];
};

export async function extractListings(input: ExtractInput): Promise<Extraction> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  input.images.forEach((img, i) => {
    content.push({ type: "text", text: `Image ${i}:` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
        data: img.data.toString("base64"),
      },
    });
  });
  if (input.existing?.length) {
    content.push({
      type: "text",
      text:
        "This seller's current listings, newest first (id | title | condition | price | last posted):\n" +
        input.existing
          .map((e) => `${e.id} | ${e.title} | ${e.condition} | ${e.price === null ? "no price yet" : `$${e.price}`} | ${e.postedAgo}`)
          .join("\n"),
    });
  }
  content.push({
    type: "text",
    text: input.text?.trim()
      ? `Message text:\n${input.text.trim()}`
      : "The message has no text, only the images above.",
  });

  const { effort, ...routing } = modelOptions("medium");
  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...routing,
    output_config: { ...(effort ? { effort } : {}), format: betaZodOutputFormat(ExtractionSchema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Model declined to process this message");
  }
  if (!response.parsed_output) {
    throw new Error(`Could not parse model output (stop_reason=${response.stop_reason})`);
  }
  return sanitize(response.parsed_output, input.images.length, new Set(input.existing?.map((e) => e.id)));
}

// Structured outputs guarantee the shape, not the business sense.
export function sanitize(result: Extraction, imageCount: number, knownIds?: Set<string>): Extraction {
  const sold = [...new Set(result.sold_listing_ids ?? [])].filter((id) => !knownIds || knownIds.has(id));
  if (!result.is_sale_post) return { is_sale_post: false, items: [], sold_listing_ids: [] };
  const items = result.items
    .filter((it) => it.title.trim())
    .map((it) => ({
      ...it,
      title: it.title.trim(),
      unit_price: typeof it.unit_price === "number" && Number.isFinite(it.unit_price) && it.unit_price > 0 ? it.unit_price : null,
      quantity: Math.max(1, Math.round(it.quantity || 1)),
      currency: (it.currency || "USD").toUpperCase().slice(0, 3),
      image_indexes: [...new Set(it.image_indexes)].filter((i) => i >= 0 && i < imageCount),
      existing_listing_id: it.existing_listing_id ?? null,
    }))
    // an item that is marked sold in the same message isn't also re-listed
    .filter((it) => !(it.existing_listing_id && sold.includes(it.existing_listing_id)));
  // A single item with photos but no explicit mapping gets all of them.
  if (items.length === 1 && items[0].image_indexes.length === 0 && imageCount > 0) {
    items[0].image_indexes = Array.from({ length: imageCount }, (_, i) => i);
  }
  return { is_sale_post: items.length > 0 || sold.length > 0, items, sold_listing_ids: sold };
}
