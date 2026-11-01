import { randomUUID } from "node:crypto";
import webpush from "web-push";
import type { PushSubscription as WebPushSubscription } from "web-push";
import {
  EventStatus,
  NotificationPushDeliveryStatus,
  NotificationReminderStatus,
  NotificationType,
  UserRole,
  type PrismaClient,
} from "./generated/prisma/client.js";
import { env } from "./env.js";
import {
  decryptPushSubscription,
  queuePushDeliveries,
  type PushSubscriptionPayload,
} from "./notifications.js";

const REMINDER_OFFSETS_HOURS = [24, 1];
const CLAIM_BATCH_SIZE = 25;
const MAX_PUSH_ATTEMPTS = 3;
const PROCESSING_LEASE_MS = 60_000;
const PUSH_RETRY_DELAYS_MS = [60_000, 5 * 60_000];
const POLL_INTERVAL_MS = 30_000;

export interface PlannedNotificationReminder {
  offsetHours: number;
  scheduledAt: Date;
}

export function planNotificationReminderTimes(
  eventStartAt: Date,
  now: Date,
): PlannedNotificationReminder[] {
  if (eventStartAt <= now) return [];
  return REMINDER_OFFSETS_HOURS.flatMap((offsetHours) => {
    const scheduledAt = new Date(eventStartAt.getTime() - offsetHours * 60 * 60 * 1000);
    return scheduledAt >= now ? [{ offsetHours, scheduledAt }] : [];
  });
}

