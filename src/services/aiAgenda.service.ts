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

  let model = env?.GEMINI_MODEL?.trim() || "gemini-1.5-flash";
  if (/gemini-3\.5/i.test(model) || !model.startsWith("gemini")) {
    model = "gemini-1.5-flash";
  }

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

  // If format already has date and time (e.g. 2026-10-23T18:00 or 2026-10-23 18:00)
  const dtMatch = str.match(/(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dtMatch) {
    return `${dtMatch[1]}T${pad(dtMatch[2])}:${pad(dtMatch[3])}:00`;
  }

  // If format only has time (e.g. "18:00", "6:00 PM", "6 PM", "10:30 AM")
  const timeOnly = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeOnly) {
    let h = parseInt(timeOnly[1], 10);
    const m = timeOnly[2] ? parseInt(timeOnly[2], 10) : 0;
    const meridiem = (timeOnly[3] || "").toLowerCase();
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
              "Creative, catchy 2 to 7 words session title. For celebrations or parties include fitting emojis (e.g. '🎉 Welcome Gala Kickoff', '🏆 Grand Awards Ceremony', '🍕 Networking Pizza Mixer'). For tech/business keep it punchy (e.g. '⚡ Cloud Architecture Masterclass', '🎙️ Keynote: Future of AI').",
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
            description: "2 to 4 relevant keyword tags (e.g. ['Keynote', 'AI'] or ['Celebration', 'Music']).",
          },
          start_time: {
            type: "STRING",
            description:
              "Start time formatted as 'YYYY-MM-DDTHH:mm:ss' on the event date (e.g. '2026-10-23T10:00:00'). If no specific time was mentioned, assign a sensible time on the event date.",
          },
          end_time: {
            type: "STRING",
            description:
              "End time formatted as 'YYYY-MM-DDTHH:mm:ss' on the event date (e.g. '2026-10-23T11:00:00'). Must be after start_time.",
          },
          location: {
            type: "STRING",
            description:
              "Room, hall, stage, or virtual link (e.g. 'Auditorium A', 'Room 204', 'Virtual Stage'). If none, return empty string.",
          },
        },
        required: ["title", "start_time", "end_time", "description"],
      },
    },
  },
  required: ["reply", "sessions"],
};

