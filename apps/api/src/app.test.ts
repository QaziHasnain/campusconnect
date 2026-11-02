import { beforeAll, describe, expect, it, vi } from "vitest";

describe("API", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/campusconnect";
    process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
    process.env.FRONTEND_ORIGIN = "http://localhost:5173";
  });

  it("returns a JSON health response with security and CORS headers", async () => {
    const request = (await import("supertest")).default;
    const { createApp } = await import("./app.js");
    const { MemoryStore } = await import("express-session");
    const app = createApp({
      sessionStore: new MemoryStore(),
      authRepository: {
        findByEmail: vi.fn(),
        findById: vi.fn(),
        create: vi.fn(),
        storePasswordResetToken: vi.fn(),
        resetPassword: vi.fn(),
      },
    });
    const response = await request(app)
      .get("/api/health")
      .set("Origin", "http://localhost:5173");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");

    const fallbackPortResponse = await request(app)
      .get("/api/health")
      .set("Origin", "http://localhost:5174");
    expect(fallbackPortResponse.headers["access-control-allow-origin"])
      .toBe("http://localhost:5174");

    const externalOriginResponse = await request(app)
      .get("/api/health")
      .set("Origin", "https://example.com");
    expect(externalOriginResponse.headers["access-control-allow-origin"]).toBeUndefined();
  }, 15_000);

  it("rejects cross-origin state-changing requests while allowing the configured frontend", async () => {
    const request = (await import("supertest")).default;
    const { createApp } = await import("./app.js");
    const { MemoryStore } = await import("express-session");
    const app = createApp({
      sessionStore: new MemoryStore(),
      authRepository: {
        findByEmail: vi.fn(),
        findById: vi.fn(),
        create: vi.fn(),
        storePasswordResetToken: vi.fn(),
        resetPassword: vi.fn(),
      },
    });

    const rejected = await request(app)
      .post("/api/auth/logout")
      .set("Origin", "https://attacker.example");
    expect(rejected.status).toBe(403);

    const rejectedFetchMetadata = await request(app)
      .post("/api/auth/logout")
      .set("Sec-Fetch-Site", "cross-site");
    expect(rejectedFetchMetadata.status).toBe(403);

    const allowed = await request(app)
      .post("/api/auth/logout")
      .set("Origin", "http://localhost:5173");
    expect(allowed.status).toBe(200);
  });
});
