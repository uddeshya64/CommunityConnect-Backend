/**
 * AI event creator controller.
 *
 * Flow: voice -> transcript -> AI extraction -> existing event schema ->
 * user review -> backend validation -> (CSV download | database upload).
 *
 * Reuses the existing pieces only:
 *  - `authenticate` middleware for identity (`req.user.id`)
 *  - `CreateEventSchema` (via `validateEventDraft`) for validation
 *  - `EventService.createEvent` for the database write, so event types, role
 *    definitions and the creator's Admin role behave exactly as they do for
 *    `POST /api/events`.
 *
 * @file controllers/aiEvent.controller.ts
 */

import { Request, Response } from "express";
import { AiEventService } from "../services/aiEvent.service";
import { EventService } from "../services/event.service";
import {
  AiChatSchema,
  MAX_CSV_BYTES,
} from "../validation/aiEvent.validation";
import {
  buildEventCsvFilename,
  EVENT_CSV_COLUMNS,
  parseEventCsv,
  stringifyEventCsv,
  toCsvBuffer,
} from "../utils/eventCsv";
import {
  buildClarificationQuestions,
  computeMissingFields,
  EVENT_DRAFT_FIELDS,
  EVENT_MODES,
  normaliseEventType,
  validateEventDraft,
  type EventDraftValues,
} from "../utils/eventDraft";

function zodIssues(error: any) {
  return error?.issues ?? [
    { path: [], message: error?.message || "Invalid request" },
  ];
}

/** Normalise a client supplied draft (numbers, enums, trimmed strings). */
function sanitiseIncomingDraft(input: unknown): EventDraftValues {
  const draft: EventDraftValues = { ...((input || {}) as EventDraftValues) };

  if (typeof draft.type === "string") {
    draft.type = normaliseEventType(draft.type);
  }

  if (
    typeof draft.mode === "string" &&
    ["online", "offline", "hybrid"].includes(draft.mode)
  ) {
    draft.mode = draft.mode;
  }

  for (const field of [
    "capacity",
    "registration_fee",
    "min_team_size",
    "max_team_size",
  ]) {
    const value = draft[field];
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) draft[field] = parsed;
  }

  for (const field of ["start_date", "end_date"] as const) {
    const value = draft[field];
    if (typeof value !== "string" || !value.trim()) continue;
    const parsed = new Date(value);
    draft[field] = Number.isNaN(parsed.getTime())
      ? value.trim()
      : parsed.toISOString();
  }

  for (const field of [
    "title",
    "description",
    "location",
    "registration_type",
  ] as const) {
    if (typeof draft[field] === "string") {
      draft[field] = (draft[field] as string).trim();
    }
  }

  return draft;
}

