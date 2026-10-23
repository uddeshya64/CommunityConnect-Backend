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

  return {
    apiKey,
    model: env?.GEMINI_MODEL?.trim() || "gemini-flash-latest",
  };
}

function buildThinkingConfig(model: string): Record<string, unknown> | null {
  if (/gemini-3/i.test(model)) return { thinkingLevel: "low" };
  if (/gemini-2\.5/i.test(model)) return { thinkingBudget: 0 };
  return null;
}

function parseToLocalDatetimeString(val: any, fallbackDateYMD: string): string | null {
  if (!val) return null;
  const str = String(val).trim();
  if (!str || str === "null" || str === "undefined") return null;

  // If format already has date and time (e.g. 2026-10-23T18:00 or 2026-10-23 18:00)
  const dtMatch = str.match(/(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dtMatch) {
    const pad = (n: string | number) => String(n).padStart(2, "0");
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
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${fallbackDateYMD}T${pad(h)}:${pad(m)}:00`;
  }

  return null;
}

const AGENDA_JSON_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: {
      type: "STRING",
      description: "A friendly, upbeat 1-2 sentence assistant message summarizing the agenda session crafted.",
    },
    session: {
      type: "OBJECT",
      description: "The single agenda session generated for the active draft.",
      properties: {
        title: {
          type: "STRING",
          description:
            "Creative, catchy 2 to 5 words session title. Detect the event/prompt vibe: if celebration, party, gala, festival, or social, include fitting celebration emojis (e.g. '🎉 Welcome Gala Kickoff', '🏆 Grand Awards Ceremony', '🍕 Networking Pizza Mixer', '🎵 Live DJ Night'). For tech/business/formal events, keep it sharp and punchy (e.g. '⚡ Cloud Architecture Masterclass', '🎙️ Keynote: Future of AI'). Strictly 2 to 5 words.",
        },
        speaker_name: {
          type: "STRING",
          description:
            "CRITICAL: ONLY extract speaker, host, or performer name IF explicitly mentioned by the user in the prompt (e.g. 'by Sarah', 'hosted by DJ Mike'). If NOT explicitly mentioned by the user, this MUST BE null. NEVER invent or assume a name.",
        },
        description: {
          type: "STRING",
          description:
            "Sensible, engaging, and rich 2-4 sentence description detailing what actually happens in this session, key activities, or takeaways. Match the tone: enthusiastic and fun with emojis for celebrations, inspiring and clear for conferences.",
        },
        tags: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "2 to 4 relevant keyword tags (e.g. ['Party', 'DJ'] or ['Keynote', 'AI']). If no specific tags apply, return empty array.",
        },
        start_time: {
          type: "STRING",
          description:
            "Start time formatted as 'YYYY-MM-DDTHH:mm:ss' representing the user's specified local time on the event date (e.g. '2026-10-23T18:00:00' for 6 PM). Do NOT append 'Z' or timezone offsets. If the user did NOT mention or specify a time in the prompt, return null.",
        },
        end_time: {
          type: "STRING",
          description:
            "End time formatted as 'YYYY-MM-DDTHH:mm:ss' (e.g. '2026-10-23T19:00:00' for 7 PM). Do NOT append 'Z' or timezone offsets. If the user did NOT mention or specify a time in the prompt, return null.",
        },
        location: {
          type: "STRING",
          description:
            "CRITICAL: ONLY extract location or room IF explicitly mentioned in the user prompt (e.g. 'in Room 101', 'Hall B', 'Zoom Link'). If the user did NOT mention a location in their prompt, this MUST BE null. NEVER invent a room or venue.",
        },
      },
      required: ["title"],
    },
  },
  required: ["reply", "session"],
};

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
  const combinedText = `${prompt} ${event.title || ""} ${event.type?.name || ""}`.toLowerCase();

  // Detect celebratory / social / party vibe
  const isCelebration = /(celebrat|party|gala|award|anniversary|birthday|fest|cultural|dance|music|dj|cocktail|dinner|lunch|food|pizza|game|fun|cheer|reception)/i.test(combinedText);
  const isTechOrWork = /(ai|cloud|code|developer|hackathon|workshop|keynote|panel|summit|conference|webinar|design|product)/i.test(combinedText);

  // ONLY extract speaker if explicitly in user prompt
  let speakerName: string | null = null;
  const speakerMatch = prompt.match(/(?:by|with|speaker(?:\s*is|:)?|hosted\s+by)\s+([A-Z][a-zA-Z0-9.\s]{2,30}?)(?=[,.\n]|from|at|in|$)/i);
  if (speakerMatch) {
    speakerName = speakerMatch[1].trim();
  }

  // ONLY extract location if explicitly mentioned in user prompt - NEVER default to event.location
  let location: string | null = null;
  const locationMatch = prompt.match(/(?:in|at)\s+(hall\s+[a-z0-9]+|room\s+[0-9]+|stage\s+[0-9]+|auditorium\s+[a-z0-9]+|ballroom|rooftop|online|virtual)/i);
  if (locationMatch) {
    location = locationMatch[0].replace(/^(?:in|at)\s+/i, "").trim();
  }

  // Detect tags
  const tags: string[] = [];
  if (isCelebration) {
    if (/award/i.test(combinedText)) tags.push("Awards", "Recognition");
    else if (/dj|music|dance/i.test(combinedText)) tags.push("Music", "Entertainment");
    else if (/dinner|food|lunch|pizza|cocktail/i.test(combinedText)) tags.push("Dining", "Networking");
    else tags.push("Celebration", "Fun");
  } else if (isTechOrWork) {
    if (/keynote/i.test(combinedText)) tags.push("Keynote", "Leadership");
    else if (/workshop/i.test(combinedText)) tags.push("Workshop", "Hands-on");
    else if (/hackathon/i.test(combinedText)) tags.push("Hackathon", "Build");
    else tags.push("Tech", "Innovation");
  }

  // Extract times ONLY if explicitly mentioned in prompt
  let startTimeStr: string | null = null;
  let endTimeStr: string | null = null;

  const rangeRegex = /(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const rangeMatch = prompt.match(rangeRegex);

  const singleRegex = /(?:at|from|starts?\s+at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;
  const singleMatch = prompt.match(singleRegex);

  const pad = (n: number) => String(n).padStart(2, "0");

  if (rangeMatch) {
    let startH = parseInt(rangeMatch[1], 10);
    const startM = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 0;
    const startMeridiem = (rangeMatch[3] || rangeMatch[6] || "").toLowerCase();
    if (startMeridiem === "pm" && startH < 12) startH += 12;
    if (startMeridiem === "am" && startH === 12) startH = 0;

    let endH = parseInt(rangeMatch[4], 10);
    const endM = rangeMatch[5] ? parseInt(rangeMatch[5], 10) : 0;
    const endMeridiem = (rangeMatch[6] || rangeMatch[3] || "").toLowerCase();
    if (endMeridiem === "pm" && endH < 12) endH += 12;
    if (endMeridiem === "am" && endH === 12) endH = 0;

    startTimeStr = `${eventDateYMD}T${pad(startH)}:${pad(startM)}:00`;
    endTimeStr = `${eventDateYMD}T${pad(endH)}:${pad(endM)}:00`;
  } else if (singleMatch) {
    let startH = parseInt(singleMatch[1], 10);
    const startM = singleMatch[2] ? parseInt(singleMatch[2], 10) : 0;
    const meridiem = (singleMatch[3] || "").toLowerCase();
    if (meridiem === "pm" && startH < 12) startH += 12;
    if (meridiem === "am" && startH === 12) startH = 0;

    const endH = (startH + 1) % 24;
    startTimeStr = `${eventDateYMD}T${pad(startH)}:${pad(startM)}:00`;
    endTimeStr = `${eventDateYMD}T${pad(endH)}:${pad(startM)}:00`;
  }

  // Generate catchy 2-5 words title
  let cleanWords = prompt
    .replace(/(?:from|at)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi, "")
    .replace(/(?:by|with|speaker(?:\s*is|:)?|hosted\s+by)\s+[A-Za-z0-9.\s]+/gi, "")
    .replace(/^(?:create|add|schedule|plan|organize)\s+(?:a|an)?\s*/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let title = "";
  if (cleanWords.length >= 2 && cleanWords.length <= 5) {
    title = cleanWords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  } else if (cleanWords.length > 5) {
    title = cleanWords.slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  // Apply styling & emojis
  if (isCelebration) {
    const emojis = ["🎉", "🥳", "✨", "🏆", "🥂", "🍕", "🎵", "🎈"];
    const emoji = emojis[Math.floor(Math.random() * emojis.length)];
    if (!title) {
      title = `${emoji} Grand Celebration Gala`;
    } else if (!title.startsWith(emoji)) {
      title = `${emoji} ${title}`;
    }
  } else {
    if (!title) {
      title = isTechOrWork ? "⚡ Keynote & Innovation Session" : "🎙️ Community Welcome Session";
    }
  }

  const titleParts = title.split(/\s+/);
  if (titleParts.length > 6) {
    title = titleParts.slice(0, 5).join(" ");
  }

  let description = "";
  if (isCelebration) {
    description = `Get ready for an exciting gathering at "${title}"! ${
      speakerName ? `Hosted with special guest ${speakerName}, guests` : "Guests and attendees"
    } will enjoy vibrant music, celebrations, memorable activities, and warm community bonding. Don't miss out on the festivities! 🎉`;
  } else {
    description = `An insightful session exploring ${title}. ${
      speakerName ? `Led by ${speakerName}, this` : "This"
    } session covers key insights, live interactive discussions, practical takeaways, and dedicated Q&A for attendees.`;
  }

  return {
    reply: `I have designed the session "${title}" for your draft. You can review, refine, or add more drafts!`,
    sessions: [
      {
        title,
        speaker_name: speakerName,
        description,
        tags,
        start_time: startTimeStr || "",
        end_time: endTimeStr || "",
        location,
      },
    ],
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

    try {
      const url = `${GEMINI_BASE_URL}/${gemini.model}:generateContent?key=${gemini.apiKey}`;
      const thinkingConfig = buildThinkingConfig(gemini.model);

      const offsetMs = (params.timeZoneOffsetMinutes ?? 0) * 60 * 1000;
      const localStartDate = new Date(new Date(event.start_date).getTime() - offsetMs);
      const eventDateYMD = localStartDate.toISOString().split("T")[0];

      const systemInstruction = [
        `You are the Community Connect AI Agenda and Session Architect for:`,
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
        `TASK: The user is editing a single agenda session draft. Generate EXACTLY ONE session corresponding to the user's prompt or voice transcript.`,
        ``,
        `CRITICAL RULES:`,
        `1. GENERATE EXACTLY ONE SESSION:`,
        `   - Do NOT generate multiple sessions. Output exactly one session object for the user's current draft.`,
        ``,
        `2. STRICT RULES FOR MISSING DETAILS (LEAVE BLANK / NULL IF NOT IN PROMPT):`,
        `   - speaker_name: ONLY extract speaker, host, DJ, or presenter name IF explicitly stated in the prompt (e.g. "by Dr. Sarah", "hosted by DJ Alex"). If NOT stated, speaker_name MUST BE null. NEVER invent a name.`,
        `   - location: ONLY extract location IF explicitly stated in the prompt (e.g. "in Room 204", "Hall A", "Virtual Link"). If NOT stated, location MUST BE null. NEVER invent a room or venue and NEVER default to the event venue.`,
        `   - start_time & end_time: ONLY extract times IF explicitly stated in the prompt (e.g. "from 6 PM to 7 PM", "at 10:00 AM"). If no time was specified by the user, start_time and end_time MUST BE null. NEVER guess or invent 10 AM, 6 PM, or event start date.`,
        ``,
        `3. TIME FORMATTING (NO UTC SHIFTS):`,
        `   - When user specifies a time (e.g. "6 PM to 7 PM"), map it directly to the Event Local Date '${eventDateYMD}'.`,
        `   - Output format: '${eventDateYMD}THH:mm:ss' (e.g. '${eventDateYMD}T18:00:00' for 6 PM, '${eventDateYMD}T19:00:00' for 7 PM).`,
        `   - NEVER append 'Z' or timezone offsets. Keep the exact hours stated by the user.`,
        ``,
        `4. SESSION TITLES MUST BE 2 TO 5 WORDS:`,
        `   - Make the session title catchy, creative, and memorable (strictly 2 to 5 words).`,
        `   - NEVER use long rambling sentences as titles.`,
        ``,
        `5. SCAN PROMPT & EVENT TYPE TO CHOOSE THE STYLE & EMOJIS:`,
        `   - CELEBRATORY / PARTY / FESTIVAL / CULTURAL / GALA / AWARDS / SOCIAL: If celebratory, bring vibrant energy with fitting celebration emojis in the title (e.g. 🎉, 🥳, 🏆, 🥂, 🍕, 🎵, 🎈, 💃, 🌟, ✨, 🍰, 🎸) and an enthusiastic description.`,
        `   - TECH / PROFESSIONAL / CONFERENCE / WORKSHOP / FORMAL: Modern, inspiring, and sharp with subtle fitting icons (⚡, 🎙️, 💡, 🌐, 🚀) and structured learning/takeaway descriptions.`,
        ``,
        `6. SENSIBLE, MEANINGFUL DESCRIPTIONS:`,
        `   - Must make complete sense based on the prompt's subject matter. 2 to 4 rich sentences.`,
        ``,
        `7. 'reply': A warm, friendly 1-2 sentence assistant summary describing the session created.`,
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
              text: `Event: "${event.title}" (${event.type?.name || "Event"})\nEvent Date: ${eventDateYMD}\nUser Single Session Draft Request: "${prompt}"`,
            },
          ],
        },
      ];

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

      if (!text) {
        throw new Error("Empty response from AI model");
      }

      const parsed = JSON.parse(text);

      const rawSession =
        parsed.session ||
        (Array.isArray(parsed.sessions) && parsed.sessions.length > 0
          ? parsed.sessions[0]
          : null);

      const startTimeFormatted = rawSession
        ? parseToLocalDatetimeString(rawSession.start_time, eventDateYMD)
        : null;
      const endTimeFormatted = rawSession
        ? parseToLocalDatetimeString(rawSession.end_time, eventDateYMD)
        : null;

      const sessions: GeneratedAgendaSession[] = rawSession
        ? [
            {
              title: String(rawSession.title || "Agenda Session").slice(0, 100),
              speaker_name: rawSession.speaker_name
                ? String(rawSession.speaker_name).slice(0, 100)
                : null,
              description: rawSession.description
                ? String(rawSession.description)
                : null,
              tags: Array.isArray(rawSession.tags)
                ? rawSession.tags.map((t: any) => String(t).slice(0, 50))
                : [],
              start_time: startTimeFormatted || "",
              end_time: endTimeFormatted || "",
              location: rawSession.location
                ? String(rawSession.location).slice(0, 100)
                : null,
            },
          ]
        : extractLocalAgenda({ prompt, event, timeZoneOffsetMinutes: params.timeZoneOffsetMinutes }).sessions;

      return {
        reply:
          parsed.reply ||
          `Generated session "${sessions[0]?.title || "Agenda Session"}".`,
        sessions,
        source: "gemini",
      };
    } catch (err: any) {
      console.warn("[AI_AGENDA] Gemini call failed, using local fallback:", err?.message || err);
      return extractLocalAgenda({ prompt, event, timeZoneOffsetMinutes: params.timeZoneOffsetMinutes });
    }
  }
}
