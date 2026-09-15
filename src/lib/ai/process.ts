import { getAIClient } from "./client";

let resolvedModel: string | null = null;

async function getModel(): Promise<string> {
  // Read lazily, not at module-import time — see the comment in embed.ts for why.
  const configuredModel = process.env.AI_MODEL;
  if (configuredModel) return configuredModel;
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
    perspective: "personal" | "secondhand" | "unclear";
    geographicScope: string | null;
    tags: string[];
    // --- Phase 1 additions ---
    scale: "individual" | "group" | "mass" | "unclear"; // how many people the text itself suggests are affected
    durationPattern: "one_time" | "recurring" | "ongoing_chronic" | "unclear";
    genderSpecificTopic: boolean; // is the PROBLEM ITSELF about a gender-specific issue (not a guess about the submitter)
    affectedParty: "self" | "named_other" | "group" | "unclear";
    trend: "worsening" | "improving" | "stable" | "unclear";
    submitterConfidence: "stated_fact" | "inferred_guess" | "uncertain";
    emotions: string[]; // up to 3 short emotion words, e.g. ["frustration", "resignation"]
    tradeoff: { benefit: string; cost: string } | null; // e.g. benefit "flexibility", cost "isolation"
    underlyingNeed: string | null; // hedged hypothesis, not a claimed fact
    actionable: boolean; // could a product/service/policy realistically address this, vs pure venting
    willingnessToPay: boolean; // does the text mention money/cost/paying for a fix
    existingAlternatives: string[]; // named tools/services/workarounds already tried, if any
    impactSeverity: "negligible" | "moderate" | "significant" | "severe";
    descriptionQuality: number; // 0-1, how specific/clear/useful this description is (not length-based)
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
   - geographicScope: ONLY if the author explicitly names a place in their text, report it at country or region/city level. Never invent a location, never narrow it beyond what the author stated, never include street-level detail. Use null if no location is mentioned.
   - tags: up to 5 short lowercase_snake_case topic tags capturing themes beyond the primary category
   - scale: does the text itself suggest this affects just the author ("individual"), a specific group they describe ("group"), or a broad population ("mass")? Use "unclear" if not indicated.
   - durationPattern: "one_time" (a single incident), "recurring" (happens repeatedly), "ongoing_chronic" (a continuous, unresolved state), or "unclear"
   - genderSpecificTopic: true only if the PROBLEM ITSELF inherently concerns a gender-specific issue (e.g. maternity leave, gendered dress-code enforcement, gender-based discrimination). This is about the topic, never a guess about the author's own gender or identity.
   - affectedParty: "self" (author is the one harmed), "named_other" (author describes a specific other person being harmed), "group" (a described group is harmed), or "unclear"
   - trend: "worsening", "improving", "stable", or "unclear" based on whether the author indicates this is getting better, worse, or staying the same
   - submitterConfidence: "stated_fact" if the author speaks with certainty/firsthand knowledge, "inferred_guess" if they hedge ("I think", "probably"), "uncertain" if genuinely ambiguous
   - emotions: up to 3 short single-word emotions clearly present in the text (e.g. "frustration", "fear", "hope", "anger", "resignation"). Empty array if none are clearly expressed.
   - tradeoff: if the author describes a benefit-vs-cost tension (e.g. "remote work gives me flexibility but I feel isolated"), capture it as {benefit, cost} in a few words each. Use null if no such tradeoff is present — do not invent one.
   - underlyingNeed: a SHORT, HEDGED hypothesis about what the author may actually need beyond their stated complaint (e.g. "may need affordable childcare, not just a longer commute"). Phrase it tentatively. Use null if you cannot infer one responsibly from the text.
   - actionable: true if this is the kind of problem a product, service, or policy change could realistically address; false if it's purely personal/emotional with no addressable angle
   - willingnessToPay: true only if the text itself mentions money, cost, or willingness to pay for a solution
   - existingAlternatives: any tools, services, or workarounds the author explicitly says they already tried. Empty array if none mentioned. Never invent these.
   - impactSeverity: "negligible", "moderate", "significant", or "severe" — a rough bucket for how much this affects the author's life, based only on what the text conveys. Never output a specific dollar figure or number you cannot know.
   - descriptionQuality: a score from 0 to 1 for how SPECIFIC, CLEAR, and USEFUL this description is as a representation of the underlying problem — not how long or eloquent it is. A short but concrete, specific account scores higher than a long but vague or repetitive one. Consider: does it give enough detail that someone unfamiliar with the situation could understand what's actually happening and why it matters?

4. IDENTIFY entities mentioned (type one of: product, company, service, location, technology, institution, problem_type) with a normalized value and your confidence (0-1) that the entity is correctly identified. Do not include personally identifying entities (individual people's names) here — this is for organizations/products/places/topics only.

Do not guess or infer the author's own age, income, occupation, education level, immigration status, or other personal demographic attributes anywhere in your response — this is never requested and must never be included.

Respond ONLY with JSON matching the required schema, no markdown fences, no commentary.`;

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
          scale: { type: "string", enum: ["individual", "group", "mass", "unclear"] },
          durationPattern: {
            type: "string",
            enum: ["one_time", "recurring", "ongoing_chronic", "unclear"],
          },
          genderSpecificTopic: { type: "boolean" },
          affectedParty: {
            type: "string",
            enum: ["self", "named_other", "group", "unclear"],
          },
          trend: { type: "string", enum: ["worsening", "improving", "stable", "unclear"] },
          submitterConfidence: {
            type: "string",
            enum: ["stated_fact", "inferred_guess", "uncertain"],
          },
          emotions: { type: "array", items: { type: "string" } },
          tradeoff: {
            type: ["object", "null"],
            properties: {
              benefit: { type: "string" },
              cost: { type: "string" },
            },
            required: ["benefit", "cost"],
            additionalProperties: false,
          },
          underlyingNeed: { type: ["string", "null"] },
          actionable: { type: "boolean" },
          willingnessToPay: { type: "boolean" },
          existingAlternatives: { type: "array", items: { type: "string" } },
          impactSeverity: {
            type: "string",
            enum: ["negligible", "moderate", "significant", "severe"],
          },
          descriptionQuality: { type: "number" },
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
          "scale",
          "durationPattern",
          "genderSpecificTopic",
          "affectedParty",
          "trend",
          "submitterConfidence",
          "emotions",
          "tradeoff",
          "underlyingNeed",
          "actionable",
          "willingnessToPay",
          "existingAlternatives",
          "impactSeverity",
          "descriptionQuality",
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

  // Qwen3-family models support a documented "/no_think" directive that skips
  // their chain-of-thought reasoning pass — a large speed win for this
  // extraction task, which doesn't need deep reasoning. Not all reasoning
  // models support this (e.g. DeepSeek-R1-distill always reasons), so this
  // only applies when the model name indicates Qwen3.
  const isQwen3 = /qwen3/i.test(model);
  const userContent = isQwen3 ? `${rawText}\n/no_think` : rawText;
  if (isQwen3) {
    console.log("[ai] Qwen3 model detected — appending /no_think to disable extended reasoning");
  }

  const requestBody = {
    model,
    response_format: { type: "json_schema" as const, json_schema: RESPONSE_SCHEMA },
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: userContent },
    ],
    temperature: 0.2,
    // Best-effort: some local serving backends (recent llama.cpp/vLLM builds)
    // read this nested field to disable Qwen3 thinking mode directly, without
    // relying on the /no_think text convention. Harmless if unsupported.
    ...(isQwen3 ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completion = await getAIClient().chat.completions.create(requestBody as any);

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
