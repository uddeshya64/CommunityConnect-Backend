/*
  Warnings:

  - You are about to drop the column `permissions` on the `event_user_roles` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `event_user_roles` table. All the data in the column will be lost.
  - Added the required column `role_id` to the `event_user_roles` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "event_user_roles" DROP COLUMN "permissions",
DROP COLUMN "role",
ADD COLUMN     "permissions_override" JSONB,
ADD COLUMN     "role_id" INTEGER NOT NULL;

-- DropEnum
DROP TYPE "EventRole";

-- CreateTable
CREATE TABLE "event_role_definitions" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "permissions" JSONB NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "event_role_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_role_definitions_event_id_name_key" ON "event_role_definitions"("event_id", "name");

-- AddForeignKey
ALTER TABLE "event_user_roles" ADD CONSTRAINT "event_user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "event_role_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_role_definitions" ADD CONSTRAINT "event_role_definitions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
