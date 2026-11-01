import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const optionalNonEmptyString = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

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
  SMTP_HOST: optionalNonEmptyString,
  SMTP_PORT: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(1).max(65535).optional(),
  ),
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  SMTP_USER: optionalNonEmptyString,
  SMTP_PASSWORD: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  SMTP_FROM: optionalNonEmptyString,
}).superRefine((configuration, context) => {
  const smtpValues = [
    configuration.SMTP_HOST,
    configuration.SMTP_PORT,
    configuration.SMTP_USER,
    configuration.SMTP_PASSWORD,
    configuration.SMTP_FROM,
  ];
  const hasSmtpConfiguration = smtpValues.some((value) => value !== undefined);
  const hasIncompleteSmtpConfiguration = smtpValues.some((value) => value === undefined);
  if (hasSmtpConfiguration && hasIncompleteSmtpConfiguration) {
    context.addIssue({
      code: "custom",
      path: ["SMTP_HOST"],
      message:
        "SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM must be configured together",
    });
  }
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
  smtp:
    parsedEnvironment.data.SMTP_HOST &&
    parsedEnvironment.data.SMTP_PORT &&
    parsedEnvironment.data.SMTP_USER &&
    parsedEnvironment.data.SMTP_PASSWORD &&
    parsedEnvironment.data.SMTP_FROM
      ? {
          host: parsedEnvironment.data.SMTP_HOST,
          port: parsedEnvironment.data.SMTP_PORT,
          secure: parsedEnvironment.data.SMTP_SECURE,
          user: parsedEnvironment.data.SMTP_USER,
          password: parsedEnvironment.data.SMTP_PASSWORD,
          from: parsedEnvironment.data.SMTP_FROM,
        }
      : null,
};
