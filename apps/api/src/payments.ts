import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import express from "express";
import Razorpay from "razorpay";
import { z } from "zod";
import type { RegistrationNotifier } from "./events.js";
import {
  EventPaymentStatus,
  EventStatus,
  UserRole,
  type Prisma,
  type PrismaClient,
} from "./generated/prisma/client.js";

const paymentAttemptSelect = {
  id: true,
  eventId: true,
  userId: true,
  registrationId: true,
  amountPaise: true,
  currency: true,
  status: true,
  razorpayOrderId: true,
  razorpayPaymentId: true,
  expiresAt: true,
} satisfies Prisma.EventPaymentAttemptSelect;

export type PaymentAttemptRecord = Prisma.EventPaymentAttemptGetPayload<{
  select: typeof paymentAttemptSelect;
}>;

export interface ProviderPayment {
  id: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  status: string;
}

export interface PaymentGateway {
  createOrder(input: {
    amountPaise: number;
    currency: "INR";
    receipt: string;
    paymentAttemptId: string;
  }): Promise<{ id: string }>;
  fetchPayment(paymentId: string): Promise<ProviderPayment>;
}

export interface RazorpaySettings {
  mode: "test" | "live";
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
}

export interface PaymentConfiguration {
  enabled: boolean;
  keyId: string | null;
  keySecret: string | null;
  mode: "test" | "live";
  webhookSecret: string | null;
  message: string | null;
}

export function getPaymentConfiguration(settings: RazorpaySettings): PaymentConfiguration {
  if (settings.mode !== "test") {
    return {
      enabled: false,
      keyId: null,
      keySecret: null,
      mode: settings.mode,
      webhookSecret: null,
      message: "Live payments are disabled. Configure Razorpay test-mode credentials.",
    };
  }
  if (!settings.keyId || !settings.keyId.startsWith("rzp_test_")) {
    return {
      enabled: false,
      keyId: null,
      keySecret: null,
      mode: settings.mode,
      webhookSecret: null,
      message: "Razorpay test-mode credentials are not configured.",
    };
  }
  if (!settings.keySecret) {
    return {
      enabled: false,
      keyId: null,
      keySecret: null,
      mode: settings.mode,
      webhookSecret: null,
      message: "Razorpay test-mode credentials are incomplete.",
    };
  }

  return {
    enabled: true,
    keyId: settings.keyId,
    keySecret: settings.keySecret,
    mode: settings.mode,
    webhookSecret: settings.webhookSecret,
    message: null,
  };
}

export function createRazorpayGateway(
  configuration: PaymentConfiguration,
  keySecret: string | null,
): PaymentGateway | null {
  if (!configuration.enabled || !configuration.keyId || !keySecret) return null;

  const client = new Razorpay({
    key_id: configuration.keyId,
    key_secret: keySecret,
  });

  return {
    createOrder: async (input) => {
      const order = await client.orders.create({
        amount: input.amountPaise,
        currency: input.currency,
        receipt: input.receipt,
        notes: { paymentAttemptId: input.paymentAttemptId },
      });
      return { id: order.id };
    },
    fetchPayment: async (paymentId) => {
      const payment = await client.payments.fetch(paymentId);
      const amountPaise = Number(payment.amount);
      if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
        throw new Error("Razorpay returned an invalid payment amount");
      }
      return {
        id: payment.id,
        orderId: payment.order_id ?? "",
        amountPaise,
        currency: payment.currency,
        status: payment.status,
      };
    },
  };
}

type ReservationResult =
  | { status: "ready"; attempt: PaymentAttemptRecord }
  | {
      status:
        | "not_found"
        | "event_cancelled"
        | "free_event"
        | "already_registered"
        | "capacity_reached"
        | "order_pending";
    };

