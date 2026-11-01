import argon2 from "argon2";
import { createHash, randomUUID } from "node:crypto";
import type { Express } from "express";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const runDatabaseIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === "true";

describe.skipIf(!runDatabaseIntegrationTests)(
  "password reset expiration with PostgreSQL",
  () => {
    const primaryEmail = `stage51-primary-${randomUUID()}@campusconnect.test`;
    const unrelatedEmail = `stage51-unrelated-${randomUUID()}@campusconnect.test`;
    const initialPassword = `Initial-${randomUUID()}!`;
    const unrelatedPassword = `Unrelated-${randomUUID()}!`;
    let app: Express;
    let appFactory: typeof import("./app.js").createApp;
    let prisma: typeof import("./prisma.js").prisma;
    let pool: typeof import("./db.js").pool;
    let primaryUserId: string;
    let unrelatedUserId: string;
    let latestResetUrl: string | null;
    let latestVerificationUrl: string | null;
    let testApp: Express;

    function createTestApp() {
      latestResetUrl = null;
      return appFactory({
        authRouterOptions: {
          deliverResetLink: async (_email, resetUrl) => {
            latestResetUrl = resetUrl;
          },
          deliverVerificationLink: async (_email, _name, verificationUrl) => {
            latestVerificationUrl = verificationUrl;
          },
        },
      });
    }

    async function issueResetToken(email = primaryEmail) {
      const response = await supertest(testApp)
        .post("/api/auth/forgot-password")
        .send({ email });
      expect(response.status).toBe(202);
      expect(latestResetUrl).not.toBeNull();
      const token = new URL(latestResetUrl!).searchParams.get("token");
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      return token!;
    }

    async function setExpiration(token: string, expression: string) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const result = await pool.query(
        `UPDATE "PasswordResetToken"
         SET "expiresAt" = ${expression}
         WHERE "tokenHash" = $1 AND "userId" = $2`,
        [tokenHash, primaryUserId],
      );
      expect(result.rowCount).toBe(1);
    }

    async function submitReset(token: string, password = `Replacement-${randomUUID()}!`) {
      const response = await supertest(testApp)
        .post("/api/auth/reset-password")
        .send({ token, password });
      return { response, password };
    }

    beforeAll(async () => {
      const { env } = await import("./env.js");
      const databaseUrl = new URL(env.databaseUrl);
      const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
      const configuredDatabase = decodeURIComponent(databaseUrl.pathname.slice(1));
      if (!localHosts.has(databaseUrl.hostname) || configuredDatabase !== "campusconnect_test") {
        throw new Error(
          "Password reset expiration tests require the dedicated local campusconnect_test database",
        );
      }

      const [appModule, prismaModule, dbModule] = await Promise.all([
        import("./app.js"),
        import("./prisma.js"),
        import("./db.js"),
      ]);
      appFactory = appModule.createApp;
      prisma = prismaModule.prisma;
      pool = dbModule.pool;
      const identity = await pool.query<{ database_name: string }>(
        "SELECT current_database() AS database_name",
      );
      if (identity.rows[0]?.database_name !== "campusconnect_test") {
        throw new Error("Connected database is not campusconnect_test");
      }

      app = appFactory({
        authRouterOptions: {
          deliverResetLink: async () => {},
          deliverVerificationLink: async (_email, _name, verificationUrl) => {
            latestVerificationUrl = verificationUrl;
          },
        },
      });
      for (const [email, name, password, assignId] of [
        [primaryEmail, "Stage 5.1 Primary Test", initialPassword, (id: string) => {
          primaryUserId = id;
        }],
        [unrelatedEmail, "Stage 5.1 Unrelated Test", unrelatedPassword, (id: string) => {
          unrelatedUserId = id;
        }],
      ] as const) {
        const registration = await supertest(app)
          .post("/api/auth/register")
          .send({ name, email, password });
        expect(registration.status).toBe(201);
        expect(registration.body.user.role).toBe("STUDENT");
        assignId(registration.body.user.id);
        expect(latestVerificationUrl).not.toBeNull();
        const verificationToken = new URL(latestVerificationUrl!).searchParams.get("token");
        expect(verificationToken).toMatch(/^[a-f0-9]{64}$/);
        const verification = await supertest(app)
          .post("/api/auth/verify-email")
          .send({ token: verificationToken });
        expect(verification.status).toBe(200);
      }
    }, 30_000);

    beforeEach(async () => {
      testApp = createTestApp();
      latestResetUrl = null;
      await prisma.passwordResetToken.deleteMany({
        where: { userId: { in: [primaryUserId, unrelatedUserId] } },
      });
      await prisma.user.update({
        where: { id: primaryUserId },
        data: { passwordHash: await argon2.hash(initialPassword) },
      });
      await prisma.user.update({
        where: { id: unrelatedUserId },
        data: { passwordHash: await argon2.hash(unrelatedPassword) },
      });
      await pool.query(
        `DELETE FROM "session" WHERE sess ->> 'userId' = ANY($1::text[])`,
        [[primaryUserId, unrelatedUserId]],
      );
    });

    afterAll(async () => {
      if (!prisma || !pool) return;

      try {
        const temporaryIds = [primaryUserId, unrelatedUserId].filter(
          (id): id is string => Boolean(id),
        );
        if (temporaryIds.length === 0) return;

        const relatedRecords = await pool.query<{
          registrations: number;
          organized_events: number;
        }>(
          `SELECT
             (SELECT count(*)::int FROM "Registration" WHERE "userId" = ANY($1::text[])) AS registrations,
             (SELECT count(*)::int FROM "Event" WHERE "organizerId" = ANY($1::text[])) AS organized_events`,
          [temporaryIds],
        );
        if (
          relatedRecords.rows[0]?.registrations !== 0 ||
          relatedRecords.rows[0]?.organized_events !== 0
        ) {
          throw new Error("Refusing to delete test accounts with retained registrations or events");
        }

        await pool.query(
          `DELETE FROM "session" WHERE sess ->> 'userId' = ANY($1::text[])`,
          [temporaryIds],
        );
        await prisma.$transaction(async (transaction) => {
          await transaction.passwordResetToken.deleteMany({
            where: { userId: { in: temporaryIds } },
          });
          await transaction.user.deleteMany({
            where: {
              id: { in: temporaryIds },
              role: "STUDENT",
            },
          });
        });
      } finally {
        await prisma.$disconnect();
        await pool.end();
      }
    });

    it("accepts a valid token and a token with a future database expiration", async () => {
      const token = await issueResetToken();
      const { response, password } = await submitReset(token);

      expect(response.status).toBe(200);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: primaryUserId },
        select: { passwordHash: true },
      });
      expect(await argon2.verify(user.passwordHash, password)).toBe(true);

      await prisma.user.update({
        where: { id: primaryUserId },
        data: { passwordHash: await argon2.hash(initialPassword) },
      });
      const futureToken = await issueResetToken();
      await setExpiration(futureToken, "clock_timestamp() + INTERVAL '5 minutes'");
      const futureReset = await submitReset(futureToken);
      expect(futureReset.response.status).toBe(200);
    });

    it("rejects a token expired by a substantial amount without changing the password", async () => {
      const token = await issueResetToken();
      await setExpiration(token, "clock_timestamp() - INTERVAL '1 day'");
      const { response } = await submitReset(token);

      expect(response.status).toBe(400);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: primaryUserId },
        select: { passwordHash: true },
      });
      expect(await argon2.verify(user.passwordHash, initialPassword)).toBe(true);
    });

    it("rejects a token expired by one second", async () => {
      const token = await issueResetToken();
      await setExpiration(token, "clock_timestamp() - INTERVAL '1 second'");
      const { response } = await submitReset(token);

      expect(response.status).toBe(400);
    });

    it("rejects a token expiring at the current database time", async () => {
      const token = await issueResetToken();
      await setExpiration(token, "clock_timestamp()");
      const { response } = await submitReset(token);

      expect(response.status).toBe(400);
    });

    it("rejects a reused token", async () => {
      const token = await issueResetToken();
      expect((await submitReset(token)).response.status).toBe(200);
      expect((await submitReset(token)).response.status).toBe(400);
    });

    it("rejects an invalid token", async () => {
      const { response } = await submitReset(`invalid-${randomUUID()}`);

      expect(response.status).toBe(400);
    });

    it("does not change passwords or invalidate unrelated accounts after a failed reset", async () => {
      const unrelatedAgent = supertest.agent(testApp);
      const unrelatedLogin = await unrelatedAgent
        .post("/api/auth/login")
        .send({ email: unrelatedEmail, password: unrelatedPassword });
      expect(unrelatedLogin.status).toBe(200);

      const token = await issueResetToken();
      await setExpiration(token, "clock_timestamp() - INTERVAL '1 day'");
      const { response } = await submitReset(token);

      expect(response.status).toBe(400);
      const primary = await prisma.user.findUniqueOrThrow({
        where: { id: primaryUserId },
        select: { passwordHash: true },
      });
      const unrelated = await prisma.user.findUniqueOrThrow({
        where: { id: unrelatedUserId },
        select: { passwordHash: true },
      });
      expect(await argon2.verify(primary.passwordHash, initialPassword)).toBe(true);
      expect(await argon2.verify(unrelated.passwordHash, unrelatedPassword)).toBe(true);
      expect((await unrelatedAgent.get("/api/auth/me")).status).toBe(200);
    });

    it("allows only one concurrent request to consume a token", async () => {
      const token = await issueResetToken();
      const [first, second] = await Promise.all([
        submitReset(token, `Concurrent-A-${randomUUID()}!`),
        submitReset(token, `Concurrent-B-${randomUUID()}!`),
      ]);

      expect([first.response.status, second.response.status].sort()).toEqual([200, 400]);
    });
  },
);
