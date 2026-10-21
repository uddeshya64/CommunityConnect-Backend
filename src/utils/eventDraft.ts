/**
 * Canonical event draft helpers.
 *
 * SINGLE SOURCE OF TRUTH for the AI event creator.
 *
 * The `EventDraft` shape below is exactly the payload accepted by the existing
 * `POST /api/events` endpoint (see `src/validation/event.validation.ts` ->
 * `CreateEventSchema`). It maps 1:1 onto the Prisma `Event` model / `events`
 * table (see `prisma/schema.prisma`):
 *
 *   title, description, mode, banner_url, logo_url, start_date, end_date,
 *   location, capacity, registration_type, registration_fee, min_team_size,
 *   max_team_size, rewards, custom_fields, custom_form_schema
 *
 * The only naming difference from the table is `type` (a human readable name)
 * instead of `type_id` (a foreign key). `EventService.createEvent` already
 * resolves/creates the `EventType` row from the name, so the AI flow reuses
 * that exact behaviour instead of inventing a second representation.
 *
 * @file utils/eventDraft.ts
 */

import { CreateEventSchema } from "../validation/event.validation";
import type { z } from "zod";

/** Payload accepted by POST /api/events, after validation (Dates, numbers). */
export type EventDraft = z.infer<typeof CreateEventSchema>;

/**
 * The draft wire format shared by the AI, the review form, the CSV and the
 * upload flow. Field names are the real `events` column names; dates are ISO
 * strings and are converted to `Date` by `CreateEventSchema` (`z.coerce.date`)
 * inside `validateEventDraft`.
 */
export interface EventDraftPatch {
  /** Mirrors `events.id`; informational only, never used as a write key. */
  event_id?: string | number;
  title?: string;
  description?: string;
  type?: string;
  mode?: (typeof EVENT_MODES)[number];
  start_date?: string;
  end_date?: string;
  location?: string;
  capacity?: number;
  registration_type?: string;
  registration_fee?: number;
  min_team_size?: number;
  max_team_size?: number;
  banner_url?: string;
  logo_url?: string;
  rewards?: Record<string, unknown>;
  custom_fields?: Record<string, unknown>;
  custom_form_schema?: unknown[];
}

/** Values still unknown / empty during the conversation. */
export type EventDraftValues = Record<string, unknown>;

export const EVENT_MODES = ["online", "offline", "hybrid"] as const;

/** The existing frontend template names, used to normalise an AI category. */
export const KNOWN_EVENT_TYPES = [
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
] as const;

/**
 * Field metadata used to
 *  - decide what is still missing,
 *  - build clarification questions for the AI conversation,
 *  - render the review form on the frontend.
 *
 * `key` values are the real `Event` / `events` column names (API spelling).
 */
export interface EventDraftFieldMeta {
  key: keyof EventDraftPatch;
  label: string;
  /** Prompt used when the AI asks the user for this value. */
  question: string;
  /** `true` when the existing CreateEventSchema requires a usable value. */
  required: boolean;
}

export const EVENT_DRAFT_FIELDS: EventDraftFieldMeta[] = [
  {
    key: "title",
    label: "Title",
    question: "What is the name of the event?",
    required: true,
  },
  {
    key: "description",
    label: "Description",
    question:
      "Please describe the event in a little more detail (at least 20 characters) so attendees know what to expect.",
    required: true,
  },
  {
    key: "type",
    label: "Category",
    question: "What category does this event belong to?",
    required: true,
  },
  {
    key: "mode",
    label: "Mode",
    question: "Is the event online, offline (in person) or hybrid?",
    required: true,
  },
  {
    key: "start_date",
    label: "Start date & time",
    question: "When does the event start (date and time)?",
    required: true,
  },
  {
    key: "end_date",
    label: "End date & time",
    question: "When does the event end (date and time)?",
    required: true,
  },
  {
    key: "location",
    label: "Location",
    question: "Where is the event being held (venue or meeting link)?",
    required: false,
  },
  {
    key: "capacity",
    label: "Capacity",
    question: "How many people can attend?",
    required: false,
  },
  {
    key: "registration_type",
    label: "Registration type",
    question: "Is registration for a single participant or for a team?",
    required: true,
  },
  {
    key: "registration_fee",
    label: "Registration fee",
    question: "What is the registration fee? (0 if it is free)",
    required: true,
  },
  {
    key: "min_team_size",
    label: "Minimum team size",
    question: "What is the minimum team size?",
    required: true,
  },
  {
    key: "max_team_size",
    label: "Maximum team size",
    question: "What is the maximum team size?",
    required: true,
  },
];

