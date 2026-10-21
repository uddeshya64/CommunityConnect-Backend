/**
 * AI event extraction service.
 *
 * Turns a voice transcript / chat message into values that match the existing
 * event schema exactly (`utils/eventDraft.ts` -> `CreateEventSchema`), and asks
 * clarification questions for whatever is still missing.
 *
 * Provider strategy
 *  1. If `GEMINI_API_KEY` is configured, the transcript plus the already
 *     collected draft is sent to the Gemini "generateContent" REST endpoint
 *     with a JSON response schema. The API key never leaves the server.
 *  2. Otherwise - or if the provider call fails - the deterministic
 *     `extractEventFromText` extractor is used, so the feature keeps working
 *     offline and stays unit-testable.
 *
 * @file services/aiEvent.service.ts
 */

import axios from "axios";
import {
  buildClarificationQuestions,
  computeMissingFields,
  isDraftComplete,
  mergeDraft,
  normaliseEventType,
  type EventDraftPatch,
  type EventDraftValues,
} from "../utils/eventDraft";
import { extractEventFromText } from "../utils/eventTextExtractor";
import { EVENT_MODES } from "../utils/eventDraft";
import type { ConversationMessage } from "../validation/aiEvent.validation";

export type AiSource = "gemini" | "local";

export interface AiTurnResult {
  /** Assistant message to show in the chat bubble. */
  reply: string;
  /** Newly extracted values (patch), already normalised. */
  extracted: EventDraftPatch;
  /** Full draft after merging the patch into the incoming draft. */
  draft: EventDraftValues;
  /** Clarification questions for still-missing required fields. */
  questions: string[];
  missing_fields: string[];
  complete: boolean;
  source: AiSource;
}

export interface AiTurnInput {
  message: string;
  history?: ConversationMessage[];
  draft?: EventDraftValues;
  knownTypes?: string[];
  /**
   * Minutes to add to local time to reach UTC (browser
   * `new Date().getTimezoneOffset()`), so spoken times such as "10 am" are
   * resolved in the organiser's timezone rather than the server's.
   */
  timeZoneOffsetMinutes?: number;
}

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MAX_ATTEMPTS = 2;
const GEMINI_RETRY_BASE_MS = 500;
const GEMINI_RETRY_MAX_MS = 4000;
const GEMINI_TIMEOUT_MS = 15000;

/**
 * Low-latency thinking settings per model family. Gemini 3 models use
 * `thinkingLevel`, while Gemini 2.5 models use `thinkingBudget`; sending the
 * wrong one is rejected with a 400, which silently dropped every turn onto the
 * local extractor.
 */
function buildThinkingConfig(
  model: string
): Record<string, unknown> | null {
  if (/gemini-3/i.test(model)) return { thinkingLevel: "low" };
  if (/gemini-2\.5/i.test(model)) return { thinkingBudget: 0 };
  return null;
}

function getGeminiConfig(): { apiKey: string; model: string } | null {
  const env = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  const apiKey = env?.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    apiKey,
    model: env?.GEMINI_MODEL?.trim() || "gemini-flash-latest",
  };
}

export function isAiProviderConfigured(): boolean {
  return getGeminiConfig() !== null;
}

