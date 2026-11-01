import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { UserRole, type User } from "./generated/prisma/client.js";
import { env } from "./env.js";
import {
  deliverPasswordResetLink,
  deliverVerificationLink,
} from "./email.js";

type SafeUser = Pick<User, "id" | "name" | "email" | "role" | "createdAt" | "updatedAt" | "emailVerified" | "emailVerifiedAt">;
type UserWithPassword = SafeUser & Pick<User, "passwordHash">;

export interface AuthRepository {
  findByEmail(email: string): Promise<UserWithPassword | null>;
  findById(id: string): Promise<SafeUser | null>;
  create(data: {
    name: string;
    email: string;
    passwordHash: string;
    role: UserRole;
    emailVerified?: boolean;
  }): Promise<SafeUser>;
  storePasswordResetToken(data: {
    userId: string;
    tokenHash: string;
    expiresInMs: number;
  }): Promise<void>;
  resetPassword(tokenHash: string, passwordHash: string): Promise<boolean>;
  storeVerificationToken?(data: {
    userId: string;
    tokenHash: string;
    expiresInMs: number;
  }): Promise<void>;
  consumeVerificationToken?(tokenHash: string): Promise<{ userId: string } | null>;
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
  })
  .strict();

const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(1).max(128),
  })
  .strict();

const requestPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
}).strict();

const verifyEmailSchema = z.object({
  token: z.string().min(1).max(256),
}).strict();

const resendVerificationSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
}).strict();

const resetPasswordSchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(8).max(128),
}).strict();

const genericResetRequestResponse = {
  message:
    "If an account exists for this address, password reset instructions will be sent.",
};

const genericVerificationRequestResponse = {
  message:
    "If an account exists and is unverified, a verification email will be sent.",
};

const passwordResetTokenLifetimeMs = 30 * 60 * 1000;
const emailVerificationTokenLifetimeMs = 24 * 60 * 60 * 1000;
const minimumResetRequestResponseMs = 150;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function createRateLimiter(limit: number, windowMs: number, getKeys: (request: Request) => string[]) {
  const entries = new Map<string, RateLimitEntry>();

  return (request: Request, response: Response, next: (error?: unknown) => void) => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }

    const keys = getKeys(request);
    const blockedEntry = keys
      .map((key) => entries.get(key))
      .find((entry) => entry && entry.count >= limit);

    if (blockedEntry) {
      response.setHeader(
        "Retry-After",
        Math.max(1, Math.ceil((blockedEntry.resetAt - now) / 1000)).toString(),
      );
      return response.status(429).json({ error: "Too many requests. Try again later." });
    }

    for (const key of keys) {
      const entry = entries.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        entries.set(key, { count: 1, resetAt: now + windowMs });
      }
    }
    return next();
  };
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function waitUntilMinimumDuration(startedAt: number) {
  const remainingMs = minimumResetRequestResponseMs - (Date.now() - startedAt);
  return remainingMs > 0
    ? new Promise<void>((resolve) => setTimeout(resolve, remainingMs))
    : Promise.resolve();
}

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

