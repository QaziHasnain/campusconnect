import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { MemoryStore } from "express-session";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { env } from "./env.js";

const runDatabaseIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const integrationEmailPrefix = `notification-integration-${randomUUID()}`;
const integrationPassword = "notification-integration-password";

describe.skipIf(!runDatabaseIntegrationTests)("Notifications with PostgreSQL", () => {
  let app: import("express").Express;
  let prisma: typeof import("./prisma.js").prisma | null = null;
  let pool: typeof import("./db.js").pool | null = null;
  let firstStudent: ReturnType<typeof request.agent>;
  let secondStudent: ReturnType<typeof request.agent>;
  const userIds: string[] = [];

  beforeAll(async () => {
    const databaseUrl = new URL(env.databaseUrl);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    const configuredDatabase = decodeURIComponent(databaseUrl.pathname.slice(1));
    if (!localHosts.has(databaseUrl.hostname) || configuredDatabase !== "campusconnect_test") {
      throw new Error(
        "Notification integration tests require the dedicated local campusconnect_test database",
      );
    }

    const [appModule, prismaModule, databaseModule] = await Promise.all([
      import("./app.js"),
      import("./prisma.js"),
      import("./db.js"),
    ]);
    prisma = prismaModule.prisma;
    pool = databaseModule.pool;
    const identity = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    if (identity.rows[0]?.database_name !== "campusconnect_test") {
      throw new Error("Connected database is not campusconnect_test");
    }

    app = appModule.createApp({ sessionStore: new MemoryStore() });
    const passwordHash = await argon2.hash(integrationPassword);
    const accounts: Array<{ id: string; email: string }> = [];
    for (const name of ["first", "second"]) {
      const account = await prisma!.user.create({
        data: {
          name,
          email: `${integrationEmailPrefix}-${name}@example.test`,
          passwordHash,
          role: "STUDENT",
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
        select: { id: true, email: true },
      });
      accounts.push(account);
      userIds.push(account.id);
    }

    const [firstNotification] = await Promise.all(
      accounts.map((account) =>
        prisma!.notification.create({
          data: {
            userId: account.id,
            title: "Integration notice",
            message: "Private notification record.",
            type: "EVENT_UPDATE",
          },
          select: { id: true },
        }),
      ),
    );
    if (!firstNotification) throw new Error("Could not create integration notification");

    const agents = accounts.map(() => request.agent(app));
    for (let index = 0; index < accounts.length; index += 1) {
      const login = await agents[index]!.post("/api/auth/login").send({
        email: accounts[index]!.email,
        password: integrationPassword,
      });
      if (login.status !== 200) {
        throw new Error("Could not sign in notification integration student");
      }
    }
    firstStudent = agents[0]!;
    secondStudent = agents[1]!;
  }, 30_000);

  afterAll(async () => {
    if (prisma && userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
  });

  it("isolates history and read state between users", async () => {
    const firstHistory = await firstStudent.get("/api/me/notifications");
    const secondHistory = await secondStudent.get("/api/me/notifications");
    expect(firstHistory.status).toBe(200);
    expect(secondHistory.status).toBe(200);
    expect(firstHistory.body.notifications).toHaveLength(1);
    expect(secondHistory.body.notifications).toHaveLength(1);
    expect(firstHistory.body.notifications[0].id)
      .not.toBe(secondHistory.body.notifications[0].id);

    const foreignId = secondHistory.body.notifications[0].id as string;
    expect((await firstStudent.patch(`/api/me/notifications/${foreignId}/read`).send({})).status)
      .toBe(404);
    const ownId = firstHistory.body.notifications[0].id as string;
    expect((await firstStudent.patch(`/api/me/notifications/${ownId}/read`).send({})).status)
      .toBe(200);
    expect((await firstStudent.get("/api/me/notifications")).body.unreadCount).toBe(0);
    expect((await secondStudent.get("/api/me/notifications")).body.unreadCount).toBe(1);
  });
});