function buildSystemInstruction(knownTypes: string[]): string {
  const types = knownTypes.length
    ? knownTypes.join(", ")
    : "Technical Conferences, Hackathons and Competitions, Corporate Events, Exhibitions and Trade Shows, Academic and Training Events, Weddings and Personal Events, Community and Nonprofit Events, Sports and Recreational Events, Government and Civic Events, Hybrid and Virtual Events";

  return [
    "You are the Community Connect AI Event Creation assistant.",
    "From the user's spoken or typed prompt, immediately extract and generate all necessary event details to create a complete, ready-to-publish event draft.",
    "Do NOT ask any clarification questions or ask the user for missing fields. Always fill in sensible, realistic defaults for any fields that the user did not explicitly specify.",
    "Allowed keys and meanings in the event object:",
    'title: Catchy, clear event title (string, max 150 chars).',
    'description: Engaging, rich description explaining the purpose, highlights, target audience, and details of the event (minimum 40 to 80 words, complete sentences). You MUST ALWAYS write this description and never leave it empty.',
    `type: Best matching event category from: ${types}.`,
    'mode: "online", "offline", or "hybrid". If not stated, default to "offline" (or "online" if virtual keywords are mentioned).',
    'start_date: Start date and time in ISO 8601 format. Resolve relative dates like "tomorrow", "this weekend", "next Friday" relative to the current date. If no date is given, default to next Saturday at 10:00 AM.',
    'end_date: End date and time in ISO 8601 format (must be after start_date, default +3 to +4 hours after start_date).',
    'location: Venue name, address, or city. If online, use "Online / Virtual Meet". If not mentioned, infer from context or use "Main Auditorium / Hall".',
    'capacity: Maximum number of attendees (integer, default 100).',
    'registration_type: "solo" or "team" (default "solo").',
    'registration_fee: Entry fee as number (default 0 for free entry).',
    'min_team_size: integer >= 1 (default 1).',
    'max_team_size: integer >= 1 (default 1 for solo, or 4 for team).',
    "In 'reply', give a cheerful, concise 1-2 sentence summary confirming the event has been generated and is ready to review or publish.",
  ].join(" ");
}

/**
 * Intelligent fallback generator that auto-evaluates the event context (title,
 * category, mode, location, prompt) and crafts a rich, high-quality description
 * whenever the AI model is overloaded, rate-limited, or in local mode.
 */
