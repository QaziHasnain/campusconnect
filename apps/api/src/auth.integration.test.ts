import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "./env.js";

const runDatabaseIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === "true";

describe.skipIf(!runDatabaseIntegrationTests)("Auth API with PostgreSQL", () => {
  let app: import("express").Express;
  let prisma: typeof import("./prisma.js").prisma;
  let pool: typeof import("./db.js").pool;
  let latestVerificationUrl: string | null = null;
  const email = `auth-integration-${Date.now()}@example.com`;
  const password = "integration-test-password";

  beforeAll(async () => {
    const databaseUrl = new URL(env.databaseUrl);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    const configuredDatabase = decodeURIComponent(databaseUrl.pathname.slice(1));
    if (!localHosts.has(databaseUrl.hostname) || configuredDatabase !== "campusconnect_test") {
      throw new Error("Authentication integration tests require the dedicated local campusconnect_test database");
    }

    const [appModule, prismaModule, databaseModule] = await Promise.all([
      import("./app.js"),
      import("./prisma.js"),
      import("./db.js"),
    ]);
    app = appModule.createApp({
      authRouterOptions: {
        deliverVerificationLink: async (_email, _name, verificationUrl) => {
          latestVerificationUrl = verificationUrl;
        },
      },
    });
    prisma = prismaModule.prisma;
    pool = databaseModule.pool;
    const identity = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    if (identity.rows[0]?.database_name !== "campusconnect_test") {
      throw new Error("Connected database is not campusconnect_test");
    }
  });

  afterAll(async () => {
    if (prisma && pool) {
      try {
        const user = await prisma.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (user) {
          await pool.query(`DELETE FROM "session" WHERE sess ->> 'userId' = $1`, [user.id]);
          await prisma.user.deleteMany({ where: { id: user.id, email } });
        }
      } finally {
        await prisma.$disconnect();
        await pool.end();
      }
    }
  });

  it("persists registration and PostgreSQL sessions through login, current-user lookup, and logout", async () => {
    const request = (await import("supertest")).default;
    const agent = request.agent(app);
    const registration = await agent.post("/api/auth/register").send({
      name: "Integration User",
      email,
      password,
    });

    expect(registration.status).toBe(201);
    expect(registration.body.user).not.toHaveProperty("passwordHash");

    const unverifiedLogin = await agent.post("/api/auth/login").send({ email, password });
    expect(unverifiedLogin.status).toBe(403);
    expect(unverifiedLogin.body.error).toBe("EMAIL_NOT_VERIFIED");

    expect(latestVerificationUrl).not.toBeNull();
    const verificationToken = new URL(latestVerificationUrl!).searchParams.get("token");
    expect(verificationToken).toMatch(/^[a-f0-9]{64}$/);
    const verification = await agent.post("/api/auth/verify-email").send({
      token: verificationToken,
    });
    expect(verification.status).toBe(200);

    const login = await agent.post("/api/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    expect((await agent.get("/api/auth/me")).body.user.email).toBe(email);

    expect((await agent.post("/api/auth/logout")).status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });
});
