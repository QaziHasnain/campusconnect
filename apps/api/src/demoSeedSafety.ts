const safeDemoDatabaseNames = new Set([
  "campusconnect_demo",
  "campusconnect_test",
]);
const localDatabaseHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function getSafeDemoDatabaseName(
  databaseUrl: string,
  enabledFlag: string | undefined,
  acknowledgedDatabaseName: string | undefined,
): string {
  if (enabledFlag !== "true") {
    throw new Error("Set DEMO_SEED_ENABLED=true to explicitly enable demo data seeding");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("Demo seeding requires a valid PostgreSQL database URL");
  }

  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw new Error("Demo seeding requires a PostgreSQL database");
  }
  if (!localDatabaseHosts.has(parsedUrl.hostname)) {
    throw new Error("Demo seeding is permitted only for a local PostgreSQL database");
  }

  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  if (!safeDemoDatabaseNames.has(databaseName)) {
    throw new Error("The database name is not on the demo-seeding allowlist");
  }
  if (acknowledgedDatabaseName !== databaseName) {
    throw new Error("Set DEMO_SEED_DATABASE_NAME to exactly match the approved local database name");
  }

  return databaseName;
}
