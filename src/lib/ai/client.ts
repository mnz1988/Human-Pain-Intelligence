import OpenAI from "openai";

// Swappable AI backend. Today: local LM Studio via AI_BASE_URL. Falls back to
// real OpenAI cloud if AI_BASE_URL is unset.
let client: OpenAI | null = null;

export function getAIClient(): OpenAI {
  if (!client) {
    const baseURL = process.env.AI_BASE_URL;
    console.log(`[ai] baseURL=${baseURL ?? "(default OpenAI)"}`);
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || "not-needed-for-lm-studio",
      baseURL,
    });
  }
  return client;
}
