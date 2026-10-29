import argon2 from "argon2";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { UserRole, type User } from "./generated/prisma/client.js";
import { env } from "./env.js";

type SafeUser = Pick<User, "id" | "name" | "email" | "role" | "createdAt" | "updatedAt">;
type UserWithPassword = SafeUser & Pick<User, "passwordHash">;

export interface AuthRepository {
  findByEmail(email: string): Promise<UserWithPassword | null>;
  findById(id: string): Promise<SafeUser | null>;
  create(data: {
    name: string;
    email: string;
    passwordHash: string;
    role: UserRole;
  }): Promise<SafeUser>;
}

const publicUserFields = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} as const;

const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(8).max(128),
    role: z.enum([UserRole.STUDENT, UserRole.ORGANIZER]).default(UserRole.STUDENT),
  })
  .strict();

const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(1).max(128),
  })
  .strict();

function toPublicUser(user: SafeUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function regenerateSession(request: Request) {
  return new Promise<void>((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(request: Request) {
  return new Promise<void>((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(request: Request) {
  return new Promise<void>((resolve, reject) => {
    request.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function logAuthError(action: string, error: unknown) {
  console.error(`Authentication ${action} failed`, error);
}

function serverError(response: Response) {
  return response.status(500).json({ error: "Authentication service unavailable" });
}

export function createAuthRouter(repository: AuthRepository) {
  const router = Router();

  router.post("/register", async (request, response) => {
    const parsed = registerSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        error: "Invalid registration details",
        details: z.treeifyError(parsed.error),
      });
    }

    const { name, email, password, role } = parsed.data;

    try {
      if (await repository.findByEmail(email)) {
        return response.status(409).json({ error: "Email already registered" });
      }

      const passwordHash = await argon2.hash(password);
      const user = await repository.create({ name, email, passwordHash, role });

      await regenerateSession(request);
      request.session.userId = user.id;
      await saveSession(request);

      return response.status(201).json({ user: toPublicUser(user) });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return response.status(409).json({ error: "Email already registered" });
      }
      logAuthError("registration", error);
      return serverError(response);
    }
  });

  router.post("/login", async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        error: "Invalid login details",
        details: z.treeifyError(parsed.error),
      });
    }

    const { email, password } = parsed.data;

    try {
      const user = await repository.findByEmail(email);

      if (!user || !(await argon2.verify(user.passwordHash, password))) {
        return response.status(401).json({ error: "Invalid email or password" });
      }

      await regenerateSession(request);
      request.session.userId = user.id;
      await saveSession(request);

      return response.json({ user: toPublicUser(user) });
    } catch (error) {
      logAuthError("login", error);
      return serverError(response);
    }
  });

  router.get("/me", async (request, response) => {
    if (!request.session.userId) {
      return response.status(401).json({ error: "Authentication required" });
    }

    try {
      const user = await repository.findById(request.session.userId);

      if (!user) {
        await destroySession(request);
        return response.status(401).json({ error: "Authentication required" });
      }

      return response.json({ user: toPublicUser(user) });
    } catch (error) {
      logAuthError("current-user lookup", error);
      return serverError(response);
    }
  });

  router.post("/logout", async (request, response) => {
    try {
      await destroySession(request);
      response.clearCookie("campusconnect.sid", {
        httpOnly: true,
        sameSite: "lax",
        secure: env.nodeEnv === "production",
        path: "/",
      });
      return response.json({ message: "Logged out" });
    } catch (error) {
      logAuthError("logout", error);
      return serverError(response);
    }
  });

  return router;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