export function evaluateAndGenerateDescription(params: {
  title?: string;
  type?: string;
  mode?: string;
  location?: string;
  prompt?: string;
}): string {
  const title = (params.title || "Special Event").trim();
  const category = (params.type || "").trim();
  const mode = (params.mode || "offline").toLowerCase();
  const location = (params.location || "").trim();
  const prompt = (params.prompt || "").trim();

  const venueInfo =
    mode === "online"
      ? "hosted live online with interactive sessions"
      : location
      ? `taking place in person at ${location}`
      : "taking place in person at our designated venue";

  const lowerCat = category.toLowerCase();
  const lowerPrompt = prompt.toLowerCase();

  if (
    lowerCat.includes("hackathon") ||
    lowerPrompt.includes("hackathon") ||
    lowerPrompt.includes("coding") ||
    lowerPrompt.includes("codeathon") ||
    lowerPrompt.includes("ideathon")
  ) {
    return `Get ready for ${title}! Join passionate developers, designers, and innovators for an intensive, high-energy building sprint. Participants will collaborate in teams to brainstorm groundbreaking ideas, build functional prototypes, and pitch impactful solutions. Whether you are an experienced hacker or developing your very first product, you will find hands-on mentorship, peer learning, and exciting opportunities for awards and recognition.`;
  }

  if (
    lowerCat.includes("conference") ||
    lowerPrompt.includes("conference") ||
    lowerPrompt.includes("summit") ||
    lowerPrompt.includes("symposium") ||
    lowerPrompt.includes("tech talk")
  ) {
    return `Welcome to ${title}, a premier gathering ${venueInfo} designed to unite industry professionals, creators, and technology leaders. Immerse yourself in insightful keynote discussions, forward-looking deep dives, and meaningful peer networking. Attendees will gain actionable insights, innovative perspectives, and valuable connections to accelerate their journey.`;
  }

  if (
    lowerCat.includes("training") ||
    lowerCat.includes("academic") ||
    lowerPrompt.includes("workshop") ||
    lowerPrompt.includes("masterclass") ||
    lowerPrompt.includes("bootcamp") ||
    lowerPrompt.includes("seminar") ||
    lowerPrompt.includes("training") ||
    lowerPrompt.includes("course")
  ) {
    return `Elevate your skillset with ${title}! This comprehensive, hands-on workshop is crafted to deliver practical understanding and direct application. Guided by experienced mentors, attendees will explore core principles, learn real-world techniques, and take part in interactive exercises designed to level up their capabilities.`;
  }

  if (
    lowerCat.includes("corporate") ||
    lowerPrompt.includes("corporate") ||
    lowerPrompt.includes("annual day") ||
    lowerPrompt.includes("offsite") ||
    lowerPrompt.includes("townhall")
  ) {
    return `Join us for ${title}, a curated gathering focused on strategic alignment, milestone achievements, and team collaboration. This session brings together stakeholders and team members to celebrate collective progress, exchange key insights, and set clear goals for upcoming ventures in an engaging atmosphere.`;
  }

  if (
    lowerCat.includes("community") ||
    lowerCat.includes("nonprofit") ||
    lowerPrompt.includes("charity") ||
    lowerPrompt.includes("donation") ||
    lowerPrompt.includes("volunteer") ||
    lowerPrompt.includes("ngo") ||
    lowerPrompt.includes("drive")
  ) {
    return `Be part of positive change with ${title}! A community-powered gathering bringing volunteers, partners, and supporters together to make a real difference. Connect with dedicated individuals, share impactful moments, and contribute directly towards building a stronger, more supportive community.`;
  }

  if (
    lowerCat.includes("sports") ||
    lowerCat.includes("recreational") ||
    lowerPrompt.includes("cricket") ||
    lowerPrompt.includes("football") ||
    lowerPrompt.includes("tournament") ||
    lowerPrompt.includes("marathon") ||
    lowerPrompt.includes("match")
  ) {
    return `Experience the excitement of ${title}! An energetic sporting gathering celebrating teamwork, fitness, and friendly competition. Whether participating as a competitor or cheering from the sidelines, join us for a day of spirited challenges, athletic achievements, and memorable moments.`;
  }

  if (
    lowerCat.includes("exhibition") ||
    lowerPrompt.includes("expo") ||
    lowerPrompt.includes("trade show") ||
    lowerPrompt.includes("fair")
  ) {
    return `Explore future opportunities at ${title}! A dynamic showcase ${venueInfo} featuring innovative exhibits, interactive demonstrations, and valuable networking with leading brands, creators, and industry pioneers. Discover the latest products and gain firsthand insights into cutting-edge trends.`;
  }

  if (
    lowerCat.includes("wedding") ||
    lowerCat.includes("personal") ||
    lowerPrompt.includes("party") ||
    lowerPrompt.includes("celebration") ||
    lowerPrompt.includes("reception")
  ) {
    return `Join us as we celebrate ${title}! A heartwarming occasion bringing friends, family, and loved ones together to celebrate shared joy, meaningful bonds, and unforgettable memories. Come celebrate this special milestone with warmth, festivities, and great company.`;
  }

  return `Welcome to ${title}, an exciting and engaging event ${venueInfo}! Designed to foster collaboration, learning, and memorable experiences, this gathering offers attendees curated sessions, thought-provoking discussions, and prime networking opportunities. Reserve your spot today to connect with peers and be part of an unforgettable experience.`;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "Short friendly reply confirming the event details created.",
    },
    event: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        type: { type: "string" },
        mode: { type: "string", enum: ["online", "offline", "hybrid"] },
        start_date: { type: "string" },
        end_date: { type: "string" },
        location: { type: "string" },
        capacity: { type: "integer" },
        registration_type: { type: "string", enum: ["solo", "team"] },
        registration_fee: { type: "number" },
        min_team_size: { type: "integer" },
        max_team_size: { type: "integer" },
      },
      required: ["title", "description", "type", "mode"],
    },
  },
  required: ["reply", "event"],
} as const;

function toGeminiHistory(
  history: ConversationMessage[]
): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
  return history
    .filter((entry) => entry.content && entry.content.trim())
    .slice(-10)
    .map((entry) => ({
      role: entry.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: entry.content }],
    }));
}

