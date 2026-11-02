import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "./env.js";

const enabled = process.env.RUN_CAMPUSCONNECT_SCHEMA_REGRESSION_TESTS === "true";

describe.skipIf(!enabled)("CampusConnect database schema regression", () => {
  const email = `schema-regression-${randomUUID()}@example.test`;
  const password = "schema-regression-password";
  let prisma: typeof import("./prisma.js").prisma;
  let pool: typeof import("./db.js").pool;

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
  });

  it("registers, verifies, logs in with a PostgreSQL session, and lists events", async () => {
    const url = new URL(env.databaseUrl);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (
      !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) ||
      database !== "CampusConnect"
    ) {
      throw new Error("This regression test requires the authorized local CampusConnect database.");
    }

    const [appModule, prismaModule, databaseModule] = await Promise.all([
      import("./app.js"),
      import("./prisma.js"),
      import("./db.js"),
    ]);
    prisma = prismaModule.prisma;
    pool = databaseModule.pool;

    const identity = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    if (identity.rows[0]?.database_name !== "CampusConnect") {
      throw new Error("Connected database is not the authorized CampusConnect database.");
    }

    let verificationUrl: string | null = null;
    const app = appModule.createApp({
      authRouterOptions: {
        deliverVerificationLink: async (_email, _name, url) => {
          verificationUrl = url;
        },
      },
    });
    const agent = request.agent(app);

    try {
      const registration = await agent.post("/api/auth/register").send({
        name: "Schema Regression User",
        email,
        password,
      });
      expect(registration.status).toBe(201);

      const verificationToken = verificationUrl
        ? new URL(verificationUrl).searchParams.get("token")
        : null;
      expect(verificationToken).toMatch(/^[a-f0-9]{64}$/);

      const verification = await agent.post("/api/auth/verify-email").send({
        token: verificationToken,
      });
      expect(verification.status).toBe(200);

      const login = await agent.post("/api/auth/login").send({ email, password });
      expect(login.status).toBe(200);
      expect(login.headers["set-cookie"]).toEqual(
        expect.arrayContaining([expect.stringContaining("campusconnect.sid=")]),
      );

      const currentUser = await agent.get("/api/auth/me");
      expect(currentUser.status).toBe(200);
      expect(currentUser.body.user.email).toBe(email);

      const sessions = await pool.query<{ sid: string }>(
        'SELECT "sid" FROM "session" WHERE sess ->> \'userId\' = $1',
        [registration.body.user.id],
      );
      expect(sessions.rowCount).toBeGreaterThan(0);

      const events = await agent.get("/api/events");
      expect(events.status).toBe(200);
      expect(Array.isArray(events.body.events)).toBe(true);

      const logout = await agent.post("/api/auth/logout");
      expect(logout.status).toBe(200);
      expect((await agent.get("/api/auth/me")).status).toBe(401);
    } finally {
      const account = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (account) {
        await pool.query('DELETE FROM "session" WHERE sess ->> \'userId\' = $1', [account.id]);
        await prisma.user.deleteMany({ where: { id: account.id, email } });
      }
      expect(await prisma.user.findUnique({ where: { email }, select: { id: true } })).toBeNull();
    }
  }, 30_000);
});
