import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.AI_MODEL ?? "claude-opus-5-5";

let _client: Anthropic | null = null;
export function anthropic(): Anthropic {
  _client ??= new Anthropic();
  return _client;
}
