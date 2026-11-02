import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import expressSession from "express-session";
import { MemoryStore } from "express-session";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventCategory, EventPaymentStatus, EventStatus } from "./generated/prisma/client.js";
import { env } from "./env.js";
import { pool } from "./db.js";
import { prisma } from "./prisma.js";
import {
  createPrismaPaymentRepository,
  getPaymentConfiguration,
  type PaymentGateway,
  type ProviderPayment,
} from "./payments.js";
import { createPaymentRouter } from "./payments.js";
import { createEventRouter, createPrismaEventRepository } from "./events.js";

const runDatabaseIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const fixturePrefix = `payment-integration-${randomUUID()}`;
const keySecret = "integration-test-key-secret";
const webhookSecret = "integration-test-webhook-secret";
const configuration = getPaymentConfiguration({
  mode: "test",
  keyId: "rzp_test_integration_fixture",
  keySecret,
  webhookSecret,
});

class DatabaseTestGateway implements PaymentGateway {
  readonly payments = new Map<string, ProviderPayment>();
  private orderNumber = 0;

  get createdOrderCount() {
    return this.orderNumber;
  }

  async createOrder() {
    this.orderNumber += 1;
    return { id: `order_integration_${this.orderNumber}` };
  }

  async fetchPayment(paymentId: string) {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new Error("Missing integration payment fixture");
    return payment;
  }
}

