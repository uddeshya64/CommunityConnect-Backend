/*
  Warnings:

  - You are about to drop the column `role_id` on the `event_user_roles` table. All the data in the column will be lost.
  - You are about to drop the `roles` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[event_id,user_id]` on the table `event_user_roles` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `role` to the `event_user_roles` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "EventRole" AS ENUM ('CO_HOST', 'JUDGE', 'MENTOR', 'VOLUNTEER', 'SPEAKER');

-- DropForeignKey
ALTER TABLE "event_user_roles" DROP CONSTRAINT "event_user_roles_role_id_fkey";

-- AlterTable
ALTER TABLE "event_user_roles" DROP COLUMN "role_id",
ADD COLUMN     "permissions" JSONB,
ADD COLUMN     "role" "EventRole" NOT NULL;

-- DropTable
DROP TABLE "roles";

-- CreateIndex
CREATE UNIQUE INDEX "event_user_roles_event_id_user_id_key" ON "event_user_roles"("event_id", "user_id");
