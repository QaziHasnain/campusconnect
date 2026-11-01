import { describe, expect, it } from "vitest";
import { getSafeDemoDatabaseName } from "./demoSeedSafety.js";

describe("demo seed database safety", () => {
  it("requires the explicit enable flag", () => {
    expect(() =>
      getSafeDemoDatabaseName(
        "postgresql://localhost:5432/campusconnect_demo",
        undefined,
        "campusconnect_demo",
      ),
    ).toThrow("DEMO_SEED_ENABLED=true");
  });

  it("rejects remote hosts and non-allowlisted database names", () => {
    expect(() =>
      getSafeDemoDatabaseName(
        "postgresql://example.invalid:5432/CampusConnect",
        "true",
        "CampusConnect",
      ),
    ).toThrow("local PostgreSQL");
    expect(() =>
      getSafeDemoDatabaseName(
        "postgresql://localhost:5432/production",
        "true",
        "production",
      ),
    ).toThrow("allowlist");
  });

  it("requires a matching database acknowledgement and accepts an approved local target", () => {
    expect(() =>
      getSafeDemoDatabaseName(
        "postgresql://localhost:5432/campusconnect_demo",
        "true",
        "campusconnect_test",
      ),
    ).toThrow("DEMO_SEED_DATABASE_NAME");

    expect(
      getSafeDemoDatabaseName(
        "postgresql://localhost:5432/campusconnect_demo",
        "true",
        "campusconnect_demo",
      ),
    ).toBe("campusconnect_demo");
  });
});
