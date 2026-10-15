-- CreateTable
CREATE TABLE "event_staff_invites" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_staff_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_staff_invites_token_key" ON "event_staff_invites"("token");

-- CreateIndex
CREATE UNIQUE INDEX "event_staff_invites_event_id_email_key" ON "event_staff_invites"("event_id", "email");

-- AddForeignKey
ALTER TABLE "event_staff_invites" ADD CONSTRAINT "event_staff_invites_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_staff_invites" ADD CONSTRAINT "event_staff_invites_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "event_role_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
