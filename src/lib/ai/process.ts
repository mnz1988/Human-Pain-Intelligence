import { getAIClient } from "./client";

const CONFIGURED_MODEL = process.env.AI_MODEL; // undefined -> auto-detect from server
let resolvedModel: string | null = null;

async function getModel(): Promise<string> {
  if (CONFIGURED_MODEL) return CONFIGURED_MODEL;
  if (resolvedModel) return resolvedModel;

  if (!process.env.AI_BASE_URL) {
    // Talking to OpenAI's real API with no model specified — don't guess,
    // just use a sane, cheap default rather than whatever models.list() returns.
    resolvedModel = "gpt-4o-mini";
    return resolvedModel;
  }

  const list = await getAIClient().models.list();
  const first = list.data[0];
  if (!first) {
    throw new Error(
      "AI_MODEL is not set and no model is currently loaded/reported by the AI server's /v1/models endpoint"
    );
  }
  console.log(`[ai] auto-detected loaded model: ${first.id}`);
  resolvedModel = first.id;
  return resolvedModel;
}

export interface ProcessedContribution {
  language: string; // ISO 639-1 code, e.g. "en", "fa"
  sanitizedText: string;
  privacyRiskScore: number; // 0-100, higher = more PII risk found before sanitization
  problem: {
    title: string;
    summary: string;
    primaryCategory: string;
    secondaryCategory: string | null;
    urgency: "low" | "medium" | "high";
    perspective: "personal" | "secondhand" | "unclear"; // is the author living this, or reporting on others?
    geographicScope: string | null; // country or region-level only, e.g. "Iran", "Isfahan, Iran" — never a street address, taken only from what the author already wrote
    tags: string[]; // up to 5 short topic tags, lowercase_snake_case
  };
  entities: Array<{
    entityType: string;
    normalizedValue: string;
    confidence: number;
  }>;
}

const SYSTEM_PROMPT = `You process an anonymous, first-person complaint or problem description submitted to a "human pain intelligence" platform. You must do the following:

1. DETECT the language of the input text as an ISO 639-1 code (e.g. "en", "fa", "es").

2. SANITIZE: rewrite the text with all personally identifying information removed or generalized (names, exact locations more specific than country/region, employers, phone numbers, emails, account/case numbers, dates of birth). Keep the substance of the problem intact. Do not add commentary. Keep the sanitized text in the original language.

3. EXTRACT the underlying problem as:
   - a short title and a 1-3 sentence summary, both written in English regardless of the input language, in neutral third person
   - a primary category (single word or short phrase, e.g. "healthcare", "employment", "housing", "consumer_finance", "government_services", "technology", "transportation", "public_safety", "other"), plus an optional secondary category
   - urgency: "low", "medium", or "high" based on how severe/time-critical the situation sounds
   - perspective: "personal" if the author is describing their own direct experience, "secondhand" if they're reporting on someone else's situation, "unclear" if it can't be determined
   - geographicScope: ONLY if the author explicitly names a place in their text, report it at country or region/city level (e.g. "Iran", "Isfahan, Iran"). Never invent a location, never narrow it beyond what the author stated, never include street-level detail. Use null if no location is mentioned.
   - tags: up to 5 short lowercase_snake_case topic tags capturing themes beyond the primary category (e.g. ["curfew", "public_transport", "safety_concern"])

4. IDENTIFY entities mentioned (type one of: product, company, service, location, technology, institution, problem_type) with a normalized value and your confidence (0-1) that the entity is correctly identified. Do not include personally identifying entities (individual people's names) here — this is for organizations/products/places/topics only.

Respond ONLY with JSON matching this exact shape, no markdown fences, no commentary:
{
  "language": string,
  "sanitizedText": string,
  "privacyRiskScore": number,
  "problem": {
    "title": string, "summary": string, "primaryCategory": string, "secondaryCategory": string | null,
    "urgency": "low" | "medium" | "high", "perspective": "personal" | "secondhand" | "unclear",
    "geographicScope": string | null, "tags": string[]
  },
  "entities": [ { "entityType": string, "normalizedValue": string, "confidence": number } ]
}`;

const RESPONSE_SCHEMA = {
  name: "processed_contribution",
  strict: true,
  schema: {
    type: "object",
    properties: {
      language: { type: "string" },
      sanitizedText: { type: "string" },
      privacyRiskScore: { type: "number" },
      problem: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          primaryCategory: { type: "string" },
          secondaryCategory: { type: ["string", "null"] },
          urgency: { type: "string", enum: ["low", "medium", "high"] },
          perspective: { type: "string", enum: ["personal", "secondhand", "unclear"] },
          geographicScope: { type: ["string", "null"] },
          tags: { type: "array", items: { type: "string" } },
        },
        required: [
          "title",
          "summary",
          "primaryCategory",
          "secondaryCategory",
          "urgency",
          "perspective",
          "geographicScope",
          "tags",
        ],
        additionalProperties: false,
      },
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            entityType: { type: "string" },
            normalizedValue: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["entityType", "normalizedValue", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["language", "sanitizedText", "privacyRiskScore", "problem", "entities"],
    additionalProperties: false,
  },
} as const;

export async function processContribution(rawText: string): Promise<ProcessedContribution> {
  const model = await getModel();
  const completion = await getAIClient().chat.completions.create({
    model,
    response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: rawText },
    ],
    temperature: 0.2,
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) {
    console.error("Unexpected AI response shape:", JSON.stringify(completion, null, 2));
    throw new Error(
      `AI returned no usable content. Full response: ${JSON.stringify(completion).slice(0, 500)}`
    );
  }

  let parsed: ProcessedContribution;
  try {
    parsed = JSON.parse(raw) as ProcessedContribution;
  } catch {
    throw new Error(`AI response was not valid JSON. Raw content: ${raw.slice(0, 500)}`);
  }

  if (!parsed.sanitizedText || !parsed.problem?.title || !parsed.language) {
    throw new Error(
      `AI response missing required fields. Parsed: ${JSON.stringify(parsed).slice(0, 500)}`
    );
  }

  return parsed;
}
