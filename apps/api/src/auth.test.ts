import { MemoryStore } from "express-session";
import { createHash } from "node:crypto";
import type { User } from "./generated/prisma/client.js";
import { UserRole } from "./generated/prisma/client.js";
import type { AuthRepository } from "./auth.js";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/campusconnect";
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
process.env.FRONTEND_ORIGIN = "http://localhost:5173";

const users = new Map<string, User>();
const resetTokens = new Map<
  string,
  { userId: string; tokenHash: string; expiresAt: Date }
>();
const verificationTokens = new Map<
  string,
  { userId: string; tokenHash: string; expiresAt: Date }
>();
const sessionStore = new MemoryStore();
let app: import("express").Express;
let deliveredResetUrl: string | null = null;
let deliveredVerificationUrl: string | null = null;

const repository: AuthRepository = {
  async findByEmail(email) {
    const user = [...users.values()].find((user) => user.email === email);
    return user ?? null;
  },
  async findById(id) {
    const user = users.get(id);
    if (!user) {
      return null;
    }

    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  },
  async create(data) {
    const user: User = {
      id: `test-${users.size + 1}`,
      ...data,
      emailVerified: data.emailVerified ?? false,
      emailVerifiedAt: null,
      whatsAppPhoneNumber: null,
      whatsAppConsent: false,
      whatsAppConsentAt: null,
      whatsAppWithdrawnAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.set(user.id, user);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  },
  async storePasswordResetToken(data) {
    for (const [hash, token] of resetTokens) {
      if (token.userId === data.userId) resetTokens.delete(hash);
    }
    resetTokens.set(data.tokenHash, {
      ...data,
      expiresAt: new Date(Date.now() + data.expiresInMs),
    });
  },
  async resetPassword(tokenHash, passwordHash) {
    const token = resetTokens.get(tokenHash);
    if (!token || token.expiresAt <= new Date()) {
      return false;
    }
    resetTokens.delete(tokenHash);

    const user = users.get(token.userId);
    if (!user) return false;
    const now = new Date();
    users.set(user.id, { ...user, passwordHash, updatedAt: now });
    for (const [hash, savedToken] of resetTokens) {
      if (savedToken.userId === user.id) resetTokens.delete(hash);
    }

    await new Promise<void>((resolve, reject) => {
      sessionStore.all((error, sessions) => {
        if (error) {
          reject(error);
          return;
        }

        const sessionIds = Object.entries(sessions ?? {})
          .filter(([, session]) => session.userId === user.id)
          .map(([sessionId]) => sessionId);
        Promise.all(
          sessionIds.map(
            (sessionId) =>
              new Promise<void>((destroyResolve, destroyReject) => {
                sessionStore.destroy(sessionId, (destroyError) =>
                  destroyError ? destroyReject(destroyError) : destroyResolve(),
                );
              }),
          ),
        ).then(() => resolve(), reject);
      });
    });

    return true;
  },
  async storeVerificationToken(data) {
    for (const [hash, token] of verificationTokens) {
      if (token.userId === data.userId) verificationTokens.delete(hash);
    }
    verificationTokens.set(data.tokenHash, {
      ...data,
      expiresAt: new Date(Date.now() + data.expiresInMs),
    });
  },
  async consumeVerificationToken(tokenHash) {
    const token = verificationTokens.get(tokenHash);
    if (!token || token.expiresAt <= new Date()) {
      return null;
    }
    verificationTokens.delete(tokenHash);

    const user = users.get(token.userId);
    if (!user) return null;
    users.set(user.id, { ...user, emailVerified: true, emailVerifiedAt: new Date(), updatedAt: new Date() });
    return { userId: token.userId };
  },
};

beforeAll(async () => {
  const { createApp } = await import("./app.js");
  app = createApp({
    authRepository: repository,
    sessionStore,
    authRouterOptions: {
      deliverResetLink: async (_email, resetUrl) => {
        deliveredResetUrl = resetUrl;
      },
      deliverVerificationLink: async (_email, _name, verificationUrl) => {
        deliveredVerificationUrl = verificationUrl;
      },
    },
  });
});

describe("Auth API without PostgreSQL (injected repository and test-only session store)", () => {
  it("registers, normalizes email, hashes the password, rotates login sessions, reads the user, and logs out", async () => {
    const request = (await import("supertest")).default;
    const agent = request.agent(app);
    const registration = await agent.post("/api/auth/register").send({
      name: " Ada Lovelace ",
      email: " ADA@Example.COM ",
      password: "correct-horse-battery",
    });

    expect(registration.status).toBe(201);
    expect(registration.body.message).toContain("verify");
    expect(registration.body.user).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.com",
      role: "STUDENT",
    });
    expect(registration.body.user).not.toHaveProperty("passwordHash");

    const user = [...users.values()][0];
    expect(user.passwordHash).not.toBe("correct-horse-battery");
    expect(await (await import("argon2")).default.verify(user.passwordHash, "correct-horse-battery")).toBe(
      true,
    );

    const unverifiedLogin = await agent.post("/api/auth/login").send({
      email: " ADA@EXAMPLE.COM ",
      password: "correct-horse-battery",
    });

    expect(unverifiedLogin.status).toBe(403);
    expect(unverifiedLogin.body.error).toBe("EMAIL_NOT_VERIFIED");

    const verificationToken = new URL(deliveredVerificationUrl!).searchParams.get("token");
    const verified = await request(app).post("/api/auth/verify-email").send({ token: verificationToken });
    expect(verified.status).toBe(200);

    const login = await agent.post("/api/auth/login").send({
      email: " ADA@EXAMPLE.COM ",
      password: "correct-horse-battery",
    });

    expect(login.status).toBe(200);
    expect(login.body.user).not.toHaveProperty("passwordHash");
    expect(login.headers["set-cookie"]).toBeDefined();

    const currentUser = await agent.get("/api/auth/me");
    expect(currentUser.status).toBe(200);
    expect(currentUser.body.user).toEqual(login.body.user);
    expect(currentUser.body.user).not.toHaveProperty("passwordHash");

    const logout = await agent.post("/api/auth/logout");
    expect(logout.status).toBe(200);
    expect(logout.headers["set-cookie"][0]).toContain("Expires=");
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("rejects invalid roles, malformed input, duplicate emails, and invalid credentials", async () => {
    const request = (await import("supertest")).default;
    const agent = request.agent(app);
    const invalidRole = await agent.post("/api/auth/register").send({
      name: "Admin",
      email: "admin@example.com",
      password: "a-valid-password",
      role: "ADMIN",
    });
    expect(invalidRole.status).toBe(400);

    const invalidEmail = await agent.post("/api/auth/register").send({
      name: "Invalid",
      email: "not-an-email",
      password: "a-valid-password",
    });
    expect(invalidEmail.status).toBe(400);

    const duplicate = await agent.post("/api/auth/register").send({
      name: "Duplicate",
      email: "ada@example.com",
      password: "a-valid-password",
    });
    expect(duplicate.status).toBe(409);

    const incorrectPassword = await agent.post("/api/auth/login").send({
      email: "ada@example.com",
      password: "wrong-password",
    });
    const unknownUser = await agent.post("/api/auth/login").send({
      email: "nobody@example.com",
      password: "wrong-password",
    });
    expect(incorrectPassword.status).toBe(401);
    expect(incorrectPassword.body).toEqual(unknownUser.body);
    expect(incorrectPassword.body.error).toBe("Invalid email or password");
  });

  it("defaults registration role to STUDENT and rejects extra fields", async () => {
    const request = (await import("supertest")).default;
    const result = await request(app).post("/api/auth/register").send({
      name: "Grace Hopper",
      email: "grace@example.com",
      password: "another-valid-password",
      isAdmin: true,
    });
    expect(result.status).toBe(400);

    const organizerRoleAttempt = await request(app).post("/api/auth/register").send({
      name: "Role Escalation",
      email: "role-escalation@example.com",
      password: "another-valid-password",
      role: "ORGANIZER",
    });
    expect(organizerRoleAttempt.status).toBe(400);

    const registration = await request(app).post("/api/auth/register").send({
      name: "Grace Hopper",
      email: "grace@example.com",
      password: "another-valid-password",
    });
    expect(registration.status).toBe(201);
    expect(registration.body.user.role).toBe(UserRole.STUDENT);
  });

  it("returns a safe JSON error for malformed JSON bodies", async () => {
    const request = (await import("supertest")).default;
    const response = await request(app)
      .post("/api/auth/register")
      .set("Content-Type", "application/json")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid JSON body" });
  });

  it("uses the same generic response for known and unknown reset emails", async () => {
    const request = (await import("supertest")).default;
    const unknown = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "unknown-reset@example.com" });
    const known = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "ada@example.com" });

    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(unknown.body.message).not.toContain("email was sent");
    expect(deliveredResetUrl).toContain("/reset-password?token=");
  });

  it("stores only a token hash and accepts a reset token once", async () => {
    const request = (await import("supertest")).default;
    const forgot = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "ada@example.com" });
    const token = new URL(deliveredResetUrl!).searchParams.get("token");
    expect(forgot.status).toBe(202);
    expect(token).toMatch(/^[a-f0-9]{64}$/);

    const tokenHash = createHash("sha256").update(token!).digest("hex");
    expect(resetTokens.has(tokenHash)).toBe(true);
    expect(resetTokens.has(token!)).toBe(false);

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "a-new-valid-password" });
    expect(reset.status).toBe(200);
    expect(reset.body.message).toMatch(/Sign in with your new password/);
    expect(resetTokens.has(tokenHash)).toBe(false);

    const oldPasswordLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "ada@example.com", password: "correct-horse-battery" });
    expect(oldPasswordLogin.status).toBe(401);

    const reused = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "another-new-password" });
    expect(reused.status).toBe(400);

    const emailVerifiedUser = [...users.values()].find((user) => user.email === "ada@example.com");
    if (emailVerifiedUser) {
      users.set(emailVerifiedUser.id, { ...emailVerifiedUser, emailVerified: true, emailVerifiedAt: new Date(), updatedAt: new Date() });
    }

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "ada@example.com", password: "a-new-valid-password" });
    expect(login.status).toBe(200);
  });

  it("rejects expired and invalid tokens and validates reset password length", async () => {
    const request = (await import("supertest")).default;
    const expiredToken = "expired-reset-token";
    const expiredHash = createHash("sha256").update(expiredToken).digest("hex");
    resetTokens.set(expiredHash, {
      userId: "test-1",
      tokenHash: expiredHash,
      expiresAt: new Date(Date.now() - 1000),
    });

    const expired = await request(app).post("/api/auth/reset-password").send({
      token: expiredToken,
      password: "a-valid-new-password",
    });
    const invalid = await request(app).post("/api/auth/reset-password").send({
      token: "not-a-valid-token",
      password: "a-valid-new-password",
    });
    const invalidPassword = await request(app).post("/api/auth/reset-password").send({
      token: "not-a-valid-token",
      password: "short",
    });

    expect(expired.status).toBe(400);
    expect(expired.body).toEqual({ error: "This reset link is invalid or has expired." });
    expect(invalid.body).toEqual(expired.body);
    expect(invalidPassword.status).toBe(400);
    expect(invalidPassword.body.error).toBe("Invalid password reset details");
  });

  it("invalidates existing sessions after a successful password reset", async () => {
    const request = (await import("supertest")).default;
    const agent = request.agent(app);
    const registration = await agent.post("/api/auth/register").send({
      name: "Session Reset User",
      email: "session-reset@example.com",
      password: "original-password",
    });
    expect(registration.status).toBe(201);

    const verificationToken = new URL(deliveredVerificationUrl!).searchParams.get("token");
    const verified = await request(app).post("/api/auth/verify-email").send({ token: verificationToken });
    expect(verified.status).toBe(200);

    const login = await agent.post("/api/auth/login").send({
      email: "session-reset@example.com",
      password: "original-password",
    });
    expect(login.status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(200);

    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "session-reset@example.com" });
    const token = new URL(deliveredResetUrl!).searchParams.get("token");
    const reset = await request(app).post("/api/auth/reset-password").send({
      token,
      password: "replacement-password",
    });

    expect(reset.status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "session-reset@example.com", password: "original-password" })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "session-reset@example.com", password: "replacement-password" })
      ).status,
    ).toBe(200);
  });

  it("rate limits password reset requests without changing the generic response", async () => {
    const request = (await import("supertest")).default;
    const { createApp } = await import("./app.js");
    const limitedApp = createApp({
      authRepository: repository,
      sessionStore: new MemoryStore(),
      authRouterOptions: {
        deliverResetLink: async () => {},
      },
    });

    const responses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(
        await request(limitedApp)
          .post("/api/auth/forgot-password")
          .send({ email: `unknown-${attempt}@example.com` }),
      );
    }

    expect(responses.slice(0, 5).map((response) => response.status)).toEqual([
      202, 202, 202, 202, 202,
    ]);
    expect(responses.slice(0, 5).map((response) => response.body)).toEqual(
      Array(5).fill(responses[0].body),
    );
    expect(responses[5].status).toBe(429);
    expect(responses[5].headers["retry-after"]).toBeDefined();
  });

  it("limits repeated password login attempts by IP and account", async () => {
    const request = (await import("supertest")).default;
    const { createApp } = await import("./app.js");
    const limitedApp = createApp({
      authRepository: repository,
      sessionStore: new MemoryStore(),
    });

    const responses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      responses.push(await request(limitedApp).post("/api/auth/login").send({
        email: "brute-force-target@example.com",
        password: "incorrect-password",
      }));
    }

    expect(responses.slice(0, 10).every((response) => response.status === 401)).toBe(true);
    expect(responses[10].status).toBe(429);
    expect(responses[10].headers["retry-after"]).toBeDefined();
  });

  it("keeps email delivery failures indistinguishable from unknown addresses", async () => {
    const request = (await import("supertest")).default;
    const { createApp } = await import("./app.js");
    const deliveryFailureApp = createApp({
      authRepository: repository,
      sessionStore: new MemoryStore(),
      authRouterOptions: {
        deliverResetLink: async () => {
          throw new Error("test-only mail failure");
        },
      },
    });
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const known = await request(deliveryFailureApp)
        .post("/api/auth/forgot-password")
        .send({ email: "ada@example.com" });
      const unknown = await request(deliveryFailureApp)
        .post("/api/auth/forgot-password")
        .send({ email: "unknown-delivery@example.com" });

      expect(known.status).toBe(202);
      expect(known.body).toEqual(unknown.body);
    } finally {
      logError.mockRestore();
    }
  });
});
