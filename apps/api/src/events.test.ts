import { MemoryStore } from "express-session";
import request from "supertest";
import type { User } from "./generated/prisma/client.js";
import { EventCategory, EventStatus, UserRole } from "./generated/prisma/client.js";
import type { AuthRepository } from "./auth.js";
import type {
  EventCreateData,
  EventRecord,
  EventRepository,
  EventUpdateData,
  RegistrationRecord,
  RegistrationResult,
  RegistrationWithEventRecord,
} from "./events.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/campusconnect";
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
process.env.FRONTEND_ORIGIN = "http://localhost:5173";

const users = new Map<string, User>();
const events = new Map<string, EventRecord>();
const registrations = new Map<string, RegistrationRecord>();
const deletionBlockedEventIds = new Set<string>();
let app: import("express").Express;
let organizer: ReturnType<typeof request.agent>;
let otherOrganizer: ReturnType<typeof request.agent>;
let student: ReturnType<typeof request.agent>;
let otherStudent: ReturnType<typeof request.agent>;
let organizerId: string;
let otherOrganizerId: string;
let studentId: string;
let otherStudentId: string;

const authRepository: AuthRepository = {
  async findByEmail(email) {
    return [...users.values()].find((user) => user.email === email) ?? null;
  },
  async findById(id) {
    const user = users.get(id);
    if (!user) return null;
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  },
  async create(data) {
    const user: User = {
      id: `user-${users.size + 1}`,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.set(user.id, user);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  },
  async storePasswordResetToken() {},
  async resetPassword() {
    return false;
  },
};

const eventRepository: EventRepository = {
  async listPublished(filters) {
    return [...events.values()]
      .filter((event) => event.status === EventStatus.PUBLISHED)
      .filter((event) => !filters.category || event.category === filters.category)
      .filter((event) => {
        if (!filters.search) return true;
        const searchable = `${event.title} ${event.description} ${event.venue}`.toLowerCase();
        return searchable.includes(filters.search.toLowerCase());
      })
      .sort((first, second) => first.startAt.getTime() - second.startAt.getTime());
  },
  async listOwned(ownerId) {
    return [...events.values()]
      .filter((event) => event.organizerId === ownerId)
      .sort((first, second) => first.startAt.getTime() - second.startAt.getTime());
  },
  async findPublishedById(id) {
    const event = events.get(id);
    return event?.status === EventStatus.PUBLISHED ? event : null;
  },
  async findById(id) {
    return events.get(id) ?? null;
  },
  async findUserRole(userId) {
    return users.get(userId)?.role ?? null;
  },
  async registerForEvent(eventId, userId): Promise<RegistrationResult> {
    const event = events.get(eventId);
    if (!event || event.status !== EventStatus.PUBLISHED) return { status: "not_found" };

    const registrationKey = `${userId}:${eventId}`;
    if (registrations.has(registrationKey)) return { status: "duplicate" };

    const registrationCount = [...registrations.values()].filter(
      (registration) => registration.eventId === eventId,
    ).length;
    if (event.capacity !== null && registrationCount >= event.capacity) {
      return { status: "capacity_reached" };
    }

    const registration: RegistrationRecord = {
      id: `registration-${registrations.size + 1}`,
      userId,
      eventId,
      createdAt: new Date(),
    };
    registrations.set(registrationKey, registration);
    return { status: "created", registration };
  },
  async findRegistrationStatus(eventId, userId) {
    if (!events.has(eventId)) return null;
    return registrations.has(`${userId}:${eventId}`);
  },
  async listUserRegistrations(userId): Promise<RegistrationWithEventRecord[]> {
    return [...registrations.values()]
      .filter((registration) => registration.userId === userId)
      .flatMap((registration) => {
        const event = events.get(registration.eventId);
        return event ? [{ ...registration, event }] : [];
      })
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime());
  },
  async create(data: EventCreateData) {
    const id = `event-${events.size + 1}`;
    const user = users.get(data.organizerId);
    if (!user) throw new Error("Missing test organizer");
    const now = new Date();
    const event: EventRecord = {
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
      organizer: { name: user.name },
    };
    events.set(id, event);
    return event;
  },
  async updateOwned(id: string, ownerId: string, data: EventUpdateData) {
    const event = events.get(id);
    if (!event || event.organizerId !== ownerId) return null;
    const updated = { ...event, ...data, updatedAt: new Date() };
    events.set(id, updated);
    return updated;
  },
  async deleteOwned(id, ownerId) {
    if (deletionBlockedEventIds.has(id)) throw { code: "P2003" };
    const event = events.get(id);
    if (!event || event.organizerId !== ownerId) return false;
    events.delete(id);
    return true;
  },
};

