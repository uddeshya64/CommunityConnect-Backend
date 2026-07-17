-- 1. Create event_types table
CREATE TABLE "event_types" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_types_pkey" PRIMARY KEY ("id")
);

-- 2. Create unique index on event_types name
CREATE UNIQUE INDEX "event_types_name_key" ON "event_types"("name");

-- 3. Seed default system event types
INSERT INTO "event_types" ("name", "is_system") VALUES
('hackathon', true),
('workshop', true),
('meetup', true);

-- 4. Add nullable type_id column to events table first
ALTER TABLE "events" ADD COLUMN "type_id" INTEGER;

-- 5. Migrate existing event type values to the new event_types table IDs
UPDATE "events" e
SET "type_id" = et.id
FROM "event_types" et
WHERE CAST(e."type" AS VARCHAR) = et.name;

-- 6. Set type_id to NOT NULL since the old type was NOT NULL
ALTER TABLE "events" ALTER COLUMN "type_id" SET NOT NULL;

-- 7. Drop the old type column
ALTER TABLE "events" DROP COLUMN "type";

-- 8. Drop the old EventType enum
DROP TYPE "EventType";

-- 9. Add foreign key constraints
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "event_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
