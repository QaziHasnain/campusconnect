CREATE TYPE "EventPaymentStatus" AS ENUM (
    'PENDING',
    'SUCCESSFUL',
    'FAILED',
    'CANCELLED'
);

ALTER TABLE "Event"
    ADD COLUMN "venueAddress" TEXT,
    ADD COLUMN "latitude" DOUBLE PRECISION,
    ADD COLUMN "longitude" DOUBLE PRECISION,
    ADD COLUMN "ticketPricePaise" INTEGER,
    ADD CONSTRAINT "Event_coordinates_check" CHECK (
        ("latitude" IS NULL AND "longitude" IS NULL)
        OR (
            "latitude" BETWEEN -90 AND 90
            AND "longitude" BETWEEN -180 AND 180
        )
    ),
    ADD CONSTRAINT "Event_ticketPricePaise_check" CHECK (
        "ticketPricePaise" IS NULL OR "ticketPricePaise" > 0
    );

CREATE TABLE "EventPaymentAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "registrationId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "EventPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EventPaymentAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventPaymentAttempt_amountPaise_check" CHECK ("amountPaise" > 0),
    CONSTRAINT "EventPaymentAttempt_currency_check" CHECK ("currency" = 'INR'),
    CONSTRAINT "EventPaymentAttempt_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EventPaymentAttempt_eventId_fkey"
        FOREIGN KEY ("eventId") REFERENCES "Event"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EventPaymentAttempt_registrationId_fkey"
        FOREIGN KEY ("registrationId") REFERENCES "Registration"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EventPaymentAttempt_registrationId_key"
    ON "EventPaymentAttempt"("registrationId");
CREATE UNIQUE INDEX "EventPaymentAttempt_razorpayOrderId_key"
    ON "EventPaymentAttempt"("razorpayOrderId");
CREATE UNIQUE INDEX "EventPaymentAttempt_razorpayPaymentId_key"
    ON "EventPaymentAttempt"("razorpayPaymentId");
CREATE INDEX "EventPaymentAttempt_eventId_status_expiresAt_idx"
    ON "EventPaymentAttempt"("eventId", "status", "expiresAt");
CREATE INDEX "EventPaymentAttempt_userId_eventId_status_idx"
    ON "EventPaymentAttempt"("userId", "eventId", "status");

CREATE TABLE "RazorpayWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RazorpayWebhookEvent_pkey" PRIMARY KEY ("id")
);