function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;

  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the first balanced object in the text.
    const start = candidate.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < candidate.length; i += 1) {
      const char = candidate[i];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }

    return null;
  }
}

const NUMERIC_FIELDS = [
  "capacity",
  "registration_fee",
  "min_team_size",
  "max_team_size",
] as const;

/**
 * Facts a provider must not invent. Each one is something a user can immediately
 * contradict ("I never said 150 people"), so it is only accepted when the
 * deterministic extractor found it in the transcript too.
 */
const FACTUAL_FIELDS = [
  "location",
  "capacity",
  "registration_fee",
  "banner_url",
  "logo_url",
] as const;

/** Normalise whatever the model returned into canonical event field values. */
export function normaliseExtraction(
  raw: unknown
): EventDraftPatch {
  if (!raw || typeof raw !== "object") return {};

  const source = raw as Record<string, unknown>;
  const patch: EventDraftPatch = {};

  if (typeof source.title === "string" && source.title.trim()) {
    patch.title = source.title.trim().slice(0, 150);
  }

  if (typeof source.description === "string" && source.description.trim()) {
    patch.description = source.description.trim();
  }

  if (typeof source.type === "string" && source.type.trim()) {
    patch.type = normaliseEventType(source.type);
  }

  if (
    typeof source.mode === "string" &&
    EVENT_MODES.includes(source.mode.toLowerCase() as never)
  ) {
    patch.mode = source.mode.toLowerCase() as EventDraftPatch["mode"];
  }

  for (const field of ["start_date", "end_date"] as const) {
    const value = source[field];
    if (value instanceof Date) {
      patch[field] = value.toISOString();
    } else if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value.trim());
      patch[field] = Number.isNaN(parsed.getTime())
        ? value.trim()
        : parsed.toISOString();
    } else if (typeof value === "number" && Number.isFinite(value)) {
      patch[field] = new Date(value).toISOString();
    }
  }

  if (typeof source.location === "string" && source.location.trim()) {
    patch.location = source.location.trim();
  }

  for (const field of NUMERIC_FIELDS) {
    const value = source[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      (patch as EventDraftValues)[field] = Math.max(0, Math.round(value));
    } else if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/[^\d.-]/g, ""));
      if (Number.isFinite(parsed)) {
        (patch as EventDraftValues)[field] = Math.max(0, Math.round(parsed));
      }
    }
  }

  if (
    typeof source.registration_type === "string" &&
    source.registration_type.trim()
  ) {
    const value = source.registration_type.trim().toLowerCase();
    patch.registration_type = value === "team" ? "team" : "solo";
  }

  // A team needs coherent min/max sizes.
  if (patch.registration_type === "team" || patch.max_team_size !== undefined) {
    const max = Number(patch.max_team_size ?? 0);
    const min = Number(patch.min_team_size ?? 0);
    if (max > 0) {
      patch.max_team_size = max;
      patch.min_team_size = min > 0 && min <= max ? min : 1;
    }
  }

  // End must be after start.
  if (patch.start_date && patch.end_date) {
    const start = new Date(patch.start_date).getTime();
    const end = new Date(patch.end_date).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
      patch.end_date = new Date(start + 3 * 60 * 60 * 1000).toISOString();
    }
  }

  return patch;
}