describe.skipIf(!runDatabaseIntegrationTests)("Razorpay payments with PostgreSQL", () => {
  let app: express.Express;
  let organizerId: string;
  let firstStudentId: string;
  let secondStudentId: string;
  let firstStudent: ReturnType<typeof request.agent>;
  let secondStudent: ReturnType<typeof request.agent>;
  let organizer: ReturnType<typeof request.agent>;
  const eventIds: string[] = [];
  const userIds: string[] = [];
  const webhookIds: string[] = [];
  const gateway = new DatabaseTestGateway();

  async function assertDedicatedDatabase() {
    const configured = new URL(env.databaseUrl);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    if (
      !localHosts.has(configured.hostname) ||
      decodeURIComponent(configured.pathname.slice(1)) !== "campusconnect_test"
    ) {
      throw new Error("Payment integration tests require the dedicated local campusconnect_test database");
    }
    const result = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    if (result.rows[0]?.database_name !== "campusconnect_test") {
      throw new Error("Connected database is not campusconnect_test");
    }
  }

  async function db<T>(operation: () => Promise<T>): Promise<T> {
    await assertDedicatedDatabase();
    return operation();
  }

  async function api<T extends request.Test>(operation: () => T) {
    await assertDedicatedDatabase();
    return operation();
  }

  beforeAll(async () => {
    await assertDedicatedDatabase();
    app = express();
    app.use(
      expressSession({
        secret: "payment-integration-session-secret-for-tests",
        resave: false,
        saveUninitialized: false,
        store: new MemoryStore(),
      }),
    );
    app.post("/test/login/:userId", (req, res) => {
      req.session.userId = req.params.userId;
      res.status(204).end();
    });
    app.use(
      "/api/payments",
      createPaymentRouter(createPrismaPaymentRepository(prisma), gateway, configuration),
    );
    app.use(express.json());
    app.use("/api/events", createEventRouter(createPrismaEventRepository(prisma)));

    const passwordHash = "integration-fixture-password-hash";
    const accounts = await db(() =>
      prisma.user.createManyAndReturn({
        data: [
          { name: "Payment Test Organizer", email: `${fixturePrefix}-organizer@example.test`, passwordHash, role: "ORGANIZER", emailVerified: true, emailVerifiedAt: new Date() },
          { name: "Payment Test Student One", email: `${fixturePrefix}-student-one@example.test`, passwordHash, role: "STUDENT", emailVerified: true, emailVerifiedAt: new Date() },
          { name: "Payment Test Student Two", email: `${fixturePrefix}-student-two@example.test`, passwordHash, role: "STUDENT", emailVerified: true, emailVerifiedAt: new Date() },
        ],
        select: { id: true, role: true },
      }),
    );
    organizerId = accounts.find((account) => account.role === "ORGANIZER")!.id;
    const students = accounts.filter((account) => account.role === "STUDENT");
    firstStudentId = students[0].id;
    secondStudentId = students[1].id;
    userIds.push(...accounts.map((account) => account.id));

    firstStudent = request.agent(app);
    secondStudent = request.agent(app);
    organizer = request.agent(app);
    await Promise.all([
      api(() => firstStudent.post(`/test/login/${firstStudentId}`)),
      api(() => secondStudent.post(`/test/login/${secondStudentId}`)),
      api(() => organizer.post(`/test/login/${organizerId}`)),
    ]);
  }, 30_000);

  afterAll(async () => {
    if (eventIds.length > 0 || userIds.length > 0 || webhookIds.length > 0) {
      await assertDedicatedDatabase();
      if (webhookIds.length > 0) {
        await db(() => prisma.razorpayWebhookEvent.deleteMany({ where: { id: { in: webhookIds } } }));
      }
      if (eventIds.length > 0) {
        await db(() => prisma.eventPaymentAttempt.deleteMany({ where: { eventId: { in: eventIds } } }));
        await db(() => prisma.registration.deleteMany({ where: { eventId: { in: eventIds } } }));
        await db(() => prisma.event.deleteMany({ where: { id: { in: eventIds } } }));
      }
      if (userIds.length > 0) {
        await db(() => prisma.user.deleteMany({ where: { id: { in: userIds } } }));
      }
    }
    await prisma.$disconnect();
    await pool.end();
  });

  async function createEvent(capacity: number, pricePaise = 1250) {
    const event = await db(() =>
      prisma.event.create({
        data: {
          title: `Payment integration ${randomUUID()}`,
          description: "Isolated payment integration fixture",
          category: EventCategory.TECHNOLOGY,
          venue: "Integration Test Hall",
          startAt: new Date("2026-11-10T10:00:00.000Z"),
          organizerId,
          status: EventStatus.PUBLISHED,
          capacity,
          ticketPricePaise: pricePaise,
        },
        select: { id: true },
      }),
    );
    eventIds.push(event.id);
    return event.id;
  }

  async function createPaidOrder(agent: ReturnType<typeof request.agent>, eventId: string) {
    return api(() => agent.post(`/api/payments/events/${eventId}/orders`).send({}));
  }

  async function capture(agent: ReturnType<typeof request.agent>, order: any, paymentId: string) {
    const payment: ProviderPayment = {
      id: paymentId,
      orderId: order.body.orderId,
      amountPaise: order.body.amountPaise,
      currency: "INR",
      status: "captured",
    };
    gateway.payments.set(paymentId, payment);
    const signature = createHmac("sha256", keySecret)
      .update(`${order.body.orderId}|${paymentId}`)
      .digest("hex");
    return api(() =>
      agent.post("/api/payments/checkout/verify").send({
        paymentAttemptId: order.body.paymentAttemptId,
        paymentId,
        signature,
      }),
    );
  }

  async function registrationCount(eventId: string) {
    return db(() => prisma.registration.count({ where: { eventId } }));
  }

  it("lets only one of two students reserve the final paid seat", async () => {
    const eventId = await createEvent(1);
    const responses = await Promise.all([
      createPaidOrder(firstStudent, eventId),
      createPaidOrder(secondStudent, eventId),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const attempts = await db(() =>
      prisma.eventPaymentAttempt.count({
        where: { eventId, status: EventPaymentStatus.PENDING, expiresAt: { gt: new Date() } },
      }),
    );
    expect(attempts).toBe(1);
    expect(await registrationCount(eventId)).toBe(0);
  });

  it("reports paid registrations and active payment reservations in public seat totals", async () => {
    const eventId = await createEvent(3);
    const publicEvent = () => api(() => request(app).get(`/api/events/${eventId}`));

    expect((await publicEvent()).body.event).toMatchObject({
      capacity: 3,
      registeredCount: 0,
      remainingSeats: 3,
    });

    const order = await createPaidOrder(firstStudent, eventId);
    expect(order.status).toBe(201);
    expect((await publicEvent()).body.event).toMatchObject({
      registeredCount: 0,
      remainingSeats: 2,
    });

    expect((await firstStudent.post(`/api/payments/${order.body.paymentAttemptId}/cancel`).send({})).status)
      .toBe(200);
    expect((await publicEvent()).body.event.remainingSeats).toBe(2);

    const resumedOrder = await createPaidOrder(firstStudent, eventId);
    expect(resumedOrder.status).toBe(201);
    expect((await capture(firstStudent, resumedOrder, "payment_seat_count_capture")).body.status)
      .toBe(EventPaymentStatus.SUCCESSFUL);
    expect((await publicEvent()).body.event).toMatchObject({
      registeredCount: 1,
      remainingSeats: 2,
    });
  });

  it("serializes concurrent captures for one payment and creates exactly one registration", async () => {
    const eventId = await createEvent(2);
    const order = await createPaidOrder(firstStudent, eventId);
    expect(order.status).toBe(201);
    const results = await Promise.all([
      capture(firstStudent, order, "payment_concurrent_capture"),
      capture(firstStudent, order, "payment_concurrent_capture"),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(results.map((result) => result.body.status)).toEqual([
      EventPaymentStatus.SUCCESSFUL,
      EventPaymentStatus.SUCCESSFUL,
    ]);
    expect(await registrationCount(eventId)).toBe(1);
  });

  it("processes duplicate captured webhook deliveries idempotently", async () => {
    const eventId = await createEvent(2);
    const order = await createPaidOrder(firstStudent, eventId);
    const webhookId = `evt_${randomUUID()}`;
    webhookIds.push(webhookId);
    const body = JSON.stringify({
      id: webhookId,
      event: "payment.captured",
      payload: { payment: { entity: {
        id: "payment_duplicate_webhook",
        order_id: order.body.orderId,
        amount: order.body.amountPaise,
        currency: "INR",
        status: "captured",
      } } },
    });
    const signature = createHmac("sha256", webhookSecret).update(body).digest("hex");
    const deliver = () => api(() =>
      request(app).post("/api/payments/webhook")
        .set("Content-Type", "application/json")
        .set("x-razorpay-signature", signature)
        .send(body),
    );
    expect((await deliver()).status).toBe(200);
    expect((await deliver()).status).toBe(200);
    expect(await registrationCount(eventId)).toBe(1);
    expect(await db(() => prisma.razorpayWebhookEvent.count({ where: { id: webhookId } }))).toBe(1);
  });

  it("creates one registration for a captured payment", async () => {
    const eventId = await createEvent(2);
    const order = await createPaidOrder(firstStudent, eventId);
    expect(order.status).toBe(201);
    expect((await capture(firstStudent, order, "payment_single_capture")).body.status)
      .toBe(EventPaymentStatus.SUCCESSFUL);
    expect(await registrationCount(eventId)).toBe(1);
    const attempt = await db(() => prisma.eventPaymentAttempt.findUnique({
      where: { id: order.body.paymentAttemptId },
      select: { status: true, registrationId: true },
    }));
    expect(attempt?.status).toBe(EventPaymentStatus.SUCCESSFUL);
    expect(attempt?.registrationId).toBeTruthy();
    const attendees = await api(() => organizer.get(`/api/events/${eventId}/attendees`));
    expect(attendees.status).toBe(200);
    expect(attendees.body).toMatchObject({ totalRegistrations: 1, availableCapacity: 1 });
    expect(attendees.body.attendees[0]).toMatchObject({
      registrationStatus: "CONFIRMED",
      paymentStatus: "SUCCESSFUL",
    });
    expect(attendees.body.attendees[0]).not.toHaveProperty("paymentId");
    expect(attendees.body.attendees[0]).not.toHaveProperty("razorpayOrderId");
  });

  it("does not create registrations for failed or cancelled payments", async () => {
    const failedEventId = await createEvent(2);
    const failedOrder = await createPaidOrder(firstStudent, failedEventId);
    const failedPaymentId = "payment_failed_integration";
    gateway.payments.set(failedPaymentId, {
      id: failedPaymentId,
      orderId: failedOrder.body.orderId,
      amountPaise: failedOrder.body.amountPaise,
      currency: "INR",
      status: "failed",
    });
    const failedSignature = createHmac("sha256", keySecret)
      .update(`${failedOrder.body.orderId}|${failedPaymentId}`).digest("hex");
    const failed = await api(() => firstStudent.post("/api/payments/checkout/verify").send({
      paymentAttemptId: failedOrder.body.paymentAttemptId,
      paymentId: failedPaymentId,
      signature: failedSignature,
    }));
    expect(failed.body.status).toBe(EventPaymentStatus.FAILED);
    expect(await registrationCount(failedEventId)).toBe(0);

    const cancelledEventId = await createEvent(2);
    const cancelledOrder = await createPaidOrder(firstStudent, cancelledEventId);
    const cancelled = await api(() => firstStudent
      .post(`/api/payments/${cancelledOrder.body.paymentAttemptId}/cancel`).send({}));
    expect(cancelled.body.status).toBe(EventPaymentStatus.CANCELLED);
    expect(await registrationCount(cancelledEventId)).toBe(0);
  });

  it("preserves payment and registration records on event cancellation and blocks new orders", async () => {
    const eventId = await createEvent(3);
    const successfulOrder = await createPaidOrder(firstStudent, eventId);
    expect((await capture(firstStudent, successfulOrder, "payment_before_event_cancel")).status).toBe(200);
    const pendingOrder = await createPaidOrder(secondStudent, eventId);
    expect(pendingOrder.status).toBe(201);
    const orderCountBeforeCancellation = gateway.createdOrderCount;

    const cancellation = await api(() => organizer.post(`/api/events/${eventId}/cancel`).send({}));
    expect(cancellation.status).toBe(200);
    expect(cancellation.body.event.status).toBe("CANCELLED");

    expect((await createPaidOrder(secondStudent, eventId)).status).toBe(409);
    expect(gateway.createdOrderCount).toBe(orderCountBeforeCancellation);
    expect(await registrationCount(eventId)).toBe(1);
    const attempts = await db(() => prisma.eventPaymentAttempt.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
      select: { status: true, registrationId: true, razorpayOrderId: true },
    }));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ status: EventPaymentStatus.SUCCESSFUL });
    expect(attempts[0].registrationId).toBeTruthy();
    expect(attempts[1]).toMatchObject({ status: EventPaymentStatus.PENDING });
    expect(attempts[1].razorpayOrderId).toBe(pendingOrder.body.orderId);
    expect(await db(() => prisma.notification.count({
      where: { reminderKey: `event-cancellation:${eventId}:${firstStudentId}` },
    }))).toBe(1);

    const afterCancelCapture = await capture(secondStudent, pendingOrder, "payment_after_event_cancel");
    expect(afterCancelCapture.status).toBe(200);
    expect(afterCancelCapture.body.status).toBe(EventPaymentStatus.REFUND_REQUIRED);
    expect(await registrationCount(eventId)).toBe(1);
    const preservedAttempts = await db(() => prisma.eventPaymentAttempt.findMany({
      where: { eventId },
      select: { status: true, razorpayPaymentId: true },
    }));
    expect(preservedAttempts).toHaveLength(2);
    expect(preservedAttempts.some((attempt) =>
      attempt.status === EventPaymentStatus.REFUND_REQUIRED &&
      attempt.razorpayPaymentId === "payment_after_event_cancel",
    )).toBe(true);
  }, 30_000);

  it("rejects free registration for a paid event while its limited seat is reserved", async () => {
    const eventId = await createEvent(1);
    const results = await Promise.all([
      createPaidOrder(firstStudent, eventId),
      api(() => secondStudent.post(`/api/events/${eventId}/register`).send({})),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    const occupiedSeats = await db(async () => {
      const [registrations, reservations] = await Promise.all([
        prisma.registration.count({ where: { eventId } }),
        prisma.eventPaymentAttempt.count({
          where: { eventId, status: EventPaymentStatus.PENDING, expiresAt: { gt: new Date() } },
        }),
      ]);
      return registrations + reservations;
    });
    expect(occupiedSeats).toBe(1);
  });

  it("reuses a checkout order and prevents duplicate registrations on repeated checkout", async () => {
    const eventId = await createEvent(2);
    const first = await createPaidOrder(firstStudent, eventId);
    const repeated = await createPaidOrder(firstStudent, eventId);
    expect([first.status, repeated.status]).toEqual([201, 201]);
    expect(first.body.paymentAttemptId).toBe(repeated.body.paymentAttemptId);
    expect(first.body.orderId).toBe(repeated.body.orderId);
    expect(await db(() => prisma.eventPaymentAttempt.count({ where: { eventId } }))).toBe(1);

    expect((await capture(firstStudent, first, "payment_repeated_checkout")).body.status)
      .toBe(EventPaymentStatus.SUCCESSFUL);
    expect((await createPaidOrder(firstStudent, eventId)).status).toBe(409);
    expect(await registrationCount(eventId)).toBe(1);
  });
});
