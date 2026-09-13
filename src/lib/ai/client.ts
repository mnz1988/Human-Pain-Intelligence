import OpenAI from "openai";
import { Agent, fetch } from "undici";

// Swappable AI backend. Today: local LM Studio via AI_BASE_URL. Falls back to
// real OpenAI cloud if AI_BASE_URL is unset.
let client: OpenAI | null = null;

const REQUEST_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes — local models can be slow

export function getAIClient(): OpenAI {
  if (!client) {
    const baseURL = process.env.AI_BASE_URL;
    console.log(`[ai] baseURL=${baseURL ?? "(default OpenAI)"}`);
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || "not-needed-for-lm-studio",
      baseURL,
      timeout: REQUEST_TIMEOUT_MS,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch: fetch as any,
      fetchOptions: {
        // Node's undici fetch has its own ~5min headers timeout independent of
        // the SDK's own timeout above — without this, slow local models trip
        // that first with a confusing "Request timed out" error. The fetch
        // and dispatcher must come from the same undici instance, or the
        // client throws a "Connection error" — hence importing fetch above
        // instead of relying on Node's separate built-in global fetch.
        dispatcher: new Agent({ headersTimeout: REQUEST_TIMEOUT_MS }),
      },
    });
  }
  return client;
}
