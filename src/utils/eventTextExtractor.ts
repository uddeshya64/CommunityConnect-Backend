/**
 * Deterministic transcript -> event extractor.
 *
 * This is the offline / no-API-key fallback for the AI event creator. It runs
 * on plain text (voice transcript or typed message) and produces values in the
 * exact shape of the existing event schema (see `utils/eventDraft.ts`).
 *
 * Keeping it pure (no I/O, no env) makes it directly unit-testable and gives
 * the AI provider a deterministic baseline to fall back to.
 *
 * @file utils/eventTextExtractor.ts
 */

import {
  normaliseEventType,
  type EventDraftPatch,
  type EventDraftValues,
} from "./eventDraft";

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTH_ALT = Object.keys(MONTHS).join("|");
const WEEKDAY_ALT = Object.keys(WEEKDAYS).join("|");

/** Words that should never be treated as a time-of-day. */
const TIME_FALSE_POSITIVES = ["online", "on line", "only", "one", "won"];

const CATEGORY_KEYWORDS: Array<[RegExp, string]> = [
  [/\b(hackathon|code ?fest|codeathon|coding competition|ideathon)\b/i, "Hackathons and Competitions"],
  [/\b(competition|contest|challenge)\b/i, "Hackathons and Competitions"],
  [/\b(conference|summit|symposium|tech talk|keynote)\b/i, "Technical Conferences"],
  [/\b(exhibition|expo|trade show|trade fair|stalls?|booths?)\b/i, "Exhibitions and Trade Shows"],
  [/\b(workshop|training|course|class|seminar|lecture|bootcamp|college|school|university|academic)\b/i, "Academic and Training Events"],
  [/\b(wedding|reception|engagement|mehndi|birthday|anniversary|party|ceremony)\b/i, "Weddings and Personal Events"],
  [/\b(sports?|tournament|cricket|football|kabaddi|marathon|5k|10k|marathon|yoga|badminton|volleyball|match)\b/i, "Sports and Recreational Events"],
  [/\b(government|municipal|nagar panchayat|civic|minister|swachhata|government drive)\b/i, "Government and Civic Events"],
  [/\b(corporate|company|annual day|offsite|internal|startup pitch|townhall)\b/i, "Corporate Events"],
  [/\b(virtual|webinar|livestream|live stream|streamed|online event)\b/i, "Hybrid and Virtual Events"],
  [/\b(community|nonprofit|non-profit|ngo|charity|donation|volunteer|clean ?up|awareness|outreach|social)\b/i, "Community and Nonprofit Events"],
  // Placed last so the more specific categories above still win. Bare
  // "celebration" is deliberately absent so a "wedding celebration" stays a
  // wedding, but named festivals are unambiguous.
  [/\b(festivals?|diwali|deepawali|holi|christmas|new year|navratri|durga puja|ganpati|janmashtami|eid|pongal|onam|ugadi|varalakshmi|thanksgiving|independence day|republic day|puja|garba|dandiya|jubilee|mela)\b/i, "Community and Nonprofit Events"],
];

const ONLINE_HINT =
  /\b(online|virtual|zoom|google meet|teams meet|webinar|livestream|live stream|stream(?:ed|ing)?|discord|whatsapp call|video call|online event)\b/i;
const OFFLINE_HINT =
  /\b(offline|in person|in-person|on ground|on-ground|venue|community hall|auditorium|stadium|college campus|school|ground|hall|centre|center|office park|hotel|resort)\b/i;

export interface ExtractedSchedule {
  start_date?: string;
  end_date?: string;
}

/**
 * Timezone handling.
 *
 * Spoken times ("at 10 am") are local to the organiser, not to the server, so
 * the offset is supplied by the browser (`new Date().getTimezoneOffset()`,
 * i.e. UTC - local in minutes). It is also what makes extraction deterministic
 * in tests.
 */
export interface ExtractOptions {
  now?: Date;
  /** Minutes to add to local time to reach UTC (JS `getTimezoneOffset()`). */
  timeZoneOffsetMinutes?: number;
}

function resolveOffset(options: ExtractOptions): number {
  return options.timeZoneOffsetMinutes ?? new Date().getTimezoneOffset();
}

