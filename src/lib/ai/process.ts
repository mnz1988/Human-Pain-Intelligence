import OpenAI from "openai";

// Swappable AI backend. Today: OpenAI cloud. Later: point baseURL at LM Studio
// (e.g. http://localhost:1234/v1) via env vars, no call-site changes needed.
let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.AI_BASE_URL, // undefined -> OpenAI's default
    });
  }
  return client;
}

const MODEL = process.env.AI_MODEL ?? "gpt-4o-mini";

export interface ProcessedContribution {
  sanitizedText: string;
  privacyRiskScore: number; // 0-100, higher = more PII risk found before sanitization
  problem: {
    title: string;
    summary: string;
    primaryCategory: string;
    secondaryCategory: string | null;
  };
  entities: Array<{
    entityType: string;
    normalizedValue: string;
    confidence: number;
  }>;
}

const SYSTEM_PROMPT = `You process an anonymous, first-person complaint or problem description submitted to a "human pain intelligence" platform. You must do three things:

1. SANITIZE: rewrite the text with all personally identifying information removed or generalized (names, exact locations more specific than country/region, employers, phone numbers, emails, account/case numbers, dates of birth). Keep the substance of the problem intact. Do not add commentary.

2. EXTRACT the underlying problem as a short title, a 1-3 sentence summary written in neutral third person, and a primary category (single word or short phrase, e.g. "healthcare", "employment", "housing", "consumer_finance", "government_services", "technology", "other"), plus an optional secondary category.

3. IDENTIFY entities mentioned (type one of: product, company, service, location, technology, institution, problem_type) with a normalized value and your confidence (0-1) that the entity is correctly identified. Do not include personally identifying entities (individual people's names) here — this is for organizations/products/places/topics only.

Respond ONLY with JSON matching this exact shape, no markdown fences, no commentary:
{
  "sanitizedText": string,
  "privacyRiskScore": number,
  "problem": { "title": string, "summary": string, "primaryCategory": string, "secondaryCategory": string | null },
  "entities": [ { "entityType": string, "normalizedValue": string, "confidence": number } ]
}`;

export async function processContribution(rawText: string): Promise<ProcessedContribution> {
  const completion = await getClient().chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: rawText },
    ],
    temperature: 0.2,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("AI returned no content");
  }

  const parsed = JSON.parse(raw) as ProcessedContribution;

  if (!parsed.sanitizedText || !parsed.problem?.title) {
    throw new Error("AI response missing required fields");
  }

  return parsed;
}
