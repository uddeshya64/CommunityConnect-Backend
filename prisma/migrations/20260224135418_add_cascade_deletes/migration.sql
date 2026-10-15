-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_created_by_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_registration_id_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "fcm_token" TEXT;

-- CreateTable
CREATE TABLE "event_timelines" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "speaker_name" VARCHAR(100),
    "description" TEXT,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "location" TEXT,
    "should_notify" BOOLEAN NOT NULL DEFAULT true,
    "is_notified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "event_timelines_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_timelines" ADD CONSTRAINT "event_timelines_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
