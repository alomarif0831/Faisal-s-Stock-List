import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CONDITIONS } from "@/lib/catalog";
import { anthropic, MODEL, modelOptions } from "./client";

// Find a Deal: turn what a buyer types ("cheapest 16 pro max for under 900,
// sealed", "a ps5 for my son") into searches our matcher can run.

const QuerySchema = z.object({
  searches: z
    .array(z.string())
    .describe(
      'One to three short search phrases written the way listings are titled: product name + key variant (storage, size), lowercase, no price, no condition, no filler words. Most specific first. e.g. ["iphone 16 pro max 256"], or ["galaxy s25 ultra", "galaxy s24 ultra"] for "latest samsung flagship".',
    ),
  summary: z.string().describe('Short restatement for the buyer, e.g. "iPhone 16 Pro Max 256GB, sealed, up to $900"'),
  max_price: z.number().nullable().describe("Most they will pay per unit in USD, or null if not stated"),
  min_price: z.number().nullable().describe("Lowest price they want, or null"),
  condition: z.enum(CONDITIONS).nullable().describe("Only if the buyer asks for a condition, else null"),
});

export type QueryUnderstanding = z.infer<typeof QuerySchema>;

const SYSTEM = `You help buyers search a catalog of electronics posted by resellers in WhatsApp groups (phones, tablets, laptops, consoles, headphones, watches and more). Turn the buyer's request into structured search filters.

- Searches must use words that appear in listing titles: brand and model names, generation, size, storage. Expand shorthand ("16pm" -> "iphone 16 pro max", "s25u" -> "galaxy s25 ultra", "app2" -> "airpods pro 2", "ps5" stays "ps5").
- When the buyer is vague ("a good iphone", "latest samsung", "gaming console"), give up to three searches for the products in stock that best fit, using the in-stock model list when provided.
- Never put prices or conditions inside searches; put them in max_price/min_price/condition. "Under 900", "900 max", "budget $900" are max_price 900. "New"/"sealed" is "New sealed"; "open box" is "New open box"; "used"/"pre-owned" is "Used".
- If the request is not about buying an item, return the best literal search you can.`;

// Searches repeat a lot ("ps5", "16 pro max"), so remember answers for a while.
const cache = new Map<string, { at: number; value: QueryUnderstanding }>();
const CACHE_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;

/**
 * Ask Claude what the buyer means. Returns null when AI isn't configured or
 * the call fails, so the page can fall back to plain keyword search.
 */
export async function understandQuery(query: string, inStockModels: string[]): Promise<QueryUnderstanding | null> {
  const q = query.trim().slice(0, 200);
  if (!q || !process.env.ANTHROPIC_API_KEY) return null;
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  try {
    const { effort, ...routing } = modelOptions("low");
    const response = await anthropic().beta.messages.parse(
      {
        model: MODEL,
        max_tokens: 1024,
        ...routing,
        output_config: { ...(effort ? { effort } : {}), format: betaZodOutputFormat(QuerySchema) },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              ...(inStockModels.length
                ? [{ type: "text" as const, text: `Models in stock right now:\n${inStockModels.slice(0, 400).join("\n")}` }]
                : []),
              { type: "text" as const, text: `Buyer's request: ${q}` },
            ],
          },
        ],
      },
      { timeout: 15_000, maxRetries: 1 },
    );
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    const value = clean(response.parsed_output);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.warn("[find] AI query understanding failed", err);
    return null;
  }
}

function clean(u: QueryUnderstanding): QueryUnderstanding {
  const price = (n: number | null) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);
  return {
    searches: [...new Set(u.searches.map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 3),
    summary: u.summary.trim().slice(0, 140),
    max_price: price(u.max_price),
    min_price: price(u.min_price),
    condition: u.condition === "Unknown" ? null : u.condition,
  };
}
