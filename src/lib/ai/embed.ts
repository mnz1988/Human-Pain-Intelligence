import { getAIClient } from "./client";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;

/**
 * Generates an embedding vector for the given text. Returns null (rather than
 * throwing) if EMBEDDING_MODEL isn't configured, so clustering degrades
 * gracefully to "always create a new cluster" instead of breaking processing.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!EMBEDDING_MODEL) {
    console.warn("[ai] EMBEDDING_MODEL not set — skipping embedding, clustering will be disabled");
    return null;
  }

  const res = await getAIClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  const embedding = res.data[0]?.embedding;
  if (!embedding) {
    throw new Error("Embedding response contained no data");
  }
  return embedding;
}
