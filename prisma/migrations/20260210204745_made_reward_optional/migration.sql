-- AlterTable
ALTER TABLE "events" ALTER COLUMN "rewards" DROP NOT NULL,
ALTER COLUMN "rewards" SET DEFAULT '{}';
