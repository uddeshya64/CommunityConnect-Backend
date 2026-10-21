-- Seed the 10 predefined event categories as system event types.
-- This keeps the database in sync with PREDEFINED_EVENT_CATEGORIES
-- (frontend `src/lib/eventTemplates.ts`) and the AI category mapping
-- (`normaliseEventType` in `src/utils/eventDraft.ts`), so the categories
-- appear in every event form/filter and resolve to the same names.
INSERT INTO "event_types" ("name", "is_system") VALUES
  ('Technical Conferences', true),
  ('Hackathons and Competitions', true),
  ('Corporate Events', true),
  ('Exhibitions and Trade Shows', true),
  ('Academic and Training Events', true),
  ('Weddings and Personal Events', true),
  ('Community and Nonprofit Events', true),
  ('Sports and Recreational Events', true),
  ('Government and Civic Events', true),
  ('Hybrid and Virtual Events', true)
ON CONFLICT ("name") DO NOTHING;
