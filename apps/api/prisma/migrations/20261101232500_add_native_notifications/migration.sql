CREATE TYPE "NotificationType" AS ENUM ('EVENT_REMINDER', 'EVENT_UPDATE');

CREATE TYPE "NotificationReminderStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'SENT',
    'CANCELLED'
);

CREATE TYPE "NotificationPushDeliveryStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'SENT',
    'FAILED',
    'CANCELLED'
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "relatedEventId" TEXT,
    "reminderKey" TEXT,
    "showInApp" BOOLEAN NOT NULL DEFAULT true,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpointHash" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "eventRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "eventUpdatesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationReminder" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "offsetHours" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "NotificationReminderStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMPTZ(3),
    "lockedAt" TIMESTAMPTZ(3),
    "cancelledReason" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationReminder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPushDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "status" "NotificationPushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMPTZ(3),
    "lockedAt" TIMESTAMPTZ(3),
    "sanitizedError" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationPushDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_reminderKey_key" ON "Notification"("reminderKey");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

CREATE UNIQUE INDEX "PushSubscription_endpointHash_key" ON "PushSubscription"("endpointHash");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

CREATE UNIQUE INDEX "NotificationReminder_registrationId_offsetHours_key"
    ON "NotificationReminder"("registrationId", "offsetHours");
CREATE INDEX "NotificationReminder_status_scheduledAt_idx"
    ON "NotificationReminder"("status", "scheduledAt");
CREATE INDEX "NotificationReminder_status_lockedAt_idx"
    ON "NotificationReminder"("status", "lockedAt");

CREATE UNIQUE INDEX "NotificationPushDelivery_notificationId_subscriptionId_key"
    ON "NotificationPushDelivery"("notificationId", "subscriptionId");
CREATE INDEX "NotificationPushDelivery_status_nextRetryAt_idx"
    ON "NotificationPushDelivery"("status", "nextRetryAt");
CREATE INDEX "NotificationPushDelivery_status_lockedAt_idx"
    ON "NotificationPushDelivery"("status", "lockedAt");

ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_relatedEventId_fkey"
    FOREIGN KEY ("relatedEventId") REFERENCES "Event"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PushSubscription"
    ADD CONSTRAINT "PushSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
    ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationReminder"
    ADD CONSTRAINT "NotificationReminder_registrationId_fkey"
    FOREIGN KEY ("registrationId") REFERENCES "Registration"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationPushDelivery"
    ADD CONSTRAINT "NotificationPushDelivery_notificationId_fkey"
    FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationPushDelivery"
    ADD CONSTRAINT "NotificationPushDelivery_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
