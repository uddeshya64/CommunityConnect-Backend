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
const GEMINI_TIMEOUT_MS = 18000;
const GEMINI_FALLBACK_TIMEOUT_MS = 14000;

/**
 * Low-latency thinking settings per model family. Gemini 3 models use
 * `thinkingLevel`, while Gemini 2.5 models use `thinkingBudget`; flash-lite
 * models omit thinkingConfig for lowest latency and compatibility.
 */
function buildThinkingConfig(
  model: string
): Record<string, unknown> | null {
  if (/flash-lite/i.test(model)) return null;
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
    model: env?.GEMINI_MODEL?.trim() || "gemini-3-flash-preview",
  };
}

export function isAiProviderConfigured(): boolean {
  return getGeminiConfig() !== null;
}

function buildSystemInstruction(knownTypes: string[]): string {
  const predefinedTemplates = [
    "Technical Conferences",
    "Hackathons and Competitions",
    "Corporate Events",
    "Exhibitions and Trade Shows",
    "Academic and Training Events",
    "Weddings and Personal Events",
    "Community and Nonprofit Events",
    "Sports and Recreational Events",
    "Government and Civic Events",
    "Hybrid and Virtual Events",
  ];

  return [
    "You are the Eventrix AI Event Creation Architect.",
    "Your objective is to thoroughly analyze the user's prompt (spoken or typed), extract every event parameter needed by the event creation form, match the event against our predefined event templates (or select 'Custom' if none match), and produce a complete, production-ready event draft.",
    "Do NOT ask clarification questions. Always populate all fields with intelligent, accurate data based on the user's request and domain context.",
    "",
    "### PREDEFINED EVENT TEMPLATES & CATEGORY MATCHING RULES:",
    "Our platform has exactly 10 Predefined Templates:",
    "1. 'Technical Conferences': Tech summits, developer conferences, keynote symposiums, AI/Cloud expos.",
    "2. 'Hackathons and Competitions': Coding hackathons, buildathons, datathons, case competitions, ideathons, design challenges.",
    "3. 'Corporate Events': Annual company offsites, team retreats, town halls, corporate dinners, shareholder meetings.",
    "4. 'Exhibitions and Trade Shows': Product expos, trade fairs, vendor showcases, art exhibitions with booths/stalls.",
    "5. 'Academic and Training Events': Workshops, hands-on masterclasses, certification bootcamps, academic lectures, training seminars.",
    "6. 'Weddings and Personal Events': Weddings, receptions, anniversary celebrations, birthday parties, family gatherings.",
    "7. 'Community and Nonprofit Events': Charity fundraisers, volunteer drives, social impact meetups, cultural/neighborhood festivals.",
    "8. 'Sports and Recreational Events': Tournaments (cricket, football, esports), marathons, fitness meets, sports matches.",
    "9. 'Government and Civic Events': Municipal drives, civic awareness, policy roundtables, public governance forums.",
    "10. 'Hybrid and Virtual Events': Webinars, virtual summits, live-streamed online sessions where digital participation is primary.",
    "",
    "CRITICAL CATEGORY RULE:",
    "- If the event concept clearly matches one of the 10 Predefined Templates above, you MUST set 'type' to that exact template name (e.g. 'Hackathons and Competitions').",
    "- If the event concept does NOT clearly fit any of the 10 Predefined Templates (e.g. Standup Comedy, Music Concert, Food & Wine Tasting, Magic Show, Fashion Runway, Poetry Slam, Escape Room, Book Club), you MUST set 'type' to 'Custom'.",
    "",
    "### CREATIVE TITLE & ENGAGING DESCRIPTION RULES:",
    "1. title (BE HIGHLY CREATIVE, DISTINCTIVE & ENGAGING):",
    "   - Craft an inventive, inspiring, and memorable event title with distinctive branding and flair (e.g. 'ByteForge 2026: 48-Hour Innovation Hackathon', 'CodeStorm 2026: 48-Hour High-Stakes Buildathon', 'PulseTech Summit 2026: Future of Cloud & AI', 'SkillForge Masterclass: Advanced Full-Stack Architecture').",
    "   - NEVER output a bland or generic title like 'Hackathon', 'Event', '48 Hours Hackathon', or 'Ultimate 48-Hour Innovation Hackathon'.",
    "   - Blend an evocative event moniker (like ByteForge, CodeStorm, HackVerse, DevClash, InnoVenture, PulseTech, Nexus, Catalyst) with the key format and duration.",
    "",
    "2. description (BE IMMERSIVE, VIVID, MULTI-PARAGRAPH & INSPIRING):",
    "   - Write a rich, captivating, 3-paragraph description (120 to 220 words) with high energy and creative polish:",
    "     * Paragraph 1 (The Hook & Mission): Set the stage with an electrifying hook. Introduce the vision, the vibrant atmosphere, and why this event is an unmissable experience.",
    "     * Paragraph 2 (The Experience & Squad Dynamics): Detail what participants will do (rapid prototyping, collaborative problem-solving, hands-on building, mentor sessions). Explicitly weave in key details from the prompt such as duration (e.g., 'Over an intense 48-hour sprint...'), team dynamics (e.g., 'Collaborating in agile squads of 2 to 5 teammates...'), and total capacity (e.g., 'Uniting 500 ambitious creators...').",
    "     * Paragraph 3 (Prizes, Perks & Call to Action): Enthusiastically highlight the rewards, swag, and recognition. If the user mentions rewards (e.g., 'cash prizes and vouchers to top 15 teams'), feature them prominently (e.g., 'Compete for lucrative cash rewards, sponsor vouchers, and exclusive developer swag distributed among the top 15 teams!'). Conclude with an inspiring call to action prompting attendees to assemble their squad and register.",
    "   - NEVER produce a dry, 1-2 sentence summary.",
    "",
    "### FIELD EXTRACTION & DURATION RULES:",
    "1. type: One of the 10 Predefined Templates listed above, or 'Custom'.",
    "2. mode: 'online', 'offline', or 'hybrid'. Default to 'offline' unless online/virtual keywords are present.",
    "3. start_date & end_date (CRITICAL DURATION CALCULATION):",
    "   - start_date must be an ISO 8601 string resolved in the organizer's timezone offset.",
    "   - When the user specifies an event duration (e.g., '48 hours', '24 hours', '3 days', '2 hours', 'half day'):",
    "     YOU MUST CALCULATE end_date BY ADDING THE EXACT DURATION TO start_date!",
    "     Example: If start_date is November 30th at 9:00 AM and duration is '48 hours', end_date MUST be December 2nd at 9:00 AM!",
    "     If no duration is stated, default end_date to 3 to 4 hours after start_date.",
    "4. location: Physical venue name, address, or virtual meeting link. Use what the user stated in the prompt, OR preserve any location already present in 'Already collected'. If unspecified in both, leave as empty string \"\".",
    "5. capacity: Attendee capacity as integer (e.g., if user says 'capacity of 500', extract 500). Default 100 if unspecified.",
    "6. registration_type: 'team' if the prompt mentions teams, teammates, squad, or team sizes. Otherwise 'solo'.",
    "7. min_team_size: integer >= 1.",
    "   - If user mentions 'minimum teammates is 2' or 'at least 2', extract 2.",
    "   - For team events where unspecified, default to 2.",
    "   - For solo events, set to 1.",
    "8. max_team_size: integer >= 1.",
    "   - If user mentions 'max number of team members are 5' or 'up to 5', extract 5.",
    "   - FOR TEAM EVENTS, NEVER LEAVE max_team_size EMPTY OR NULL! Default to 4 or 5 if unspecified.",
    "   - For solo events, set to 1.",
    "9. registration_fee: Entry fee as number in INR (0 for free entry).",
    "10. registration_form_schema: Array of 4 to 6 relevant custom attendee registration questions tailored to this event type.",
    "    - Fixed profile fields (Name, Email, Phone) are already collected automatically, DO NOT duplicate them.",
    "    - For Hackathons: GitHub/Devpost Link, Tech Stack / Proficiencies, College/University, Graduation Year, T-Shirt Size, Dietary Preference.",
    "    - For Conferences: Company/Organization, Job Title/Designation, Experience Level, LinkedIn Profile.",
    "    - For Custom events: Intelligent domain-specific questions.",
    "    Each item must have: key (snake_case string), label (string), type ('text' | 'textarea' | 'number' | 'select' | 'checkbox'), required (boolean), and options (string array if select).",
    "11. reply: Cheerful, concise 1-2 sentence confirmation summarizing the creative event title, dates/duration, capacity/team limits, and attendee form.",
    "",
    "### STRICT JSON OUTPUT CONTRACT:",
    "Respond ONLY with a valid JSON object matching this exact schema (no markdown fences or commentary):",
    JSON.stringify({
      reply: "string",
      event: {
        title: "string",
        description: "string (3 vivid paragraphs separated by \\n\\n)",
        type: "string (exact template name or 'Custom')",
        mode: "online | offline | hybrid",
        start_date: "ISO 8601 string",
        end_date: "ISO 8601 string",
        location: "string",
        capacity: 100,
        registration_type: "solo | team",
        registration_fee: 0,
        min_team_size: 2,
        max_team_size: 5,
        registration_form_schema: [
          {
            key: "snake_case_key",
            label: "Question label",
            type: "text | textarea | number | select | checkbox",
            required: true,
            options: ["Only when type is select"],
          },
        ],
      },
    }),
  ].join("\n");
}

