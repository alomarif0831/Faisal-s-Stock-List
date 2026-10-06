import Anthropic from "@anthropic-ai/sdk";

// Reading reseller posts is extraction, not deep reasoning, so the default
// is Claude Sonnet 5.5 (half the price of Opus). Override with AI_MODEL,
// e.g. claude-opus-5-5 for maximum accuracy or claude-haiku-4-5 for lowest cost.
export const MODEL = process.env.AI_MODEL ?? "claude-sonnet-5-5";

let _client: Anthropic | null = null;
export function anthropic(): Anthropic {
  _client ??= new Anthropic();
  return _client;
}

type Effort = "low" | "medium" | "high";

/**
 * Model-specific request options. Haiku 4.5 rejects the effort setting and
 * the server-side refusal fallback, so they're only sent to models that
 * support them.
 */
export function modelOptions(effort: Effort) {
  if (MODEL.startsWith("claude-haiku")) return { betas: [] as Anthropic.Beta.AnthropicBeta[], effort: undefined };
  return {
    // If a safety classifier declines, retry on Anthropic's recommended
    // fallback model instead of returning nothing.
    betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[],
    fallbacks: "default" as const,
    effort: (process.env.AI_EFFORT as Effort | undefined) ?? effort,
  };
}