export function createAuthRouter(
  repository: AuthRepository,
  options: {
    deliverResetLink?: (email: string, resetUrl: string) => Promise<void>;
    deliverVerificationLink?: (email: string, name: string, verificationUrl: string) => Promise<void>;
  } = {},
) {
  const router = Router();
  const resetRequestLimiter = createRateLimiter(
    5,
    15 * 60 * 1000,
    (request) => [
      `ip:${request.ip ?? "unknown"}`,
      `email:${typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : ""}`,
    ],
  );
  const resetTokenLimiter = createRateLimiter(
    10,
    15 * 60 * 1000,
    (request) => [`ip:${request.ip ?? "unknown"}`],
  );
  const verificationRequestLimiter = createRateLimiter(
    5,
    60 * 60 * 1000,
    (request) => [
      `ip:${request.ip ?? "unknown"}`,
      `email:${typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : ""}`,
    ],
  );

  router.post("/register", async (request, response) => {
    const parsed = registerSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        error: "Invalid registration details",
        details: z.treeifyError(parsed.error),
      });
    }

    const { name, email, password } = parsed.data;

    try {
      if (await repository.findByEmail(email)) {
        return response.status(409).json({ error: "Email already registered" });
      }

      const passwordHash = await argon2.hash(password);
      const user = await repository.create({
        name,
        email,
        passwordHash,
        role: UserRole.STUDENT,
        emailVerified: false,
      });

      const verificationToken = randomBytes(32).toString("hex");
      const verificationUrl = new URL("/verify-email", env.frontendOrigin);
      verificationUrl.searchParams.set("token", verificationToken);

      if (repository.storeVerificationToken) {
        await repository.storeVerificationToken({
          userId: user.id,
          tokenHash: hashToken(verificationToken),
          expiresInMs: emailVerificationTokenLifetimeMs,
        });
      }

      await (options.deliverVerificationLink ?? deliverVerificationLink)(
        email,
        name,
        verificationUrl.toString(),
      );

      return response.status(201).json({
        user: toPublicUser(user),
        message: "Check your email to verify your account before signing in.",
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return response.status(409).json({ error: "Email already registered" });
      }
      logAuthError("registration", error);
      return serverError(response);
    }
  });

  router.post("/verify-email", async (request, response) => {
    const parsed = verifyEmailSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        error: "Invalid verification details",
        details: z.treeifyError(parsed.error),
      });
    }

    try {
      const verificationToken = repository.consumeVerificationToken;
      if (!verificationToken) {
        return response.status(500).json({ error: "Authentication service unavailable" });
      }

      const result = await verificationToken(hashToken(parsed.data.token));
      if (!result) {
        return response.status(400).json({ error: "This verification link is invalid or has expired." });
      }

      return response.json({ message: "Email verified. You can sign in now." });
    } catch (error) {
      logAuthError("email verification", error);
      return serverError(response);
    }
  });

  router.post("/resend-verification", verificationRequestLimiter, async (request, response) => {
    const parsed = resendVerificationSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        error: "Invalid email address",
        details: z.treeifyError(parsed.error),
      });
    }

    try {
      const user = await repository.findByEmail(parsed.data.email);
      if (user && !user.emailVerified) {
        const verificationToken = randomBytes(32).toString("hex");
        const verificationUrl = new URL("/verify-email", env.frontendOrigin);
        verificationUrl.searchParams.set("token", verificationToken);

        if (repository.storeVerificationToken) {
          await repository.storeVerificationToken({
            userId: user.id,
            tokenHash: hashToken(verificationToken),
            expiresInMs: emailVerificationTokenLifetimeMs,
          });
        }

        await (options.deliverVerificationLink ?? deliverVerificationLink)(
          parsed.data.email,
          user.name,
          verificationUrl.toString(),
        );
      }

      return response.status(202).json(genericVerificationRequestResponse);
    } catch (error) {
      logAuthError("verification resend", error);
      return response.status(202).json(genericVerificationRequestResponse);
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

      if (!user.emailVerified) {
        return response.status(403).json({ error: "EMAIL_NOT_VERIFIED" });
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

  router.post("/forgot-password", resetRequestLimiter, async (request, response) => {
    const parsed = requestPasswordResetSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: "Invalid email address",
        details: z.treeifyError(parsed.error),
      });
    }

    const startedAt = Date.now();
    try {
      const user = await repository.findByEmail(parsed.data.email);
      if (user) {
        const token = randomBytes(32).toString("hex");
        await repository.storePasswordResetToken({
          userId: user.id,
          tokenHash: hashToken(token),
          expiresInMs: passwordResetTokenLifetimeMs,
        });
        const resetUrl = new URL("/reset-password", env.frontendOrigin);
        resetUrl.searchParams.set("token", token);
        await (options.deliverResetLink ?? deliverPasswordResetLink)(
          parsed.data.email,
          resetUrl.toString(),
        );
      }

      await waitUntilMinimumDuration(startedAt);
      return response.status(202).json(genericResetRequestResponse);
    } catch {
      console.error("Password reset request processing failed");
      await waitUntilMinimumDuration(startedAt);
      return response.status(202).json(genericResetRequestResponse);
    }
  });

  router.post("/reset-password", resetTokenLimiter, async (request, response) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: "Invalid password reset details",
        details: z.treeifyError(parsed.error),
      });
    }

    try {
      const passwordHash = await argon2.hash(parsed.data.password);
      const reset = await repository.resetPassword(
        hashToken(parsed.data.token),
        passwordHash,
      );
      if (!reset) {
        return response.status(400).json({ error: "This reset link is invalid or has expired." });
      }

      return response.json({ message: "Password updated. Sign in with your new password." });
    } catch (error) {
      logAuthError("password reset", error);
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