/**
 * Intelligent fallback generator that auto-evaluates the event context (title,
 * category, mode, location, prompt) and crafts a rich, high-quality description
 * whenever the AI model is overloaded, rate-limited, or in local mode.
 */
/**
 * Generates an imaginative, branded, and distinctive title.
 * Upgrades plain generic titles (like "Hackathon", "Conference", "Special Event")
 * into engaging titles with flair and clear identity.
 */
export function deriveCreativeTitle(
  rawTitle?: string,
  type?: string,
  prompt?: string
): string {
  const cleanRaw = (rawTitle || "").trim().replace(/[:\-_]+$/, "").trim();
  const lowerPrompt = (prompt || "").toLowerCase();
  const lowerRaw = cleanRaw.toLowerCase();

  const isGeneric =
    !cleanRaw ||
    cleanRaw.length < 15 ||
    /^(hackathon|conference|event|workshop|special event|48 hours hackathon|new event|meetup|summit|competition)$/i.test(
      cleanRaw
    ) ||
    lowerRaw.startsWith("hackathon which") ||
    lowerRaw.startsWith("event which") ||
    lowerRaw === "ultimate 48-hour innovation hackathon";

  if (!isGeneric) {
    return cleanRaw;
  }

  // Extract duration if present
  const durationMatch = lowerPrompt.match(/\b(\d{1,3})\s*[- ]*(?:hours?|hrs?)\b/i);
  const durationLabel = durationMatch ? `${durationMatch[1]}-Hour` : "";

  const dayMatch = lowerPrompt.match(/\b(\d{1,2})\s*[- ]*(?:days?)\b/i);
  const dayLabel = dayMatch ? `${dayMatch[1]}-Day` : "";

  const timeModifier = durationLabel || dayLabel || "";
  const modifier = timeModifier ? `${timeModifier} ` : "";

  if (
    type === "Hackathons and Competitions" ||
    lowerPrompt.includes("hackathon") ||
    lowerPrompt.includes("coding") ||
    lowerPrompt.includes("codeathon")
  ) {
    const names = [
      `CodeForge 2026: ${modifier}National Innovation Hackathon`,
      `ByteSprint 2026: ${modifier}High-Stakes Buildathon`,
      `HackSphere: ${modifier}Collaborative Engineering Sprint`,
      `DevClash 2026: ${modifier}Rapid Prototyping Arena`,
      `InnoVenture: ${modifier}Product & Venture Hackathon`,
    ];
    return names[lowerPrompt.length % names.length];
  }

  if (
    type === "Technical Conferences" ||
    lowerPrompt.includes("conference") ||
    lowerPrompt.includes("summit")
  ) {
    const names = [
      `TechPulse Summit 2026: ${modifier}Future of Intelligent Systems`,
      `DevNexus Global: ${modifier}Cloud & Architecture Conference`,
      `CognitiveCon 2026: ${modifier}Frontiers in Applied Tech`,
      `CloudHorizon: ${modifier}Next-Gen Engineering Summit`,
    ];
    return names[lowerPrompt.length % names.length];
  }

  if (
    type === "Academic and Training Events" ||
    lowerPrompt.includes("workshop") ||
    lowerPrompt.includes("bootcamp") ||
    lowerPrompt.includes("masterclass")
  ) {
    const names = [
      `SkillForge Masterclass: ${modifier || "Hands-On "}System Architecture Lab`,
      `DeepDive Academy: ${modifier || "Interactive "}Full-Stack Engineering`,
      `Catalyst Labs: ${modifier || "Practical "}Hands-On Masterclass`,
    ];
    return names[lowerPrompt.length % names.length];
  }

  if (type === "Corporate Events" || lowerPrompt.includes("corporate")) {
    const names = [
      "Synergy 2026: Annual Leadership & Innovation Summit",
      "Vanguard Horizons: Corporate Strategy & Milestone Assembly",
      "Apex Assembly: Annual Enterprise Strategy Summit",
    ];
    return names[lowerPrompt.length % names.length];
  }

  if (type === "Sports and Recreational Events" || lowerPrompt.includes("tournament")) {
    const names = [
      "Apex Arena 2026: National Championship Cup",
      "Titan League: Premier Athletics & Tournament Challenge",
      "Velocity Cup: Annual Sports & Athletics Invitational",
    ];
    return names[lowerPrompt.length % names.length];
  }

  if (type === "Exhibitions and Trade Shows" || lowerPrompt.includes("expo")) {
    const names = [
      "ExpoVision 2026: Global Innovation & Product Showcase",
      "TradeVenture Expo: Industry Leaders & Technology Pavilion",
      "NextGen Showcase: Annual Trade Fair & Innovation Expo",
    ];
    return names[lowerPrompt.length % names.length];
  }

  if (type === "Community and Nonprofit Events" || lowerPrompt.includes("community")) {
    const names = [
      "UnityPulse 2026: Community Impact & Social Action Summit",
      "Aura Gathering: Annual Neighborhood Cultural & Giving Gala",
      "Kindred Horizon: Grassroots Action & Community Festival",
    ];
    return names[lowerPrompt.length % names.length];
  }

  if (type === "Weddings and Personal Events") {
    return "Grand Celebration: Joyous Milestones & Family Gala";
  }

  if (cleanRaw && cleanRaw.length > 5 && !/^(event|special event)$/i.test(cleanRaw)) {
    return cleanRaw.charAt(0).toUpperCase() + cleanRaw.slice(1);
  }

  return "Apex Horizon: Innovation & Community Gathering";
}

