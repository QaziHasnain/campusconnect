import { randomUUID } from "node:crypto";
import {
  EventStatus,
  UserRole,
  WhatsAppReminderStatus,
  type PrismaClient,
} from "./generated/prisma/client.js";
import { env } from "./env.js";
import { normalizeWhatsAppPhoneNumber } from "./whatsappPhone.js";
import {
  createTwilioWhatsAppProvider,
  createWhatsAppProvider,
  WhatsAppDeliveryError,
  type TwilioWhatsAppProviderConfiguration,
  type WhatsAppProviderConfiguration,
  type WhatsAppTemplateMessage,
} from "./whatsappProvider.js";

const CLAIM_BATCH_SIZE = 10;
const MAX_ATTEMPTS = 3;
const PROCESSING_LEASE_MS = 60_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000];
const POLL_INTERVAL_MS = 30_000;

export interface PlannedReminder {
  offsetHours: number;
  scheduledAt: Date;
}

export function planReminderTimes(
  eventStartAt: Date,
  now: Date,
  offsetsHours: number[],
): PlannedReminder[] {
  if (eventStartAt <= now) return [];
  return offsetsHours.flatMap((offsetHours) => {
    const scheduledAt = new Date(eventStartAt.getTime() - offsetHours * 60 * 60 * 1000);
    return scheduledAt >= now ? [{ offsetHours, scheduledAt }] : [];
  });
}

export function getRetryTime(attemptCount: number, now: Date, retryAfterSeconds?: number | null) {
  if (attemptCount >= MAX_ATTEMPTS) return null;
  const defaultDelay = RETRY_DELAYS_MS[
    Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)
  ];
  const delay = retryAfterSeconds
    ? Math.max(defaultDelay, Math.min(retryAfterSeconds * 1000, 60 * 60 * 1000))
    : defaultDelay;
  return new Date(now.getTime() + delay);
}

export interface ClaimedWhatsAppReminder {
  id: string;
  attemptCount: number;
}

export interface ReminderDeliveryContext {
  studentName: string;
  phoneNumber: string | null;
  consent: boolean;
  consentGrantedAt: Date | null;
  consentWithdrawnAt: Date | null;
  eventName: string;
  eventVenue: string;
  eventStartAt: Date;
  eventStatus: EventStatus;
  eventId: string;
}

export interface WhatsAppReminderRepository {
  loadClaimedReminder(id: string): Promise<ReminderDeliveryContext | null>;
  markReminderSent(id: string, providerMessageId: string, sentAt: Date): Promise<void>;
  markReminderCancelled(id: string, reason: string): Promise<void>;
  scheduleReminderRetry(id: string, reason: string, nextRetryAt: Date): Promise<void>;
  markReminderFailed(id: string, reason: string): Promise<void>;
}

export interface WhatsAppTemplateProvider {
  sendTemplate(recipient: string, message: WhatsAppTemplateMessage): Promise<string>;
}

