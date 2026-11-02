import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  NotificationType,
  UserRole,
  type Prisma,
  type PrismaClient,
} from "./generated/prisma/client.js";

const notificationSelect = {
  id: true,
  title: true,
  message: true,
  type: true,
  relatedEventId: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export type NotificationSummary = Prisma.NotificationGetPayload<{
  select: typeof notificationSelect;
}>;

export interface NotificationPreferences {
  inAppEnabled: boolean;
  pushEnabled: boolean;
  eventRemindersEnabled: boolean;
  eventUpdatesEnabled: boolean;
}

export interface NotificationRepository {
  isStudent(userId: string): Promise<boolean>;
  listNotifications(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ notifications: NotificationSummary[]; unreadCount: number }>;
  markNotificationRead(userId: string, notificationId: string): Promise<NotificationSummary | null>;
  markAllNotificationsRead(userId: string): Promise<number>;
  getPreferences(userId: string): Promise<NotificationPreferences>;
  updatePreferences(
    userId: string,
    preferences: NotificationPreferences,
  ): Promise<NotificationPreferences>;
  saveSubscription(
    userId: string,
    endpointHash: string,
    encryptedPayload: string,
  ): Promise<boolean>;
  deleteSubscription(userId: string, endpointHash: string): Promise<void>;
}

const preferencesSchema = z
  .object({
    inAppEnabled: z.boolean(),
    pushEnabled: z.boolean(),
    eventRemindersEnabled: z.boolean(),
    eventUpdatesEnabled: z.boolean(),
  })
  .strict();

const subscriptionSchema = z
  .object({
    endpoint: z.string().trim().min(1).max(2048),
    expirationTime: z.number().finite().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
        auth: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
      })
      .strict(),
  })
  .strict();

const notificationIdSchema = z.string().min(1).max(128);
const listQuerySchema = z
  .object({
    cursor: z.string().min(1).max(128).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(30),
  })
  .strict();

export interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

export function hashPushEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

/** Best-effort callers can persist a single confirmation per registration without a schema change. */
export async function createRegistrationConfirmation(
  prisma: PrismaClient,
  input: { registrationId: string; userId: string; eventId: string; eventTitle: string; startAt: Date },
) {
  const preference = await prisma.notificationPreference.findUnique({
    where: { userId: input.userId },
    select: { inAppEnabled: true },
  });
  if (preference?.inAppEnabled === false) return;
  const date = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(input.startAt);
  await prisma.notification.createMany({
    data: [{
      userId: input.userId,
      title: "Registration confirmed",
      message: `Your registration for ${input.eventTitle} on ${date} is confirmed.`,
      type: NotificationType.EVENT_UPDATE,
      relatedEventId: input.eventId,
      reminderKey: `registration-confirmation:${input.registrationId}`,
      showInApp: true,
    }],
    skipDuplicates: true,
  });
}

