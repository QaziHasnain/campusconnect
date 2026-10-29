import { MemoryStore } from "express-session";
import type { User } from "./generated/prisma/client.js";
import { UserRole } from "./generated/prisma/client.js";
import type { AuthRepository } from "./auth.js";
import { beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/campusconnect";
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
process.env.FRONTEND_ORIGIN = "http://localhost:5173";

const users = new Map<string, User>();
let app: import("express").Express;

const repository: AuthRepository = {
  async findByEmail(email) {
    return [...users.values()].find((user) => user.email === email) ?? null;
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.set(user.id, user);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  },
};

beforeAll(async () => {
  const { createApp } = await import("./app.js");
  app = createApp({ authRepository: repository, sessionStore: new MemoryStore() });
});

describe("Auth API without PostgreSQL (injected repository and test-only session store)", () => {
  it("registers, normalizes email, hashes the password, rotates login sessions, reads the user, and logs out", async () => {
    const request = (await import("supertest")).default;
    const agent = request.agent(app);
    const registration = await agent.post("/api/auth/register").send({
      name: " Ada Lovelace ",
      email: " ADA@Example.COM ",
      password: "correct-horse-battery",
      role: "ORGANIZER",
    });

    expect(registration.status).toBe(201);
    expect(registration.body.user).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.com",
      role: "ORGANIZER",
    });
    expect(registration.body.user).not.toHaveProperty("passwordHash");

    const user = [...users.values()][0];
    expect(user.passwordHash).not.toBe("correct-horse-battery");
    expect(await (await import("argon2")).default.verify(user.passwordHash, "correct-horse-battery")).toBe(
      true,
    );

    const originalCookie = registration.headers["set-cookie"][0].split(";")[0];
    const login = await agent.post("/api/auth/login").send({
      email: " ADA@EXAMPLE.COM ",
      password: "correct-horse-battery",
    });

    expect(login.status).toBe(200);
    expect(login.body.user).not.toHaveProperty("passwordHash");
    expect(login.headers["set-cookie"][0].split(";")[0]).not.toBe(originalCookie);

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
});