export async function deliverClaimedReminders(
  repository: WhatsAppReminderRepository,
  provider: WhatsAppTemplateProvider,
  claimed: ClaimedWhatsAppReminder[],
  now: Date,
  frontendOrigin: string,
): Promise<void> {
  for (const reminder of claimed) {
    const context = await repository.loadClaimedReminder(reminder.id);
    if (
      !context ||
      !context.consent ||
      !context.consentGrantedAt ||
      context.consentWithdrawnAt ||
      !context.phoneNumber ||
      normalizeWhatsAppPhoneNumber(context.phoneNumber) !== context.phoneNumber
    ) {
      await repository.markReminderCancelled(reminder.id, "CONSENT_OR_PHONE_UNAVAILABLE");
      continue;
    }
    if (context.eventStatus !== EventStatus.PUBLISHED || context.eventStartAt <= now) {
      await repository.markReminderCancelled(reminder.id, "EVENT_NOT_ELIGIBLE");
      continue;
    }

    const eventDate = new Intl.DateTimeFormat("en", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(context.eventStartAt);
    const eventTime = new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(context.eventStartAt);
    const detailsUrl = new URL(`/events/${encodeURIComponent(context.eventId)}`, frontendOrigin);

    let providerMessageId: string;
    try {
      providerMessageId = await provider.sendTemplate(context.phoneNumber, {
        studentName: context.studentName,
        eventName: context.eventName,
        eventDate,
        eventTime,
        venue: context.eventVenue,
        eventDetailsUrl: detailsUrl.toString(),
      });
    } catch (error) {
      const deliveryError = error instanceof WhatsAppDeliveryError
        ? error
        : new WhatsAppDeliveryError("PROVIDER_UNEXPECTED_ERROR", true);
      const nextRetryAt = deliveryError.temporary
        ? getRetryTime(reminder.attemptCount, now, deliveryError.retryAfterSeconds)
        : null;
      if (nextRetryAt) {
        await repository.scheduleReminderRetry(reminder.id, deliveryError.code, nextRetryAt);
      } else {
        await repository.markReminderFailed(reminder.id, deliveryError.code);
      }
      continue;
    }
    await repository.markReminderSent(reminder.id, providerMessageId, new Date());
  }
}

export async function processDueReminders(
  claimDue: () => Promise<ClaimedWhatsAppReminder[]>,
  repository: WhatsAppReminderRepository,
  provider: WhatsAppTemplateProvider,
  now: Date,
  frontendOrigin: string,
): Promise<void> {
  const claimed = await claimDue();
  await deliverClaimedReminders(repository, provider, claimed, now, frontendOrigin);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function reconcileScheduledReminders(
  prisma: PrismaClient,
  offsetsHours: number[],
  now: Date,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "WhatsAppReminder" AS reminder
    SET "status" = 'CANCELLED'::"WhatsAppReminderStatus",
        "sanitizedError" = 'NOT_ELIGIBLE',
        "updatedAt" = ${now}
    FROM "Registration" AS registration
    JOIN "User" AS student ON student."id" = registration."userId"
    JOIN "Event" AS event ON event."id" = registration."eventId"
    WHERE reminder."registrationId" = registration."id"
      AND reminder."status" = 'PENDING'::"WhatsAppReminderStatus"
      AND (
        student."role" <> 'STUDENT'::"UserRole"
        OR student."whatsAppConsent" = false
        OR student."whatsAppConsentAt" IS NULL
        OR student."whatsAppWithdrawnAt" IS NOT NULL
        OR student."whatsAppPhoneNumber" IS NULL
        OR event."status" <> 'PUBLISHED'::"EventStatus"
        OR event."startAt" <= ${now}
      )
  `;

  const registrations = await prisma.registration.findMany({
    where: {
      user: {
        is: {
          role: UserRole.STUDENT,
          whatsAppConsent: true,
          whatsAppConsentAt: { not: null },
          whatsAppWithdrawnAt: null,
          whatsAppPhoneNumber: { not: null },
        },
      },
      event: {
        is: {
          status: EventStatus.PUBLISHED,
          startAt: { gt: now },
        },
      },
    },
    select: {
      id: true,
      event: { select: { startAt: true } },
    },
  });

  for (const registration of registrations) {
    const plannedByOffset = new Map(
      planReminderTimes(registration.event.startAt, now, offsetsHours)
        .map((reminder) => [reminder.offsetHours, reminder.scheduledAt]),
    );
    for (const offsetHours of offsetsHours) {
      const uniqueKey = {
        registrationId_offsetHours: {
          registrationId: registration.id,
          offsetHours,
        },
      };
      const expectedScheduledAt = new Date(
        registration.event.startAt.getTime() - offsetHours * 60 * 60 * 1000,
      );
      const scheduledAt = plannedByOffset.get(offsetHours);
      if (!scheduledAt) {
        await prisma.whatsAppReminder.updateMany({
          where: {
            ...uniqueKey,
            status: WhatsAppReminderStatus.PENDING,
            scheduledAt: { not: expectedScheduledAt },
          },
          data: {
            status: WhatsAppReminderStatus.CANCELLED,
            sanitizedError: "REMINDER_TIME_PASSED_AFTER_EVENT_CHANGE",
            updatedAt: now,
          },
        });
        continue;
      }

      try {
        await prisma.whatsAppReminder.createMany({
          data: [{
            id: randomUUID(),
            registrationId: registration.id,
            offsetHours,
            scheduledAt,
            createdAt: now,
            updatedAt: now,
          }],
          skipDuplicates: true,
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }
      await prisma.whatsAppReminder.updateMany({
        where: { ...uniqueKey, status: WhatsAppReminderStatus.PENDING },
        data: { scheduledAt, updatedAt: now },
      });
      await prisma.whatsAppReminder.updateMany({
        where: { ...uniqueKey, status: WhatsAppReminderStatus.CANCELLED },
        data: {
          status: WhatsAppReminderStatus.PENDING,
          scheduledAt,
          attemptCount: 0,
          nextRetryAt: null,
          sanitizedError: null,
          lockedAt: null,
          updatedAt: now,
        },
      });
    }
  }
}

export async function claimDueReminders(
  prisma: PrismaClient,
  now: Date,
  batchSize = CLAIM_BATCH_SIZE,
): Promise<ClaimedWhatsAppReminder[]> {
  return prisma.$transaction(async (transaction) => {
    return transaction.$queryRaw<ClaimedWhatsAppReminder[]>`
      WITH due AS (
        SELECT "id"
        FROM "WhatsAppReminder"
        WHERE "status" = 'PENDING'::"WhatsAppReminderStatus"
          AND "scheduledAt" <= ${now}
          AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= ${now})
        ORDER BY "scheduledAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE "WhatsAppReminder" AS reminder
      SET "status" = 'PROCESSING'::"WhatsAppReminderStatus",
          "attemptCount" = reminder."attemptCount" + 1,
          "lockedAt" = ${now},
          "nextRetryAt" = NULL,
          "updatedAt" = ${now}
      FROM due
      WHERE reminder."id" = due."id"
      RETURNING reminder."id", reminder."attemptCount"
    `;
  });
}

function createPrismaDeliveryRepository(prisma: PrismaClient): WhatsAppReminderRepository {
  return {
    async loadClaimedReminder(id) {
      const reminder = await prisma.whatsAppReminder.findUnique({
        where: { id },
        select: {
          status: true,
          registration: {
            select: {
              user: {
                select: {
                  name: true,
                  whatsAppPhoneNumber: true,
                  whatsAppConsent: true,
                  whatsAppConsentAt: true,
                  whatsAppWithdrawnAt: true,
                },
              },
              event: {
                select: {
                  id: true,
                  title: true,
                  venue: true,
                  startAt: true,
                  status: true,
                },
              },
            },
          },
        },
      });
      if (!reminder || reminder.status !== WhatsAppReminderStatus.PROCESSING) return null;
      return {
        studentName: reminder.registration.user.name,
        phoneNumber: reminder.registration.user.whatsAppPhoneNumber,
        consent: reminder.registration.user.whatsAppConsent,
        consentGrantedAt: reminder.registration.user.whatsAppConsentAt,
        consentWithdrawnAt: reminder.registration.user.whatsAppWithdrawnAt,
        eventName: reminder.registration.event.title,
        eventVenue: reminder.registration.event.venue,
        eventStartAt: reminder.registration.event.startAt,
        eventStatus: reminder.registration.event.status,
        eventId: reminder.registration.event.id,
      };
    },
    async markReminderSent(id, providerMessageId, sentAt) {
      await prisma.whatsAppReminder.updateMany({
        where: { id, status: WhatsAppReminderStatus.PROCESSING },
        data: {
          status: WhatsAppReminderStatus.SENT,
          providerMessageId,
          sentAt,
          sanitizedError: null,
          lockedAt: null,
        },
      });
    },
    async markReminderCancelled(id, reason) {
      await prisma.whatsAppReminder.updateMany({
        where: { id, status: WhatsAppReminderStatus.PROCESSING },
        data: {
          status: WhatsAppReminderStatus.CANCELLED,
          sanitizedError: reason,
          lockedAt: null,
        },
      });
    },
    async scheduleReminderRetry(id, reason, nextRetryAt) {
      await prisma.whatsAppReminder.updateMany({
        where: { id, status: WhatsAppReminderStatus.PROCESSING },
        data: {
          status: WhatsAppReminderStatus.PENDING,
          sanitizedError: reason,
          nextRetryAt,
          lockedAt: null,
        },
      });
    },
    async markReminderFailed(id, reason) {
      await prisma.whatsAppReminder.updateMany({
        where: { id, status: WhatsAppReminderStatus.PROCESSING },
        data: {
          status: WhatsAppReminderStatus.FAILED,
          sanitizedError: reason,
          nextRetryAt: null,
          lockedAt: null,
        },
      });
    },
  };
}

export async function runWhatsAppReminderCycle(
  prisma: PrismaClient,
  now = new Date(),
  enabled = env.whatsapp.enabled,
): Promise<void> {
  if (!enabled) return;

  await reconcileScheduledReminders(prisma, env.whatsapp.reminderOffsetsHours, now);
  let provider: WhatsAppTemplateProvider;
  if (env.whatsapp.provider === "twilio") {
    const { accountSid, authToken, from, contentSid } = env.whatsapp.twilio;
    if (!accountSid || !authToken || !from || !contentSid) {
      throw new Error("Twilio WhatsApp provider configuration is incomplete");
    }
    const providerConfiguration: TwilioWhatsAppProviderConfiguration = {
      accountSid,
      authToken,
      from,
      contentSid,
    };
    provider = createTwilioWhatsAppProvider(providerConfiguration);
  } else {
    const {
      accessToken,
      phoneNumberId,
      graphApiVersion,
      templateName,
      templateLanguage,
    } = env.whatsapp;
    if (!accessToken || !phoneNumberId || !graphApiVersion || !templateName || !templateLanguage) {
      throw new Error("WhatsApp provider configuration is incomplete");
    }
    const providerConfiguration: WhatsAppProviderConfiguration = {
      accessToken,
      phoneNumberId,
      graphApiVersion,
      templateName,
      templateLanguage,
    };
    provider = createWhatsAppProvider(providerConfiguration);
  }
  await processDueReminders(
    () => claimDueReminders(prisma, now),
    createPrismaDeliveryRepository(prisma),
    provider,
    now,
    env.frontendOrigin,
  );

  await prisma.whatsAppReminder.updateMany({
    where: {
      status: WhatsAppReminderStatus.PROCESSING,
      lockedAt: { lt: new Date(now.getTime() - PROCESSING_LEASE_MS) },
    },
    data: {
      status: WhatsAppReminderStatus.PENDING,
      sanitizedError: "PROCESSING_LEASE_EXPIRED",
      lockedAt: null,
      nextRetryAt: now,
    },
  });
}

export async function startWhatsAppReminderWorker(
  runCycle: (now: Date) => Promise<void>,
  options: { intervalMs?: number; shouldStop?: () => boolean } = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    while (!stopping && !options.shouldStop?.()) {
      try {
        await runCycle(new Date());
      } catch (error) {
        console.error(
          "WhatsApp reminder worker cycle failed",
          error instanceof WhatsAppDeliveryError ? error.code : "WORKER_CYCLE_ERROR",
        );
      }
      if (stopping || options.shouldStop?.()) break;
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
