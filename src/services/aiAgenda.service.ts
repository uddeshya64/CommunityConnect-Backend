import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface GeneratedAgendaSession {
  title: string;
  speaker_name?: string | null;
  description?: string | null;
  tags?: string[];
  start_time: string;
  end_time: string;
  location?: string | null;
}

export interface AiAgendaTurnResult {
  reply: string;
  sessions: GeneratedAgendaSession[];
  source: "gemini" | "local";
}

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_TIMEOUT_MS = 15000;

function getGeminiConfig(): { apiKey: string; model: string } | null {
  const env = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  const apiKey = env?.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = env?.GEMINI_MODEL?.trim() || "gemini-3-flash-preview";

  return {
    apiKey,
    model,
  };
}

function buildThinkingConfig(model: string): Record<string, unknown> | null {
  if (/gemini-3/i.test(model)) return { thinkingLevel: "low" };
  if (/gemini-2\.5/i.test(model)) return { thinkingBudget: 0 };
  return null;
}

function parseToLocalDatetimeString(
  val: any,
  fallbackDateYMD: string,
  defaultHour: number = 10,
  defaultMinute: number = 0
): string {
  const pad = (n: number | string) => String(n).padStart(2, "0");
  const fallback = `${fallbackDateYMD}T${pad(defaultHour)}:${pad(defaultMinute)}:00`;

  if (!val) return fallback;
  const str = String(val).trim();
  if (!str || str === "null" || str === "undefined") return fallback;

  // Format with date and time: YYYY-MM-DD[T/ ]HH:mm
  const dtMatch = str.match(/(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dtMatch) {
    return `${dtMatch[1]}T${pad(dtMatch[2])}:${pad(dtMatch[3])}:00`;
  }

  // Format with time only: 24-hr (e.g. "19:00", "19:30:00") or 12-hr ("7:00 PM", "7 PM")
  const timeOnly = str.match(/(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeOnly) {
    let h = parseInt(timeOnly[1], 10);
    const m = timeOnly[2] ? parseInt(timeOnly[2], 10) : 0;
    const meridiem = (timeOnly[4] || "").toLowerCase();
    if (meridiem === "pm" && h < 12) h += 12;
    if (meridiem === "am" && h === 12) h = 0;
    return `${fallbackDateYMD}T${pad(h)}:${pad(m)}:00`;
  }

  return fallback;
}

const AGENDA_JSON_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: {
      type: "STRING",
      description: "A friendly, upbeat 1-2 sentence assistant message summarizing the agenda session(s) crafted.",
    },
    sessions: {
      type: "ARRAY",
      description: "List of crafted agenda sessions. If user prompt is for 1 session, return 1 session. If user prompt describes multiple sessions, tracks, or a full event schedule, return all sessions in chronological order.",
      items: {
        type: "OBJECT",
        properties: {
          title: {
            type: "STRING",
            description:
              "Creative, catchy 2 to 7 words session title representing the actual event activity. NEVER include conversational words like 'can you create' or 'I can you create'. For celebrations or parties include fitting emojis (e.g. '🪔 Diwali Team Dinner & Celebration', '🎉 Welcome Gala Kickoff', '🏆 Grand Awards Ceremony', '🍕 Networking Pizza Mixer'). For tech/business keep it punchy (e.g. '⚡ Cloud Architecture Masterclass', '🎙️ Keynote: Future of AI').",
          },
          speaker_name: {
            type: "STRING",
            description:
              "Speaker, host, or performer name if mentioned (e.g. 'Dr. Sarah Smith', 'DJ Mike'). If none, return empty string.",
          },
          description: {
            type: "STRING",
            description:
              "Sensible, engaging 2-4 sentence description detailing what actually happens in this session and takeaways.",
          },
          tags: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "2 to 4 relevant keyword tags (e.g. ['Celebration', 'Diwali', 'Dinner'] or ['Keynote', 'AI']).",
          },
          start_time: {
            type: "STRING",
            description:
              "Start time formatted as 'YYYY-MM-DDTHH:mm:ss' on the event date (e.g. '2026-11-06T19:00:00' for evening dinner). If no specific time was mentioned, assign a realistic time (dinner/evening at 19:00, lunch at 12:30, daytime at 10:00).",
          },
          end_time: {
            type: "STRING",
            description:
              "End time formatted as 'YYYY-MM-DDTHH:mm:ss' on the event date (e.g. '2026-11-06T21:00:00'). Must be after start_time.",
          },
          location: {
            type: "STRING",
            description:
              "Room, hall, stage, or virtual link (e.g. 'Main Banquet Hall', 'Auditorium A', 'Room 204', 'Virtual Stage'). If none, return empty string.",
          },
        },
        required: ["title", "start_time", "end_time", "description"],
      },
    },
  },
  required: ["reply", "sessions"],
};