const FIELD_META_BY_KEY = new Map(EVENT_DRAFT_FIELDS.map((f) => [f.key, f]));

/** `true` when the value is present enough for the existing schema. */
export function isDraftValuePresent(
  key: string,
  value: unknown
): boolean {
  if (value === null || value === undefined) return false;

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) return value.length > 0;

  if (typeof value === "object") return Object.keys(value).length > 0;

  return true;
}

/**
 * Keys of the required fields that are still missing/invalid.
 * `mode` and `type` are enum-ish values, so they are checked with the real
 * allowed sets instead of a plain emptiness test.
 */
export function computeMissingFields(
  draft: EventDraftValues
): string[] {
  const missing: string[] = [];

  for (const field of EVENT_DRAFT_FIELDS) {
    if (!field.required) continue;

    const value = draft?.[field.key];

    if (!isDraftValuePresent(field.key, value)) {
      missing.push(field.key);
      continue;
    }

    if (field.key === "mode" && !EVENT_MODES.includes(value as never)) {
      missing.push(field.key);
      continue;
    }

    if (
      (field.key === "start_date" || field.key === "end_date") &&
      Number.isNaN(new Date(value as string).getTime())
    ) {
      missing.push(field.key);
    }
  }

  return missing;
}

/** Human readable clarification questions for everything still missing. */
export function buildClarificationQuestions(
  draft: EventDraftValues
): string[] {
  return computeMissingFields(draft)
    .map((key) => FIELD_META_BY_KEY.get(key as keyof EventDraftPatch)?.question)
    .filter((q): q is string => Boolean(q));
}

export function isDraftComplete(draft: EventDraftValues): boolean {
  return computeMissingFields(draft).length === 0;
}

/** Shallow merge that ignores `undefined` / `null` incoming values. */
export function mergeDraft<T extends EventDraftValues>(
  current: T,
  patch: EventDraftPatch | EventDraftValues
): T {
  const next: EventDraftValues = { ...current };

  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    next[key] = value;
  }

  return next as T;
}

/**
 * Best-effort mapping of a free-form category coming from the AI onto one of
 * the existing event type names. Unknown categories are kept as-is, which is
 * valid: `EventService.createEvent` creates a custom `EventType` for them.
 */
export function normaliseEventType(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";

  const lower = raw.toLowerCase();

  const exact = KNOWN_EVENT_TYPES.find(
    (t) => t.toLowerCase() === lower
  );
  if (exact) return exact;

  const partial = KNOWN_EVENT_TYPES.find(
    (t) =>
      t.toLowerCase().includes(lower) ||
      lower.includes(t.toLowerCase())
  );
  if (partial) return partial;

  return raw.slice(0, 50);
}

export interface DraftValidationResult {
  valid: boolean;
  /** Values that pass the existing CreateEventSchema. */
  event: EventDraft | null;
  /** Field level messages, keyed by event column name. */
  errors: Record<string, string[]>;
  missing_fields: string[];
}

function flattenZodIssues(
  error: z.ZodError
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.length
      ? String(issue.path[issue.path.length - 1])
      : "_root";
    if (!errors[key]) errors[key] = [];
    errors[key].push(issue.message);
  }

  return errors;
}

/**
 * THE validation step. Reuses the project's existing `CreateEventSchema`
 * verbatim, so the AI flow can never drift from `POST /api/events`.
 */
export function validateEventDraft(
  input: unknown
): DraftValidationResult {
  const parsed = CreateEventSchema.safeParse(input);

  if (!parsed.success) {
    const errors = flattenZodIssues(parsed.error);
    const draftValues = (input || {}) as EventDraftValues;

    return {
      valid: false,
      event: null,
      errors,
      missing_fields: computeMissingFields(draftValues),
    };
  }

  return {
    valid: true,
    event: parsed.data,
    errors: {},
    missing_fields: [],
  };
}
