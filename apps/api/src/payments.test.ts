import { createHmac } from "node:crypto";
import express from "express";
import { MemoryStore } from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  EventPaymentStatus,
  EventStatus,
  UserRole,
} from "./generated/prisma/client.js";
import {
  createPaymentRouter,
  getPaymentConfiguration,
  type PaymentAttemptRecord,
  type PaymentConfiguration,
  type PaymentGateway,
  type PaymentRepository,
  type ProviderPayment,
} from "./payments.js";

const keySecret = "test-key-secret";
const webhookSecret = "test-webhook-secret";
const configuration = getPaymentConfiguration({
  mode: "test",
  keyId: "rzp_test_fixture",
  keySecret,
  webhookSecret,
});

class FakePaymentRepository implements PaymentRepository {
  private readonly roles = new Map([
    ["student-one", UserRole.STUDENT],
    ["student-two", UserRole.STUDENT],
    ["organizer", UserRole.ORGANIZER],
  ]);
  private readonly events = new Map([
    ["paid-event", { status: EventStatus.PUBLISHED, price: 1250, capacity: 3 }],
    ["limited-event", { status: EventStatus.PUBLISHED, price: 500, capacity: 1 }],
    ["free-event", { status: EventStatus.PUBLISHED, price: null, capacity: null }],
  ]);
  private readonly attempts = new Map<string, PaymentAttemptRecord>();
  private readonly registrations = new Set<string>();
  private readonly webhookIds = new Set<string>();
  private nextAttemptId = 1;
  private nextRegistrationId = 1;

  async findUserRole(userId: string) {
    return this.roles.get(userId) ?? null;
  }

  async reserveAttempt(eventId: string, userId: string, expiresAt: Date, now: Date) {
    const event = this.events.get(eventId);
    if (!event || event.status !== EventStatus.PUBLISHED) return { status: "not_found" as const };
    if (event.price === null) return { status: "free_event" as const };
    if (this.registrations.has(`${userId}:${eventId}`)) {
      return { status: "already_registered" as const };
    }

    const existing = [...this.attempts.values()].find(
      (attempt) =>
        attempt.userId === userId &&
        attempt.eventId === eventId &&
        (attempt.status === EventPaymentStatus.PENDING ||
          attempt.status === EventPaymentStatus.CANCELLED) &&
        attempt.expiresAt > now,
    );
    if (existing) {
      if (!existing.razorpayOrderId) return { status: "order_pending" as const };
      if (existing.status === EventPaymentStatus.CANCELLED) {
        const resumed = { ...existing, status: EventPaymentStatus.PENDING };
        this.attempts.set(existing.id, resumed);
        return { status: "ready" as const, attempt: resumed };
      }
      return { status: "ready" as const, attempt: existing };
    }

    const registrationCount = [...this.registrations].filter((key) => key.endsWith(`:${eventId}`)).length;
    const reservationCount = [...this.attempts.values()].filter(
      (attempt) =>
        attempt.eventId === eventId &&
        (attempt.status === EventPaymentStatus.PENDING ||
          attempt.status === EventPaymentStatus.CANCELLED) &&
        attempt.expiresAt > now,
    ).length;
    if (event.capacity !== null && registrationCount + reservationCount >= event.capacity) {
      return { status: "capacity_reached" as const };
    }

    const attempt: PaymentAttemptRecord = {
      id: `attempt-${this.nextAttemptId++}`,
      userId,
      eventId,
      registrationId: null,
      amountPaise: event.price,
      currency: "INR",
      status: EventPaymentStatus.PENDING,
      razorpayOrderId: null,
      razorpayPaymentId: null,
      expiresAt,
    };
    this.attempts.set(attempt.id, attempt);
    return { status: "ready" as const, attempt };
  }