function cleanConversationalPreamble(text: string): string {
  return text
    .replace(/^(?:i\s+)?(?:can\s+you|please|could\s+you|would\s+you|help\s+me|want\s+to|need\s+to)\s+(?:create|make|build|generate|structure|design|plan|add|schedule|set\s+up|draft)\s+(?:an?\s+)?(?:agenda|schedule|plan|timeline|session|activities|program)?\s*(?:for|about|with|of)?\s*/i, "")
    .replace(/^(?:create|make|build|generate|structure|design|plan|add|schedule|set\s+up|draft)\s+(?:an?\s+)?(?:agenda|schedule|plan|timeline|session|activities|program)?\s*(?:for|about|with|of)?\s*/i, "")
    .replace(/^(?:an?\s+)?(?:agenda|schedule|plan|timeline)\s+(?:for|about|with|of)?\s*/i, "")
    .trim();
}

function parseSingleSessionText(
  rawText: string,
  event: any,
  eventDateYMD: string,
  defaultStartHour: number = 10,
  durationMinutes: number = 60
): GeneratedAgendaSession {
  const text = cleanConversationalPreamble(rawText);
  const combinedText = `${rawText} ${event.title || ""} ${event.type?.name || ""}`.toLowerCase();
  const isCelebration = /(celebrat|party|gala|award|anniversary|birthday|fest|cultural|dance|music|dj|cocktail|dinner|lunch|food|pizza|game|fun|cheer|reception|diwali)/i.test(combinedText);
  const isTechOrWork = /(ai|cloud|code|developer|hackathon|workshop|keynote|panel|summit|conference|webinar|design|product|lab)/i.test(combinedText);

  // Time context sensing (dinner = 19:00, lunch = 13:00, morning = 09:00)
  let sensedStartHour = defaultStartHour;
  let sensedDuration = durationMinutes;
  if (combinedText.includes("dinner") || combinedText.includes("evening") || combinedText.includes("cocktail") || combinedText.includes("night party")) {
    sensedStartHour = 19;
    sensedDuration = 120;
  } else if (combinedText.includes("lunch")) {
    sensedStartHour = 13;
    sensedDuration = 60;
  } else if (combinedText.includes("breakfast") || combinedText.includes("morning setup")) {
    sensedStartHour = 9;
    sensedDuration = 60;
  } else if (combinedText.includes("afternoon") || combinedText.includes("workshop") || combinedText.includes("lab")) {
    sensedStartHour = 14;
    sensedDuration = 90;
  }

  // Speaker extraction
  let speakerName: string | null = null;
  const speakerMatch = rawText.match(/(?:by|hosted\s+by|speaker(?:\s*is|:)?)\s+([A-Za-z0-9\s.]{1,35}?)(?=[,\n]|(?:\s+(?:from|at|in)\b)|$)/i);
  if (speakerMatch) {
    speakerName = speakerMatch[1].trim().replace(/\.+$/, "");
  }

  // Location extraction
  let location: string | null = null;
  const locationMatch = rawText.match(/(?:in|at)\s+([a-zA-Z0-9\s-]{2,25}?(?:hall|room|stage|auditorium|ballroom|rooftop|center|centre|lab|campus|virtual|online|zoom|meet|dining|banquet)[a-zA-Z0-9\s-]*)/i)
    || rawText.match(/(?:in|at)\s+(hall\s+[a-z0-9]+|room\s+[0-9]+|stage\s+[0-9]+|auditorium\s+[a-z0-9]+|lab\s+[a-z0-9]+|ballroom|rooftop|online|virtual)/i);
  if (locationMatch) {
    location = locationMatch[0].replace(/^(?:in|at)\s+/i, "").trim();
  }

  // Tags
  const tags: string[] = [];
  if (combinedText.includes("diwali")) tags.push("Diwali", "Festive");
  if (combinedText.includes("dinner") || combinedText.includes("food")) tags.push("Dining", "Team Dinner");
  if (isCelebration) {
    if (!tags.includes("Festive")) tags.push("Celebration");
    if (/award/i.test(combinedText)) tags.push("Awards");
    if (/dj|music|dance/i.test(combinedText)) tags.push("Entertainment");
    tags.push("Networking");
  } else if (isTechOrWork) {
    if (/keynote/i.test(combinedText)) tags.push("Keynote");
    if (/workshop|lab/i.test(combinedText)) tags.push("Workshop");
    if (/hackathon/i.test(combinedText)) tags.push("Hackathon");
    tags.push("Tech");
  }
  const cleanTags = Array.from(new Set(tags)).slice(0, 4);

  // Time extraction
  const rangeRegex = /(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const rangeMatch = rawText.match(rangeRegex);

  const singleRegex = /(?:at|from|starts?\s+at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;
  const singleMatch = rawText.match(singleRegex);

  const pad = (n: number) => String(n).padStart(2, "0");
  let startH = sensedStartHour;
  let startM = 0;
  let endH = sensedStartHour + Math.floor(sensedDuration / 60);
  let endM = sensedDuration % 60;

  if (rangeMatch) {
    startH = parseInt(rangeMatch[1], 10);
    startM = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 0;
    const startMeridiem = (rangeMatch[3] || rangeMatch[6] || "").toLowerCase();
    if (startMeridiem === "pm" && startH < 12) startH += 12;
    if (startMeridiem === "am" && startH === 12) startH = 0;

    endH = parseInt(rangeMatch[4], 10);
    endM = rangeMatch[5] ? parseInt(rangeMatch[5], 10) : 0;
    const endMeridiem = (rangeMatch[6] || rangeMatch[3] || "").toLowerCase();
    if (endMeridiem === "pm" && endH < 12) endH += 12;
    if (endMeridiem === "am" && endH === 12) endH = 0;
  } else if (singleMatch) {
    startH = parseInt(singleMatch[1], 10);
    startM = singleMatch[2] ? parseInt(singleMatch[2], 10) : 0;
    const meridiem = (singleMatch[3] || "").toLowerCase();
    if (meridiem === "pm" && startH < 12) startH += 12;
    if (meridiem === "am" && startH === 12) startH = 0;
    endH = (startH + 1) % 24;
    endM = startM;
  }

  if (endH < startH || (endH === startH && endM <= startM)) {
    endH = (startH + 1) % 24;
    endM = startM;
  }

  const startTimeStr = `${eventDateYMD}T${pad(startH)}:${pad(startM)}:00`;
  const endTimeStr = `${eventDateYMD}T${pad(endH)}:${pad(endM)}:00`;

  // Clean title: isolate the core topic/activity
  let titleClause = text
    .split(/\b(?:in\s+which|where\s+we|and\s+going\s+to|so\s+that|in\s+order\s+to|which\s+will|talk\s+about)\b/i)[0]
    .replace(/(?:from\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi, "")
    .replace(/(?:at|from|starts?\s+at)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi, "")
    .replace(/(?:by|hosted\s+by)\s+[A-Za-z0-9.]*(?:\s+[A-Za-z0-9.]*){0,3}/gi, "")
    .replace(/(?:in|at)\s+(?:hall\s+[a-z0-9]+|room\s+[0-9]+|stage\s+[0-9]+|auditorium\s+[a-z0-9]+|lab\s+[a-z0-9]+|ballroom|rooftop|online|virtual)/gi, "")
    .replace(/^\d+[\s.)-]+\s*/, "")
    .trim();

  let words = titleClause.split(/\s+/).filter(Boolean);
  if (words.length > 7) words = words.slice(0, 6);
  let title = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

  // If Diwali or Festive is in prompt/event and not yet in title
  if (combinedText.includes("diwali") && !title.toLowerCase().includes("diwali")) {
    title = title ? `${title} & Diwali Celebration` : "Diwali Team Celebration & Dinner";
  }

  // Prepend appropriate emoji
  const hasEmoji = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/u.test(title);
  if (!hasEmoji) {
    if (combinedText.includes("diwali")) {
      title = `🪔 ${title || "Diwali Festive Gathering"}`;
    } else if (combinedText.includes("dinner") || combinedText.includes("food")) {
      title = `🍽️ ${title || "Team Dinner Party"}`;
    } else if (isCelebration) {
      title = `🎉 ${title || "Grand Celebration Gala"}`;
    } else if (isTechOrWork) {
      title = `⚡ ${title || "Keynote & Innovation Session"}`;
    } else {
      title = `🎙️ ${title || "Community Welcome Session"}`;
    }
  }

  // Description
  let description = "";
  if (combinedText.includes("diwali") || combinedText.includes("dinner")) {
    description = `Join colleagues and team members for an exciting gathering at "${title}"! Attendees will enjoy festive celebrations, great food, sharing memorable experiences, and warm community bonding. Don't miss out on the festivities! 🎉`;
  } else if (isCelebration) {
    description = `Get ready for an exciting gathering at "${title}"! ${
      speakerName ? `Hosted with special guest ${speakerName}, guests` : "Guests and attendees"
    } will enjoy vibrant celebrations, memorable activities, and warm community bonding. Don't miss out on the festivities! 🎉`;
  } else {
    description = `An insightful session exploring ${title}. ${
      speakerName ? `Led by ${speakerName}, this` : "This"
    } session covers key insights, practical takeaways, interactive discussion, and dedicated Q&A for attendees.`;
  }

  return {
    title,
    speaker_name: speakerName,
    description,
    tags: cleanTags,
    start_time: startTimeStr,
    end_time: endTimeStr,
    location,
  };
}

/** Deterministic local extractor for offline/fallback mode */
function extractLocalAgenda(params: {
  prompt: string;
  event: any;
  timeZoneOffsetMinutes?: number;
}): AiAgendaTurnResult {
  const prompt = params.prompt.trim();
  const event = params.event;
  const offsetMs = (params.timeZoneOffsetMinutes ?? 0) * 60 * 1000;
  const localStartDate = new Date(new Date(event.start_date || Date.now()).getTime() - offsetMs);
  const eventDateYMD = localStartDate.toISOString().split("T")[0];

  const lines = prompt
    .split(/\n|(?<=[.;])\s+(?=[1-9]\.|\b(?:then|next|afterwards|session)\b)/i)
    .map((l) => l.trim())
    .filter((l) => l.length > 5 && !/^(?:create|here is|schedule:?|agenda:?)\s*$/i.test(l));

  const sessions: GeneratedAgendaSession[] = [];

  if (lines.length > 1) {
    let currentHour = 10;
    for (let i = 0; i < lines.length; i += 1) {
      const s = parseSingleSessionText(lines[i], event, eventDateYMD, currentHour, 60);
      sessions.push(s);
      currentHour = (currentHour + 1) % 24;
    }
  } else {
    const s = parseSingleSessionText(prompt, event, eventDateYMD, 10, 60);
    sessions.push(s);
  }

  const reply =
    sessions.length > 1
      ? `I have crafted ${sessions.length} agenda sessions for your schedule. You can review, refine, or add more sessions!`
      : `I have designed the session "${sessions[0]?.title || "Agenda Session"}" for your draft. You can review, refine, or add more drafts!`;

  return {
    reply,
    sessions,
    source: "local",
  };
}

export class AiAgendaService {
  static async generate(params: {
    eventId: number;
    prompt: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    timeZoneOffsetMinutes?: number;
  }): Promise<AiAgendaTurnResult> {
    const { eventId, prompt } = params;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        type: true,
        timelines: {
          orderBy: { start_time: "asc" },
          select: {
            id: true,
            title: true,
            start_time: true,
            end_time: true,
            speaker_name: true,
            location: true,
            tags: true,
          },
        },
      },
    });

    if (!event) {
      throw new Error("Event not found");
    }

    const gemini = getGeminiConfig();

    if (!gemini) {
      return extractLocalAgenda({ prompt, event, timeZoneOffsetMinutes: params.timeZoneOffsetMinutes });
    }

    const offsetMs = (params.timeZoneOffsetMinutes ?? 0) * 60 * 1000;
    const localStartDate = new Date(new Date(event.start_date || Date.now()).getTime() - offsetMs);
    const eventDateYMD = localStartDate.toISOString().split("T")[0];

    const systemInstruction = [
      `You are the Eventrix AI Agenda and Session Architect for:`,
      `Event Title: "${event.title}"`,
      `Event Category: ${event.type?.name || "General Event"}`,
      `Event Mode: ${event.mode}`,
      `Event Local Date: ${eventDateYMD}`,
      `Event Date Range: ${event.start_date ? event.start_date.toISOString() : "TBA"} to ${event.end_date ? event.end_date.toISOString() : "TBA"}`,
      `Current Existing Timeline Sessions: ${JSON.stringify(
        event.timelines.map((t: any) => ({
          title: t.title,
          start: t.start_time,
          end: t.end_time,
          speaker: t.speaker_name,
        }))
      )}`,
      ``,
      `TASK: Analyze the user's prompt or voice transcript and generate complete agenda sessions.`,
      `- If the user describes a single session (e.g. "team dinner with Diwali celebration"), output 1 or 2 well-defined sessions in the 'sessions' array.`,
      `- If the user describes multiple sessions, schedule breakdown, or full agenda, output ALL corresponding sessions in chronological order in the 'sessions' array.`,
      ``,
      `CRITICAL RULES:`,
      `1. NEVER INCLUDE CONVERSATIONAL PROMPT PHRASES IN TITLES:`,
      `   - Do NOT include 'can you create', 'I can you create', 'please make', 'agenda for', or 'we are going to have' in session titles.`,
      `   - Titles must be creative, memorable, and 2 to 7 words representing the actual event or activity (e.g. '🪔 Diwali Team Dinner & Celebration', '🎉 Welcome Gala Kickoff', '⚡ Cloud Architecture Masterclass').`,
      ``,
      `2. TIME ASSIGNMENT & SENSITIVITY:`,
      `   - If user specified times, map them directly to '${eventDateYMD}THH:mm:ss'.`,
      `   - If user mentions dinner, evening, gala, or party without exact hours, schedule in the evening (e.g. 19:00 to 21:00 or 19:30 to 21:30).`,
      `   - If user mentions lunch, schedule around 12:30 or 13:00.`,
      `   - If user mentions breakfast, schedule around 09:00.`,
      `   - 'start_time' and 'end_time' MUST NEVER BE EMPTY OR NULL. Always provide valid 'YYYY-MM-DDTHH:mm:ss' or 'HH:mm' strings.`,
      ``,
      `3. SPEAKER & LOCATION:`,
      `   - If mentioned, extract speaker_name and location. If not mentioned or not applicable, set them to empty string "".`,
      ``,
      `4. DESCRIPTIONS:`,
      `   - 2 to 4 rich, sensible sentences summarizing what takes place in the session.`,
      ``,
      `5. 'reply': A warm, friendly assistant message confirming the session(s) structured.`,
    ].join("\n");

    const contents = [
      ...(params.history || []).map((h) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.content }],
      })),
      {
        role: "user",
        parts: [
          {
            text: `Event: "${event.title}" (${event.type?.name || "Event"})\nEvent Date: ${eventDateYMD}\nUser Agenda Request: "${prompt}"`,
          },
        ],
      },
    ];

    // Try gemini-3-flash-preview, then gemini-3.5-flash-lite
    const candidateModels = Array.from(new Set([gemini.model, "gemini-3-flash-preview", "gemini-3.5-flash-lite"]));

    for (const modelToTry of candidateModels) {
      try {
        const url = `${GEMINI_BASE_URL}/${modelToTry}:generateContent?key=${gemini.apiKey}`;
        const thinkingConfig = buildThinkingConfig(modelToTry);

        const payload: Record<string, unknown> = {
          system_instruction: {
            parts: [{ text: systemInstruction }],
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json",
            responseSchema: AGENDA_JSON_SCHEMA,
            ...(thinkingConfig ? { thinkingConfig } : {}),
          },
        };

        const response = await axios.post(url, payload, {
          timeout: GEMINI_TIMEOUT_MS,
        });

        const candidate = response.data?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        if (!text) continue;

        const parsed = JSON.parse(text);

        let rawSessionsList: any[] = [];
        if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
          rawSessionsList = parsed.sessions;
        } else if (parsed.session) {
          rawSessionsList = [parsed.session];
        }

        if (rawSessionsList.length === 0) continue;

        // Contextual default start hour for fallback (dinner = 19:00, otherwise 10:00)
        const isEvening = /dinner|evening|gala|party/i.test(prompt);
        let currentDefaultHour = isEvening ? 19 : 10;

        const sessions: GeneratedAgendaSession[] = rawSessionsList.map((rawSession, idx) => {
          const startTimeFormatted = parseToLocalDatetimeString(
            rawSession.start_time,
            eventDateYMD,
            currentDefaultHour,
            0
          );
          const endTimeFormatted = parseToLocalDatetimeString(
            rawSession.end_time,
            eventDateYMD,
            currentDefaultHour + 1,
            30
          );
          currentDefaultHour = (currentDefaultHour + 2) % 24;

          return {
            title: String(rawSession.title || `Agenda Session ${idx + 1}`).slice(0, 100),
            speaker_name:
              rawSession.speaker_name && rawSession.speaker_name !== "null"
                ? String(rawSession.speaker_name).trim().slice(0, 100) || null
                : null,
            description:
              rawSession.description && rawSession.description !== "null"
                ? String(rawSession.description)
                : null,
            tags: Array.isArray(rawSession.tags)
              ? rawSession.tags.map((t: any) => String(t).slice(0, 50))
              : [],
            start_time: startTimeFormatted,
            end_time: endTimeFormatted,
            location:
              rawSession.location && rawSession.location !== "null"
                ? String(rawSession.location).trim().slice(0, 100) || null
                : null,
          };
        });

        return {
          reply: parsed.reply || `Generated ${sessions.length} agenda session(s).`,
          sessions,
          source: "gemini",
        };
      } catch (err: any) {
        console.warn(`[AI_AGENDA] Attempt with model ${modelToTry} failed:`, err?.response?.data?.error?.message || err?.message || err);
      }
    }

    console.warn("[AI_AGENDA] All Gemini attempts exhausted, falling back to local extractor");
    return extractLocalAgenda({ prompt, event, timeZoneOffsetMinutes: params.timeZoneOffsetMinutes });
  }
}