beforeAll(async () => {
  const { createApp } = await import("./app.js");
  app = createApp({
    authRepository,
    eventRepository,
    sessionStore: new MemoryStore(),
  });

  async function register(name: string, role: "STUDENT" | "ORGANIZER") {
    const agent = request.agent(app);
    const email = `${name.toLowerCase().replaceAll(" ", ".")}-${Date.now()}@example.com`;
    if (role === "STUDENT") {
      const result = await agent.post("/api/auth/register").send({
        name,
        email,
        password: "event-test-password",
      });
      expect(result.status).toBe(201);
      return { agent, id: result.body.user.id as string };
    }

    const argon2 = (await import("argon2")).default;
    const user = await authRepository.create({
      name,
      email,
      passwordHash: await argon2.hash("event-test-password"),
      role: UserRole.ORGANIZER,
    });
    const login = await agent
      .post("/api/auth/login")
      .send({ email, password: "event-test-password" });
    expect(login.status).toBe(200);
    return { agent, id: user.id };
  }

  const organizerAccount = await register("Event Organizer", "ORGANIZER");
  const otherOrganizerAccount = await register("Other Organizer", "ORGANIZER");
  const studentAccount = await register("Campus Student", "STUDENT");
  const otherStudentAccount = await register("Another Student", "STUDENT");
  organizer = organizerAccount.agent;
  organizerId = organizerAccount.id;
  otherOrganizer = otherOrganizerAccount.agent;
  otherOrganizerId = otherOrganizerAccount.id;
  student = studentAccount.agent;
  studentId = studentAccount.id;
  otherStudent = otherStudentAccount.agent;
  otherStudentId = otherStudentAccount.id;
});

beforeEach(() => {
  events.clear();
  registrations.clear();
  deletionBlockedEventIds.clear();
});
afterEach(() => {
  events.clear();
  registrations.clear();
  deletionBlockedEventIds.clear();
});

function seedEvent({
  id,
  ownerId = organizerId,
  status = EventStatus.PUBLISHED,
  startAt = new Date("2026-11-10T10:00:00.000Z"),
  category = EventCategory.TECHNOLOGY,
  title = "Campus Technology Talk",
  capacity = null,
}: {
  id: string;
  ownerId?: string;
  status?: EventStatus;
  startAt?: Date;
  category?: EventCategory;
  title?: string;
  capacity?: number | null;
}) {
  const owner = users.get(ownerId);
  if (!owner) throw new Error("Missing test event owner");
  const event: EventRecord = {
    id,
    title,
    description: "A useful campus gathering",
    category,
    venue: "Innovation Hall",
    startAt,
    endAt: null,
    organizerId: ownerId,
    status,
    capacity,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    organizer: { name: owner.name },
  };
  events.set(id, event);
  return event;
}

const validEvent = {
  title: "Campus Design Workshop",
  description: "A practical design session",
  category: "WORKSHOPS",
  venue: "Design Studio",
  startAt: "2026-11-21T10:00:00.000Z",
};

