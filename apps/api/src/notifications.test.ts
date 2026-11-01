import express from "express";
import session, { MemoryStore } from "express-session";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  decryptPushSubscription,
  createNotificationRouter,
  encryptPushSubscription,
  hashPushEndpoint,
  type NotificationPreferences,
  type NotificationRepository,
  type NotificationSummary,
} from "./notifications.js";

const now = new Date("2026-11-01T10:00:00.000Z");
const endpoint = "https://fcm.googleapis.com/device/opaque-token";

function notification(
  id: string,
  userId: string,
  readAt: Date | null = null,
): NotificationSummary {
  return {
    id,
    title: "Event reminder",
    message: "An event you registered for is coming up.",
    type: "EVENT_REMINDER",
    relatedEventId: "event-1",
    readAt,
    createdAt: now,
  };
}

class FakeNotificationRepository implements NotificationRepository {
  readonly notifications = new Map<string, NotificationSummary[]>([
    ["student-1", [notification("notice-1", "student-1"), notification("notice-2", "student-1", now)]],
    ["student-2", [notification("notice-3", "student-2")]],
  ]);
  readonly students = new Set(["student-1", "student-2"]);
  readonly preferences = new Map<string, NotificationPreferences>();
  readonly subscriptions = new Map<string, { userId: string; encryptedPayload: string }>();

  async isStudent(userId: string) {
    return this.students.has(userId);
  }

  async listNotifications(userId: string, cursor: string | undefined, limit: number) {
    const list = this.notifications.get(userId) ?? [];
    const cursorIndex = cursor ? list.findIndex(({ id }) => id === cursor) : -1;
    const notifications = list.slice(cursorIndex + 1, cursorIndex + 1 + limit);
    return {
      notifications,
      unreadCount: list.filter(({ readAt }) => readAt === null).length,
    };
  }

  async markNotificationRead(userId: string, notificationId: string) {
    const list = this.notifications.get(userId) ?? [];
    const notificationIndex = list.findIndex(({ id }) => id === notificationId);
    if (notificationIndex < 0) return null;
    const updated = { ...list[notificationIndex]!, readAt: now };
    list[notificationIndex] = updated;
    return updated;
  }

  async markAllNotificationsRead(userId: string) {
    const list = this.notifications.get(userId) ?? [];
    let updatedCount = 0;
    this.notifications.set(
      userId,
      list.map((item) => {
        if (item.readAt) return item;
        updatedCount += 1;
        return { ...item, readAt: now };
      }),
    );
    return updatedCount;
  }

  async getPreferences(userId: string) {
    return this.preferences.get(userId) ?? {
      inAppEnabled: true,
      pushEnabled: false,
      eventRemindersEnabled: true,
      eventUpdatesEnabled: true,
    };
  }

  async updatePreferences(userId: string, preferences: NotificationPreferences) {
    this.preferences.set(userId, preferences);
    return preferences;
  }

  async saveSubscription(userId: string, endpointHash: string, encryptedPayload: string) {
    const existing = this.subscriptions.get(endpointHash);
    if (existing && existing.userId !== userId) return false;
    this.subscriptions.set(endpointHash, { userId, encryptedPayload });
    return true;
  }

  async deleteSubscription(userId: string, endpointHash: string) {
    if (this.subscriptions.get(endpointHash)?.userId === userId) {
      this.subscriptions.delete(endpointHash);
    }
  }
}

function createTestApp(repository: NotificationRepository, encryptionKey = Buffer.alloc(32)) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-session-secret-that-is-long-enough",
      resave: false,
      saveUninitialized: false,
      store: new MemoryStore(),
    }),
  );
  app.use((request, _response, next) => {
    const userId = request.header("x-test-user");
    if (userId) request.session.userId = userId;
    next();
  });
  app.use(
    "/api/me/notifications",
    createNotificationRouter(repository, {
      vapidPublicKey: "test-public-key",
      subscriptionEncryptionKey: encryptionKey,
    }),
  );
  return app;
}

