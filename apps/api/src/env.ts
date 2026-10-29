import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .url()
    .refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol), {
      message: "DATABASE_URL must use the postgres or postgresql protocol",
    }),
  SESSION_SECRET: z.string().min(32),
  FRONTEND_ORIGIN: z.url().default("http://localhost:5173"),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  throw new Error(`Invalid environment configuration: ${z.prettifyError(parsedEnvironment.error)}`);
}

export const env = {
  nodeEnv: parsedEnvironment.data.NODE_ENV,
  port: parsedEnvironment.data.PORT,
  databaseUrl: parsedEnvironment.data.DATABASE_URL,
  sessionSecret: parsedEnvironment.data.SESSION_SECRET,
  frontendOrigin: parsedEnvironment.data.FRONTEND_ORIGIN,
};
