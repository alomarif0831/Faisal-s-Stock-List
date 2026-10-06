import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { anthropic, MODEL } from "./client";

const ResultSchema = z.object({
  ask_index: z.number().int().describe("Which question (0-based) this answer is about"),
  outcome: z
    .enum(["available", "changed", "unavailable", "unclear"])
    .describe(
      "available = still available with nothing changed; changed = available but price, quantity, or condition changed; unavailable = sold/gone; unclear = can't tell yet",
    ),
  unit_price: z.number().nullable().describe("New per-unit price if the seller stated one, else null"),
  quantity_available: z.number().int().nullable().describe("Units the seller says they have now, else null"),
  notes: z.string().nullable().describe("Other changes the buyer should know (condition, color, delay), else null"),
  summary: z.string().describe("One short sentence for the store owner describing the seller's answer"),
});

const ReplySchema = z.object({ results: z.array(ResultSchema) });
export type SellerAnswer = z.infer<typeof ResultSchema>;

export type OpenAsk = {
  title: string;
  quantity: number;
  unitPrice: number | null;
  originalMessage: string | null;
};

const SYSTEM = `You help an electronics reseller. Our WhatsApp bot asked a supplier whether items they advertised are still available. Read the supplier's reply and report, for each question, what they said.

- "yes", "available", "still have", a thumbs-up, or an OK-type reply with no other details = available.
- A new price or a lower quantity, or a different condition/color = changed (fill unit_price / quantity_available / notes).
- "sold", "gone", "no more", "out" = unavailable.
- If the reply doesn't answer the question (greeting only, "let me check", a question back), the outcome is unclear.
- When there are several questions and the reply doesn't say which item it means, apply it to all of them only if it clearly covers everything ("all available"); otherwise unclear.
- Prices are per unit in USD unless stated. Never invent numbers.
Return one result per question.`;

export async function readSellerReply(asks: OpenAsk[], reply: string): Promise<SellerAnswer[]> {
  const questions = asks
    .map(
      (a, i) =>
        (a.unitPrice === null
          ? `Question ${i}: Is "${a.title}" still available (${a.quantity} unit(s)), and what is the price per unit? A stated price here is outcome "changed" with unit_price set.`
          : `Question ${i}: Is "${a.title}" still available, ${a.quantity} unit(s) at $${a.unitPrice} each?`) +
        (a.originalMessage ? `\nTheir original post: ${a.originalMessage}` : ""),
    )
    .join("\n\n");

  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(ReplySchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: `${questions}\n\nSupplier's reply:\n${reply}` }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error(`Could not read seller reply (stop_reason=${response.stop_reason})`);
  }
  return response.parsed_output.results.filter((r) => r.ask_index >= 0 && r.ask_index < asks.length);
}