describe("notification API", () => {
  it("isolates notification history and unread counts by authenticated student", async () => {
    const repository = new FakeNotificationRepository();
    const app = createTestApp(repository);
    const ownResponse = await request(app)
      .get("/api/me/notifications")
      .set("x-test-user", "student-1");
    const otherResponse = await request(app)
      .get("/api/me/notifications")
      .set("x-test-user", "student-2");

    expect(ownResponse.status).toBe(200);
    expect(ownResponse.body.notifications.map((item: NotificationSummary) => item.id))
      .toEqual(["notice-1", "notice-2"]);
    expect(ownResponse.body.unreadCount).toBe(1);
    expect(otherResponse.body.notifications.map((item: NotificationSummary) => item.id))
      .toEqual(["notice-3"]);
    expect(otherResponse.body.unreadCount).toBe(1);
  });

  it("prevents reading another student's notification and supports individual and bulk read", async () => {
    const repository = new FakeNotificationRepository();
    const app = createTestApp(repository);
    const anotherStudent = await request(app)
      .patch("/api/me/notifications/notice-3/read")
      .set("x-test-user", "student-1")
      .send({});
    expect(anotherStudent.status).toBe(404);

    const own = await request(app)
      .patch("/api/me/notifications/notice-1/read")
      .set("x-test-user", "student-1")
      .send({});
    expect(own.status).toBe(200);
    expect(own.body.notification.readAt).toBe(now.toISOString());

    const bulk = await request(app)
      .post("/api/me/notifications/read-all")
      .set("x-test-user", "student-1")
      .send({});
    expect(bulk.status).toBe(200);
    expect(bulk.body.updatedCount).toBe(0);
    expect(repository.notifications.get("student-2")?.[0]?.readAt).toBeNull();
  });

  it("requires student authentication and validates preference payloads", async () => {
    const repository = new FakeNotificationRepository();
    const app = createTestApp(repository);
    expect((await request(app).get("/api/me/notifications")).status).toBe(401);
    expect(
      (await request(app).get("/api/me/notifications").set("x-test-user", "organizer")).status,
    ).toBe(403);
    const invalid = await request(app)
      .put("/api/me/notifications/preferences")
      .set("x-test-user", "student-1")
      .send({ pushEnabled: true, extra: true });
    expect(invalid.status).toBe(400);
  });

  it("returns only the public VAPID key to an authenticated student", async () => {
    const app = createTestApp(new FakeNotificationRepository());
    const response = await request(app)
      .get("/api/me/notifications/push-config")
      .set("x-test-user", "student-1");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ vapidPublicKey: "test-public-key" });
    expect(response.body).not.toHaveProperty("vapidPrivateKey");
  });

  it("stores an encrypted per-device subscription and removes only its owner's subscription", async () => {
    const repository = new FakeNotificationRepository();
    const encryptionKey = Buffer.alloc(32, 7);
    const app = createTestApp(repository, encryptionKey);
    const payload = {
      endpoint,
      expirationTime: null,
      keys: { p256dh: "p".repeat(65), auth: "a".repeat(32) },
    };

    const saved = await request(app)
      .post("/api/me/notifications/subscriptions")
      .set("x-test-user", "student-1")
      .send(payload);
    expect(saved.status).toBe(201);
    const stored = repository.subscriptions.get(hashPushEndpoint(endpoint));
    expect(stored?.userId).toBe("student-1");
    expect(stored?.encryptedPayload).not.toContain(endpoint);
    expect(decryptPushSubscription(stored!.encryptedPayload, encryptionKey)).toEqual(payload);

    const wrongOwnerDelete = await request(app)
      .delete("/api/me/notifications/subscriptions")
      .set("x-test-user", "student-2")
      .send({ endpoint });
    expect(wrongOwnerDelete.status).toBe(204);
    expect(repository.subscriptions.has(hashPushEndpoint(endpoint))).toBe(true);

    const removed = await request(app)
      .delete("/api/me/notifications/subscriptions")
      .set("x-test-user", "student-1")
      .send({ endpoint });
    expect(removed.status).toBe(204);
    expect(repository.subscriptions.has(hashPushEndpoint(endpoint))).toBe(false);
  });

  it("supports multiple private device subscriptions for one student", async () => {
    const repository = new FakeNotificationRepository();
    const app = createTestApp(repository);
    for (const deviceEndpoint of [
      endpoint,
      "https://fcm.googleapis.com/device/second-opaque-token",
    ]) {
      const response = await request(app)
        .post("/api/me/notifications/subscriptions")
        .set("x-test-user", "student-1")
        .send({
          endpoint: deviceEndpoint,
          keys: { p256dh: "p".repeat(65), auth: "a".repeat(32) },
        });
      expect(response.status).toBe(201);
    }
    expect([...repository.subscriptions.values()].filter(({ userId }) => userId === "student-1"))
      .toHaveLength(2);
  });

  it("rejects malformed or insecure push subscriptions", async () => {
    const repository = new FakeNotificationRepository();
    const app = createTestApp(repository);
    const invalid = await request(app)
      .post("/api/me/notifications/subscriptions")
      .set("x-test-user", "student-1")
      .send({
        endpoint: "http://attacker.example.test/push",
        keys: { p256dh: "p".repeat(65), auth: "a".repeat(32) },
      });
    expect(invalid.status).toBe(400);
    expect(repository.subscriptions.size).toBe(0);
  });

  it("rejects tampered encrypted subscription data", async () => {
    const encrypted = encryptPushSubscription(
      {
        endpoint,
        keys: { p256dh: "p".repeat(65), auth: "a".repeat(32) },
      },
      Buffer.alloc(32, 3),
    );
    expect(() => decryptPushSubscription(encrypted, Buffer.alloc(32, 4))).toThrow();
  });
});
