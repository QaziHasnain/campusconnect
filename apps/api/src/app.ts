import connectPgSimple from "connect-pg-simple";
import cors from "cors";
import express from "express";
import session, { type Store } from "express-session";
import helmet from "helmet";
import { createAuthRouter, type AuthRepository } from "./auth.js";
import {
  createEventRouter,
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
};

export function createApp(options: {
  authRepository?: AuthRepository;
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
  app.use("/api/auth", createAuthRouter(options.authRepository ?? authRepository));
  app.use(
    "/api/events",
    createEventRouter(options.eventRepository ?? createPrismaEventRepository(prisma)),
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