export const AiEventController = {
  /**
   * POST /api/ai-events/chat
   * One conversation turn: extract fields + return clarification questions.
   */
  async chat(req: Request, res: Response) {
    try {
      const input = AiChatSchema.parse(req.body);

      const result = await AiEventService.converse({
        message: input.message,
        history: input.history,
        draft: sanitiseIncomingDraft(input.draft),
        knownTypes: input.known_types,
        timeZoneOffsetMinutes: input.time_zone_offset,
      });

      res.json({
        success: true,
        data: {
          reply: result.reply,
          extracted: result.extracted,
          draft: result.draft,
          questions: result.questions,
          missing_fields: result.missing_fields,
          complete: result.complete,
          source: result.source,
        },
      });
    } catch (error: any) {
      if (error?.issues) {
        return res.status(400).json({ error: zodIssues(error) });
      }
      res.status(500).json({ error: error?.message || "AI extraction failed" });
    }
  },

  /**
   * POST /api/ai-events/validate
   * Validate the reviewed draft with the existing CreateEventSchema.
   */
  async validate(req: Request, res: Response) {
    try {
      const draft = sanitiseIncomingDraft(req.body?.event);
      const result = validateEventDraft(draft);

      res.status(result.valid ? 200 : 422).json({
        success: result.valid,
        data: {
          valid: result.valid,
          event: result.event,
          errors: result.errors,
          missing_fields:
            result.missing_fields.length > 0
              ? result.missing_fields
              : computeMissingFields(draft),
          questions: buildClarificationQuestions(draft),
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Validation failed" });
    }
  },

  /**
   * POST /api/ai-events/csv
   * Generate the CSV from the validated event data and return it as a
   * downloadable file. This never touches the database.
   */
  async downloadCsv(req: Request, res: Response) {
    try {
      const draft = sanitiseIncomingDraft(req.body?.event);
      const result = validateEventDraft(draft);

      if (!result.valid) {
        return res.status(422).json({
          success: false,
          error: "Event data is not valid yet",
          data: {
            errors: result.errors,
            missing_fields: result.missing_fields,
            questions: buildClarificationQuestions(draft),
          },
        });
      }

      const filename = buildEventCsvFilename(result.event || {});
      const csv = stringifyEventCsv([result.event || {}]);
      const buffer = toCsvBuffer(csv);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.setHeader("Content-Length", String(buffer.length));
      res.setHeader("X-CSV-Filename", filename);
      res.status(200).send(buffer);
    } catch (error: any) {
      if (error?.issues) {
        return res.status(400).json({ error: zodIssues(error) });
      }
      res.status(500).json({ error: error?.message || "CSV generation failed" });
    }
  },

  /**
   * POST /api/ai-events/import
   * Upload a generated CSV (multipart) or post the reviewed event as JSON,
   * validate it again with the existing schema and persist it.
   */
  async importEvent(req: Request, res: Response) {
    try {
      const userId = Number(req.user!.id);

      let payloads: Array<Record<string, unknown>> = [];
      const source = req.file ? "csv" : "json";

      if (req.file) {
        if (req.file.size > MAX_CSV_BYTES) {
          return res.status(413).json({
            error: `CSV file is too large (max ${Math.floor(
              MAX_CSV_BYTES / 1024
            )} KB)`,
          });
        }

        const name = (req.file.originalname || "").toLowerCase();
        if (name && !name.endsWith(".csv") && !name.endsWith(".txt")) {
          return res.status(400).json({ error: "Only .csv files are supported" });
        }

        const text = req.file.buffer.toString("utf8");
        const parsed = parseEventCsv(text);

        if (parsed.errors.length > 0 && parsed.payloads.length === 0) {
          return res.status(400).json({ error: parsed.errors[0].message });
        }

        payloads = parsed.payloads;

        if (payloads.length === 0) {
          return res.status(400).json({ error: "No event rows found in the CSV file" });
        }
      } else if (req.body?.event) {
        payloads = [req.body.event as Record<string, unknown>];
      } else {
        return res.status(400).json({
          error: "Attach a CSV file in the 'file' field or send an 'event' object",
        });
      }

      const created: unknown[] = [];
      const failures: Array<{ row: number; errors: Record<string, string[]> }> = [];

      payloads.forEach((payload, index) => {
        const result = validateEventDraft(sanitiseIncomingDraft(payload));

        if (!result.valid) {
          failures.push({ row: index + 1, errors: result.errors });
          return;
        }

        created.push(result.event);
      });

      if (created.length === 0) {
        return res.status(422).json({
          success: false,
          error: "Event data failed validation",
          data: { failures },
        });
      }

      const saved = [];
      for (const event of created) {
        saved.push(await EventService.createEvent(userId, event));
      }

      res.status(201).json({
        success: true,
        message:
          saved.length > 1
            ? `${saved.length} events imported from CSV`
            : "Event created successfully",
        data: {
          source,
          created: saved,
          created_count: saved.length,
          failures,
        },
      });
    } catch (error: any) {
      if (error?.issues) {
        return res.status(400).json({ error: zodIssues(error) });
      }
      res.status(500).json({ error: error?.message || "Import failed" });
    }
  },

  /**
   * GET /api/ai-events/schema
   * Exposes the canonical event field list (same metadata used to build
   * clarification questions) plus the event types the organiser can use, so
   * the review form renders exactly the fields the backend validates.
   */
  async schema(req: Request, res: Response) {
    try {
      const userId = Number(req.user!.id);
      const eventTypes = await EventService.getEventTypes(userId);

      res.json({
        success: true,
        data: {
          fields: EVENT_DRAFT_FIELDS,
          modes: EVENT_MODES,
          csv_columns: EVENT_CSV_COLUMNS,
          event_types: eventTypes,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to load schema" });
    }
  },
};