export function getPushRetryTime(attemptCount: number, now: Date): Date | null {
  if (attemptCount >= MAX_PUSH_ATTEMPTS) return null;
  const delay = PUSH_RETRY_DELAYS_MS[
    Math.min(Math.max(attemptCount - 1, 0), PUSH_RETRY_DELAYS_MS.length - 1)
  ];
  return new Date(now.getTime() + delay);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function reconcileScheduledNotifications(
  prisma: PrismaClient,
  now: Date,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "NotificationReminder" AS reminder
    SET "status" = 'CANCELLED'::"NotificationReminderStatus",
        "cancelledReason" = CASE
          WHEN event."status" <> 'PUBLISHED'::"EventStatus"
            OR event."startAt" <= ${now} THEN 'EVENT_NOT_ELIGIBLE'
          ELSE 'PREFERENCES_DISABLED'
        END,
        "lockedAt" = NULL,
        "updatedAt" = ${now}
    FROM "Registration" AS registration
    JOIN "User" AS student ON student."id" = registration."userId"
    JOIN "Event" AS event ON event."id" = registration."eventId"
    LEFT JOIN "NotificationPreference" AS preference ON preference."userId" = student."id"
    WHERE reminder."registrationId" = registration."id"
      AND reminder."status" = 'PENDING'::"NotificationReminderStatus"
      AND (
        student."role" <> 'STUDENT'::"UserRole"
        OR event."status" <> 'PUBLISHED'::"EventStatus"
        OR event."startAt" <= ${now}
        OR COALESCE(preference."eventRemindersEnabled", true) = false
        OR (
          COALESCE(preference."inAppEnabled", true) = false
          AND (
            COALESCE(preference."pushEnabled", false) = false
            OR NOT EXISTS (
              SELECT 1
              FROM "PushSubscription" AS subscription
              WHERE subscription."userId" = student."id"
            )
          )
        )
      )
  `;

  const registrations = await prisma.registration.findMany({
    where: {
      user: { is: { role: UserRole.STUDENT } },
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
      user: {
        select: {
          notificationPreference: {
            select: {
              inAppEnabled: true,
              pushEnabled: true,
              eventRemindersEnabled: true,
            },
          },
          pushSubscriptions: { select: { id: true } },
        },
      },
    },
  });

  for (const registration of registrations) {
    const preferences = registration.user.notificationPreference;
    if (
      !(preferences?.eventRemindersEnabled ?? true) ||
      (
        !(preferences?.inAppEnabled ?? true) &&
        (!(preferences?.pushEnabled ?? false) || registration.user.pushSubscriptions.length === 0)
      )
    ) {
      continue;
    }

    const plannedByOffset = new Map(
      planNotificationReminderTimes(registration.event.startAt, now)
        .map(({ offsetHours, scheduledAt }) => [offsetHours, scheduledAt]),
    );
    for (const offsetHours of REMINDER_OFFSETS_HOURS) {
      const scheduledAt = plannedByOffset.get(offsetHours);
      if (!scheduledAt) {
        await prisma.notificationReminder.updateMany({
          where: {
            registrationId: registration.id,
            offsetHours,
            status: NotificationReminderStatus.PENDING,
          },
          data: {
            status: NotificationReminderStatus.CANCELLED,
            cancelledReason: "REMINDER_WINDOW_PASSED",
            lockedAt: null,
            updatedAt: now,
          },
        });
        continue;
      }

      try {
        await prisma.notificationReminder.createMany({
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
      await prisma.notificationReminder.updateMany({
        where: {
          registrationId: registration.id,
          offsetHours,
          status: NotificationReminderStatus.PENDING,
        },
        data: {
          scheduledAt,
          cancelledReason: null,
          updatedAt: now,
        },
      });
      await prisma.notificationReminder.updateMany({
        where: {
          registrationId: registration.id,
          offsetHours,
          status: NotificationReminderStatus.CANCELLED,
        },
        data: {
          status: NotificationReminderStatus.PENDING,
          scheduledAt,
          attemptCount: 0,
          nextRetryAt: null,
          cancelledReason: null,
          lockedAt: null,
          updatedAt: now,
        },
      });
    }
  }
}

export interface ClaimedNotificationReminder {
  id: string;
}

export async function claimDueNotificationReminders(
  prisma: PrismaClient,
  now: Date,
  batchSize = CLAIM_BATCH_SIZE,
): Promise<ClaimedNotificationReminder[]> {
  return prisma.$transaction((transaction) =>
    transaction.$queryRaw<ClaimedNotificationReminder[]>`
      WITH due AS (
        SELECT "id"
        FROM "NotificationReminder"
        WHERE "status" = 'PENDING'::"NotificationReminderStatus"
          AND "scheduledAt" <= ${now}
          AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= ${now})
        ORDER BY "scheduledAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE "NotificationReminder" AS reminder
      SET "status" = 'PROCESSING'::"NotificationReminderStatus",
          "attemptCount" = reminder."attemptCount" + 1,
          "lockedAt" = ${now},
          "nextRetryAt" = NULL,
          "updatedAt" = ${now}
      FROM due
      WHERE reminder."id" = due."id"
      RETURNING reminder."id"
    `,
  );
}

export async function processClaimedNotificationReminder(
  prisma: PrismaClient,
  reminderId: string,
  now: Date,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const reminder = await transaction.notificationReminder.findUnique({
      where: { id: reminderId },
      select: {
        status: true,
        offsetHours: true,
        scheduledAt: true,
        registration: {
          select: {
            user: {
              select: {
                id: true,
                role: true,
                notificationPreference: {
                  select: {
                    inAppEnabled: true,
                    pushEnabled: true,
                    eventRemindersEnabled: true,
                  },
                },
                pushSubscriptions: { select: { id: true } },
              },
            },
            event: {
              select: {
                id: true,
                startAt: true,
                status: true,
              },
            },
          },
        },
      },
    });
    if (!reminder || reminder.status !== NotificationReminderStatus.PROCESSING) return;

    const { user, event } = reminder.registration;
    if (
      user.role !== UserRole.STUDENT ||
      event.status !== EventStatus.PUBLISHED ||
      event.startAt <= now
    ) {
      await transaction.notificationReminder.updateMany({
        where: { id: reminderId, status: NotificationReminderStatus.PROCESSING },
        data: {
          status: NotificationReminderStatus.CANCELLED,
          cancelledReason: "EVENT_NOT_ELIGIBLE",
          lockedAt: null,
          updatedAt: now,
        },
      });
      return;
    }

    const expectedAt = new Date(
      event.startAt.getTime() - reminder.offsetHours * 60 * 60 * 1000,
    );
    if (reminder.scheduledAt.getTime() !== expectedAt.getTime()) {
      const canReschedule = expectedAt > now;
      await transaction.notificationReminder.updateMany({
        where: { id: reminderId, status: NotificationReminderStatus.PROCESSING },
        data: {
          status: canReschedule
            ? NotificationReminderStatus.PENDING
            : NotificationReminderStatus.CANCELLED,
          scheduledAt: expectedAt,
          cancelledReason: canReschedule ? null : "REMINDER_WINDOW_PASSED",
          lockedAt: null,
          updatedAt: now,
        },
      });
      return;
    }

    const preferences = user.notificationPreference;
    const eventRemindersEnabled = preferences?.eventRemindersEnabled ?? true;
    const inAppEnabled = preferences?.inAppEnabled ?? true;
    const pushEnabled = preferences?.pushEnabled ?? false;
    if (
      !eventRemindersEnabled ||
      (!inAppEnabled && (!pushEnabled || user.pushSubscriptions.length === 0))
    ) {
      await transaction.notificationReminder.updateMany({
        where: { id: reminderId, status: NotificationReminderStatus.PROCESSING },
        data: {
          status: NotificationReminderStatus.CANCELLED,
          cancelledReason: eventRemindersEnabled ? "NO_CHANNEL_ENABLED" : "PREFERENCES_DISABLED",
          lockedAt: null,
          updatedAt: now,
        },
      });
      return;
    }

    const notification = await transaction.notification.upsert({
      where: { reminderKey: reminderId },
      create: {
        userId: user.id,
        title: "Event reminder",
        message: "An event you registered for is coming up.",
        type: NotificationType.EVENT_REMINDER,
        relatedEventId: event.id,
        reminderKey: reminderId,
        showInApp: inAppEnabled,
      },
      update: {},
      select: { id: true },
    });
    if (pushEnabled) {
      await queuePushDeliveries(
        transaction,
        notification.id,
        user.pushSubscriptions.map(({ id }) => id),
      );
    }
    await transaction.notificationReminder.updateMany({
      where: { id: reminderId, status: NotificationReminderStatus.PROCESSING },
      data: {
        status: NotificationReminderStatus.SENT,
        sentAt: now,
        cancelledReason: null,
        lockedAt: null,
        updatedAt: now,
      },
    });
  });
}

export interface ClaimedPushDelivery {
  id: string;
  attemptCount: number;
}

export interface PushDeliveryContext {
  notificationId: string;
  subscriptionId: string;
  subscription: PushSubscriptionPayload;
  eventId: string | null;
  type: NotificationType;
}

export interface NotificationPushRepository {
  loadClaimedDelivery(id: string): Promise<PushDeliveryContext | null>;
  markDeliverySent(id: string, sentAt: Date): Promise<void>;
  markDeliveryCancelled(id: string, reason: string): Promise<void>;
  scheduleDeliveryRetry(id: string, reason: string, retryAt: Date): Promise<void>;
  markDeliveryFailed(id: string, reason: string): Promise<void>;
  removeExpiredSubscription(id: string): Promise<void>;
}

export interface WebPushProvider {
  send(subscription: PushSubscriptionPayload, payload: string): Promise<void>;
}

function providerFailure(error: unknown): {
  statusCode: number | null;
  reason: string;
} {
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : null;
  return {
    statusCode,
    reason: statusCode ? `PUSH_HTTP_${statusCode}` : "PUSH_NETWORK_ERROR",
  };
}

function safePushPayload(context: PushDeliveryContext, frontendOrigin: string): string {
  const url = context.eventId
    ? new URL(`/events/${encodeURIComponent(context.eventId)}`, frontendOrigin).toString()
    : new URL("/", frontendOrigin).toString();
  return JSON.stringify({
    title: "CampusConnect",
    body:
      context.type === NotificationType.EVENT_REMINDER
        ? "You have an event reminder."
        : "An event you registered for has been updated.",
    tag: context.notificationId,
    url,
  });
}

export async function deliverClaimedPushes(
  repository: NotificationPushRepository,
  provider: WebPushProvider,
  claimed: ClaimedPushDelivery[],
  now: Date,
  frontendOrigin: string,
): Promise<void> {
  for (const delivery of claimed) {
    const context = await repository.loadClaimedDelivery(delivery.id);
    if (!context) {
      await repository.markDeliveryCancelled(delivery.id, "SUBSCRIPTION_OR_PREFERENCE_UNAVAILABLE");
      continue;
    }
    try {
      await provider.send(context.subscription, safePushPayload(context, frontendOrigin));
      await repository.markDeliverySent(delivery.id, new Date());
    } catch (error) {
      const failure = providerFailure(error);
      if (failure.statusCode === 404 || failure.statusCode === 410) {
        await repository.removeExpiredSubscription(context.subscriptionId);
        continue;
      }
      const permanent =
        failure.statusCode !== null &&
        failure.statusCode >= 400 &&
        failure.statusCode < 500 &&
        failure.statusCode !== 408 &&
        failure.statusCode !== 429;
      const retryAt = permanent ? null : getPushRetryTime(delivery.attemptCount, now);
      if (retryAt) {
        await repository.scheduleDeliveryRetry(delivery.id, failure.reason, retryAt);
      } else {
        await repository.markDeliveryFailed(delivery.id, failure.reason);
      }
    }
  }
}

export async function claimDuePushDeliveries(
  prisma: PrismaClient,
  now: Date,
  batchSize = CLAIM_BATCH_SIZE,
): Promise<ClaimedPushDelivery[]> {
  return prisma.$transaction((transaction) =>
    transaction.$queryRaw<ClaimedPushDelivery[]>`
      WITH due AS (
        SELECT "id"
        FROM "NotificationPushDelivery"
        WHERE "status" = 'PENDING'::"NotificationPushDeliveryStatus"
          AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= ${now})
        ORDER BY "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE "NotificationPushDelivery" AS delivery
      SET "status" = 'PROCESSING'::"NotificationPushDeliveryStatus",
          "attemptCount" = delivery."attemptCount" + 1,
          "lockedAt" = ${now},
          "nextRetryAt" = NULL,
          "updatedAt" = ${now}
      FROM due
      WHERE delivery."id" = due."id"
      RETURNING delivery."id", delivery."attemptCount"
    `,
  );
}

function createPrismaPushDeliveryRepository(
  prisma: PrismaClient,
  encryptionKey: Buffer,
): NotificationPushRepository {
  return {
    async loadClaimedDelivery(id) {
      const delivery = await prisma.notificationPushDelivery.findUnique({
        where: { id },
        select: {
          status: true,
          notification: {
            select: {
              id: true,
              userId: true,
              type: true,
              relatedEventId: true,
              user: {
                select: {
                  notificationPreference: {
                    select: {
                      pushEnabled: true,
                      eventRemindersEnabled: true,
                      eventUpdatesEnabled: true,
                    },
                  },
                },
              },
            },
          },
          subscription: {
            select: {
              id: true,
              userId: true,
              encryptedPayload: true,
            },
          },
        },
      });
      if (
        !delivery ||
        delivery.status !== NotificationPushDeliveryStatus.PROCESSING ||
        delivery.notification.userId !== delivery.subscription.userId
      ) {
        return null;
      }
      const preferences = delivery.notification.user.notificationPreference;
      if (
        !(preferences?.pushEnabled ?? false) ||
        (delivery.notification.type === NotificationType.EVENT_REMINDER &&
          !(preferences?.eventRemindersEnabled ?? true)) ||
        (delivery.notification.type === NotificationType.EVENT_UPDATE &&
          !(preferences?.eventUpdatesEnabled ?? true))
      ) {
        return null;
      }
      return {
        notificationId: delivery.notification.id,
        subscriptionId: delivery.subscription.id,
        subscription: decryptPushSubscription(
          delivery.subscription.encryptedPayload,
          encryptionKey,
        ),
        eventId: delivery.notification.relatedEventId,
        type: delivery.notification.type,
      };
    },
    async markDeliverySent(id, sentAt) {
      await prisma.notificationPushDelivery.updateMany({
        where: { id, status: NotificationPushDeliveryStatus.PROCESSING },
        data: {
          status: NotificationPushDeliveryStatus.SENT,
          sentAt,
          sanitizedError: null,
          lockedAt: null,
        },
      });
    },
    async markDeliveryCancelled(id, reason) {
      await prisma.notificationPushDelivery.updateMany({
        where: { id, status: NotificationPushDeliveryStatus.PROCESSING },
        data: {
          status: NotificationPushDeliveryStatus.CANCELLED,
          sanitizedError: reason,
          lockedAt: null,
        },
      });
    },
    async scheduleDeliveryRetry(id, reason, retryAt) {
      await prisma.notificationPushDelivery.updateMany({
        where: { id, status: NotificationPushDeliveryStatus.PROCESSING },
        data: {
          status: NotificationPushDeliveryStatus.PENDING,
          sanitizedError: reason,
          nextRetryAt: retryAt,
          lockedAt: null,
        },
      });
    },
    async markDeliveryFailed(id, reason) {
      await prisma.notificationPushDelivery.updateMany({
        where: { id, status: NotificationPushDeliveryStatus.PROCESSING },
        data: {
          status: NotificationPushDeliveryStatus.FAILED,
          sanitizedError: reason,
          nextRetryAt: null,
          lockedAt: null,
        },
      });
    },
    async removeExpiredSubscription(id) {
      await prisma.$transaction(async (transaction) => {
        const subscription = await transaction.pushSubscription.findUnique({
          where: { id },
          select: { id: true, userId: true },
        });
        if (!subscription) return;
        await transaction.notificationPushDelivery.updateMany({
          where: {
            subscriptionId: id,
            status: NotificationPushDeliveryStatus.PROCESSING,
          },
          data: {
            status: NotificationPushDeliveryStatus.FAILED,
            sanitizedError: "PUSH_SUBSCRIPTION_EXPIRED",
            lockedAt: null,
          },
        });
        await transaction.pushSubscription.delete({ where: { id } });
        const remainingSubscriptions = await transaction.pushSubscription.count({
          where: { userId: subscription.userId },
        });
        if (remainingSubscriptions === 0) {
          await transaction.notificationPreference.updateMany({
            where: { userId: subscription.userId },
            data: { pushEnabled: false },
          });
        }
      });
    },
  };
}

async function recoverExpiredClaims(prisma: PrismaClient, now: Date): Promise<void> {
  const expiredBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  await Promise.all([
    prisma.notificationReminder.updateMany({
      where: {
        status: NotificationReminderStatus.PROCESSING,
        lockedAt: { lt: expiredBefore },
      },
      data: {
        status: NotificationReminderStatus.PENDING,
        cancelledReason: "PROCESSING_LEASE_EXPIRED",
        lockedAt: null,
        nextRetryAt: now,
      },
    }),
    prisma.notificationPushDelivery.updateMany({
      where: {
        status: NotificationPushDeliveryStatus.PROCESSING,
        lockedAt: { lt: expiredBefore },
      },
      data: {
        status: NotificationPushDeliveryStatus.PENDING,
        sanitizedError: "PROCESSING_LEASE_EXPIRED",
        lockedAt: null,
        nextRetryAt: now,
      },
    }),
  ]);
}

function createWebPushProvider(
  configuration: NonNullable<typeof env.push>,
): WebPushProvider {
  webpush.setVapidDetails(
    configuration.vapidSubject,
    configuration.vapidPublicKey,
    configuration.vapidPrivateKey,
  );
  return {
    async send(subscription, payload) {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          expirationTime: subscription.expirationTime ?? null,
          keys: subscription.keys,
        } satisfies WebPushSubscription,
        payload,
        { TTL: 3600, urgency: "normal" },
      );
    },
  };
}

export async function runNotificationWorkerCycle(
  prisma: PrismaClient,
  now = new Date(),
  providerOverride?: WebPushProvider | null,
): Promise<void> {
  await recoverExpiredClaims(prisma, now);
  await reconcileScheduledNotifications(prisma, now);

  const claimedReminders = await claimDueNotificationReminders(prisma, now);
  for (const reminder of claimedReminders) {
    await processClaimedNotificationReminder(prisma, reminder.id, now);
  }

  const provider =
    providerOverride === undefined
      ? env.push
        ? createWebPushProvider(env.push)
        : null
      : providerOverride;
  if (provider && env.push) {
    const claimedPushes = await claimDuePushDeliveries(prisma, now);
    await deliverClaimedPushes(
      createPrismaPushDeliveryRepository(prisma, env.push.subscriptionEncryptionKey),
      provider,
      claimedPushes,
      now,
      env.frontendOrigin,
    );
  }
  await recoverExpiredClaims(prisma, now);
}

export async function startNotificationWorker(
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
          "Notification worker cycle failed",
          error instanceof Error ? error.name : "UNKNOWN_ERROR",
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