function parseSingleSessionText(
  text: string,
  event: any,
  eventDateYMD: string,
  defaultStartHour: number = 10,
  durationMinutes: number = 60
): GeneratedAgendaSession {
  const combinedText = `${text} ${event.title || ""} ${event.type?.name || ""}`.toLowerCase();
  const isCelebration = /(celebrat|party|gala|award|anniversary|birthday|fest|cultural|dance|music|dj|cocktail|dinner|lunch|food|pizza|game|fun|cheer|reception)/i.test(combinedText);
  const isTechOrWork = /(ai|cloud|code|developer|hackathon|workshop|keynote|panel|summit|conference|webinar|design|product|lab)/i.test(combinedText);

  // Speaker extraction
  let speakerName: string | null = null;
  const speakerMatch = text.match(/(?:by|hosted\s+by|speaker(?:\s*is|:)?)\s+([A-Za-z0-9\s.]{1,35}?)(?=[,\n]|(?:\s+(?:from|at|in)\b)|$)/i);
  if (speakerMatch) {
    speakerName = speakerMatch[1].trim().replace(/\.+$/, "");
  }

  // Location extraction
  let location: string | null = null;
  const locationMatch = text.match(/(?:in|at)\s+([a-zA-Z0-9\s-]{2,25}?(?:hall|room|stage|auditorium|ballroom|rooftop|center|centre|lab|campus|virtual|online|zoom|meet)[a-zA-Z0-9\s-]*)/i)
    || text.match(/(?:in|at)\s+(hall\s+[a-z0-9]+|room\s+[0-9]+|stage\s+[0-9]+|auditorium\s+[a-z0-9]+|lab\s+[a-z0-9]+|ballroom|rooftop|online|virtual)/i);
  if (locationMatch) {
    location = locationMatch[0].replace(/^(?:in|at)\s+/i, "").trim();
  }

  // Tags
  const tags: string[] = [];
  if (isCelebration) {
    if (/award/i.test(combinedText)) tags.push("Awards", "Recognition");
    else if (/dj|music|dance/i.test(combinedText)) tags.push("Music", "Entertainment");
    else if (/dinner|food|lunch|pizza|cocktail/i.test(combinedText)) tags.push("Dining", "Networking");
    else tags.push("Celebration", "Fun");
  } else if (isTechOrWork) {
    if (/keynote/i.test(combinedText)) tags.push("Keynote", "Leadership");
    else if (/workshop|lab/i.test(combinedText)) tags.push("Workshop", "Hands-on");
    else if (/hackathon/i.test(combinedText)) tags.push("Hackathon", "Build");
    else tags.push("Tech", "Innovation");
  }

  // Time extraction
  const rangeRegex = /(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const rangeMatch = text.match(rangeRegex);

  const singleRegex = /(?:at|from|starts?\s+at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;
  const singleMatch = text.match(singleRegex);

  const pad = (n: number) => String(n).padStart(2, "0");
  let startH = defaultStartHour;
  let startM = 0;
  let endH = defaultStartHour + Math.floor(durationMinutes / 60);
  let endM = durationMinutes % 60;

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

  // Clean title
  let clean = text
    .replace(/(?:from\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi, "")
    .replace(/(?:at|from|starts?\s+at)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi, "")
    .replace(/(?:by|hosted\s+by)\s+[A-Za-z0-9.]*(?:\s+[A-Za-z0-9.]*){0,3}/gi, "")
    .replace(/(?:in|at)\s+(?:hall\s+[a-z0-9]+|room\s+[0-9]+|stage\s+[0-9]+|auditorium\s+[a-z0-9]+|lab\s+[a-z0-9]+|ballroom|rooftop|online|virtual)/gi, "")
    .replace(/^(?:create|add|schedule|plan|organize)\s+(?:a|an)?\s*/i, "")
    .replace(/^\d+[\s.)-]+\s*/, "")
    .trim();

  const words = clean.split(/\s+/).filter(Boolean);
  let title = "";
  if (words.length > 8) {
    title = words.slice(0, 7).join(" ");
  } else if (words.length >= 1) {
    title = words.join(" ");
  }

  title = title.replace(/\s+(?:&|and|with|at|in|-|for|to)\s*$/i, "").trim();

  const hasEmoji = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/u.test(title);
  if (!hasEmoji) {
    const emojis = isCelebration
      ? ["🎉", "🥳", "✨", "🏆", "🥂", "🍕", "🎵", "🎈"]
      : isTechOrWork
      ? ["⚡", "🎙️", "💡", "🌐", "🚀"]
      : ["🎙️", "📅"];
    const emoji = emojis[Math.floor(Math.random() * emojis.length)];
    if (!title) {
      title = isCelebration ? `${emoji} Grand Celebration Gala` : `${emoji} Community Welcome Session`;
    } else {
      title = `${emoji} ${title}`;
    }
  }

  let description = "";
  if (isCelebration) {
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
    tags,
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
    const localStartDate = new Date(new Date(event.start_date).getTime() - offsetMs);
    const eventDateYMD = localStartDate.toISOString().split("T")[0];

    const systemInstruction = [
      `You are the Eventrix AI Agenda and Session Architect for:`,
      `Event Title: "${event.title}"`,
      `Event Category: ${event.type?.name || "General Event"}`,
      `Event Mode: ${event.mode}`,
      `Event Local Date: ${eventDateYMD}`,
      `Event Date Range: ${event.start_date.toISOString()} to ${event.end_date.toISOString()}`,
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
      `- If the user describes a single session (e.g. "Keynote by Sarah at 10 AM"), output exactly 1 session in the 'sessions' array.`,
      `- If the user describes multiple sessions, schedule breakdown, or full agenda (e.g. "1. Keynote 2. Workshop 3. Lunch"), output ALL corresponding sessions in chronological order in the 'sessions' array.`,
      ``,
      `CRITICAL RULES:`,
      `1. TIME ASSIGNMENT:`,
      `   - When the user specifies times (e.g. "from 6 PM to 7 PM"), map them directly to '${eventDateYMD}THH:mm:ss'.`,
      `   - If user did NOT state times, assign realistic, non-overlapping chronological times on '${eventDateYMD}' (e.g. starting at 10:00 AM or after the last existing session).`,
      `   - 'start_time' and 'end_time' MUST NEVER BE EMPTY OR NULL. Always provide valid 'YYYY-MM-DDTHH:mm:ss' strings.`,
      ``,
      `2. SPEAKER & LOCATION:`,
      `   - If mentioned, extract speaker_name and location. If not mentioned or not applicable, set them to empty string "".`,
      ``,
      `3. SESSION TITLES:`,
      `   - Make session titles creative, punchy, and clear (2 to 7 words).`,
      `   - For celebrations/parties, use vibrant fitting emojis (🎉, 🏆, 🍕, 🎵, 🥳).`,
      `   - For tech/professional, use sharp icons (⚡, 🎙️, 💡, 🚀).`,
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

    // Try primary model, with automatic fallback models if 404/retired
    const candidateModels = Array.from(new Set([gemini.model, "gemini-1.5-flash", "gemini-2.0-flash"]));

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

        let currentDefaultHour = 10;
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
            0
          );
          currentDefaultHour = (currentDefaultHour + 1) % 24;

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
