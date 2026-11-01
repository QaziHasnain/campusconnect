import { describe, expect, it, vi } from "vitest";
import {
  EventStatus,
  NotificationReminderStatus,
  NotificationType,
  UserRole,
} from "./generated/prisma/client.js";
import {
  queueEventUpdateNotifications,
} from "./notifications.js";
import {
  claimDueNotificationReminders,
  deliverClaimedPushes,
  getPushRetryTime,
  NotificationPushRepository,
  planNotificationReminderTimes,
  processClaimedNotificationReminder,
  reconcileScheduledNotifications,
  WebPushProvider,
} from "./notificationWorker.js";

const now = new Date("2026-11-01T10:00:00.000Z");
const eventStartAt = new Date("2026-11-02T10:00:00.000Z");
const pushContext = {
  notificationId: "notification-1",
  subscriptionId: "subscription-1",
  subscription: {
    endpoint: "https://push.example.test/device/token",
    keys: { p256dh: "p".repeat(65), auth: "a".repeat(32) },
  },
  eventId: "event-1",
  type: NotificationType.EVENT_REMINDER,
} as const;

function createPushRepository() {
  return {
    loadClaimedDelivery: vi.fn(async () => pushContext),
    markDeliverySent: vi.fn(async () => undefined),
    markDeliveryCancelled: vi.fn(async () => undefined),
    scheduleDeliveryRetry: vi.fn(async () => undefined),
    markDeliveryFailed: vi.fn(async () => undefined),
    removeExpiredSubscription: vi.fn(async () => undefined),
  } satisfies NotificationPushRepository;
}

describe("native event reminder scheduling", () => {
  it("plans UTC reminders 24 hours and 1 hour before an event", () => {
    expect(planNotificationReminderTimes(eventStartAt, now)).toEqual([
      { offsetHours: 24, scheduledAt: new Date("2026-11-01T10:00:00.000Z") },
      { offsetHours: 1, scheduledAt: new Date("2026-11-02T09:00:00.000Z") },
    ]);
    expect(
      planNotificationReminderTimes(new Date("2026-11-01T10:30:00.000Z"), now),
    ).toEqual([]);
    expect(
      planNotificationReminderTimes(new Date("2026-11-01T11:30:00.000Z"), now),
    ).toEqual([
      { offsetHours: 1, scheduledAt: new Date("2026-11-01T10:30:00.000Z") },
    ]);
  });

  it("reconciles idempotently and updates pending schedules after an event edit", async () => {
    const records = new Map<string, {
      registrationId: string;
      offsetHours: number;
      scheduledAt: Date;
      status: string;
    }>();
    const prisma = {
      $executeRaw: async () => 0,
      registration: {
        findMany: async () => [{
          id: "registration-1",
          event: { startAt: eventStartAt },
          user: {
            notificationPreference: {
              inAppEnabled: true,
              pushEnabled: false,
              eventRemindersEnabled: true,
            },
          },
        }],
      },
      notificationReminder: {
        createMany: async ({ data }: {
          data: Array<{
            registrationId: string;
            offsetHours: number;
            scheduledAt: Date;
          }>;
        }) => {
          for (const reminder of data) {
            const key = `${reminder.registrationId}:${reminder.offsetHours}`;
            if (!records.has(key)) records.set(key, { ...reminder, status: "PENDING" });
          }
          return { count: data.length };
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: {
            registrationId: string;
            offsetHours: number;
            status: { in: string[] } | string;
          };
          data: Record<string, unknown>;
        }) => {
          const record = records.get(`${where.registrationId}:${where.offsetHours}`);
          const statuses = typeof where.status === "string" ? [where.status] : where.status.in;
          if (record && statuses.includes(record.status)) {
            Object.assign(record, data);
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
    };

    await reconcileScheduledNotifications(prisma as never, now);
    await reconcileScheduledNotifications(prisma as never, now);
    expect(records.size).toBe(2);

    const changedStartAt = new Date("2026-11-03T10:00:00.000Z");
    prisma.registration.findMany = async () => [{
      id: "registration-1",
      event: { startAt: changedStartAt },
      user: {
        notificationPreference: {
          inAppEnabled: true,
          pushEnabled: false,
          eventRemindersEnabled: true,
        },
      },
    }];
    await reconcileScheduledNotifications(prisma as never, now);
    expect(records.get("registration-1:24")?.scheduledAt)
      .toEqual(new Date("2026-11-02T10:00:00.000Z"));
    expect(records.get("registration-1:24")?.status).toBe("PENDING");
  });

  it("atomically claims work with SKIP LOCKED so concurrent workers do not overlap", async () => {
    const states = new Map([["job-1", "PENDING"], ["job-2", "PENDING"], ["job-3", "PENDING"]]);
    const prisma = {
      $transaction: async <T>(callback: (transaction: {
        $queryRaw: (strings: TemplateStringsArray) => Promise<Array<{ id: string }>>;
      }) => Promise<T>) =>
        callback({
          $queryRaw: async (strings) => {
            expect(strings.join("")).toContain("FOR UPDATE SKIP LOCKED");
            const claimed: Array<{ id: string }> = [];
            for (const [id, status] of states) {
              if (status === "PENDING" && claimed.length < 2) {
                states.set(id, "PROCESSING");
                claimed.push({ id });
              }
            }
            return claimed;
          },
        }),
    };

    const [first, second] = await Promise.all([
      claimDueNotificationReminders(prisma as never, now, 2),
      claimDueNotificationReminders(prisma as never, now, 2),
    ]);
    const claimedIds = [...first, ...second].map(({ id }) => id);
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    expect(claimedIds).toHaveLength(3);
  });

  it("rechecks event status before creating a reminder notification", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const upsert = vi.fn();
    const prisma = {
      $transaction: async (callback: (transaction: unknown) => Promise<void>) =>
        callback({
          notificationReminder: {
            findUnique: async () => ({
              status: NotificationReminderStatus.PROCESSING,
              offsetHours: 24,
              scheduledAt: new Date("2026-11-01T10:00:00.000Z"),
              registration: {
                user: {
                  id: "student-1",
                  role: UserRole.STUDENT,
                  notificationPreference: null,
                  pushSubscriptions: [],
                },
                event: {
                  id: "event-1",
                  startAt: eventStartAt,
                  status: EventStatus.DRAFT,
                },
              },
            }),
            updateMany,
          },
          notification: { upsert },
        }),
    };

    await processClaimedNotificationReminder(prisma as never, "reminder-1", now);
    expect(upsert).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationReminderStatus.CANCELLED,
          cancelledReason: "EVENT_NOT_ELIGIBLE",
        }),
      }),
    );
  });

  it("creates one preference-gated in-app reminder from a claimed registration", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const upsert = vi.fn(async () => ({ id: "notification-1" }));
    const prisma = {
      $transaction: async (callback: (transaction: unknown) => Promise<void>) =>
        callback({
          notificationReminder: {
            findUnique: async () => ({
              status: NotificationReminderStatus.PROCESSING,
              offsetHours: 24,
              scheduledAt: now,
              registration: {
                user: {
                  id: "student-1",
                  role: UserRole.STUDENT,
                  notificationPreference: null,
                  pushSubscriptions: [],
                },
                event: {
                  id: "event-1",
                  startAt: eventStartAt,
                  status: EventStatus.PUBLISHED,
                },
              },
            }),
            updateMany,
          },
          notification: { upsert },
        }),
    };

    await processClaimedNotificationReminder(prisma as never, "reminder-unique", now);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reminderKey: "reminder-unique" },
        create: expect.objectContaining({
          userId: "student-1",
          type: NotificationType.EVENT_REMINDER,
          showInApp: true,
        }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: NotificationReminderStatus.SENT }),
      }),
    );
  });

  it("does not enqueue push deliveries when a student has browser push disabled", async () => {
    const createNotification = vi.fn(async () => ({ id: "notification-1" }));
    const createDeliveries = vi.fn(async () => ({ count: 0 }));
    const transaction = {
      registration: {
        findMany: async () => [{
          user: {
            id: "student-1",
            notificationPreference: {
              inAppEnabled: true,
              pushEnabled: false,
              eventRemindersEnabled: true,
              eventUpdatesEnabled: true,
            },
            pushSubscriptions: [{ id: "subscription-1" }],
          },
        }],
      },
      notification: { create: createNotification },
      notificationPushDelivery: { createMany: createDeliveries },
    };

    await queueEventUpdateNotifications(transaction as never, "event-1");
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ showInApp: true, type: NotificationType.EVENT_UPDATE }),
      }),
    );
    expect(createDeliveries).not.toHaveBeenCalled();
  });
});

