CREATE TYPE "WhatsAppReminderStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'SENT',
    'FAILED',
    'CANCELLED'
);

ALTER TABLE "User"
    ADD COLUMN "whatsAppPhoneNumber" TEXT,
    ADD COLUMN "whatsAppConsent" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "whatsAppConsentAt" TIMESTAMPTZ(3),
    ADD COLUMN "whatsAppWithdrawnAt" TIMESTAMPTZ(3);

CREATE TABLE "WhatsAppReminder" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "offsetHours" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "WhatsAppReminderStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMPTZ(3),
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "sanitizedError" TEXT,
    "lockedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsAppReminder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WhatsAppReminder_offsetHours_check" CHECK ("offsetHours" > 0),
    CONSTRAINT "WhatsAppReminder_attemptCount_check" CHECK ("attemptCount" >= 0)
);

CREATE UNIQUE INDEX "WhatsAppReminder_registrationId_offsetHours_key"
    ON "WhatsAppReminder"("registrationId", "offsetHours");
CREATE INDEX "WhatsAppReminder_status_scheduledAt_idx"
    ON "WhatsAppReminder"("status", "scheduledAt");
CREATE INDEX "WhatsAppReminder_status_nextRetryAt_idx"
    ON "WhatsAppReminder"("status", "nextRetryAt");
CREATE INDEX "WhatsAppReminder_status_lockedAt_idx"
    ON "WhatsAppReminder"("status", "lockedAt");

ALTER TABLE "WhatsAppReminder"
    ADD CONSTRAINT "WhatsAppReminder_registrationId_fkey"
    FOREIGN KEY ("registrationId") REFERENCES "Registration"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