async function callGemini(
  input: AiTurnInput,
  draft: EventDraftValues
): Promise<{ reply: string; patch: EventDraftPatch } | null> {
  const gemini = getGeminiConfig();
  if (!gemini) return null;

  const offset = input.timeZoneOffsetMinutes ?? new Date().getTimezoneOffset();
  const offsetLabel = `${offset <= 0 ? "+" : "-"}${Math.abs(
    Math.trunc(offset / 60)
  )}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;

  const contents = [
    ...toGeminiHistory(input.history || []),
    {
      role: "user" as const,
      parts: [
        {
          text: [
            `Current date/time: ${new Date().toISOString()}`,
            `Organiser UTC offset: ${offsetLabel} (resolve spoken times in this offset)`,
            `Already collected: ${JSON.stringify(draft)}`,
            `User says: ${input.message}`,
          ].join("\n"),
        },
      ],
    },
  ];

  const url = `${GEMINI_BASE_URL}/${gemini.model}:generateContent?key=${gemini.apiKey}`;
  const generationConfig: Record<string, unknown> = {
    temperature: 0.2,
    responseMimeType: "application/json",
    responseSchema: RESPONSE_SCHEMA,
  };
  const thinkingConfig = buildThinkingConfig(gemini.model);
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }

  const payload = {
    system_instruction: { parts: [{ text: buildSystemInstruction(input.knownTypes || []) }] },
    contents,
    generationConfig,
  };

  // The flash endpoint returns 429/503 under load. Retrying with backoff keeps a
  // transient blip from dropping the whole turn onto the local extractor.
  let lastError: unknown;
  for (let attempt = 0; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await axios.post(url, payload, { timeout: GEMINI_TIMEOUT_MS });

      const candidateText =
        response.data?.candidates?.[0]?.content?.parts
          ?.map((part: { text?: string }) => part.text || "")
          .join("") || "";

      const parsed = extractJson(candidateText);
      if (!parsed) return null;

      return {
        reply: typeof parsed.reply === "string" ? parsed.reply : "",
        patch: normaliseExtraction(parsed.event),
      };
    } catch (error: any) {
      lastError = error;
      const status = error?.response?.status;

      // 400/401/403/404 mean the request itself is wrong (bad key, retired model,
      // bad schema); retrying cannot help, so fail fast and let the caller report it.
      const retryable =
        status === 429 || status === 503 || status === 500 || status === 502 || !status;
      if (!retryable || attempt === GEMINI_MAX_ATTEMPTS) break;

      const retryAfter = Number(error?.response?.headers?.["retry-after"]);
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, GEMINI_RETRY_MAX_MS)
        : Math.min(GEMINI_RETRY_BASE_MS * 2 ** attempt, GEMINI_RETRY_MAX_MS);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export class AiEventService {
  /**
   * Process one conversation turn: extract event fields from `message`,
   * merge them into the running draft without asking clarification questions.
   */
  static async converse(input: AiTurnInput): Promise<AiTurnResult> {
    const incomingDraft: EventDraftValues = { ...(input.draft || {}) };
    const message = (input.message || "").trim();

    let patch: EventDraftPatch = {};
    let reply = "";
    let source: AiSource = "local";
    let providerError = "";

    try {
      const geminiResult = await callGemini(input, incomingDraft);
      if (geminiResult) {
        patch = geminiResult.patch;
        reply = geminiResult.reply;
        source = "gemini";
      }
    } catch (error: any) {
      const status = error?.response?.status;
      providerError = status
        ? `HTTP ${status}${error?.message ? ` ${error.message}` : ""}`
        : error?.message || String(error);

      console.warn(
        "[AI_EVENT] provider call failed, using local extractor:",
        providerError
      );
    }

    // The deterministic extractor always runs to fill gaps
    const localPatch = extractEventFromText(message, {
      timeZoneOffsetMinutes: input.timeZoneOffsetMinutes,
    });

    // Structured facts the user actually said out loud outrank a provider guess: the
    // regexes only fire on words present in the transcript, while the provider filed
    // a Diwali celebration under "Weddings and Personal Events". Title and
    // description are excluded because the provider writes far better copy than a
    // regex can.
    const localFacts: EventDraftPatch = { ...localPatch };
    delete localFacts.title;
    delete localFacts.description;
    patch = normaliseExtraction({ ...patch, ...localFacts });

    // The provider may only contribute these when the transcript mentions them.
    // Otherwise it invents a plausible venue or headcount, which surfaces as "the AI
    // filled the wrong capacity" instead of simply asking.
    for (const key of FACTUAL_FIELDS) {
      if (localPatch[key] === undefined || localPatch[key] === null) {
        delete patch[key];
      }
    }

    // Ensure title is present
    if (!patch.title && localPatch.title) {
      patch.title = localPatch.title;
    }

    // Always auto-evaluate and fill a rich, relevant description for the event
    if (!patch.description || patch.description.trim().length < 20) {
      patch.description = evaluateAndGenerateDescription({
        title: patch.title || localPatch.title || "Special Event",
        type: patch.type || localPatch.type,
        mode: patch.mode || localPatch.mode,
        location: patch.location || localPatch.location,
        prompt: message,
      });
    }

    const merged = mergeDraft(incomingDraft, patch);

    // Only infer what can be read out of what the user actually said. Inventing a
    // date, venue or capacity here produced a confident, fully "complete" event out
    // of a one-line message, which reads as the assistant ignoring the speaker.
    const saysOnline =
      message.toLowerCase().includes("online") ||
      message.toLowerCase().includes("virtual");

    // A solo event has an unambiguous size of 1, but defaulting a *team* event to 1
    // would quietly produce an event that only accepts one person per entry. Leave
    // it unset instead so the assistant asks.
    const registrationType = merged.registration_type || "solo";
    const defaultTeamSize = registrationType === "solo" ? 1 : undefined;

    const inferredDraft: EventDraftValues = {
      title:
        merged.title ||
        // Never fall back to the raw message: it made the form title read as the
        // user's own sentence. The extractor derives a short title in almost every
        // case, so this is only a last resort.
        "New Event",
      description:
        merged.description && String(merged.description).trim().length >= 20
          ? String(merged.description).trim()
          : evaluateAndGenerateDescription({
              title: typeof merged.title === "string" ? merged.title : "Special Event",
              type: typeof merged.type === "string" ? merged.type : undefined,
              mode: typeof merged.mode === "string" ? merged.mode : (saysOnline ? "online" : "offline"),
              location: (merged.location || localPatch.location || "") as string,
              prompt: message,
            }),
      // Left undefined on purpose. Defaulting to "Technical Conferences" put a
      // confidently wrong category in front of the user; an unknown category is
      // reported as a missing field so the assistant asks instead.
      type: merged.type,
      mode: merged.mode || (saysOnline ? "online" : "offline"),
      registration_type: registrationType,
      registration_fee:
        typeof merged.registration_fee === "number" ? merged.registration_fee : 0,
      min_team_size: merged.min_team_size ?? defaultTeamSize,
      max_team_size: merged.max_team_size ?? defaultTeamSize,
      ...merged,
    };

    // Anything the user never mentioned stays absent so the assistant asks about it
    // instead of quietly guessing.
    const draft: EventDraftValues = mergeDraft(inferredDraft, merged);
    const missingFields = computeMissingFields(draft);
    const questions = buildClarificationQuestions(draft);

    if (!reply) {
      reply =
        source === "local"
          ? `I could not reach the AI service (${providerError || "provider unavailable"}), so I could only pick out details from your exact words.`
          : `I've captured what I could for "${draft.title}".`;
    }

    // Only append clarification questions if not already present in the AI reply
    const newQuestions = questions.filter(
      (q) => !reply.toLowerCase().includes(q.toLowerCase().slice(0, 25))
    );
    if (newQuestions.length > 0 && source === "local") {
      reply = `${reply}\n\n${newQuestions.map((q) => `- ${q}`).join("\n")}`;
    } else if (questions.length === 0 && !reply.toLowerCase().includes("ready")) {
      reply = `${reply} All details are ready for you to review or publish!`;
    }

    return {
      reply,
      extracted: patch,
      draft,
      questions,
      missing_fields: missingFields,
      complete: missingFields.length === 0,
      source,
    };
  }
}