export interface PaymentRepository {
  findUserRole(userId: string): Promise<UserRole | null>;
  reserveAttempt(
    eventId: string,
    userId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<ReservationResult>;
  attachOrder(attemptId: string, orderId: string): Promise<PaymentAttemptRecord>;
  findOwnedAttempt(attemptId: string, userId: string): Promise<PaymentAttemptRecord | null>;
  markAttemptFailed(attemptId: string, paymentId: string | null): Promise<void>;
  cancelAttempt(attemptId: string, userId: string): Promise<PaymentAttemptRecord | null>;
  applyCapturedPayment(
    attemptId: string,
    payment: ProviderPayment,
  ): Promise<
    "successful" | "pending" | "already_registered" | "capacity_reached" | "expired" | "mismatch" | "refund_required"
  >;
  processWebhook(
    eventId: string,
    eventType: string,
    payment: ProviderPayment,
  ): Promise<"processed" | "duplicate">;
  findSuccessfulAttemptByOrder(orderId: string): Promise<PaymentAttemptRecord | null>;
}

export function createPrismaPaymentRepository(prisma: PrismaClient): PaymentRepository {
  async function applyCapturedPaymentInTransaction(
    transaction: Prisma.TransactionClient,
    attemptId: string,
    payment: ProviderPayment,
  ): Promise<
    "successful" | "pending" | "already_registered" | "capacity_reached" | "expired" | "mismatch" | "refund_required"
  > {
    const initialAttempt = await transaction.eventPaymentAttempt.findUnique({
      where: { id: attemptId },
      select: paymentAttemptSelect,
    });
    if (!initialAttempt) return "mismatch";

    await transaction.$queryRaw`
      SELECT "id" FROM "Event" WHERE "id" = ${initialAttempt.eventId} FOR UPDATE
    `;

    const attempt = await transaction.eventPaymentAttempt.findUnique({
      where: { id: attemptId },
      select: paymentAttemptSelect,
    });
    if (
      !attempt ||
      attempt.razorpayOrderId !== payment.orderId ||
      attempt.amountPaise !== payment.amountPaise ||
      attempt.currency !== payment.currency ||
      payment.status !== "captured"
    ) {
      return "mismatch";
    }
    if (attempt.status === EventPaymentStatus.SUCCESSFUL) return "successful";
    if (attempt.status === EventPaymentStatus.REFUND_REQUIRED) return "refund_required";
    const event = await transaction.event.findUnique({
      where: { id: attempt.eventId },
      select: { status: true, capacity: true },
    });
    if (event?.status === EventStatus.CANCELLED) {
      await transaction.eventPaymentAttempt.update({
        where: { id: attemptId },
        data: {
          status: EventPaymentStatus.REFUND_REQUIRED,
          razorpayPaymentId: payment.id,
        },
      });
      return "refund_required";
    }
    if (!event || event.status !== EventStatus.PUBLISHED) return "mismatch";

    if (attempt.expiresAt <= new Date()) {
      await transaction.eventPaymentAttempt.update({
        where: { id: attemptId },
        data: {
          status: EventPaymentStatus.FAILED,
          razorpayPaymentId: payment.id,
        },
      });
      return "expired";
    }

    const existingRegistration = await transaction.registration.findUnique({
      where: { userId_eventId: { userId: attempt.userId, eventId: attempt.eventId } },
      select: { id: true },
    });
    if (existingRegistration) {
      await transaction.eventPaymentAttempt.update({
        where: { id: attemptId },
        data: {
          status: EventPaymentStatus.FAILED,
          razorpayPaymentId: payment.id,
        },
      });
      return "already_registered";
    }

    const registrationCount = await transaction.registration.count({
      where: { eventId: attempt.eventId },
    });
    const activeReservationCount = await transaction.eventPaymentAttempt.count({
      where: {
        eventId: attempt.eventId,
        id: { not: attemptId },
        status: { in: [EventPaymentStatus.PENDING, EventPaymentStatus.CANCELLED] },
        expiresAt: { gt: new Date() },
      },
    });
    if (
      event.capacity !== null &&
      registrationCount + activeReservationCount >= event.capacity
    ) {
      await transaction.eventPaymentAttempt.update({
        where: { id: attemptId },
        data: {
          status: EventPaymentStatus.FAILED,
          razorpayPaymentId: payment.id,
        },
      });
      return "capacity_reached";
    }

    const registration = await transaction.registration.create({
      data: { userId: attempt.userId, eventId: attempt.eventId },
      select: { id: true },
    });
    await transaction.eventPaymentAttempt.update({
      where: { id: attemptId },
      data: {
        registrationId: registration.id,
        razorpayPaymentId: payment.id,
        status: EventPaymentStatus.SUCCESSFUL,
      },
    });
    return "successful";
  }

  return {
    findUserRole: async (userId) =>
      (await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role ??
      null,
    reserveAttempt: (eventId, userId, expiresAt, now) =>
      prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE
        `;

        const event = await transaction.event.findUnique({
          where: { id: eventId },
          select: { status: true, capacity: true, ticketPricePaise: true },
        });
        if (!event) return { status: "not_found" };
        if (event.status === EventStatus.CANCELLED) return { status: "event_cancelled" };
        if (event.status !== EventStatus.PUBLISHED) return { status: "not_found" };
        if (event.ticketPricePaise === null) return { status: "free_event" };

        const existingRegistration = await transaction.registration.findUnique({
          where: { userId_eventId: { userId, eventId } },
          select: { id: true },
        });
        if (existingRegistration) return { status: "already_registered" };

        const existingAttempt = await transaction.eventPaymentAttempt.findFirst({
          where: {
            eventId,
            userId,
            status: { in: [EventPaymentStatus.PENDING, EventPaymentStatus.CANCELLED] },
            expiresAt: { gt: now },
          },
          orderBy: { createdAt: "desc" },
          select: paymentAttemptSelect,
        });
        if (existingAttempt) {
          if (!existingAttempt.razorpayOrderId) return { status: "order_pending" };
          if (existingAttempt.status === EventPaymentStatus.CANCELLED) {
            const attempt = await transaction.eventPaymentAttempt.update({
              where: { id: existingAttempt.id },
              data: { status: EventPaymentStatus.PENDING },
              select: paymentAttemptSelect,
            });
            return { status: "ready", attempt };
          }
          return { status: "ready", attempt: existingAttempt };
        }

        const registrationCount = await transaction.registration.count({ where: { eventId } });
        const activeReservationCount = await transaction.eventPaymentAttempt.count({
          where: {
            eventId,
            status: { in: [EventPaymentStatus.PENDING, EventPaymentStatus.CANCELLED] },
            expiresAt: { gt: now },
          },
        });
        if (
          event.capacity !== null &&
          registrationCount + activeReservationCount >= event.capacity
        ) {
          return { status: "capacity_reached" };
        }

        const attempt = await transaction.eventPaymentAttempt.create({
          data: {
            eventId,
            userId,
            amountPaise: event.ticketPricePaise,
            expiresAt,
          },
          select: paymentAttemptSelect,
        });
        return { status: "ready", attempt };
      }),
    attachOrder: (attemptId, orderId) =>
      prisma.eventPaymentAttempt.update({
        where: { id: attemptId },
        data: { razorpayOrderId: orderId },
        select: paymentAttemptSelect,
      }),
    findOwnedAttempt: (attemptId, userId) =>
      prisma.eventPaymentAttempt.findFirst({
        where: { id: attemptId, userId },
        select: paymentAttemptSelect,
      }),
    markAttemptFailed: async (attemptId, paymentId) => {
      await prisma.eventPaymentAttempt.updateMany({
        where: {
          id: attemptId,
          status: { notIn: [EventPaymentStatus.SUCCESSFUL, EventPaymentStatus.REFUND_REQUIRED] },
        },
        data: {
          status: EventPaymentStatus.FAILED,
          ...(paymentId ? { razorpayPaymentId: paymentId } : {}),
        },
      });
    },
    cancelAttempt: async (attemptId, userId) => {
      await prisma.eventPaymentAttempt.updateMany({
        where: {
          id: attemptId,
          userId,
          status: EventPaymentStatus.PENDING,
        },
        data: { status: EventPaymentStatus.CANCELLED },
      });
      return prisma.eventPaymentAttempt.findFirst({
        where: { id: attemptId, userId },
        select: paymentAttemptSelect,
      });
    },
    applyCapturedPayment: (attemptId, payment) =>
      prisma.$transaction((transaction) =>
        applyCapturedPaymentInTransaction(transaction, attemptId, payment),
      ),
    processWebhook: async (eventId, eventType, payment) => {
      return prisma.$transaction(async (transaction) => {
          const inserted = await transaction.razorpayWebhookEvent.createMany({
            data: { id: eventId, type: eventType },
            skipDuplicates: true,
          });
          if (inserted.count === 0) return "duplicate";
          const attempt = await transaction.eventPaymentAttempt.findUnique({
            where: { razorpayOrderId: payment.orderId },
            select: paymentAttemptSelect,
          });
          if (!attempt) return "processed";

          if (eventType === "payment.captured") {
            await applyCapturedPaymentInTransaction(transaction, attempt.id, payment);
          } else if (
            eventType === "payment.failed" &&
            payment.amountPaise === attempt.amountPaise &&
            payment.currency === attempt.currency &&
            attempt.status !== EventPaymentStatus.SUCCESSFUL &&
            attempt.status !== EventPaymentStatus.REFUND_REQUIRED
          ) {
            await transaction.eventPaymentAttempt.update({
              where: { id: attempt.id },
              data: {
                status: EventPaymentStatus.FAILED,
                razorpayPaymentId: payment.id,
              },
            });
          }
          return "processed";
        });
    },
    findSuccessfulAttemptByOrder: (orderId) => prisma.eventPaymentAttempt.findFirst({
      where: { razorpayOrderId: orderId, status: EventPaymentStatus.SUCCESSFUL, registrationId: { not: null } },
      select: paymentAttemptSelect,
    }),
  };
}

const emptyRequestSchema = z.object({}).strict();
const eventIdSchema = z.string().min(1).max(128);
const paymentAttemptIdSchema = z.string().min(1).max(128);
const checkoutVerificationSchema = z
  .object({
    paymentAttemptId: paymentAttemptIdSchema,
    paymentId: z.string().min(1).max(128),
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

const webhookSchema = z.object({
  id: z.string().min(1).max(200),
  event: z.enum(["payment.captured", "payment.failed"]),
  payload: z.object({
    payment: z.object({
      entity: z.object({
        id: z.string().min(1),
        order_id: z.string().min(1),
        amount: z.number().int().positive(),
        currency: z.string().min(1),
        status: z.string().min(1),
      }),
    }),
  }),
});

function isValidSignature(secret: string, signedContent: string | Buffer, signature: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(signedContent).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sendValidationError(response: Response, error: z.ZodError) {
  return response.status(400).json({
    error: "Invalid payment request",
    details: z.treeifyError(error),
  });
}

function logPaymentFailure(action: string, error: unknown) {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`Payment ${action} failed`, { errorType });
}

async function requireStudent(
  request: Request,
  response: Response,
  repository: PaymentRepository,
): Promise<string | null> {
  const userId = request.session.userId;
  if (!userId) {
    response.status(401).json({ error: "Authentication required" });
    return null;
  }

  try {
    const role = await repository.findUserRole(userId);
    if (role === null) {
      response.status(401).json({ error: "Authentication required" });
      return null;
    }
    if (role !== UserRole.STUDENT) {
      response.status(403).json({ error: "Student role required" });
      return null;
    }
    return userId;
  } catch (error) {
    logPaymentFailure("authorization", error);
    response.status(500).json({ error: "Payment service unavailable" });
    return null;
  }
}

function toPaymentStatus(attempt: PaymentAttemptRecord) {
  return {
    paymentAttemptId: attempt.id,
    status: attempt.status,
  };
}

export function createPaymentRouter(
  repository: PaymentRepository,
  gateway: PaymentGateway | null,
  configuration: PaymentConfiguration,
  notifyRegistration?: RegistrationNotifier,
) {
  const router = Router();
  const deliverConfirmation = async (input: { userId: string; eventId: string; registrationId: string }) => {
    if (!notifyRegistration) return;
    try {
      await notifyRegistration(input);
    } catch (error) {
      console.error("Registration notification failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    }
  };

  router.post(
    "/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (request, response) => {
      if (!configuration.enabled) {
        return response.status(503).json({ error: "Razorpay is not configured for test payments" });
      }
      if (!configuration.webhookSecret) {
        return response.status(503).json({ error: "Razorpay webhook verification is not configured" });
      }
      if (!Buffer.isBuffer(request.body)) {
        return response.status(400).json({ error: "Invalid Razorpay webhook body" });
      }
      const signature = request.header("x-razorpay-signature");
      if (
        !signature ||
        !isValidSignature(configuration.webhookSecret, request.body, signature)
      ) {
        return response.status(401).json({ error: "Invalid Razorpay webhook signature" });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(request.body.toString("utf8"));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return response.status(400).json({ error: "Invalid Razorpay webhook JSON" });
      }
      const parsed = webhookSchema.safeParse(payload);
      if (!parsed.success) return response.status(400).json({ error: "Invalid Razorpay webhook event" });

      const { id, event, payload: webhookPayload } = parsed.data;
      const entity = webhookPayload.payment.entity;
      const payment: ProviderPayment = {
        id: entity.id,
        orderId: entity.order_id,
        amountPaise: entity.amount,
        currency: entity.currency,
        status: entity.status,
      };

      try {
        const result = await repository.processWebhook(id, event, payment);
        if (result === "processed" && event === "payment.captured" && notifyRegistration) {
          try {
            const attempt = await repository.findSuccessfulAttemptByOrder(payment.orderId);
            if (attempt?.registrationId) await deliverConfirmation({ userId: attempt.userId, eventId: attempt.eventId, registrationId: attempt.registrationId });
          } catch (error) {
            console.error("Registration notification lookup failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
          }
        }
        return response.status(200).json({ received: true });
      } catch (error) {
        logPaymentFailure("webhook processing", error);
        return response.status(500).json({ error: "Payment service unavailable" });
      }
    },
  );

  router.use(express.json());

  router.get("/config", (_request, response) => {
    response.json({
      enabled: configuration.enabled,
      keyId: configuration.enabled ? configuration.keyId : null,
      mode: configuration.mode,
      message: configuration.message,
    });
  });

  router.post("/events/:eventId/orders", async (request, response) => {
    const userId = await requireStudent(request, response, repository);
    if (!userId) return;
    const eventId = eventIdSchema.safeParse(request.params.eventId);
    if (!eventId.success) return sendValidationError(response, eventId.error);
    const body = emptyRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return sendValidationError(response, body.error);
    if (!configuration.enabled || !gateway || !configuration.keyId) {
      return response.status(503).json({
        error: configuration.message ?? "Razorpay test payments are not configured.",
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + (6 * 60 * 60 + 60) * 1000);
    try {
      const reservation = await repository.reserveAttempt(eventId.data, userId, expiresAt, now);
      if (reservation.status === "not_found") {
        return response.status(404).json({ error: "Event not found" });
      }
      if (reservation.status === "event_cancelled") {
        return response.status(409).json({ error: "Event has been cancelled" });
      }
      if (reservation.status === "free_event") {
        return response.status(409).json({ error: "This event does not require payment" });
      }
      if (reservation.status === "already_registered") {
        return response.status(409).json({ error: "Already registered for this event" });
      }
      if (reservation.status === "capacity_reached") {
        return response.status(409).json({ error: "Event is full" });
      }
      if (reservation.status === "order_pending") {
        return response.status(409).json({ error: "A payment order is already being created" });
      }
      if (reservation.status !== "ready") {
        return response.status(409).json({ error: "Unable to reserve event capacity" });
      }

      const { attempt } = reservation;
      let orderId = attempt.razorpayOrderId;
      if (!orderId) {
        try {
          const order = await gateway.createOrder({
            amountPaise: attempt.amountPaise,
            currency: "INR",
            receipt: `cc_${attempt.id}`,
            paymentAttemptId: attempt.id,
          });
          orderId = order.id;
          await repository.attachOrder(attempt.id, orderId);
        } catch (error) {
          await repository.markAttemptFailed(attempt.id, null);
          logPaymentFailure("Razorpay order creation", error);
          return response.status(502).json({ error: "Could not create a Razorpay order" });
        }
      }

      return response.status(201).json({
        paymentAttemptId: attempt.id,
        orderId,
        amountPaise: attempt.amountPaise,
        currency: attempt.currency,
        keyId: configuration.keyId,
      });
    } catch (error) {
      logPaymentFailure("order request", error);
      return response.status(500).json({ error: "Payment service unavailable" });
    }
  });

  router.post("/checkout/verify", async (request, response) => {
    const userId = await requireStudent(request, response, repository);
    if (!userId) return;
    const parsed = checkoutVerificationSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, parsed.error);
    if (!configuration.enabled || !gateway) {
      return response.status(503).json({
        error: configuration.message ?? "Razorpay test payments are not configured.",
      });
    }

    try {
      const attempt = await repository.findOwnedAttempt(parsed.data.paymentAttemptId, userId);
      if (!attempt) return response.status(404).json({ error: "Payment attempt not found" });
      if (attempt.status === EventPaymentStatus.SUCCESSFUL) {
        if (attempt.registrationId) {
          await deliverConfirmation({ userId, eventId: attempt.eventId, registrationId: attempt.registrationId });
        }
        return response.json(toPaymentStatus(attempt));
      }
      if (
        !attempt.razorpayOrderId ||
        !isValidSignature(
          configuration.keySecret ?? "",
          `${attempt.razorpayOrderId}|${parsed.data.paymentId}`,
          parsed.data.signature,
        )
      ) {
        return response.status(400).json({ error: "Payment signature is invalid" });
      }

      const payment = await gateway.fetchPayment(parsed.data.paymentId);
      if (
        payment.id !== parsed.data.paymentId ||
        payment.orderId !== attempt.razorpayOrderId ||
        payment.amountPaise !== attempt.amountPaise ||
        payment.currency !== attempt.currency
      ) {
        return response.status(400).json({ error: "Payment details do not match this order" });
      }

      if (payment.status === "failed") {
        await repository.markAttemptFailed(attempt.id, payment.id);
        return response.json({
          paymentAttemptId: attempt.id,
          status: EventPaymentStatus.FAILED,
        });
      }
      if (payment.status !== "captured") {
        return response.json({
          paymentAttemptId: attempt.id,
          status: EventPaymentStatus.PENDING,
        });
      }

      const result = await repository.applyCapturedPayment(attempt.id, payment);
      if (result === "successful") {
        if (notifyRegistration) {
          try {
          const confirmedAttempt = await repository.findOwnedAttempt(attempt.id, userId);
          if (confirmedAttempt?.registrationId) {
              await deliverConfirmation({ userId, eventId: confirmedAttempt.eventId, registrationId: confirmedAttempt.registrationId });
          }
          } catch (error) {
            console.error("Registration notification lookup failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
          }
        }
        return response.json({
          paymentAttemptId: attempt.id,
          status: EventPaymentStatus.SUCCESSFUL,
        });
      }
      if (result === "capacity_reached" || result === "already_registered") {
        return response.status(409).json({
          error:
            result === "capacity_reached"
              ? "Event capacity was reached before payment confirmation"
              : "A registration already exists for this event",
        });
      }
      if (result === "expired") {
        return response.status(409).json({ error: "This payment order has expired" });
      }
      if (result === "refund_required") {
        return response.json({
          paymentAttemptId: attempt.id,
          status: EventPaymentStatus.REFUND_REQUIRED,
        });
      }
      if (result === "mismatch") {
        return response.status(400).json({ error: "Payment details do not match this order" });
      }
      return response.json({
        paymentAttemptId: attempt.id,
        status: EventPaymentStatus.PENDING,
      });
    } catch (error) {
      logPaymentFailure("Razorpay verification", error);
      return response.status(502).json({ error: "Payment verification is temporarily unavailable" });
    }
  });

  router.get("/:attemptId", async (request, response) => {
    const userId = await requireStudent(request, response, repository);
    if (!userId) return;
    const attemptId = paymentAttemptIdSchema.safeParse(request.params.attemptId);
    if (!attemptId.success) return sendValidationError(response, attemptId.error);
    try {
      const attempt = await repository.findOwnedAttempt(attemptId.data, userId);
      if (!attempt) return response.status(404).json({ error: "Payment attempt not found" });
      return response.json(toPaymentStatus(attempt));
    } catch (error) {
      logPaymentFailure("status lookup", error);
      return response.status(500).json({ error: "Payment service unavailable" });
    }
  });

  router.post("/:attemptId/cancel", async (request, response) => {
    const userId = await requireStudent(request, response, repository);
    if (!userId) return;
    const attemptId = paymentAttemptIdSchema.safeParse(request.params.attemptId);
    if (!attemptId.success) return sendValidationError(response, attemptId.error);
    const body = emptyRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return sendValidationError(response, body.error);
    try {
      const attempt = await repository.cancelAttempt(attemptId.data, userId);
      if (!attempt) return response.status(404).json({ error: "Payment attempt not found" });
      return response.json(toPaymentStatus(attempt));
    } catch (error) {
      logPaymentFailure("cancellation", error);
      return response.status(500).json({ error: "Payment service unavailable" });
    }
  });

  return router;
}