/**
 * Intelligent generator that crafts a captivating, high-energy, multi-paragraph
 * event description. Automatically weaves in duration, capacity, squad limits,
 * venue info, and prize details extracted from the prompt.
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
  const lowerPrompt = prompt.toLowerCase();
  const lowerCat = category.toLowerCase();

  const venueInfo =
    mode === "online"
      ? "streamed live across interactive virtual stages"
      : location
      ? `taking place in person at ${location}`
      : "hosted live at our designated premier venue";

  // Extract duration mention
  const durationMatch = lowerPrompt.match(/\b(\d{1,3})\s*(?:hours?|hrs?|days?)\b/i);
  const durationPhrase = durationMatch ? `an intensive ${durationMatch[0]} sprint` : "an exhilarating multi-session experience";

  // Extract capacity mention
  const capMatch = lowerPrompt.match(/\b(?:capacity\s*(?:of)?|for)\s*(\d[\d,]*)\b/i) ||
    lowerPrompt.match(/\b(\d[\d,]*)\s*(?:paticipants|participants|attendees|people)\b/i);
  const capPhrase = capMatch ? `Bringing together ${capMatch[1]} passionate builders and visionaries` : "Uniting creators, developers, and leaders";

  // Extract squad/team size mentions
  const minTeamMatch = lowerPrompt.match(/min\w*\s*(?:number\s*of\s*)?(?:team[\s-]*members?|teammates?|temmates?|members?)?\s*(?:is|are)?\s*(\d+)/i);
  const maxTeamMatch = lowerPrompt.match(/max\w*\s*(?:number\s*of\s*)?(?:team[\s-]*members?|teammates?|temmates?|members?)?\s*(?:is|are)?\s*(\d+)/i);
  let squadPhrase = "Collaborating in high-performing teams";
  if (minTeamMatch && maxTeamMatch) {
    squadPhrase = `Collaborating in dynamic squads of ${minTeamMatch[1]} to ${maxTeamMatch[1]} members`;
  } else if (maxTeamMatch) {
    squadPhrase = `Collaborating in squads of up to ${maxTeamMatch[1]} members`;
  }

  // Extract prizes / rewards
  const prizeMatch = lowerPrompt.match(/(?:prizes?|prizzes?|awards?|rewards?)\s*(?:including|like|worth|of)?\s*([^.;!\n]+)/i);
  const prizePhrase = prizeMatch
    ? `Top teams will be rewarded with fantastic prizes, including ${prizeMatch[1].trim()}, alongside industry recognition and exclusive partner perks!`
    : "Top performers will be recognized with prestigious awards, certificates of excellence, and exclusive perks!";

  if (
    lowerCat.includes("hackathon") ||
    lowerPrompt.includes("hackathon") ||
    lowerPrompt.includes("coding") ||
    lowerPrompt.includes("codeathon") ||
    lowerPrompt.includes("ideathon")
  ) {
    return [
      `Welcome to ${title}! Gear up for ${durationPhrase} designed to push the boundaries of technology, creativity, and rapid execution. ${capPhrase}, this hackathon is the premier launchpad to transform bold ideas into high-impact, functional prototypes.`,
      `${squadPhrase}, participants will tackle real-world problem statements across emerging technology domains. Throughout the event, you will receive hands-on guidance from industry mentors, access specialized development resources, and participate in technical checkpoints designed to sharpen your architecture and pitch.`,
      `The sprint culminates in an electrifying live demo showcase before a distinguished panel of industry judges. ${prizePhrase} Assemble your squad, bring your boldest ideas, and get ready to build the future!`,
    ].join("\n\n");
  }

  if (
    lowerCat.includes("conference") ||
    lowerPrompt.includes("conference") ||
    lowerPrompt.includes("summit") ||
    lowerPrompt.includes("symposium") ||
    lowerPrompt.includes("tech talk")
  ) {
    return [
      `Welcome to ${title}, a premier industry gathering ${venueInfo} exploring the forefront of technology, leadership, and digital transformation. ${capPhrase}, this summit unites pioneers, architects, and decision-makers shaping tomorrow's technology landscape.`,
      `Immerse yourself in thought-provoking keynote presentations, in-depth panel debates, and interactive breakout sessions. Attendees will delve into scalable architecture, artificial intelligence, cloud-native paradigms, and modern engineering practices delivered by world-class practitioners.`,
      `Beyond technical sessions, engage in curated executive networking, sponsor discovery zones, and peer roundtable discussions. Whether you are leading engineering initiatives or driving technological innovation, ${title} provides actionable strategies and meaningful connections to accelerate your vision.`,
    ].join("\n\n");
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
    return [
      `Elevate your technical mastery with ${title}! This comprehensive, hands-on masterclass ${venueInfo} is meticulously engineered to bridge the gap between foundational theory and production-grade implementation.`,
      `Guided by seasoned mentors and domain specialists, attendees will participate in live coding walkthroughs, architectural breakdowns, and hands-on laboratory exercises. You will gain direct experience tackling real-world edge cases and modern best practices.`,
      `Every participant receives structured course materials, interactive code templates, and a verified Certificate of Completion. Secure your enrollment today to fast-track your technical capabilities and stay ahead of the curve.`,
    ].join("\n\n");
  }

  if (
    lowerCat.includes("corporate") ||
    lowerPrompt.includes("corporate") ||
    lowerPrompt.includes("annual day") ||
    lowerPrompt.includes("offsite") ||
    lowerPrompt.includes("townhall")
  ) {
    return [
      `Join us for ${title}, an exclusive corporate gathering ${venueInfo} dedicated to celebrating team milestones, strategic alignment, and future horizons.`,
      `This summit brings together leadership, teams, and key stakeholders to reflect on landmark accomplishments, exchange cross-functional insights, and collaboratively map out strategic objectives for the upcoming year.`,
      `Experience inspiring keynote addresses, interactive workshops, and curated evening celebrations that foster camaraderie and strong team synergy. Together, let us celebrate our journey and set new benchmarks for excellence.`,
    ].join("\n\n");
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
    return [
      `Be a catalyst for positive change with ${title}! A purposeful community gathering ${venueInfo} bringing together passionate changemakers, volunteers, and grassroots leaders dedicated to social impact.`,
      `Attendees will collaborate on meaningful community initiatives, share firsthand experiences, and take part in interactive discussions that drive sustainable local impact. Meet inspiring individuals and discover actionable ways to support causes that truly matter.`,
      `Every contribution counts toward building a more connected, resilient, and inclusive society. Join us to make a lasting difference, foster lifelong connections, and inspire our wider community!`,
    ].join("\n\n");
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
    return [
      `Feel the adrenaline and passion at ${title}! An energetic sporting championship ${venueInfo} bringing athletes, teams, and fans together to celebrate athletic excellence, teamwork, and sportsmanship.`,
      `Competitors will battle across high-stakes fixtures, testing their stamina, strategy, and teamwork in front of enthusiastic spectators. Experience the thrill of competitive play supported by professional referees and event coordinators.`,
      `${prizePhrase} Step onto the field, unleash your full potential, and play for glory!`,
    ].join("\n\n");
  }

  if (
    lowerCat.includes("exhibition") ||
    lowerPrompt.includes("expo") ||
    lowerPrompt.includes("trade show") ||
    lowerPrompt.includes("fair")
  ) {
    return [
      `Step into the future at ${title}! A premier trade exhibition and showcase ${venueInfo} featuring groundbreaking innovations, interactive vendor pavilions, and live product debuts.`,
      `Explore curated booths from industry leaders and emerging startups, witness live technology demonstrations, and engage directly with product engineers and innovators. Discover trends reshaping the marketplace and uncover new strategic partnerships.`,
      `Whether you are sourcing next-generation solutions, expanding your professional network, or seeking investment opportunities, ${title} is the ultimate gateway to industry progress.`,
    ].join("\n\n");
  }

  if (
    lowerCat.includes("wedding") ||
    lowerCat.includes("personal") ||
    lowerPrompt.includes("party") ||
    lowerPrompt.includes("celebration") ||
    lowerPrompt.includes("reception")
  ) {
    return [
      `Join us in celebrating ${title}! A joyful and heartwarming milestone ${venueInfo} bringing friends, family, and loved ones together in celebration of love, unity, and cherished memories.`,
      `Enjoy an enchanting evening filled with delightful music, exquisite dining, heartfelt speeches, and celebratory festivities. We look forward to sharing this unforgettable milestone surrounded by the warmth and blessings of everyone who matters most.`,
      `Your presence will make this special day truly complete. Come celebrate, dance, and create beautiful memories that will be treasured for a lifetime!`,
    ].join("\n\n");
  }

  return [
    `Welcome to ${title}! An extraordinary event ${venueInfo} designed to foster innovation, deep learning, and vibrant collaboration. ${capPhrase}, this gathering provides an inspiring platform to explore new ideas and expand your horizons.`,
    `Attendees will experience a dynamic program featuring interactive sessions, hands-on demonstrations, and insightful discussions led by experienced practitioners. Connect with visionary peers, exchange valuable perspectives, and gain actionable takeaways tailored to your growth.`,
    `Reserve your place today to be part of an unforgettable experience that inspires and empowers!`,
  ].join("\n\n");
}

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
  if (patch.registration_type === "team") {
    let min = Number(patch.min_team_size ?? 0);
    let max = Number(patch.max_team_size ?? 0);
    if (min <= 0) min = 2;
    if (max <= 0) max = Math.max(min, 4);
    if (min > max) min = max;
    patch.min_team_size = min;
    patch.max_team_size = max;
  } else if (patch.registration_type === "solo") {
    patch.min_team_size = 1;
    patch.max_team_size = 1;
  }

  // End must be after start.
  if (patch.start_date && patch.end_date) {
    const start = new Date(patch.start_date).getTime();
    const end = new Date(patch.end_date).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
      patch.end_date = new Date(start + 3 * 60 * 60 * 1000).toISOString();
    }
  }

  if (Array.isArray(source.registration_form_schema)) {
    const validTypes = ["text", "textarea", "number", "select", "checkbox"];
    const fixedKeys = new Set(["name", "full_name", "email", "email_address", "phone", "phone_number"]);

    const fields = source.registration_form_schema
      .filter((item: any) => item && typeof item === "object")
      .map((item: any, index: number) => {
        const label = String(item.label || item.key || "").trim();
        const key = String(item.key || label)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 30) || `custom_${index + 1}`;
        const type = validTypes.includes(String(item.type).toLowerCase())
          ? String(item.type).toLowerCase()
          : "text";
        const required = Boolean(item.required);
        let options: string[] | undefined = undefined;
        if (type === "select") {
          const parsedOptions = Array.isArray(item.options)
            ? item.options.map((o: unknown) => String(o).trim()).filter(Boolean)
            : [];
          options = parsedOptions.length > 0 ? parsedOptions : ["Option 1", "Option 2"];
        }
        return {
          id: item.id || `reg_${Date.now()}_${index + 1}`,
          key,
          label,
          type,
          required,
          options,
        };
      })
      .filter((item: any) => item.label && !fixedKeys.has(item.key));

    if (fields.length > 0) {
      patch.registration_form_schema = fields;
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

  const systemText = buildSystemInstruction(input.knownTypes || []);
  const candidateModels = Array.from(
    new Set([
      gemini.model,
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite",
      "gemini-flash-lite-latest",
    ])
  ).filter(Boolean);

  // Try the configured model first and fail over immediately across fast
  // fallback models on timeout/503 instead of sleeping on a hung model.
  // Omitting responseSchema avoids Gemini 3's slow constrained-decoding state
  // machine while keeping responseMimeType: "application/json" + prompt schema.
  let lastError: unknown;
  for (let i = 0; i < candidateModels.length; i += 1) {
    const modelToTry = candidateModels[i];
    const url = `${GEMINI_BASE_URL}/${modelToTry}:generateContent?key=${gemini.apiKey}`;
    const generationConfig: Record<string, unknown> = {
      temperature: 0.35,
      responseMimeType: "application/json",
    };
    const thinkingConfig = buildThinkingConfig(modelToTry);
    if (thinkingConfig) {
      generationConfig.thinkingConfig = thinkingConfig;
    }

    const payload = {
      system_instruction: { parts: [{ text: systemText }] },
      contents,
      generationConfig,
    };

    try {
      const timeout = i === 0 ? GEMINI_TIMEOUT_MS : GEMINI_FALLBACK_TIMEOUT_MS;
      const response = await axios.post(url, payload, { timeout });

      const candidateText =
        response.data?.candidates?.[0]?.content?.parts
          ?.map((part: { text?: string }) => part.text || "")
          .join("") || "";

      const parsed = extractJson(candidateText);
      if (!parsed || typeof parsed !== "object") {
        lastError = new Error(`Model ${modelToTry} returned invalid JSON`);
        continue;
      }

      const rawEvent =
        parsed.event && typeof parsed.event === "object"
          ? parsed.event
          : parsed;

      return {
        reply: typeof parsed.reply === "string" ? parsed.reply : "",
        patch: normaliseExtraction(rawEvent),
      };
    } catch (error: any) {
      lastError = error;
      const status = error?.response?.status;
      console.warn(
        `[AI_EVENT] model ${modelToTry} failed (${status || error?.message || "unknown"}), trying next fallback...`
      );
      if (status === 401 || status === 403) break;
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

    if (source === "gemini") {
      // When Gemini succeeds, preserve the AI's intelligent extraction (including durations and team sizes).
      // Only backfill any fields left undefined by the model AND not already present in the incoming draft.
      for (const [key, val] of Object.entries(localPatch)) {
        if (val !== undefined && val !== null && (patch as any)[key] === undefined) {
          if (incomingDraft[key] !== undefined && (key === "type" || key === "title")) {
            continue;
          }
          (patch as any)[key] = val;
        }
      }
      patch = normaliseExtraction(patch);
    } else {
      // Local fallback mode: use deterministic local extractor, preserving existing title/category on follow-ups
      const fallbackPatch = { ...localPatch };
      if (incomingDraft.type && fallbackPatch.type === "Custom") {
        delete fallbackPatch.type;
      }
      if (incomingDraft.title && (!fallbackPatch.title || message.trim().split(/\s+/).length < 6)) {
        delete fallbackPatch.title;
      }
      patch = normaliseExtraction(fallbackPatch);
    }

    // Ensure title is present and creative without clobbering an existing title on short follow-ups
    const hasExistingTitle =
      typeof incomingDraft.title === "string" && incomingDraft.title.trim().length > 0;
    if (patch.title || !hasExistingTitle) {
      patch.title = deriveCreativeTitle(
        patch.title || localPatch.title,
        patch.type || (incomingDraft.type as string) || localPatch.type,
        message
      );
    }

    // Always auto-evaluate and fill a rich, relevant description unless an existing creative one should be preserved
    const hasExistingDescription =
      typeof incomingDraft.description === "string" &&
      incomingDraft.description.trim().length >= 80;
    const isDescriptionPromptEcho =
      !patch.description ||
      patch.description.trim().length < 80 ||
      patch.description.trim().toLowerCase() === message.toLowerCase() ||
      /^(?:create|make|plan|schedule|host|organize|set up|i want to|we want to|please create)\b/i.test(
        patch.description.trim()
      );

    if (isDescriptionPromptEcho && !hasExistingDescription) {
      patch.description = evaluateAndGenerateDescription({
        title: patch.title || (incomingDraft.title as string),
        type: patch.type || (incomingDraft.type as string) || localPatch.type,
        mode: patch.mode || (incomingDraft.mode as string) || localPatch.mode,
        location: patch.location || (incomingDraft.location as string) || localPatch.location,
        prompt: message,
      });
    } else if (isDescriptionPromptEcho && hasExistingDescription) {
      delete patch.description;
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
