/**
 * CSV serialisation for Community Connect events.
 *
 * The CSV produced here is a faithful, round-trippable projection of the
 * existing event schema (`prisma/schema.prisma` -> `model Event`, table
 * `events`) using the same key names the existing `POST /api/events` endpoint
 * already accepts. `type` keeps its API name (the human readable event type)
 * because that is what `EventService.createEvent` resolves into `type_id`.
 *
 * Implementation notes
 *  - RFC 4180 compliant: fields containing a comma, a double quote, CR or LF
 *    are wrapped in double quotes and embedded quotes are doubled.
 *  - Rows are separated with CRLF, which Excel, LibreOffice, Google Sheets and
 *    `pg`'s COPY all understand.
 *  - UTF-8: emitted without a BOM by default (BOM is opt-in via
 *    `toCsvBuffer` options) and a BOM is tolerated when parsing.
 *  - No third party CSV dependency is required; the serialiser/parser below is
 *    covered by unit tests in `src/tests/eventCsv.test.ts`.
 *
 * @file utils/eventCsv.ts
 */

import type { EventDraftPatch } from "./eventDraft";

/**
 * What the serialiser accepts: the draft wire format (ISO date strings) as well
 * as an already validated event (`Date` objects).
 */
export type EventCsvRecord = Partial<
  Omit<EventDraftPatch, "start_date" | "end_date">
> & {
  start_date?: string | Date | number;
  end_date?: string | Date | number;
  /** Informational only: `events.id` for an existing event. */
  event_id?: unknown;
};

/**
 * Column order of the generated CSV.
 * `event_id` mirrors the `events.id` primary key and is informational only:
 * it is left empty for new events and ignored on import (a new row is created).
 */
export const EVENT_CSV_COLUMNS = [
  "event_id",
  "title",
  "description",
  "type",
  "mode",
  "start_date",
  "end_date",
  "location",
  "capacity",
  "registration_type",
  "registration_fee",
  "min_team_size",
  "max_team_size",
  "banner_url",
  "logo_url",
  "rewards",
  "custom_fields",
  "custom_form_schema",
] as const;

export type EventCsvColumn = (typeof EVENT_CSV_COLUMNS)[number];

/** Columns that hold a JSON document in the database. */
const JSON_COLUMNS = new Set<string>([
  "rewards",
  "custom_fields",
  "custom_form_schema",
]);

const COLUMN_ALIASES: Record<string, EventCsvColumn> = {
  event_id: "event_id",
  id: "event_id",
  eventtype: "type",
  event_type: "type",
  category: "type",
  event_category: "type",
  start_date: "start_date",
  event_date: "start_date",
  start: "start_date",
  start_at: "start_date",
  end_date: "end_date",
  end: "end_date",
  end_at: "end_date",
  venue: "location",
  event_location: "location",
  max_team_size: "max_team_size",
  min_team_size: "min_team_size",
  registration_fee: "registration_fee",
  fee: "registration_fee",
  entry_fee: "registration_fee",
  registration_type: "registration_type",
  team_type: "registration_type",
  banner_url: "banner_url",
  banner: "banner_url",
  logo_url: "logo_url",
  logo: "logo_url",
  custom_fields: "custom_fields",
  custom_form_schema: "custom_form_schema",
  rewards: "rewards",
  title: "title",
  event_title: "title",
  event_name: "title",
  name: "title",
  mode: "mode",
  capacity: "capacity",
  description: "description",
  event_description: "description",
  max_capacity: "capacity",
  seats: "capacity",
};

/** Header spellings exported by spreadsheets and the Community Connect UI. */
const ALIAS_LOOKUP = new Map<string, EventCsvColumn>(
  Object.entries(COLUMN_ALIASES).map(([alias, column]) => [
    normaliseHeader(alias),
    column,
  ])
);

/** Normalise a header cell (trim, lowercase, strip spaces/underscores). */
function normaliseHeader(header: string): string {
  return header
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function resolveColumnName(
  header: string
): EventCsvColumn | null {
  const key = normaliseHeader(header);
  if (!key) return null;

  const alias = ALIAS_LOOKUP.get(key);
  if (alias) return alias;

  const direct = EVENT_CSV_COLUMNS.find(
    (column) => normaliseHeader(column) === key
  );

  return direct || null;
}

/** Escape a single cell per RFC 4180. */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";

  const text =
    typeof value === "string"
      ? value
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  const needsQuoting =
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r") ||
    text !== text.trim();

  if (!needsQuoting) return text;

  return `"${text.replace(/"/g, '""')}"`;
}

export function stringifyCsvRow(values: readonly unknown[]): string {
  return values.map(escapeCsvValue).join(",");
}

/**
 * Serialise one or more event drafts into a CSV document.
 * The header row always uses `EVENT_CSV_COLUMNS`.
 */