  async attachOrder(attemptId: string, orderId: string) {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) throw new Error("Missing test payment attempt");
    const updated = { ...attempt, razorpayOrderId: orderId };
    this.attempts.set(attemptId, updated);
    return updated;
  }

  async findOwnedAttempt(attemptId: string, userId: string) {
    const attempt = this.attempts.get(attemptId);
    return attempt?.userId === userId ? attempt : null;
  }

  async markAttemptFailed(attemptId: string, paymentId: string | null) {
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.status === EventPaymentStatus.SUCCESSFUL) return;
    this.attempts.set(attemptId, {
      ...attempt,
      status: EventPaymentStatus.FAILED,
      razorpayPaymentId: paymentId ?? attempt.razorpayPaymentId,
    });
  }

  async cancelAttempt(attemptId: string, userId: string) {
    const attempt = await this.findOwnedAttempt(attemptId, userId);
    if (!attempt) return null;
    if (attempt.status === EventPaymentStatus.PENDING) {
      const cancelled = { ...attempt, status: EventPaymentStatus.CANCELLED };
      this.attempts.set(attemptId, cancelled);
      return cancelled;
    }
    return attempt;
  }

  async applyCapturedPayment(attemptId: string, payment: ProviderPayment) {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return "mismatch" as const;
    if (
      attempt.razorpayOrderId !== payment.orderId ||
      attempt.amountPaise !== payment.amountPaise ||
      attempt.currency !== payment.currency ||
      payment.status !== "captured"
    ) {
      return "mismatch" as const;
    }
    if (attempt.status === EventPaymentStatus.SUCCESSFUL) return "successful" as const;
    const event = this.events.get(attempt.eventId);
    if (!event) return "mismatch" as const;

    const registrationsForEvent = [...this.registrations].filter((key) =>
      key.endsWith(`:${attempt.eventId}`),
    ).length;
    const otherReservations = [...this.attempts.values()].filter(
      (other) =>
        other.id !== attempt.id &&
        other.eventId === attempt.eventId &&
        (other.status === EventPaymentStatus.PENDING ||
          other.status === EventPaymentStatus.CANCELLED) &&
        other.expiresAt > new Date(),
    ).length;
    if (
      event.capacity !== null &&
      registrationsForEvent + otherReservations >= event.capacity
    ) {
      await this.markAttemptFailed(attemptId, payment.id);
      return "capacity_reached" as const;
    }
    if (this.registrations.has(`${attempt.userId}:${attempt.eventId}`)) {
      await this.markAttemptFailed(attemptId, payment.id);
      return "already_registered" as const;
    }

    const registrationId = `registration-${this.nextRegistrationId++}`;
    this.registrations.add(`${attempt.userId}:${attempt.eventId}`);
    this.attempts.set(attemptId, {
      ...attempt,
      registrationId,
      razorpayPaymentId: payment.id,
      status: EventPaymentStatus.SUCCESSFUL,
    });
    return "successful" as const;
  }

  async processWebhook(eventId: string, eventType: string, payment: ProviderPayment) {
    if (this.webhookIds.has(eventId)) return "duplicate" as const;
    this.webhookIds.add(eventId);
    const attempt = [...this.attempts.values()].find(
      (candidate) => candidate.razorpayOrderId === payment.orderId,
    );
    if (!attempt) return "processed" as const;
    if (eventType === "payment.captured") {
      await this.applyCapturedPayment(attempt.id, payment);
    } else if (
      eventType === "payment.failed" &&
      payment.amountPaise === attempt.amountPaise &&
      payment.currency === attempt.currency
    ) {
      await this.markAttemptFailed(attempt.id, payment.id);
    }
    return "processed" as const;
  }

  registrationCount() {
    return this.registrations.size;
  }
}

class FakePaymentGateway implements PaymentGateway {
  readonly orders: Array<{
    amountPaise: number
    currency: "INR"
    receipt: string
    paymentAttemptId: string
  }> = [];
  readonly payments = new Map<string, ProviderPayment>();

  async createOrder(input: {
    amountPaise: number;
    currency: "INR";
    receipt: string;
    paymentAttemptId: string;
  }) {
    this.orders.push(input);
    return { id: `order-${this.orders.length}` };
  }

  async fetchPayment(paymentId: string) {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new Error("Missing fake payment");
    return payment;
  }
}