export function encryptPushSubscription(
  subscription: PushSubscriptionPayload,
  encryptionKey: Buffer,
): string {
  if (encryptionKey.length !== 32) {
    throw new Error("Push subscription encryption requires a 32-byte key");
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(subscription), "utf8"),
    cipher.final(),
  ]);
  return `v1.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptPushSubscription(
  encryptedPayload: string,
  encryptionKey: Buffer,
): PushSubscriptionPayload {
  if (encryptionKey.length !== 32) {
    throw new Error("Push subscription encryption requires a 32-byte key");
  }
  const [version, nonceValue, tagValue, encryptedValue, ...extra] = encryptedPayload.split(".");
  if (version !== "v1" || !nonceValue || !tagValue || !encryptedValue || extra.length > 0) {
    throw new Error("Stored push subscription has an unsupported format");
  }
  const decipherInstance = createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(nonceValue, "base64url"),
  );
  decipherInstance.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipherInstance.update(Buffer.from(encryptedValue, "base64url")),
    decipherInstance.final(),
  ]).toString("utf8");
  const parsed = subscriptionSchema.safeParse(JSON.parse(plaintext));
  if (!parsed.success) throw new Error("Stored push subscription is invalid");
  return parsed.data;
}

function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.username || url.password) return false;
    if (url.protocol !== "https:") return false;
    return (
      url.hostname === "fcm.googleapis.com" ||
      url.hostname.endsWith(".push.services.mozilla.com") ||
      url.hostname.endsWith(".push.apple.com") ||
      url.hostname === "notify.windows.com" ||
      url.hostname.endsWith(".notify.windows.com")
    );
  } catch {
    return false;
  }
}

function sendError(response: Response, action: string, error: unknown) {
  console.error(
    `Notification ${action} failed`,
    error instanceof Error ? error.name : "UNKNOWN_ERROR",
  );
  return response.status(500).json({ error: "Notification service unavailable" });
}

async function requireStudent(
  request: Request,
  response: Response,
  repository: NotificationRepository,
): Promise<string | null> {
  const userId = request.session.userId;
  if (!userId) {
    response.status(401).json({ error: "Authentication required" });
    return null;
  }
  try {
    if (!(await repository.isStudent(userId))) {
      response.status(403).json({ error: "Student role required" });
      return null;
    }
    return userId;
  } catch (error) {
    sendError(response, "authorization", error);
    return null;
  }
}

export function createNotificationRouter(
  repository: NotificationRepository,
  pushConfiguration: {
    vapidPublicKey: string;
    subscriptionEncryptionKey: Buffer;
  } | null,
) {
  const router = Router();

  router.get("/", async (request, response) => {
    const userId = await requireStudent(request, response, repository);
    if (!userId) return;
    const parsedQuery = listQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return response.status(400).json({ error: "Invalid notification query" });
    }
    try {
      const preferences = await repository.getPreferences(userId);
      if (!preferences.inAppEnabled) {
        return response.json({ notifications: [], unreadCount: 0, nextCursor: null });
      }
      const result = await repository.listNotifications(
        userId,
        parsedQuery.data.cursor,
        parsedQuery.data.limit,
      );
      return response.json({
        ...result,
        nextCursor:
          result.notifications.length === parsedQuery.data.limit
            ? result.notifications[result.notifications.length - 1]?.id ?? null
            : null,
      });
    } catch (error) {
      return sendError(response, "listing", error);
    }
  });

  router.patch("/:notificationId/read", async (request, response) => {
    const userId = await requireStudent(request, response, repository);
    if (!userId) return;
    const parsedId = notificationIdSchema.safeParse(request.params.notificationId);
    const parsedBody = z.object({}).strict().safeParse(request.body ?? {});
    if (!parsedId.success || !parsedBody.success) {
      return response.status(400).json({ error: "Invalid notification request" });
    }
    try {
      const notification = await repository.markNotificationRead(userId, parsedId.data);
      if (!notification) return response.status(404).json({ error: "Notification not found" });
      return response.json({ notification });
    } catch (error) {
      return sendError(response, "mark-read", error);
    }
  });

  router.post("/read-all", async (request, response) => {
    const userId = await requireStudent(request, response, repository);
    if (!userId) return;
    const parsedBody = z.object({}).strict().safeParse(request.body ?? {});
    if (!parsedBody.success) return response.status(400).json({ error: "Invalid request" });
    try {
      const updatedCount = await repository.markAllNotificationsRead(userId);
      return response.json({ updatedCount });
    } catch (error) {
      return sendError(response, "mark-all-read", error);
    }
  });

  router.get("/preferences", async (request, response) => {
    const userId = await requireStudent(request, response, repository);
    if (!userId) return;
    try {
      return response.json({ preferences: await repository.getPreferences(userId) });
    } catch (error) {
      return sendError(response, "preference lookup", error);
    }
  });

  router.put("/preferences", async (request, response) => {
    const userId = await requireStudent(request, response, repository);
    if (!userId) return;
    const parsed = preferencesSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid notification preferences" });
    try {
      return response.json({
        preferences: await repository.updatePreferences(userId, parsed.data),
      });
    } catch (error) {
      return sendError(response, "preference update", error);
    }
  });

  router.get("/push-config", async (request, response) => {
    const userId = await requireStudent(request, response, repository);
    if (!userId) return;
    return response.json({ vapidPublicKey: pushConfiguration?.vapidPublicKey ?? null });
  });

  router.post("/subscriptions", async (request, response) => {
    const userId = await requireStudent(request, response, repository);
    if (!userId) return;
    if (!pushConfiguration) {
      return response.status(503).json({ error: "Browser push is not configured" });
    }
    const parsed = subscriptionSchema.safeParse(request.body);
    if (!parsed.success || !isAllowedPushEndpoint(parsed.data?.endpoint ?? "")) {
      return response.status(400).json({ error: "Invalid push subscription" });
    }
    try {
      const subscription = parsed.data;
      const encryptedPayload = encryptPushSubscription(
        subscription,
        pushConfiguration.subscriptionEncryptionKey,
      );
      const saved = await repository.saveSubscription(
        userId,
        hashPushEndpoint(subscription.endpoint),
        encryptedPayload,
      );
      if (!saved) {
        return response.status(409).json({ error: "Push subscription is already in use" });
      }
      return response.status(201).json({ subscribed: true });
    } catch (error) {
      return sendError(response, "subscription registration", error);
    }
  });

  router.delete("/subscriptions", async (request, response) => {
    const userId = await requireStudent(request, response, repository);
    if (!userId) return;
    const parsed = z.object({ endpoint: z.string().trim().min(1).max(2048) }).strict()
      .safeParse(request.body);
    if (!parsed.success || !isAllowedPushEndpoint(parsed.data?.endpoint ?? "")) {
      return response.status(400).json({ error: "Invalid push subscription" });
    }
    try {
      await repository.deleteSubscription(userId, hashPushEndpoint(parsed.data.endpoint));
      return response.status(204).end();
    } catch (error) {
      return sendError(response, "subscription removal", error);
    }
  });

  return router;
}

const preferenceSelect = {
  inAppEnabled: true,
  pushEnabled: true,
  eventRemindersEnabled: true,
  eventUpdatesEnabled: true,
} satisfies Prisma.NotificationPreferenceSelect;

export function createPrismaNotificationRepository(prisma: PrismaClient): NotificationRepository {
  return {
    async isStudent(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      return user?.role === UserRole.STUDENT;
    },
    async listNotifications(userId, cursor, limit) {
      const cursorNotification = cursor
        ? await prisma.notification.findFirst({
            where: { id: cursor, userId, showInApp: true },
            select: { id: true, createdAt: true },
          })
        : null;
      if (cursor && !cursorNotification) return { notifications: [], unreadCount: 0 };
      const [notifications, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where: {
            userId,
            showInApp: true,
            ...(cursorNotification
              ? {
                  OR: [
                    { createdAt: { lt: cursorNotification.createdAt } },
                    {
                      createdAt: cursorNotification.createdAt,
                      id: { lt: cursorNotification.id },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit,
          select: notificationSelect,
        }),
        prisma.notification.count({
          where: { userId, showInApp: true, readAt: null },
        }),
      ]);
      return { notifications, unreadCount };
    },
    async markNotificationRead(userId, notificationId) {
      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, userId, showInApp: true },
        select: notificationSelect,
      });
      if (!notification) return null;
      if (notification.readAt) return notification;
      await prisma.notification.updateMany({
        where: { id: notificationId, userId, showInApp: true, readAt: null },
        data: { readAt: new Date() },
      });
      return prisma.notification.findFirst({
        where: { id: notificationId, userId, showInApp: true },
        select: notificationSelect,
      });
    },
    async markAllNotificationsRead(userId) {
      const result = await prisma.notification.updateMany({
        where: { userId, showInApp: true, readAt: null },
        data: { readAt: new Date() },
      });
      return result.count;
    },
    async getPreferences(userId) {
      return prisma.notificationPreference.upsert({
        where: { userId },
        create: { userId },
        update: {},
        select: preferenceSelect,
      });
    },
    async updatePreferences(userId, preferences) {
      return prisma.notificationPreference.upsert({
        where: { userId },
        create: { userId, ...preferences },
        update: preferences,
        select: preferenceSelect,
      });
    },
    async saveSubscription(userId, endpointHash, encryptedPayload) {
      return prisma.$transaction(async (transaction) => {
        const existing = await transaction.pushSubscription.findUnique({
          where: { endpointHash },
          select: { id: true, userId: true },
        });
        if (existing && existing.userId !== userId) return false;
        if (existing) {
          await transaction.pushSubscription.update({
            where: { id: existing.id },
            data: { encryptedPayload },
          });
        } else {
          await transaction.pushSubscription.create({
            data: { userId, endpointHash, encryptedPayload },
          });
        }
        return true;
      });
    },
    async deleteSubscription(userId, endpointHash) {
      await prisma.$transaction(async (transaction) => {
        await transaction.pushSubscription.deleteMany({ where: { userId, endpointHash } });
        const remainingSubscriptions = await transaction.pushSubscription.count({
          where: { userId },
        });
        if (remainingSubscriptions === 0) {
          await transaction.notificationPreference.updateMany({
            where: { userId },
            data: { pushEnabled: false },
          });
        }
      });
    },
  };
}

export async function queueEventUpdateNotifications(
  transaction: Prisma.TransactionClient,
  eventId: string,
): Promise<void> {
  const registrations = await transaction.registration.findMany({
    where: {
      eventId,
      user: { is: { role: UserRole.STUDENT } },
    },
    select: {
      user: {
        select: {
          id: true,
          notificationPreference: { select: preferenceSelect },
          pushSubscriptions: { select: { id: true } },
        },
      },
    },
  });
  for (const { user } of registrations) {
    const preferences = user.notificationPreference;
    if (!(preferences?.eventUpdatesEnabled ?? true)) continue;
    const inAppEnabled = preferences?.inAppEnabled ?? true;
    const pushEnabled = preferences?.pushEnabled ?? false;
    if (!inAppEnabled && (!pushEnabled || user.pushSubscriptions.length === 0)) continue;

    const notification = await transaction.notification.create({
      data: {
        userId: user.id,
        title: "Event updated",
        message: "An event you registered for has been updated.",
        type: NotificationType.EVENT_UPDATE,
        relatedEventId: eventId,
        showInApp: inAppEnabled,
      },
      select: { id: true },
    });
    if (pushEnabled) {
      await queuePushDeliveries(
        transaction,
        notification.id,
        user.pushSubscriptions.map(({ id }) => id),
      );
    }
  }
}

export async function queueEventCancellationNotifications(
  transaction: Prisma.TransactionClient,
  eventId: string,
  eventTitle: string,
): Promise<void> {
  const registrations = await transaction.registration.findMany({
    where: {
      eventId,
      user: { is: { role: UserRole.STUDENT } },
    },
    select: {
      user: {
        select: {
          id: true,
          notificationPreference: { select: preferenceSelect },
          pushSubscriptions: { select: { id: true } },
        },
      },
    },
  });

  const notificationRecipients = registrations.flatMap(({ user }) => {
    const preferences = user.notificationPreference;
    if (!(preferences?.eventUpdatesEnabled ?? true)) return [];
    const inAppEnabled = preferences?.inAppEnabled ?? true;
    const pushEnabled = preferences?.pushEnabled ?? false;
    if (!inAppEnabled && (!pushEnabled || user.pushSubscriptions.length === 0)) return [];
    return [{
      userId: user.id,
      inAppEnabled,
      pushSubscriptionIds: pushEnabled ? user.pushSubscriptions.map(({ id }) => id) : [],
      reminderKey: `event-cancellation:${eventId}:${user.id}`,
    }];
  });
  if (notificationRecipients.length === 0) return;

  await transaction.notification.createMany({
    data: notificationRecipients.map((recipient) => ({
      userId: recipient.userId,
      title: "Event cancelled",
      message: `${eventTitle} has been cancelled. No refund has been initiated. If you paid, contact the organizer about a manual refund.`,
      type: NotificationType.EVENT_UPDATE,
      relatedEventId: eventId,
      reminderKey: recipient.reminderKey,
      showInApp: recipient.inAppEnabled,
    })),
    skipDuplicates: true,
  });

  const notifications = await transaction.notification.findMany({
    where: { reminderKey: { in: notificationRecipients.map(({ reminderKey }) => reminderKey) } },
    select: { id: true, reminderKey: true },
  });
  const recipientsByKey = new Map(
    notificationRecipients.map((recipient) => [recipient.reminderKey, recipient]),
  );
  for (const notification of notifications) {
    const recipient = notification.reminderKey
      ? recipientsByKey.get(notification.reminderKey)
      : undefined;
    if (recipient?.pushSubscriptionIds.length) {
      await queuePushDeliveries(transaction, notification.id, recipient.pushSubscriptionIds);
    }
  }
}

export async function queuePushDeliveries(
  transaction: Prisma.TransactionClient,
  notificationId: string,
  subscriptionIds: string[],
): Promise<void> {
  if (subscriptionIds.length === 0) return;
  const now = new Date();
  await transaction.notificationPushDelivery.createMany({
    data: subscriptionIds.map((subscriptionId) => ({
      id: randomUUID(),
      notificationId,
      subscriptionId,
      createdAt: now,
      updatedAt: now,
    })),
    skipDuplicates: true,
  });
}
