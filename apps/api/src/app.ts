import connectPgSimple from "connect-pg-simple";
import cors from "cors";
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
import { pool } from "./db.js";
import { prisma } from "./prisma.js";

const PgSessionStore = connectPgSimple(session);

const publicUserFields = {
  id: true,
  name: true,
  email: true,
  role: true,
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
        createdAt: true,
        updatedAt: true,
      },
    }),
  create: (data) => prisma.user.create({ data, select: publicUserFields }),
  storePasswordResetToken: async (data) => {
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId: data.userId } }),
      prisma.passwordResetToken.create({ data }),
    ]);
  },
  resetPassword: (tokenHash, passwordHash, now) =>
    prisma.$transaction(async (transaction) => {
      const resetToken = await transaction.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, expiresAt: true },
      });
      if (!resetToken) return false;

      const consumed = await transaction.passwordResetToken.deleteMany({
        where: { id: resetToken.id, expiresAt: { gt: now } },
      });
      if (consumed.count !== 1) return false;

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
};

export function createApp(options: {
  authRepository?: AuthRepository;
  authRouterOptions?: Parameters<typeof createAuthRouter>[1];
  eventRepository?: EventRepository;
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

  app.use(helmet());
  app.use(
    cors({
      origin: env.frontendOrigin,
      credentials: true,
    }),
  );
  app.use(express.json());

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
        sameSite: "lax",
        secure: env.nodeEnv === "production",
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.use(
    "/api/auth",
    createAuthRouter(options.authRepository ?? authRepository, options.authRouterOptions),
  );
  app.use(
    "/api/events",
    createEventRouter(eventRepository),
  );
  app.use("/api/me", createMeRouter(eventRepository));
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

    console.error("API request failed", error);
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
