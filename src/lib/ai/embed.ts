import { getAIClient } from "./client";

/**
 * Generates an embedding vector for the given text. Returns null (rather than
 * throwing) if EMBEDDING_MODEL isn't configured, so clustering degrades
 * gracefully to "always create a new cluster" instead of breaking processing.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  // Read lazily, not at module-import time: ES module imports are hoisted and
  // execute before the importing file's own top-level code (like
  // dotenv.config() in worker/index.ts) runs, so a module-level const here
  // could capture undefined even when the .env file is correct.
  const embeddingModel = process.env.EMBEDDING_MODEL;

  if (!embeddingModel) {
    console.warn("[ai] EMBEDDING_MODEL not set — skipping embedding, clustering will be disabled");
    return null;
  }

  const res = await getAIClient().embeddings.create({
    model: embeddingModel,
    input: text,
  });

  const embedding = res.data[0]?.embedding;
  if (!embedding) {
    throw new Error("Embedding response contained no data");
  }
  return embedding;
}
