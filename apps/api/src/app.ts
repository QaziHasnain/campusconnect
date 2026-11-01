import connectPgSimple from "connect-pg-simple";
import cors from "cors";
import { randomUUID } from "node:crypto";
import express from "express";
import session, { type Store } from "express-session";
import helmet from "helmet";
import { createAuthRouter, type AuthRepository } from "./auth.js";
import {
  createEventRouter,
  createMeRouter,
  createPrismaEventRepository,
  type EventRepository,
} from "./events.js";
import { env } from "./env.js";
import {
  createPrismaWhatsAppPreferencesRepository,
  createWhatsAppPreferencesRouter,
  type WhatsAppPreferencesRepository,
} from "./whatsappPreferences.js";
import {
  createNotificationRouter,
  createPrismaNotificationRepository,
  type NotificationRepository,
} from "./notifications.js";
import { pool } from "./db.js";
import { prisma } from "./prisma.js";
import {
  createPaymentRouter,
  createPrismaPaymentRepository,
  createRazorpayGateway,
  getPaymentConfiguration,
  type PaymentConfiguration,
  type PaymentGateway,
  type PaymentRepository,
} from "./payments.js";

const PgSessionStore = connectPgSimple(session);

const publicUserFields = {
  id: true,
  name: true,
  email: true,
  role: true,
  emailVerified: true,
  emailVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const authRepository: AuthRepository = {
  findByEmail: (email) =>
    prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        passwordHash: true,
        emailVerified: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  findById: (id) =>
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  create: (data) => prisma.user.create({
    data: {
      ...data,
      emailVerified: data.emailVerified ?? false,
    },
    select: publicUserFields,
  }),
  storePasswordResetToken: async (data) => {
    await prisma.$transaction(async (transaction) => {
      await transaction.passwordResetToken.deleteMany({ where: { userId: data.userId } });
      await transaction.$executeRaw`
        INSERT INTO "PasswordResetToken" ("id", "userId", "tokenHash", "expiresAt", "createdAt")
        VALUES (
          ${randomUUID()},
          ${data.userId},
          ${data.tokenHash},
          clock_timestamp() + (${data.expiresInMs} * INTERVAL '1 millisecond'),
          clock_timestamp()
        )
      `;
    });
  },
  resetPassword: (tokenHash, passwordHash) =>
    prisma.$transaction(async (transaction) => {
      const [resetToken] = await transaction.$queryRaw<{ userId: string }[]>`
        DELETE FROM "PasswordResetToken"
        WHERE "tokenHash" = ${tokenHash}
          AND "expiresAt" > clock_timestamp()
        RETURNING "userId"
      `;
      if (!resetToken) return false;

      await transaction.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });
      await transaction.passwordResetToken.deleteMany({
        where: { userId: resetToken.userId },
      });
      await transaction.$executeRaw`
        DELETE FROM "session" WHERE sess ->> 'userId' = ${resetToken.userId}
      `;

      return true;
    }),
  storeVerificationToken: async (data) => {
    await prisma.$transaction(async (transaction) => {
      await transaction.emailVerificationToken.deleteMany({ where: { userId: data.userId } });
      await transaction.emailVerificationToken.create({
        data: {
          id: randomUUID(),
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: new Date(Date.now() + data.expiresInMs),
        },
      });
    });
  },
  consumeVerificationToken: (tokenHash) =>
    prisma.$transaction(async (transaction) => {
      const [token] = await transaction.$queryRaw<{ userId: string }[]>`
        DELETE FROM "EmailVerificationToken"
        WHERE "tokenHash" = ${tokenHash}
          AND "expiresAt" > clock_timestamp()
        RETURNING "userId"
      `;
      if (!token) return null;

      await transaction.user.update({
        where: { id: token.userId },
        data: {
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      });
      await transaction.emailVerificationToken.deleteMany({
        where: { userId: token.userId },
      });

      return { userId: token.userId };
    }),
};

export function createApp(options: {
  authRepository?: AuthRepository;
  authRouterOptions?: Parameters<typeof createAuthRouter>[1];
  eventRepository?: EventRepository;
  whatsappPreferencesRepository?: WhatsAppPreferencesRepository;
  notificationRepository?: NotificationRepository;
  paymentRepository?: PaymentRepository;
  paymentGateway?: PaymentGateway | null;
  paymentConfiguration?: PaymentConfiguration;
  sessionStore?: Store;
} = {}) {
  const app = express();
  const sessionStore =
    options.sessionStore ??
    new PgSessionStore({
      pool,
      createTableIfMissing: true,
    });
  const eventRepository =
    options.eventRepository ?? createPrismaEventRepository(prisma);
  const paymentConfiguration =
    options.paymentConfiguration ?? getPaymentConfiguration(env.razorpay);
  const paymentRepository =
    options.paymentRepository ?? createPrismaPaymentRepository(prisma);
  const paymentGateway =
    options.paymentGateway ??
    createRazorpayGateway(paymentConfiguration, paymentConfiguration.keySecret);

  app.use(helmet());
  app.use(
    cors({
      origin: env.frontendOrigin,
      credentials: true,
    }),
  );
  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use(
    "/api",
    session({
      name: "campusconnect.sid",
      secret: env.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: env.nodeEnv === "production" ? "none" : "lax",
        secure: env.nodeEnv === "production",
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.use(
    "/api/payments",
    createPaymentRouter(paymentRepository, paymentGateway, paymentConfiguration),
  );
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter(options.authRepository ?? authRepository, options.authRouterOptions),
  );
  app.use(
    "/api/events",
    createEventRouter(eventRepository),
  );
  app.use("/api/me", createMeRouter(eventRepository));
  app.use(
    "/api/me/notifications",
    createNotificationRouter(
      options.notificationRepository ?? createPrismaNotificationRepository(prisma),
      env.push,
    ),
  );
  app.use(
    "/api/me/whatsapp",
    createWhatsAppPreferencesRouter(
      options.whatsappPreferencesRepository ??
        createPrismaWhatsAppPreferencesRepository(prisma),
    ),
  );
  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (response.headersSent) {
      return next(error);
    }

    if (hasErrorType(error, "entity.parse.failed")) {
      return response.status(400).json({ error: "Invalid JSON body" });
    }

    if (hasErrorType(error, "entity.too.large")) {
      return response.status(413).json({ error: "Request body is too large" });
    }

    if (_request.path.startsWith("/api/me/whatsapp")) {
      console.error("WhatsApp preference request failed");
    } else if (_request.path.startsWith("/api/me/notifications")) {
      console.error("Notification request failed");
    } else {
      console.error("API request failed", error);
    }
    return response.status(500).json({ error: "Internal server error" });
  });

  return app;
}

function hasErrorType(error: unknown, expectedType: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === expectedType
  );
}

export const app = createApp();
