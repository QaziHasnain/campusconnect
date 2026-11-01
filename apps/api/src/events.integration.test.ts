import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { MemoryStore } from "express-session";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventCategory, EventStatus } from "./generated/prisma/client.js";
import { env } from "./env.js";

const runDatabaseIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const integrationEmailPrefix = `registration-integration-${randomUUID()}`;
const integrationPassword = "registration-integration-password";

describe.skipIf(!runDatabaseIntegrationTests)("Registration API with PostgreSQL", () => {
  let app: import("express").Express;
  let prisma: typeof import("./prisma.js").prisma;
  let pool: typeof import("./db.js").pool;
  let organizer: ReturnType<typeof request.agent>;
  let student: ReturnType<typeof request.agent>;
  let secondStudent: ReturnType<typeof request.agent>;
  let organizerId: string;
  let studentId: string;
  let secondStudentId: string;
  const eventIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const databaseUrl = new URL(env.databaseUrl);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    const configuredDatabase = decodeURIComponent(databaseUrl.pathname.slice(1));
    if (!localHosts.has(databaseUrl.hostname) || configuredDatabase !== "CampusConnect") {
      throw new Error("Registration integration tests require the local CampusConnect database");
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
    if (identity.rows[0]?.database_name !== "CampusConnect") {
      throw new Error("Connected database is not CampusConnect");
    }

    app = appModule.createApp({ sessionStore: new MemoryStore() });
    const createAccount = async (name: string, role: "STUDENT" | "ORGANIZER") => {
      const agent = request.agent(app);
      const email = `${integrationEmailPrefix}-${role}-${name}@example.test`;
      let userId: string;
      if (role === "ORGANIZER") {
        const account = await prisma.user.create({
          data: {
            name,
            email,
            passwordHash: await argon2.hash(integrationPassword),
            role: "ORGANIZER",
          },
          select: { id: true },
        });
        userId = account.id;
        userIds.push(userId);
      } else {
        const response = await agent.post("/api/auth/register").send({
          name,
          email,
          password: integrationPassword,
        });
        if (response.status !== 201 || typeof response.body.user?.id !== "string") {
          throw new Error(`Could not create registration integration ${role} account`);
        }
        userId = response.body.user.id as string;
        userIds.push(userId);
      }

      if (role === "ORGANIZER") {
        const login = await agent.post("/api/auth/login").send({
          email,
          password: integrationPassword,
        });
        if (login.status !== 200) {
          throw new Error("Could not sign in registration integration organizer account");
        }
      }
      return { agent, id: userId };
    };

    const [organizerAccount, studentAccount, secondStudentAccount] = await Promise.all([
      createAccount("organizer", "ORGANIZER"),
      createAccount("student-one", "STUDENT"),
      createAccount("student-two", "STUDENT"),
    ]);
    organizer = organizerAccount.agent;
    organizerId = organizerAccount.id;
    student = studentAccount.agent;
    studentId = studentAccount.id;
    secondStudent = secondStudentAccount.agent;
    secondStudentId = secondStudentAccount.id;
  }, 30_000);

  afterAll(async () => {
    if (prisma && pool) {
      if (eventIds.length > 0) {
        await prisma.registration.deleteMany({ where: { eventId: { in: eventIds } } });
        await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
      }
      if (userIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      await prisma.$disconnect();
      await pool.end();
    }
  });

  async function createEvent(status: EventStatus, capacity: number | null = null) {
    const event = await prisma.event.create({
      data: {
        title: `Registration integration ${randomUUID()}`,
        description: "Isolated registration integration fixture",
        category: EventCategory.TECHNOLOGY,
        venue: "Integration Test Hall",
        startAt: new Date("2026-11-10T10:00:00.000Z"),
        endAt: null,
        organizerId,
        status,
        capacity,
      },
      select: { id: true },
    });
    eventIds.push(event.id);
    return event.id;
  }

  it("enforces registration authorization, uniqueness, privacy, publication, and concurrent capacity", async () => {
    const publishedEventId = await createEvent(EventStatus.PUBLISHED);
    const draftEventId = await createEvent(EventStatus.DRAFT);
    const capacityEventId = await createEvent(EventStatus.PUBLISHED, 1);

    expect(
      (await request(app).post(`/api/events/${publishedEventId}/register`)).status,
    ).toBe(401);
    expect(
      (await request(app).get(`/api/events/${publishedEventId}/registration`)).status,
    ).toBe(401);
    expect((await organizer.post(`/api/events/${publishedEventId}/register`)).status).toBe(403);
    expect((await organizer.get(`/api/events/${publishedEventId}/registration`)).status).toBe(403);
    expect((await student.post(`/api/events/${draftEventId}/register`)).status).toBe(404);
    expect((await student.post("/api/events/nonexistent-registration-event/register")).status).toBe(
      404,
    );

    const registration = await student.post(`/api/events/${publishedEventId}/register`);
    expect(registration.status).toBe(201);
    expect(registration.body.registration).not.toHaveProperty("userId");
    expect((await student.post(`/api/events/${publishedEventId}/register`)).status).toBe(409);

    const ownStatus = await student.get(`/api/events/${publishedEventId}/registration`);
    expect(ownStatus.status).toBe(200);
    expect(ownStatus.body).toEqual({ registered: true });

    const otherStatus = await secondStudent.get(`/api/events/${publishedEventId}/registration`);
    expect(otherStatus.status).toBe(200);
    expect(otherStatus.body).toEqual({ registered: false });
    expect(JSON.stringify(otherStatus.body)).not.toContain(studentId);

    const concurrentResults = await Promise.all([
      student.post(`/api/events/${capacityEventId}/register`),
      secondStudent.post(`/api/events/${capacityEventId}/register`),
    ]);
    expect(concurrentResults.map((response) => response.status).sort()).toEqual([201, 409]);
    const capacityResponse = concurrentResults.find((response) => response.status === 409);
    expect(capacityResponse?.body).toEqual({ error: "Event is full" });
    const capacityRegistrations = await prisma.registration.findMany({
      where: { eventId: capacityEventId },
      select: { userId: true },
    });
    expect(capacityRegistrations).toHaveLength(1);
    expect([studentId, secondStudentId]).toContain(capacityRegistrations[0].userId);
  }, 30_000);
});
