import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runDatabaseIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === "true";

describe.skipIf(!runDatabaseIntegrationTests)("Auth API with PostgreSQL", () => {
  let app: import("express").Express;
  let prisma: typeof import("./prisma.js").prisma;
  let pool: typeof import("./db.js").pool;
  const email = `auth-integration-${Date.now()}@example.com`;
  const password = "integration-test-password";

  beforeAll(async () => {
    [{ app }, { prisma }, { pool }] = await Promise.all([
      import("./app.js"),
      import("./prisma.js"),
      import("./db.js"),
    ]);
  });

  afterAll(async () => {
    if (prisma && pool) {
      await prisma.user.deleteMany({ where: { email } });
      await prisma.$disconnect();
      await pool.end();
    }
  });

  it("persists registration and PostgreSQL sessions through login, current-user lookup, and logout", async () => {
    const request = (await import("supertest")).default;
    const agent = request.agent(app);
    const registration = await agent.post("/api/auth/register").send({
      name: "Integration User",
      email,
      password,
      role: "STUDENT",
    });

    expect(registration.status).toBe(201);
    expect(registration.body.user).not.toHaveProperty("passwordHash");

    const login = await agent.post("/api/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    expect((await agent.get("/api/auth/me")).body.user.email).toBe(email);

    expect((await agent.post("/api/auth/logout")).status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });
});
