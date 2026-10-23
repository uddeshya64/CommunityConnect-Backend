/**
 * AI event creator routes.
 *
 * Mounted at `/api/ai-events`. Every route is protected by the project's
 * existing `authenticate` middleware, so the AI flow can never be used to
 * create events anonymously - exactly like `POST /api/events`.
 *
 * @file routes/aiEvent.routes.ts
 */

import { Router } from "express";
import { AiEventController } from "../controllers/aiEvent.controller";
import { authenticate } from "../middlewares/auth.middleware";
import upload from "../middlewares/upload";

const router = Router();

// Conversation: transcript -> extracted event fields + clarification questions
router.post("/chat", authenticate, AiEventController.chat);

// AI Agenda session generator: voice/prompt -> structured event timeline sessions
router.post("/agenda/generate", authenticate, AiEventController.generateAgenda);

// AI Quiz & Activity generator: voice/prompt -> interactive questions, options & answers
router.post("/quiz/generate", authenticate, AiEventController.generateQuiz);

// Canonical field metadata (drives the review form) + allowed event types
router.get("/schema", authenticate, AiEventController.schema);

// Backend validation of the reviewed draft (existing CreateEventSchema)
router.post("/validate", authenticate, AiEventController.validate);

// Generate + download the CSV straight from the reviewed event data
router.post("/csv", authenticate, AiEventController.downloadCsv);

// Upload a generated CSV (or the reviewed JSON) -> validate again -> database
router.post(
  "/import",
  authenticate,
  upload.single("file"),
  AiEventController.importEvent
);

export default router;