describe("browser push delivery", () => {
  it("retries transient provider failures with a bounded delay", async () => {
    const repository = createPushRepository();
    const provider: WebPushProvider = {
      send: vi.fn(async () => {
        throw Object.assign(new Error("network"), { statusCode: 503 });
      }),
    };
    await deliverClaimedPushes(
      repository,
      provider,
      [{ id: "delivery-1", attemptCount: 1 }],
      now,
      "https://campus.example",
    );
    expect(repository.scheduleDeliveryRetry).toHaveBeenCalledWith(
      "delivery-1",
      "PUSH_HTTP_503",
      new Date("2026-11-01T10:01:00.000Z"),
    );
    expect(getPushRetryTime(3, now)).toBeNull();
  });

  it("removes permanently expired 404 and 410 subscriptions", async () => {
    for (const statusCode of [404, 410]) {
      const repository = createPushRepository();
      const provider: WebPushProvider = {
        send: vi.fn(async () => {
          throw Object.assign(new Error("expired"), { statusCode });
        }),
      };
      await deliverClaimedPushes(
        repository,
        provider,
        [{ id: `delivery-${statusCode}`, attemptCount: 1 }],
        now,
        "https://campus.example",
      );
      expect(repository.removeExpiredSubscription).toHaveBeenCalledWith("subscription-1");
      expect(repository.scheduleDeliveryRetry).not.toHaveBeenCalled();
    }
  });

  it("does not retry permanent failures and keeps event details out of lock-screen text", async () => {
    const repository = createPushRepository();
    const provider: WebPushProvider = {
      send: vi.fn(async (_subscription, payload) => {
        const message = JSON.parse(payload) as { title: string; body: string; url: string };
        expect(message.title).toBe("CampusConnect");
        expect(message.body).toBe("You have an event reminder.");
        expect(message.body).not.toContain("Campus Event");
        expect(message.url).toBe("https://campus.example/events/event-1");
        throw Object.assign(new Error("bad request"), { statusCode: 400 });
      }),
    };
    await deliverClaimedPushes(
      repository,
      provider,
      [{ id: "delivery-permanent", attemptCount: 1 }],
      now,
      "https://campus.example",
    );
    expect(repository.markDeliveryFailed).toHaveBeenCalledWith(
      "delivery-permanent",
      "PUSH_HTTP_400",
    );
    expect(repository.scheduleDeliveryRetry).not.toHaveBeenCalled();
  });
});
