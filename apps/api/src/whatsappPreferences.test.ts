import { MemoryStore } from "express-session";
import request from "supertest";
import argon2 from "argon2";
import { beforeAll, describe, expect, it } from "vitest";
import { UserRole } from "./generated/prisma/client.js";
import type { AuthRepository } from "./auth.js";
import type {
  WhatsAppPreferences,
  WhatsAppPreferencesRepository,
} from "./whatsappPreferences.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://localhost:5432/campusconnect_test";
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
process.env.FRONTEND_ORIGIN = "http://localhost:5173";
process.env.WHATSAPP_ENABLED = "false";

interface TestUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  emailVerified: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const users = new Map<string, TestUser>();
const preferences = new Map<string, WhatsAppPreferences>();
const verificationTokens = new Map<string, { userId: string; tokenHash: string; expiresAt: Date }>();
let app: import("express").Express;
let lastVerificationUrl: string | null = null;

const authRepository: AuthRepository = {
  async findByEmail(email) {
    return [...users.values()].find((user) => user.email === email) ?? null;
  },
  async findById(id) {
    const user = users.get(id);
    if (!user) return null;
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  },
  async create(data) {
    const user: TestUser = {
      id: `test-user-${users.size + 1}`,
      ...data,
      emailVerified: data.emailVerified ?? true,
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.set(user.id, user);
    preferences.set(user.id, {
      phoneNumber: null,
      consent: false,
      consentGrantedAt: null,
    });
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  },
  async storePasswordResetToken() {},
  async resetPassword() {
    return false;
  },
  async storeVerificationToken(data) {
    for (const [hash, token] of verificationTokens) {
      if (token.userId === data.userId) verificationTokens.delete(hash);
    }
    verificationTokens.set(data.tokenHash, {
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: new Date(Date.now() + data.expiresInMs),
    });
  },
  async consumeVerificationToken(tokenHash) {
    const token = verificationTokens.get(tokenHash);
    if (!token || token.expiresAt <= new Date()) return null;
    verificationTokens.delete(tokenHash);
    const user = users.get(token.userId);
    if (!user) return null;
    users.set(user.id, { ...user, emailVerified: true, emailVerifiedAt: new Date(), updatedAt: new Date() });
    return { userId: token.userId };
  },
};

const preferencesRepository: WhatsAppPreferencesRepository = {
  async findStudentPreferences(userId) {
    const user = users.get(userId);
    if (!user) return null;
    if (user.role !== UserRole.STUDENT) return { role: user.role };
    return { role: user.role, preferences: preferences.get(userId)! };
  },
  async updateStudentPreferences(userId, update) {
    const user = users.get(userId);
    if (!user || user.role !== UserRole.STUDENT) return null;
    const current = preferences.get(userId)!;
    const next = {
      phoneNumber: update.phoneNumber,
      consent: update.consent,
      consentGrantedAt: update.consent && !current.consent
        ? new Date()
        : update.consent
          ? current.consentGrantedAt
          : null,
    };
    preferences.set(userId, next);
    return next;
  },
};

beforeAll(async () => {
  const organizerPassword = await argon2.hash("organizer-test-password");
  await authRepository.create({
    name: "Organizer",
    email: "organizer@example.test",
    passwordHash: organizerPassword,
    role: UserRole.ORGANIZER,
    emailVerified: true,
  });
  const { createApp } = await import("./app.js");
  app = createApp({
    authRepository,
    whatsappPreferencesRepository: preferencesRepository,
    sessionStore: new MemoryStore(),
    authRouterOptions: {
      deliverVerificationLink: async (_email, _name, verificationUrl) => {
        lastVerificationUrl = verificationUrl;
      },
    },
  });
});

describe("Student WhatsApp preferences API", () => {
  it("requires authentication and defaults to no phone and no consent", async () => {
    expect((await request(app).get("/api/me/whatsapp")).status).toBe(401);
    expect((await request(app).put("/api/me/whatsapp").send({
      phoneNumber: "+14155550132",
      consent: true,
    })).status).toBe(401);

    const student = request.agent(app);
    const signup = await student.post("/api/auth/register").send({
      name: "Student",
      email: "student-one@example.test",
      password: "student-test-password",
    });
    expect(signup.status).toBe(201);
    const verificationToken = new URL(lastVerificationUrl ?? "http://localhost:5173/verify-email").searchParams.get("token");
    expect(verificationToken).toBeTruthy();
    const verification = await request(app).post("/api/auth/verify-email").send({ token: verificationToken });
    expect(verification.status).toBe(200);

    const login = await student.post("/api/auth/login").send({
      email: "student-one@example.test",
      password: "student-test-password",
    });
    expect(login.status).toBe(200);

    const result = await student.get("/api/me/whatsapp");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      enabled: false,
      phoneNumber: null,
      consent: false,
      consentGrantedAt: null,
    });
  });

  it("validates phone details, explicitly opts in, normalizes numbers, and supports withdrawal", async () => {
    const student = request.agent(app);
    const signup = await student.post("/api/auth/register").send({
      name: "Preference Student",
      email: "student-preferences@example.test",
      password: "student-test-password",
    });
    expect(signup.status).toBe(201);
    const verificationToken = new URL(lastVerificationUrl ?? "http://localhost:5173/verify-email").searchParams.get("token");
    expect(verificationToken).toBeTruthy();
    const verification = await request(app).post("/api/auth/verify-email").send({ token: verificationToken });
    expect(verification.status).toBe(200);

    const login = await student.post("/api/auth/login").send({
      email: "student-preferences@example.test",
      password: "student-test-password",
    });
    expect(login.status).toBe(200);

    const invalid = await student.put("/api/me/whatsapp").send({
      phoneNumber: "555-0100",
      consent: true,
    });
    expect(invalid.status).toBe(400);

    const optedIn = await student.put("/api/me/whatsapp").send({
      phoneNumber: "+1 (415) 555-0132",
      consent: true,
    });
    expect(optedIn.status).toBe(200);
    expect(optedIn.body.phoneNumber).toBe("+14155550132");
    expect(optedIn.body.consent).toBe(true);
    expect(optedIn.body.consentGrantedAt).toEqual(expect.any(String));
    expect(optedIn.body).not.toHaveProperty("email");
    expect(optedIn.body).not.toHaveProperty("userId");

    const withdrawn = await student.put("/api/me/whatsapp").send({
      phoneNumber: "+14155550132",
      consent: false,
    });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body).toMatchObject({
      phoneNumber: "+14155550132",
      consent: false,
    });
  });

  it("limits the private preference route to the signed-in student's own record", async () => {
    const organizer = request.agent(app);
    await organizer.post("/api/auth/login").send({
      email: "organizer@example.test",
      password: "organizer-test-password",
    });
    expect((await organizer.get("/api/me/whatsapp")).status).toBe(403);
    expect((await organizer.put("/api/me/whatsapp").send({
      phoneNumber: "+14155550132",
      consent: true,
    })).status).toBe(403);

    const firstStudent = request.agent(app);
    const firstSignup = await firstStudent.post("/api/auth/register").send({
      name: "Private Student",
      email: "student-private@example.test",
      password: "student-test-password",
    });
    expect(firstSignup.status).toBe(201);
    const firstVerificationToken = new URL(lastVerificationUrl ?? "http://localhost:5173/verify-email").searchParams.get("token");
    expect(firstVerificationToken).toBeTruthy();
    const firstVerification = await request(app).post("/api/auth/verify-email").send({ token: firstVerificationToken });
    expect(firstVerification.status).toBe(200);
    const firstLogin = await firstStudent.post("/api/auth/login").send({
      email: "student-private@example.test",
      password: "student-test-password",
    });
    expect(firstLogin.status).toBe(200);
    await firstStudent.put("/api/me/whatsapp").send({
      phoneNumber: "+14155550132",
      consent: true,
    });

    const secondStudent = request.agent(app);
    const secondSignup = await secondStudent.post("/api/auth/register").send({
      name: "Other Student",
      email: "student-other@example.test",
      password: "student-test-password",
    });
    expect(secondSignup.status).toBe(201);
    const secondVerificationToken = new URL(lastVerificationUrl ?? "http://localhost:5173/verify-email").searchParams.get("token");
    expect(secondVerificationToken).toBeTruthy();
    const secondVerification = await request(app).post("/api/auth/verify-email").send({ token: secondVerificationToken });
    expect(secondVerification.status).toBe(200);
    const secondLogin = await secondStudent.post("/api/auth/login").send({
      email: "student-other@example.test",
      password: "student-test-password",
    });
    expect(secondLogin.status).toBe(200);
    const otherPreferences = await secondStudent.get("/api/me/whatsapp");
    expect(otherPreferences.body.phoneNumber).toBeNull();
    expect(JSON.stringify(otherPreferences.body)).not.toContain("+14155550132");
  });
});
