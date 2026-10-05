import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { BRANDS, CATEGORIES, CONDITIONS } from "@/lib/catalog";
import { anthropic, MODEL } from "./client";

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
  unit_price: z.number().describe("Seller's asking price for ONE unit, in the stated currency"),
  currency: z.string().describe('ISO code, "USD" unless another currency is clearly stated'),
  image_indexes: z
    .array(z.number().int())
    .describe("0-based indexes of the attached images that show THIS item; empty if none"),
});

const ExtractionSchema = z.object({
  is_sale_post: z
    .boolean()
    .describe("true only if the seller is offering items for sale with a price"),
  items: z.array(ItemSchema),
});

export type ExtractedItem = z.infer<typeof ItemSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM = `You read messages posted in WhatsApp groups where electronics resellers (Apple, Samsung, and other brands) advertise stock they have for sale. Turn each message into structured listings for a storefront.

Rules:
- Only items the sender is SELLING, with a price next to them. Skip items with no price.
- Not a sale post (chatter, questions, "WTB"/"looking for"/"need", price requests, sold/out-of-stock notices): set is_sale_post=false and return no items.
- A single message can list many items, often one per line ("15 Pro 256 blue 720"). Make one item per distinct product/variant/price.
- Resellers abbreviate heavily: "15PM" = iPhone 15 Pro Max, "S24U" = Galaxy S24 Ultra, "AW" = Apple Watch, "APP2" = AirPods Pro 2, "NIB"/"sealed" = New sealed, "OB" = New open box, "CPO" = Refurbished, "A stock"/"grade A" = Used (put the grade in details).
- Prices: a bare number next to an item is the per-unit USD price. With tiered prices ("1pc 700 / 10pcs 680") use the single-unit price. With "x5 @ 650" quantity is 5 and unit_price is 650. Never invent a price.
- Use the images to confirm the model, color, condition, and quantity when the text is vague, and to map photos to items. If there is no text at all, only list items whose price is visible in the image.
- Title: brand-recognizable product name + key variant, no price, no emojis.`;

export type ExtractInput = {
  text: string | null;
  images: { mimeType: string; data: Buffer }[];
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
  content.push({
    type: "text",
    text: input.text?.trim()
      ? `Message text:\n${input.text.trim()}`
      : "The message has no text, only the images above.",
  });

  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // If a safety classifier declines, let the API retry on its
    // recommended fallback model instead of returning nothing.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(ExtractionSchema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Model declined to process this message");
  }
  if (!response.parsed_output) {
    throw new Error(`Could not parse model output (stop_reason=${response.stop_reason})`);
  }
  return sanitize(response.parsed_output, input.images.length);
}

// Structured outputs guarantee the shape, not the business sense.
export function sanitize(result: Extraction, imageCount: number): Extraction {
  if (!result.is_sale_post) return { is_sale_post: false, items: [] };
  const items = result.items
    .filter((it) => Number.isFinite(it.unit_price) && it.unit_price > 0 && it.title.trim())
    .map((it) => ({
      ...it,
      title: it.title.trim(),
      quantity: Math.max(1, Math.round(it.quantity || 1)),
      currency: (it.currency || "USD").toUpperCase().slice(0, 3),
      image_indexes: [...new Set(it.image_indexes)].filter((i) => i >= 0 && i < imageCount),
    }));
  // A single item with photos but no explicit mapping gets all of them.
  if (items.length === 1 && items[0].image_indexes.length === 0 && imageCount > 0) {
    items[0].image_indexes = Array.from({ length: imageCount }, (_, i) => i);
  }
  return { is_sale_post: items.length > 0, items };
}
