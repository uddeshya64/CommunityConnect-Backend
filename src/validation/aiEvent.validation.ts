/**
 * Validation schemas for the AI event creator endpoints.
 *
 * The final event payload is always validated by the existing
 * `CreateEventSchema` (see `validation/event.validation.ts`) - these schemas
 * only cover the conversation envelope around it.
 *
 * @file validation/aiEvent.validation.ts
 */

import { z } from "zod";

export const MAX_TRANSCRIPT_LENGTH = 20000;

export const ConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_TRANSCRIPT_LENGTH),
});

export const AiChatSchema = z.object({
  /** Latest transcript / user message (from the microphone or typed text). */
  message: z
    .string()
    .min(1, "Tell me about the event you want to create")
    .max(MAX_TRANSCRIPT_LENGTH),
  /** Previous turns, oldest first. */
  history: z.array(ConversationMessageSchema).max(50).default([]),
  /** Draft collected so far, already merged by the client. */
  draft: z.record(z.string(), z.any()).default({}),
  /** Event type names the organiser already has access to. */
  known_types: z.array(z.string().max(50)).max(50).default([]),
  /**
   * Browser `new Date().getTimezoneOffset()` (UTC - local, in minutes) so
   * spoken times are resolved in the organiser's timezone.
   */
  time_zone_offset: z.number().int().min(-840).max(840).default(0),
});

/** Body for POST /api/ai-events/validate and POST /api/ai-events/csv */
export const AiEventDraftSchema = z.object({
  event: z.record(z.string(), z.any()),
});

export const MAX_CSV_BYTES = 512 * 1024; // 512 KB is plenty for a single event

export type AiChatInput = z.infer<typeof AiChatSchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