describe("Event API", () => {
  it("lists only the signed-in organizer's events, including drafts", async () => {
    seedEvent({ id: "organizer-draft", status: EventStatus.DRAFT });
    seedEvent({ id: "organizer-published" });
    seedEvent({ id: "other-organizer", ownerId: otherOrganizerId });

    expect((await request(app).get("/api/events/mine")).status).toBe(401);
    expect((await student.get("/api/events/mine")).status).toBe(403);

    const response = await organizer.get("/api/events/mine");
    expect(response.status).toBe(200);
    expect(response.body.events.map((event: { id: string }) => event.id)).toEqual([
      "organizer-draft",
      "organizer-published",
    ]);
    expect(response.body.events[0].status).toBe("DRAFT");
    expect(response.body.events[0]).not.toHaveProperty("organizerId");
  });

  it("lists published events only, with filters, ascending dates, and organizer display name", async () => {
    seedEvent({ id: "later", startAt: new Date("2026-11-20T10:00:00.000Z") });
    seedEvent({ id: "earlier", startAt: new Date("2026-11-10T10:00:00.000Z") });
    seedEvent({ id: "draft", status: EventStatus.DRAFT });
    seedEvent({
      id: "sports",
      category: EventCategory.SPORTS,
      title: "Sports Day",
    });

    const response = await request(app).get("/api/events?category=TECHNOLOGY&search=innovation");

    expect(response.status).toBe(200);
    expect(response.body.events.map((event: { id: string }) => event.id)).toEqual([
      "earlier",
      "later",
    ]);
    expect(response.body.events[0].organizer).toEqual({ name: "Event Organizer" });
    expect(response.body.events[0]).not.toHaveProperty("organizerId");
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
    expect(JSON.stringify(response.body)).not.toContain("session");
  });

  it("returns 404 for drafts and unknown public event IDs", async () => {
    seedEvent({ id: "draft", status: EventStatus.DRAFT });

    expect((await request(app).get("/api/events/draft")).status).toBe(404);
    expect((await request(app).get("/api/events/missing")).status).toBe(404);
    expect((await request(app).get("/api/events/earlier")).status).toBe(404);
  });

  it("requires authentication and the organizer role to create events", async () => {
    expect((await request(app).post("/api/events").send(validEvent)).status).toBe(401);
    expect((await student.post("/api/events").send(validEvent)).status).toBe(403);
  });

  it("creates an owned draft and does not accept a client-supplied organizer ID", async () => {
    const response = await organizer.post("/api/events").send(validEvent);

    expect(response.status).toBe(201);
    expect(response.body.event).toMatchObject({
      ...validEvent,
      status: "DRAFT",
      organizer: { name: "Event Organizer" },
    });
    expect(response.body.event).not.toHaveProperty("organizerId");
    expect(events.get(response.body.event.id)?.organizerId).toBe(organizerId);

    const massAssignment = await organizer
      .post("/api/events")
      .send({ ...validEvent, organizerId: otherOrganizerId });
    expect(massAssignment.status).toBe(400);
  });

  it("allows an owning organizer to update, publish, and delete an event", async () => {
    seedEvent({ id: "owned", status: EventStatus.DRAFT });

    const update = await organizer.patch("/api/events/owned").send({
      title: "Published Workshop",
      status: "PUBLISHED",
      capacity: 30,
    });
    expect(update.status).toBe(200);
    expect(update.body.event).toMatchObject({
      title: "Published Workshop",
      status: "PUBLISHED",
      capacity: 30,
    });
    expect((await request(app).get("/api/events/owned")).status).toBe(200);

    const deletion = await organizer.delete("/api/events/owned");
    expect(deletion.status).toBe(204);
    expect((await organizer.get("/api/events/owned")).status).toBe(404);
  });

  it("prevents students and non-owning organizers from editing or deleting events", async () => {
    seedEvent({ id: "owned" });

    expect((await student.patch("/api/events/owned").send({ title: "No" })).status).toBe(403);
    expect((await student.delete("/api/events/owned")).status).toBe(403);
    expect((await otherOrganizer.patch("/api/events/owned").send({ title: "No" })).status).toBe(
      403,
    );
    expect((await otherOrganizer.delete("/api/events/owned")).status).toBe(403);
    expect(events.has("owned")).toBe(true);
  });

  it("validates category, dates, capacities, queries, and protected fields", async () => {
    expect(
      (await organizer.post("/api/events").send({ ...validEvent, category: "NOT_A_CATEGORY" }))
        .status,
    ).toBe(400);
    expect(
      (
        await organizer.post("/api/events").send({
          ...validEvent,
          endAt: "2026-11-20T10:00:00.000Z",
        })
      ).status,
    ).toBe(400);
    expect(
      (await organizer.post("/api/events").send({ ...validEvent, startAt: "not-a-date" })).status,
    ).toBe(400);
    expect((await organizer.post("/api/events").send({ ...validEvent, capacity: 0 })).status).toBe(
      400,
    );
    expect((await request(app).get("/api/events?category=NOT_A_CATEGORY")).status).toBe(400);

    seedEvent({ id: "protected" });
    expect(
      (await organizer.patch("/api/events/protected").send({ organizerId: organizerId })).status,
    ).toBe(400);
    expect(
      (await organizer.patch("/api/events/protected").send({ id: "new-id" })).status,
    ).toBe(400);
    expect(
      (
        await organizer
          .patch("/api/events/protected")
          .send({ endAt: "2026-11-01T10:00:00.000Z" })
      ).status,
    ).toBe(400);
  });

  it("returns not found for edits and deletes of missing events", async () => {
    expect((await organizer.patch("/api/events/missing").send({ title: "Missing" })).status).toBe(
      404,
    );
    expect((await organizer.delete("/api/events/missing")).status).toBe(404);
  });

  it("explains when registrations prevent deleting an event", async () => {
    seedEvent({ id: "event-with-registrations" });
    deletionBlockedEventIds.add("event-with-registrations");

    const response = await organizer.delete("/api/events/event-with-registrations");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Events with registrations cannot be deleted" });
  });

  it("requires an authenticated student to register and check registration status", async () => {
    seedEvent({ id: "registration-auth" });

    expect((await request(app).post("/api/events/registration-auth/register")).status).toBe(401);
    expect((await request(app).get("/api/events/registration-auth/registration")).status).toBe(401);
    expect((await organizer.post("/api/events/registration-auth/register")).status).toBe(403);
    expect((await organizer.get("/api/events/registration-auth/registration")).status).toBe(403);
  });

  it("rejects registrations for unpublished or missing events", async () => {
    seedEvent({ id: "registration-draft", status: EventStatus.DRAFT });

    expect((await student.post("/api/events/registration-draft/register")).status).toBe(404);
    expect((await student.post("/api/events/registration-missing/register")).status).toBe(404);
    expect((await student.get("/api/events/registration-missing/registration")).status).toBe(404);
  });

  it("creates a registration for the session student and prevents duplicates", async () => {
    seedEvent({ id: "registration-success" });

    const response = await student
      .post("/api/events/registration-success/register")
      .send({ userId: otherStudentId });

    expect(response.status).toBe(400);

    const registration = await student.post("/api/events/registration-success/register");
    expect(registration.status).toBe(201);
    expect(registration.body.registration).toMatchObject({
      id: "registration-1",
      eventId: "registration-success",
    });
    expect(registration.body.registration).not.toHaveProperty("userId");
    expect(registrations.get(`${studentId}:registration-success`)?.userId).toBe(studentId);
    expect(registrations.has(`${otherStudentId}:registration-success`)).toBe(false);
    expect((await student.post("/api/events/registration-success/register")).status).toBe(409);
  });

  it("prevents registrations once event capacity is reached", async () => {
    seedEvent({ id: "registration-full", capacity: 1 });
    expect((await student.post("/api/events/registration-full/register")).status).toBe(201);

    const response = await otherStudent.post("/api/events/registration-full/register");
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Event is full" });
    expect(
      [...registrations.values()].filter((item) => item.eventId === "registration-full"),
    ).toHaveLength(1);
  });

  it("returns only the current student's registration status", async () => {
    seedEvent({ id: "registration-private" });
    await student.post("/api/events/registration-private/register");

    const registeredStudentStatus = await student.get(
      "/api/events/registration-private/registration",
    );
    expect(registeredStudentStatus.status).toBe(200);
    expect(registeredStudentStatus.body).toEqual({ registered: true });

    const otherStudentStatus = await otherStudent.get(
      "/api/events/registration-private/registration",
    );
    expect(otherStudentStatus.status).toBe(200);
    expect(otherStudentStatus.body).toEqual({ registered: false });
    expect(JSON.stringify(otherStudentStatus.body)).not.toContain("userId");
    expect(JSON.stringify(otherStudentStatus.body)).not.toContain("registration-");
  });

  it("lists only the session student's registrations, including unpublished events", async () => {
    seedEvent({ id: "my-published-registration" });
    seedEvent({ id: "my-draft-registration", status: EventStatus.DRAFT });
    seedEvent({ id: "other-student-registration" });
    await student.post("/api/events/my-published-registration/register");

    registrations.set(`${studentId}:my-draft-registration`, {
      id: "registration-draft",
      userId: studentId,
      eventId: "my-draft-registration",
      createdAt: new Date("2026-10-10T00:00:00.000Z"),
    });
    registrations.set(`${otherStudentId}:other-student-registration`, {
      id: "registration-other",
      userId: otherStudentId,
      eventId: "other-student-registration",
      createdAt: new Date("2026-10-11T00:00:00.000Z"),
    });

    const response = await student.get("/api/me/registrations?userId=" + otherStudentId);

    expect(response.status).toBe(200);
    const listedRegistrations = response.body.registrations as Array<{
      event: { id: string; status: EventStatus; organizerId?: string };
    }>;
    expect(listedRegistrations.map((item) => item.event.id).sort()).toEqual([
      "my-draft-registration",
      "my-published-registration",
    ]);
    const listedDraft = listedRegistrations.find(
      (item) => item.event.id === "my-draft-registration",
    );
    expect(listedDraft?.event.status).toBe(EventStatus.DRAFT);
    expect(listedDraft?.event).not.toHaveProperty("organizerId");
    expect(JSON.stringify(response.body)).not.toContain(otherStudentId);
    expect(JSON.stringify(response.body)).not.toContain("other-student-registration");
  });

  it("requires a signed-in student to list registrations", async () => {
    expect((await request(app).get("/api/me/registrations")).status).toBe(401);
    expect((await organizer.get("/api/me/registrations")).status).toBe(403);
  });
});