function cleanNumber(raw: string): number {
  return Number(raw.replace(/[,\s]/g, ""));
}

function buildIso(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  offsetMinutes: number
): string {
  // `offsetMinutes` is "minutes to add to local time to reach UTC", which is
  // exactly what `Date.prototype.getTimezoneOffset()` returns (IST -> -330).
  const wallClockUtc = Date.UTC(year, month, day, hours, minutes, 0, 0);
  const date = new Date(wallClockUtc + offsetMinutes * 60_000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/** Resolve "today" / "tomorrow" / "next friday" style expressions. */
function resolveRelativeDate(
  text: string,
  now: Date
): { date: Date; matched: boolean } {
  const lower = text.toLowerCase();

  if (/\bday after tomorrow\b/.test(lower)) {
    return { date: addDays(now, 2), matched: true };
  }
  if (/\btomorrow\b/.test(lower)) {
    return { date: addDays(now, 1), matched: true };
  }
  if (/\btoday\b|\btonight\b|\bthis (evening|afternoon|morning)\b/.test(lower)) {
    return { date: new Date(now.getTime()), matched: true };
  }

  const weekdayMatch = lower.match(
    new RegExp(`\\b(?:(next|this|coming)\\s+)?(${WEEKDAY_ALT})\\b`)
  );

  if (weekdayMatch) {
    const qualifier = weekdayMatch[1];
    const target = WEEKDAYS[weekdayMatch[2]];
    const current = now.getDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7;
    if (qualifier === "next" && delta < 7) delta += 0; // next week, not today
    return { date: addDays(now, delta), matched: true };
  }

  return { date: new Date(now.getTime()), matched: false };
}

export interface TimeOfDay {
  hours: number;
  minutes: number;
}

/** Parse "10", "10:30", "10 am", "7:05 pm", "10 AM" into a time of day. */
export function parseTimeOfDay(
  raw: string
): TimeOfDay | null {
  const cleaned = raw.toLowerCase().replace(/\./g, "").trim();

  // Speech-to-text emits "6pm" / "10am" with no space, and the dots in "p.m." are
  // optional. A \b in front of the meridiem never matches a glued form, so "6pm"
  // silently parsed as 06:00, which then looked earlier than the start time and got
  // rewritten to start + 3h. Anchor to the end of the token instead.
  const meridiemMatch = cleaned.match(/(am|pm)$/);
  const meridiem = meridiemMatch?.[1];
  const value = meridiemMatch
    ? cleaned.slice(0, meridiemMatch.index).trim()
    : cleaned;

  const parts = value.split(":");
  if (parts.length > 2) return null;

  let hours = cleanNumber(parts[0] || "");
  const minutes = parts.length === 2 ? cleanNumber(parts[1]) : 0;

  if (!Number.isFinite(hours)) return null;
  if (!Number.isFinite(minutes)) return null;

  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return { hours, minutes };
}

const TIME_TOKEN = String.raw`\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|o'?clock)?`;

interface TimeHit {
  value: string;
  start: number;
  end: number;
}

function findTimeTokens(text: string): TimeHit[] {
  const hits: TimeHit[] = [];
  const pattern = new RegExp(TIME_TOKEN, "gi");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const value = match[0];
    const lower = value.toLowerCase();

    if (TIME_FALSE_POSITIVES.some((bad) => lower === bad.trim())) continue;
    // Ignore a bare number that is clearly not a clock time (e.g. "team of 4").
    if (!/[:apm]|o'clock/i.test(lower) && cleanNumber(value) > 24) continue;
    // "10" without any time marker is only a time when it follows a time word.
    if (!/[:apm]|o'clock/i.test(lower)) {
      const before = text.slice(Math.max(0, match.index - 18), match.index);
      if (!/\b(at|from|till|until|to|by|starting|starts|ends|@\s*)\s*$/.test(before)) {
        continue;
      }
    }

    hits.push({
      value,
      start: match.index,
      end: match.index + value.length,
    });
  }

  return hits;
}

interface DateHit {
  year: number;
  month: number;
  day: number;
}

/** Levenshtein distance, used only for short month-name prefixes. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, i) => i);

  for (let i = 1; i < rows; i += 1) {
    const curr = [i];
    for (let j = 1; j < cols; j += 1) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }

  return prev[cols - 1];
}

/**
 * Speech-to-text routinely mis-spells month names ("31 ocyt2026"). Only a
 * one-character difference in the first three letters is accepted, and only after
 * an exact match has already failed, so real words are not turned into dates.
 */
function fuzzyMonth(token: string): number | undefined {
  const needle = token.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3);
  if (needle.length < 3) return undefined;

  let best: number | undefined;
  let bestDistance = 2;

  for (const [name, index] of Object.entries(MONTHS)) {
    const distance = editDistance(needle, name.slice(0, 3));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }

  return bestDistance <= 1 ? best : undefined;
}

function findExplicitDates(text: string): DateHit[] {
  const results: DateHit[] = [];
  const nowYear = new Date().getFullYear();

  // 2026-10-15 / 2026/10/15 (optionally followed by T<time>)
  const isoPattern = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  let match: RegExpExecArray | null;
  while ((match = isoPattern.exec(text)) !== null) {
    const year = cleanNumber(match[1]);
    const month = cleanNumber(match[2]) - 1;
    const day = cleanNumber(match[3]);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      results.push({ year, month, day });
    }
  }

  // 15/10/2026 or 10-15-2026  (day-first unless the first token cannot be a day)
  const numericPattern = /\b(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?\b/g;
  while ((match = numericPattern.exec(text)) !== null) {
    const first = cleanNumber(match[1]);
    const second = cleanNumber(match[2]);
    const rawYear = match[3] ? cleanNumber(match[3]) : undefined;
    if (first > 31 || second > 31 || first === 0 || second === 0) continue;

    let day = first;
    let month = second;
    if (first <= 12 && second > 12) {
      day = second;
      month = first;
    }
    let year = rawYear ?? nowYear;
    if (year < 100) year += 2000;

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      results.push({ year, month: month - 1, day });
    }
  }

  // 15th October 2026 / October 15, 2026
  const namedPattern = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_ALT})\\.?\\s*,?\\s*(\\d{4})?\\b`,
    "gi"
  );
  while ((match = namedPattern.exec(text)) !== null) {
    const day = cleanNumber(match[1]);
    const month = MONTHS[match[2].toLowerCase()];
    const year = match[3] ? cleanNumber(match[3]) : nowYear;
    if (month === undefined || day < 1 || day > 31) continue;
    results.push({ year, month, day });
  }

  const monthFirstPattern = new RegExp(
    `\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})?\\b`,
    "gi"
  );
  while ((match = monthFirstPattern.exec(text)) !== null) {
    const month = MONTHS[match[1].toLowerCase()];
    const day = cleanNumber(match[2]);
    const year = match[3] ? cleanNumber(match[3]) : nowYear;
    if (month === undefined || day < 1 || day > 31) continue;
    results.push({ year, month, day });
  }

  // Last resort for a mis-typed month name. Only runs when nothing above matched,
  // and only accepts a near-identical three letter prefix, so "31 ocyt2026" resolves
  // to 31 October without letting ordinary words become dates.
  if (results.length === 0) {
    const loosePattern =
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?\s*,?\s*(\d{4})?\b/gi;
    while ((match = loosePattern.exec(text)) !== null) {
      const month = fuzzyMonth(match[2]);
      if (month === undefined) continue;
      const day = cleanNumber(match[1]);
      if (day < 1 || day > 31) continue;
      results.push({
        year: match[3] ? cleanNumber(match[3]) : nowYear,
        month,
        day,
      });
    }
  }

  return results;
}

/**
 * Resolve every date/time mention in the transcript into an ISO start/end pair.
 * Handles explicit dates, relative dates and "from 10 am to 4 pm" style ranges.
 */
export function extractSchedule(
  text: string,
  options: ExtractOptions | Date = {}
): ExtractedSchedule {
  const opts: ExtractOptions =
    options instanceof Date ? { now: options } : options;
  const now = opts.now ?? new Date();
  const offset = resolveOffset(opts);

  const lower = text.toLowerCase();
  const explicitDates = findExplicitDates(text);
  const relative = resolveRelativeDate(lower, now);
  const timeTokens = findTimeTokens(text);

  const datePart: DateHit | null = explicitDates[0] || null;
  const secondDate: DateHit | null = explicitDates[1] || null;

  let start: string | undefined;
  let end: string | undefined;

  const startTime = timeTokens[0] ? parseTimeOfDay(timeTokens[0].value) : null;
  const endTime = timeTokens[1] ? parseTimeOfDay(timeTokens[1].value) : null;

  // Detect an explicit range such as "from 10 am to 4 pm" / "10am-1pm".
  const rangeMatch = lower.match(
    new RegExp(
      `\\b(?:from|between)\\s+(${TIME_TOKEN})\\s*(?:to|and|till|until|thru|through|[-–—])\\s*(${TIME_TOKEN})`,
      "i"
    )
  );

  // An explicit range is the most reliable statement of intent, so prefer it over
  // whatever the positional time tokens happened to pick up.
  const fromTime = rangeMatch ? parseTimeOfDay(rangeMatch[1]) : startTime;
  const toTime = rangeMatch ? parseTimeOfDay(rangeMatch[2]) : endTime;

  if (datePart) {
    const from = fromTime?.hours ?? 10;
    const fromMinutes = fromTime?.minutes ?? 0;
    start = buildIso(
      datePart.year,
      datePart.month,
      datePart.day,
      from,
      fromMinutes,
      offset
    );

    const to = toTime?.hours ?? 17;
    const toMinutes = toTime?.minutes ?? 0;
    end = buildIso(
      datePart.year,
      datePart.month,
      datePart.day,
      to,
      toMinutes,
      offset
    );

    if (secondDate) {
      end = buildIso(
        secondDate.year,
        secondDate.month,
        secondDate.day,
        toTime?.hours ?? 17,
        toTime?.minutes ?? 0,
        offset
      );
    }
  } else if (relative.matched) {
    const base = relative.date;
    const from = fromTime?.hours ?? 10;
    const fromMinutes = fromTime?.minutes ?? 0;
    start = buildIso(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      from,
      fromMinutes,
      offset
    );

    const to = toTime?.hours ?? 17;
    end = buildIso(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      to,
      toTime?.minutes ?? 0,
      offset
    );
  }

  if (start && end && new Date(end) <= new Date(start)) {
    const shifted = new Date(new Date(start).getTime() + 3 * 60 * 60 * 1000);
    end = shifted.toISOString();
  }

  return { start_date: start, end_date: end };
}

function extractMode(text: string): "online" | "offline" | "hybrid" | undefined {
  // People say "hybrid" outright. Neither hint regex contains that word, so it was
  // ignored and a sentence like "hybrid event at Community Hall" resolved to
  // offline purely because of the venue.
  if (/\bhybrid\b/i.test(text)) return "hybrid";

  const isOnline = ONLINE_HINT.test(text);
  const isOffline = OFFLINE_HINT.test(text);

  if (isOnline && isOffline) return "hybrid";
  if (isOnline) return "online";
  if (isOffline) return "offline";
  return undefined;
}

function extractCapacity(text: string): number | undefined {
  // The gap has to be wide enough for spoken phrasing such as
  // "the capacity of the event is 5", where 18 characters sit between the keyword
  // and the number.
  const match = text.match(
    /\b(?:capacity|seats?|slots?|participants?|attendees?|people|persons?|students?|members?)\b\D{0,24}?(\d[\d,]{0,5})\b/i
  );
  if (match) {
    const value = cleanNumber(match[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const forMatch = text.match(/\bfor\s+(?:about\s+|around\s+|nearly\s+)?(\d[\d,]{0,5})\s*(?:people|persons?|students?|participants?|attendees?|members?)\b/i);
  if (forMatch) {
    const value = cleanNumber(forMatch[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return undefined;
}

function extractFee(text: string): number | undefined {
  if (/\b(free|no cost|free of cost|free entry|entry is free|free registration|no registration fee|zero (?:rs|rupees|₹))\b/i.test(text)) {
    return 0;
  }

  const match = text.match(
    /(?:₹|rs\.?|inr|rupees?)\s*(\d[\d,]{0,6})|(\d[\d,]{0,6})\s*(?:₹|rs\.?|inr|rupees?)\b/i
  );

  if (match) {
    const value = cleanNumber(match[1] || match[2]);
    if (Number.isFinite(value) && value >= 0 && value <= 100000) return value;
  }

  return undefined;
}

function extractTeamSizes(
  text: string
): { registration_type?: string; min_team_size?: number; max_team_size?: number } {
  const result: {
    registration_type?: string;
    min_team_size?: number;
    max_team_size?: number;
  } = {};

  const solo = /\b(solo|single participant|individual entry|individual participation|one per participant|no teams?|not a team)\b/i.test(text);
  const team = /\b(teams?|group of|group entry|participat\w+ as a team|team based|team of)\b/i.test(text);

  if (solo) result.registration_type = "solo";
  else if (team) result.registration_type = "team";

  const upTo = text.match(
    /\b(?:up to|maximum of|max(?:imum)?|maximum)\s*(\d{1,2})\s*(?:members?|people|participants?|students?|per team)?/i
  );
  const atLeast = text.match(
    /\b(?:at least|minimum of|min(?:imum)?)\s*(\d{1,2})\s*(?:members?|people|participants?|students?|per team)?/i
  );
  const range = text.match(
    /\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:members?|people|participants?|students?|per team)\b/i
  );

  let max: number | undefined;
  let min: number | undefined;

  if (range) {
    min = cleanNumber(range[1]);
    max = cleanNumber(range[2]);
  }
  if (upTo) max = cleanNumber(upTo[1]);
  if (atLeast) min = cleanNumber(atLeast[1]);

  if (max !== undefined && max > 0 && max <= 100) {
    result.max_team_size = max;
    result.registration_type = result.registration_type ?? "team";
  }

  if (min !== undefined && min > 0 && min <= 100) {
    result.min_team_size = min;
  }

  // A team of one is a solo registration.
  if (result.max_team_size === 1 && !result.registration_type) {
    result.registration_type = "solo";
  }

  return result;
}

function extractType(text: string): string | undefined {
  for (const [pattern, type] of CATEGORY_KEYWORDS) {
    if (pattern.test(text)) return normaliseEventType(type);
  }
  return undefined;
}

function extractLocation(text: string): string | undefined {
  const patterns = [
    /\b(?:at|in|on)\s+((?:the\s+)?[A-Z0-9][\w'&.,\-]*(?:\s+[A-Z0-9][\w'&.,\-]*){0,5}\s+(?:Hall|Arena|Stadium|Campus|Center|Centre|Institute|Academy|Park|Ground|Club|School|College|University|Hotel|Resort|Museum|Library|Office|Mall|Building|Tower|Auditorium|Theatre|Theater|Hall))\b/,
    /\b(?:venue|location|address|venue is|held at|hosted at)\s*(?:is|at|:|-)?\s*([^.,;!?\n]{3,80})/i,
    /\b(https?:\/\/\S+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = match[1].trim().replace(/[.,;]+$/, "");
      if (value.length >= 3) return value;
    }
  }

  return undefined;
}

/**
 * Build a usable title out of a free-form sentence by dropping the logistics
 * ("on 15 October 2026", "9am-5pm", "capacity 250", "at Community Hall") and the
 * spoken filler, then keeping the descriptive part. Without this the fallback title
 * was the entire prompt, dates and times included.
 */
/**
 * Everything from the first logistics keyword onwards describes how the event is
 * run, not what it is called, so the title is derived only from what precedes it.
 * A bare "team" is deliberately not a boundary, since "Team Building Workshop" is
 * a real name.
 */
const LOGISTICS_BOUNDARY =
  /\b(?:capacity|registration|entry|admission|tickets?|fees?|price|team[\s-]*events?|solo[\s-]*events?|group[\s-]*events?|venue)\b/i;

/** Words that mark the end of an event name inside a spoken sentence. */
const TITLE_CLAUSE_BREAKERS = new Set([
  "it",
  "its",
  "also",
  "that",
  "this",
  "event",
  "events",
]);

function deriveTitleFrom(text: string): string {
  const boundary = LOGISTICS_BOUNDARY.exec(text);
  const head = boundary && boundary.index > 0 ? text.slice(0, boundary.index) : text;
  // Ignore an over-eager cut that would leave nothing meaningful to work with.
  const subject = head.trim().split(/\s+/).length >= 2 ? head : text;

  const candidate = subject
    // Prefix cleanup has to run before the global filler below. That filler strips
    // copulas ("is", "are"), which would otherwise turn "we are organizing" into
    // "we organizing" before the pronoun/verb rules ever get a look at it.
    .replace(/^(?:so|um|uh|hey|okay|ok)[,\s]+/i, "")
    .replace(/^(?:we|i|they|you)\s+(?:are|is|am|will|would|want|wants|'re|'m)\s+/i, "")
    .replace(
      /^(?:organis\w+|organiz\w+|hosting|host|conducting|doing|running|planning)\s+/i,
      ""
    )
    .replace(/^(?:a|an|the)\s+/i, "")
    // The venue has to go before the filler removes the preposition, otherwise
    // "at City Hospital" loses its "at" and leaves a bare "City" in the title.
    .replace(
      /\b(?:at|in|venue|location|address)\s+[A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,3}/g,
      " "
    )
    .replace(
      /\b(?:auditorium|amphitheatre|amphitheater|hall|venue|stadium|campus|centre|center|lounge|room|ground|grounds|office|hotel|resort)\b/gi,
      " "
    )
    // "Create an event for the Diwali celebration" -> "Diwali celebration". The verb
    // and "event" are both required so real titles such as "Create a Startup
    // Bootcamp" survive intact.
    .replace(
      /^(?:(?:please|can you|could you|i want to|i need to|we want to|we need to|help me)\s+)*(?:created|creating|create|made|making|make|added|adding|add|scheduled|scheduling|schedule|planned|planning|plan|organised|organized|organising|organizing|hosted|hosting|host|held|holding|hold|set up|started|starting|start)\b\s+(?:a|an|the)?\s*(?:new\s+)?(?:event|activity|webinar|workshop|meetup|session|occasion)?\s*(?:for|about|on|named|titled|called)?\s*/i,
      ""
    )
    // "team event" is a registration detail, but a bare "team" is often part of the
    // name ("Team Building Workshop"), so the noun phrase has to be removed as a unit.
    .replace(/\b(?:team|solo|group|individual)[\s-]*(?:based|only)?[\s-]*events?\b/gi, " ")
    .replace(/\b(?:events?)\b/gi, " ")
    .replace(/\b(?:also|and also|then|its|it'?s|['’]s|that'?s|is|are|was|were|or|at|on)\b/gi, " ")
    .replace(
      /\b(?:on|at|from)\s+\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,9}\.?(?:\s*,?\s*\d{4})?/gi,
      " "
    )
    .replace(
      /\b\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,9}\.?(?:\s*,?\s*\d{4})?\b/gi,
      " "
    )
    .replace(
      /\b[a-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?\b/gi,
      " "
    )
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(
      /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\s*(?:to|and|till|until|[-–—])\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?/gi,
      " "
    )
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b(?:capacity|seats?|slots?|participants?|attendees?|people)\b\D{0,24}?\d[\d,]*/gi, " ")
    .replace(/\bfor\s+\d[\d,]*\s*(?:people|persons?|students?|participants?|attendees?|members?)\b/gi, " ")
    .replace(/\b(?:at|in|venue|location|address)\s+[A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,3}/g, " ")
    .replace(
      /\b(?:auditorium|amphitheatre|amphitheater|hall|venue|stadium|campus|centre|center|lounge|auditorium|room|ground|grounds|office|hotel|resort)\b/gi,
      " "
    )
    .replace(
      /\b(?:today|tomorrow|tonight|yesterday|this|next|coming|upcoming)\s+(?:morning|afternoon|evening|night|saturday|sunday|monday|tuesday|wednesday|thursday|friday|week|month|year)\b/gi,
      " "
    )
    .replace(/[,;\s]*\b(?:entry|admission|registration|ticket|tickets|fee|fees|price)\b[^,.;]*/gi, " ")
    .replace(/\b(?:free|no entry fee|entry is free|registration is free)\b/gi, " ")
    .replace(/^(?:so|um|uh|and|but|okay|ok|hey)[,\s]+/i, "")
    .replace(/^(?:we|i|they|you)\s+(?:are|is|am|will|would|want|wants|'re|'m)\s+/i, "")
    .replace(/^(?:to|for|and|but|also)\s+/i, "")
    .replace(/^(?:organis\w+|organiz\w+|hosting|host|conducting|doing|running|planning)\s+/i, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(?:from|to|at|in|on|for|with|and|of|by)\s*$/i, "")
    .replace(/[,\s]+$/, "")
    .replace(/^(?:on|at|from|in|for|with|to|and)\s+/i, "")
    .trim();

  if (!candidate) return "";

  const kept: string[] = [];
  for (const word of candidate.split(" ")) {
    if (word) {
      const bare = word.toLowerCase().replace(/[^a-z']/g, "");
      // A clause marker ends the name: "Diwali celebration it is a team event"
      // must not become "Diwali celebration it a". "and"/"the" are left out
      // because they occur inside real names such as "Code for Cause".
      if (kept.length >= 1 && TITLE_CLAUSE_BREAKERS.has(bare)) break;
      kept.push(word);
      if (kept.length >= 8) break;
    }
  }

  const words = kept.join(" ");
  const titled = words.replace(/\b[a-z]/g, (c, i: number) => (i === 0 ? c.toUpperCase() : c));

  return titled.slice(0, 150);
}

function extractTitle(text: string): string | undefined {
  const explicit = text.match(
    /\b(?:called|named|titled|entitled)\s+(?:it\s+)?["“'‘]?([A-Za-z0-9][^"”'’.\n]{2,80}?)["”'’]?(?=\s+(?:on|at|from|which|that|in|for|is|was)\b|[.,!?]|$)/i
  );
  if (explicit?.[1]) {
    const value = explicit[1].trim();
    if (value.length >= 3) return value.slice(0, 150);
  }

  const quoted = text.match(/["“]([^"”]{3,80})["”]/);
  if (quoted?.[1]) return quoted[1].trim().slice(0, 150);

  const derived = deriveTitleFrom(text);
  if (derived.length >= 3) return derived;

  const firstClause = text
    .split(/[.!?\n]/)
    .map((part) => part.trim())
    .find((part) => part.length >= 5);

  if (!firstClause) return undefined;

  const cleaned = firstClause
    .replace(/^(so|um|uh|and|but|we|our|i|we're|we are)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 3) return undefined;

  const capitalised = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return capitalised.slice(0, 150);
}

function buildDescription(text: string): string {
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/^(um|uh|so|okay|ok)[,\s]*/i, "")
    .trim();

  if (cleaned.length >= 20) return cleaned.slice(0, 1000);

  return (
    cleaned
      ? `${cleaned}.`
      : "Event created with the Community Connect AI event creator."
  ).slice(0, 1000);
}

/**
 * Extract event fields from a transcript / user message.
 * Only fields that are actually present in the text are returned, so the
 * caller can merge the patch into the running draft without losing data.
 */
export function extractEventFromText(
  text: string,
  options: ExtractOptions | Date = {}
): EventDraftPatch {
  if (!text || !text.trim()) return {};

  const source = text.trim();
  const patch: EventDraftPatch = {};

  const title = extractTitle(source);
  if (title) patch.title = title;

  const description = buildDescription(source);
  if (description) patch.description = description;

  const type = extractType(source);
  if (type) patch.type = type;

  const mode = extractMode(source);
  if (mode) patch.mode = mode;

  const location = extractLocation(source);
  if (location) patch.location = location;

  const capacity = extractCapacity(source);
  if (capacity !== undefined) patch.capacity = capacity;

  const fee = extractFee(source);
  if (fee !== undefined) patch.registration_fee = fee;

  const team = extractTeamSizes(source);
  Object.assign(patch, team);

  // A team entry always needs a coherent min/max pair.
  if (patch.registration_type === "team" && !patch.min_team_size) {
    patch.min_team_size = 1;
  }

  // A solo entry means a single participant, so the existing schema's
  // min/max team size columns become 1 / 1.
  if (patch.registration_type === "solo") {
    if (patch.max_team_size === undefined) patch.max_team_size = 1;
    if (patch.min_team_size === undefined) patch.min_team_size = 1;
  }

  const schedule = extractSchedule(source, options);
  if (schedule.start_date) patch.start_date = schedule.start_date;
  if (schedule.end_date) patch.end_date = schedule.end_date;

  return patch;
}

export type { EventDraftValues };