function sign(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function createTestApp(
  repository: FakePaymentRepository,
  gateway: FakePaymentGateway,
  config: PaymentConfiguration = configuration,
) {
  const app = express();
  app.use(
    expressSession({
      secret: "test-session-secret-long-enough-for-tests",
      resave: false,
      saveUninitialized: false,
      store: new MemoryStore(),
    }),
  );
  app.use("/api/payments", createPaymentRouter(repository, gateway, config));
  app.post("/test/login/:userId", (request_, response) => {
    request_.session.userId = request_.params.userId;
    response.status(204).end();
  });
  return app;
}

import expressSession from "express-session";

describe("Razorpay event payments", () => {
  let repository: FakePaymentRepository;
  let gateway: FakePaymentGateway;
  let app: express.Express;
  let firstStudent: ReturnType<typeof request.agent>;
  let secondStudent: ReturnType<typeof request.agent>;

  beforeEach(async () => {
    repository = new FakePaymentRepository();
    gateway = new FakePaymentGateway();
    app = createTestApp(repository, gateway);
    firstStudent = request.agent(app);
    secondStudent = request.agent(app);
    await Promise.all([
      firstStudent.post("/test/login/student-one"),
      secondStudent.post("/test/login/student-two"),
    ]);
  });

  async function createOrder(agent = firstStudent, eventId = "paid-event") {
    return agent.post(`/api/payments/events/${eventId}/orders`).send({});
  }

  it("uses the database amount and rejects client-supplied price fields", async () => {
    const manipulated = await firstStudent
      .post("/api/payments/events/paid-event/orders")
      .send({ amount: 1, amountPaise: 1 });
    expect(manipulated.status).toBe(400);

    const order = await createOrder();
    expect(order.status).toBe(201);
    expect(order.body.amountPaise).toBe(1250);
    expect(gateway.orders[0]).toMatchObject({ amountPaise: 1250, currency: "INR" });
    expect(JSON.stringify(order.body)).not.toContain(keySecret);
  });

  it("requires a student, a published paid event, and available capacity", async () => {
    expect((await request(app).post("/api/payments/events/paid-event/orders").send({})).status)
      .toBe(401);
    const organizer = request.agent(app);
    await organizer.post("/test/login/organizer");
    expect((await organizer.post("/api/payments/events/paid-event/orders").send({})).status)
      .toBe(403);
    expect((await createOrder(firstStudent, "free-event")).status).toBe(409);

    const limitedOrders = await Promise.all([
      createOrder(firstStudent, "limited-event"),
      createOrder(secondStudent, "limited-event"),
    ]);
    expect(limitedOrders.map((response) => response.status).sort()).toEqual([201, 409]);
  });

  it("verifies the stored order ID and captured payment before registration", async () => {
    const order = await createOrder();
    const paymentId = "payment-captured";
    const payment: ProviderPayment = {
      id: paymentId,
      orderId: order.body.orderId,
      amountPaise: order.body.amountPaise,
      currency: "INR",
      status: "captured",
    };
    gateway.payments.set(paymentId, payment);

    const invalid = await firstStudent.post("/api/payments/checkout/verify").send({
      paymentAttemptId: order.body.paymentAttemptId,
      paymentId,
      signature: "0".repeat(64),
    });
    expect(invalid.status).toBe(400);
    expect(repository.registrationCount()).toBe(0);

    const wrongOrderPaymentId = "payment-wrong-order";
    gateway.payments.set(wrongOrderPaymentId, { ...payment, id: wrongOrderPaymentId, orderId: "order-other" });
    const signatureForWrongOrder = sign(
      keySecret,
      `${order.body.orderId}|${wrongOrderPaymentId}`,
    );
    const wrongOrder = await firstStudent.post("/api/payments/checkout/verify").send({
      paymentAttemptId: order.body.paymentAttemptId,
      paymentId: wrongOrderPaymentId,
      signature: signatureForWrongOrder,
    });
    expect(wrongOrder.status).toBe(400);

    const success = await firstStudent.post("/api/payments/checkout/verify").send({
      paymentAttemptId: order.body.paymentAttemptId,
      paymentId,
      signature: sign(keySecret, `${order.body.orderId}|${paymentId}`),
    });
    expect(success.status).toBe(200);
    expect(success.body.status).toBe(EventPaymentStatus.SUCCESSFUL);
    expect(repository.registrationCount()).toBe(1);
    expect(
      (
        await firstStudent.post("/api/payments/checkout/verify").send({
          paymentAttemptId: order.body.paymentAttemptId,
          paymentId,
          signature: sign(keySecret, `${order.body.orderId}|${paymentId}`),
        })
      ).body.status,
    ).toBe(EventPaymentStatus.SUCCESSFUL);
    expect(repository.registrationCount()).toBe(1);
  });

  it("does not register an authorized but uncaptured payment", async () => {
    const order = await createOrder();
    const paymentId = "payment-authorized";
    gateway.payments.set(paymentId, {
      id: paymentId,
      orderId: order.body.orderId,
      amountPaise: order.body.amountPaise,
      currency: "INR",
      status: "authorized",
    });
    const result = await firstStudent.post("/api/payments/checkout/verify").send({
      paymentAttemptId: order.body.paymentAttemptId,
      paymentId,
      signature: sign(keySecret, `${order.body.orderId}|${paymentId}`),
    });
    expect(result.body.status).toBe(EventPaymentStatus.PENDING);
    expect(repository.registrationCount()).toBe(0);
  });

  it("rejects invalid raw-body webhook signatures and makes duplicate deliveries idempotent", async () => {
    const order = await createOrder();
    const event = {
      id: "evt-captured-1",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "payment-webhook",
            order_id: order.body.orderId,
            amount: order.body.amountPaise,
            currency: "INR",
            status: "captured",
          },
        },
      },
    };
    const rawBody = JSON.stringify(event);
    const invalid = await request(app)
      .post("/api/payments/webhook")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", "0".repeat(64))
      .send(rawBody);
    expect(invalid.status).toBe(401);

    const signature = sign(webhookSecret, rawBody);
    const deliver = () =>
      request(app)
        .post("/api/payments/webhook")
        .set("Content-Type", "application/json")
        .set("x-razorpay-signature", signature)
        .send(rawBody);
    expect((await deliver()).status).toBe(200);
    expect((await deliver()).status).toBe(200);
    expect(repository.registrationCount()).toBe(1);
  });

  it("records provider-confirmed failures and creates a fresh order for a retry", async () => {
    const order = await createOrder();
    const event = {
      id: "evt-failed-1",
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: "payment-failed",
            order_id: order.body.orderId,
            amount: order.body.amountPaise,
            currency: "INR",
            status: "failed",
          },
        },
      },
    };
    const rawBody = JSON.stringify(event);
    const webhook = await request(app)
      .post("/api/payments/webhook")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sign(webhookSecret, rawBody))
      .send(rawBody);
    expect(webhook.status).toBe(200);
    expect(
      (await firstStudent.get(`/api/payments/${order.body.paymentAttemptId}`)).body.status,
    ).toBe(EventPaymentStatus.FAILED);

    const retry = await createOrder();
    expect(retry.status).toBe(201);
    expect(retry.body.paymentAttemptId).not.toBe(order.body.paymentAttemptId);
    expect(retry.body.orderId).not.toBe(order.body.orderId);
  });

  it("keeps payment attempts private and permits a retry after cancellation", async () => {
    const order = await createOrder();
    const otherStudentResponse = await secondStudent.get(
      `/api/payments/${order.body.paymentAttemptId}`,
    );
    expect(otherStudentResponse.status).toBe(404);

    const cancelled = await firstStudent
      .post(`/api/payments/${order.body.paymentAttemptId}/cancel`)
      .send({});
    expect(cancelled.body.status).toBe(EventPaymentStatus.CANCELLED);
    const retry = await createOrder();
    expect(retry.status).toBe(201);
    expect(retry.body.paymentAttemptId).toBe(order.body.paymentAttemptId);
    expect(retry.body.orderId).toBe(order.body.orderId);
  });

  it("disables all payment routes safely when configuration is absent or live", async () => {
    const disabledConfig = getPaymentConfiguration({
      mode: "test",
      keyId: null,
      keySecret: null,
      webhookSecret: null,
    });
    const disabledApp = createTestApp(repository, gateway, disabledConfig);
    const response = await request(disabledApp).get("/api/payments/config");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ enabled: false, keyId: null, mode: "test" });

    const liveConfig = getPaymentConfiguration({
      mode: "live",
      keyId: "rzp_live_disabled",
      keySecret: "private",
      webhookSecret: "private",
    });
    expect(liveConfig.enabled).toBe(false);
    expect(liveConfig.keySecret).toBeNull();
  });
});