export function stringifyEventCsv(drafts: EventCsvRecord[]): string {
  const header = stringifyCsvRow(EVENT_CSV_COLUMNS);

  const rows = drafts.map((draft) => {
    const source = (draft || {}) as Record<string, unknown>;

    return stringifyCsvRow(
      EVENT_CSV_COLUMNS.map((column) => {
        const value = source[column];
        if (value === undefined || value === null) return "";
        if (column === "start_date" || column === "end_date") {
          return toIsoDateTime(value);
        }
        if (typeof value === "object") return JSON.stringify(value);
        return value as string | number | boolean;
      })
    );
  });

  return [header, ...rows].join("\r\n") + "\r\n";
}

/** Normalise anything date-ish into a full ISO 8601 string. */
export function toIsoDateTime(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }

  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? "" : fromNumber.toISOString();
  }

  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;

  return parsed.toISOString();
}

/**
 * UTF-8 encode a CSV document.
 * @param withBom prefix a UTF-8 byte order mark (helps legacy Excel).
 */
export function toCsvBuffer(
  csv: string,
  options: { withBom?: boolean } = {}
): Buffer {
  const payload = options.withBom ? `﻿${csv}` : csv;
  return Buffer.from(payload, "utf8");
}

/**
 * Parse a CSV document into rows of raw strings.
 * Handles quoted fields, doubled quotes, embedded commas/newlines, both LF and
 * CRLF line endings, and a leading UTF-8 BOM.
 */
export function parseCsvRows(input: string): string[][] {
  const text = input.replace(/^﻿/, "");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;

  const pushField = () => {
    row.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };

  const pushRow = () => {
    pushField();
    // Skip rows that are completely empty (trailing newline etc.)
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.trim() === "") {
      inQuotes = true;
      fieldWasQuoted = true;
      field = "";
      continue;
    }

    if (char === ",") {
      pushField();
      continue;
    }

    if (char === "\r") {
      if (text[i + 1] === "\n") i += 1;
      pushRow();
      continue;
    }

    if (char === "\n") {
      pushRow();
      continue;
    }

    field += char;
  }

  if (field !== "" || fieldWasQuoted || row.length > 0) pushRow();

  return rows;
}

function parseNumberCell(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseJsonCell(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export interface ParsedEventCsv {
  /** Payloads ready for `CreateEventSchema` (the existing POST /api/events body). */
  payloads: Array<Record<string, unknown>>;
  errors: Array<{ row: number; message: string }>;
}

/**
 * Turn a CSV document back into create-event payloads.
 * Unknown columns are ignored, recognised aliases are mapped onto the real
 * event column names, and numbers / JSON documents are coerced back.
 */
export function parseEventCsv(input: string): ParsedEventCsv {
  const rows = parseCsvRows(input);
  const payloads: Array<Record<string, unknown>> = [];
  const errors: Array<{ row: number; message: string }> = [];

  if (rows.length === 0) {
    return { payloads, errors: [{ row: 0, message: "CSV file is empty" }] };
  }

  const headerRow = rows[0];
  const mapping = headerRow.map((header) => resolveColumnName(header));

  if (!mapping.some((column) => column === "title")) {
    return {
      payloads,
      errors: [
        {
          row: 1,
          message:
            'CSV header must contain a "title" column matching the Community Connect event schema',
        },
      ],
    };
  }

  for (let index = 1; index < rows.length; index += 1) {
    const values = rows[index];

    if (values.every((value) => value.trim() === "")) continue;

    const payload: Record<string, unknown> = {};

    mapping.forEach((column, columnIndex) => {
      if (!column) return;
      const raw = values[columnIndex] ?? "";
      if (raw === "") return;

      if (JSON_COLUMNS.has(column)) {
        const parsed = parseJsonCell(raw);
        if (parsed !== undefined) payload[column] = parsed;
        return;
      }

      if (
        column === "capacity" ||
        column === "registration_fee" ||
        column === "min_team_size" ||
        column === "max_team_size"
      ) {
        const parsed = parseNumberCell(raw);
        if (parsed !== undefined) payload[column] = parsed;
        return;
      }

      if (column === "event_id") return; // informational, never imported

      payload[column] = raw;
    });

    if (!payload.title) {
      errors.push({
        row: index + 1,
        message: "Row is missing a title",
      });
      continue;
    }

    payloads.push(payload);
  }

  return { payloads, errors };
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * Meaningful download name, e.g. `blood-donation-camp-2026-10-15.csv`.
 * Falls back to `community-connect-event.csv` when the title is unusable.
 */
export function buildEventCsvFilename(draft: EventCsvRecord): string {
  const titleSlug = slugify(String(draft?.title || ""));
  const isoStart = toIsoDateTime(draft?.start_date);
  const datePart = isoStart ? isoStart.slice(0, 10) : "";

  const name = [titleSlug, datePart].filter(Boolean).join("-");

  return `${name || "community-connect-event"}.csv`;
}
