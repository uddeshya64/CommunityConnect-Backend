-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "checked_in" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checked_in_at" TIMESTAMP(3),
ADD COLUMN     "checked_in_by" INTEGER,
ADD COLUMN     "ticket_code" VARCHAR(100);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "billing_info" JSONB DEFAULT '{}',
ADD COLUMN     "branding_config" JSONB DEFAULT '{}',
ADD COLUMN     "security_config" JSONB DEFAULT '{}',
ADD COLUMN     "subscription_status" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN     "tenant_policy" JSONB DEFAULT '{}';

-- CreateIndex
CREATE UNIQUE INDEX "registrations_ticket_code_key" ON "registrations"("ticket_code");
