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
  RAZORPAY_MODE: z.enum(["test", "live"]).default("test"),
  RAZORPAY_KEY_ID: optionalNonEmptyString,
  RAZORPAY_KEY_SECRET: optionalNonEmptyString,
  RAZORPAY_WEBHOOK_SECRET: optionalNonEmptyString,
  SMTP_HOST: optionalNonEmptyString,
  SMTP_PORT: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(1).max(65535).optional(),
  ),
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  SMTP_USER: optionalNonEmptyString,
  SMTP_PASSWORD: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  SMTP_FROM: optionalNonEmptyString,
  WHATSAPP_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  WHATSAPP_PROVIDER: z.enum(["meta", "twilio"]).default("meta"),
  WHATSAPP_ACCESS_TOKEN: optionalNonEmptyString,
  WHATSAPP_PHONE_NUMBER_ID: optionalNonEmptyString,
  WHATSAPP_GRAPH_API_VERSION: optionalNonEmptyString,
  WHATSAPP_TEMPLATE_NAME: optionalNonEmptyString,
  WHATSAPP_TEMPLATE_LANGUAGE: optionalNonEmptyString,
  WHATSAPP_TWILIO_ACCOUNT_SID: optionalNonEmptyString,
  WHATSAPP_TWILIO_AUTH_TOKEN: optionalNonEmptyString,
  WHATSAPP_TWILIO_FROM: optionalNonEmptyString,
  WHATSAPP_TWILIO_CONTENT_SID: optionalNonEmptyString,
  WHATSAPP_REMINDER_OFFSETS_HOURS: z.string().default("24,1").transform((value, context) => {
    const offsets = value.split(",").map((offset) => Number(offset.trim()));
    if (
      offsets.length !== 2 ||
      offsets.some((offset) => !Number.isSafeInteger(offset) || offset <= 0) ||
      new Set(offsets).size !== offsets.length
    ) {
      context.addIssue({
        code: "custom",
        message: "WHATSAPP_REMINDER_OFFSETS_HOURS must contain two distinct positive integers",
      });
      return [];
    }
    return offsets;
  }),
  PUSH_VAPID_PUBLIC_KEY: optionalNonEmptyString,
  PUSH_VAPID_PRIVATE_KEY: optionalNonEmptyString,
  PUSH_VAPID_SUBJECT: optionalNonEmptyString,
  PUSH_SUBSCRIPTION_ENCRYPTION_KEY: optionalNonEmptyString,
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

  const metaWhatsAppValues = [
    configuration.WHATSAPP_ACCESS_TOKEN,
    configuration.WHATSAPP_PHONE_NUMBER_ID,
    configuration.WHATSAPP_GRAPH_API_VERSION,
    configuration.WHATSAPP_TEMPLATE_NAME,
    configuration.WHATSAPP_TEMPLATE_LANGUAGE,
  ];
  const twilioWhatsAppValues = [
    configuration.WHATSAPP_TWILIO_ACCOUNT_SID,
    configuration.WHATSAPP_TWILIO_AUTH_TOKEN,
    configuration.WHATSAPP_TWILIO_FROM,
    configuration.WHATSAPP_TWILIO_CONTENT_SID,
  ];
  const requiredWhatsAppValues =
    configuration.WHATSAPP_PROVIDER === "twilio"
      ? twilioWhatsAppValues
      : metaWhatsAppValues;
  if (configuration.WHATSAPP_ENABLED && requiredWhatsAppValues.some((value) => value === undefined)) {
    context.addIssue({
      code: "custom",
      path: ["WHATSAPP_ENABLED"],
      message: `All ${configuration.WHATSAPP_PROVIDER} WhatsApp provider and template values are required when WhatsApp is enabled`,
    });
  }
  if (
    configuration.WHATSAPP_GRAPH_API_VERSION &&
    !/^v\d+\.\d+$/.test(configuration.WHATSAPP_GRAPH_API_VERSION)
  ) {
    context.addIssue({
      code: "custom",
      path: ["WHATSAPP_GRAPH_API_VERSION"],
      message: "WHATSAPP_GRAPH_API_VERSION must look like vXX.X",
    });
  }

  const pushValues = [
    configuration.PUSH_VAPID_PUBLIC_KEY,
    configuration.PUSH_VAPID_PRIVATE_KEY,
    configuration.PUSH_VAPID_SUBJECT,
    configuration.PUSH_SUBSCRIPTION_ENCRYPTION_KEY,
  ];
  if (pushValues.some((value) => value !== undefined) && pushValues.some((value) => value === undefined)) {
    context.addIssue({
      code: "custom",
      path: ["PUSH_VAPID_PUBLIC_KEY"],
      message: "VAPID keys, subject, and subscription encryption key must be configured together",
    });
  }
  if (configuration.PUSH_SUBSCRIPTION_ENCRYPTION_KEY) {
    const key = Buffer.from(configuration.PUSH_SUBSCRIPTION_ENCRYPTION_KEY, "base64");
    if (
      key.length !== 32 ||
      key.toString("base64").replace(/=+$/, "") !==
        configuration.PUSH_SUBSCRIPTION_ENCRYPTION_KEY.replace(/=+$/, "")
    ) {
      context.addIssue({
        code: "custom",
        path: ["PUSH_SUBSCRIPTION_ENCRYPTION_KEY"],
        message: "PUSH_SUBSCRIPTION_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
      });
    }
  }
});

export function parseEnvironment(environment: NodeJS.ProcessEnv) {
  return environmentSchema.safeParse(environment);
}

const parsedEnvironment = parseEnvironment(process.env);

if (!parsedEnvironment.success) {
  throw new Error(`Invalid environment configuration: ${z.prettifyError(parsedEnvironment.error)}`);
}

export const env = {
  nodeEnv: parsedEnvironment.data.NODE_ENV,
  port: parsedEnvironment.data.PORT,
  databaseUrl: parsedEnvironment.data.DATABASE_URL,
  sessionSecret: parsedEnvironment.data.SESSION_SECRET,
  frontendOrigin: parsedEnvironment.data.FRONTEND_ORIGIN,
  razorpay: {
    mode: parsedEnvironment.data.RAZORPAY_MODE,
    keyId: parsedEnvironment.data.RAZORPAY_KEY_ID ?? null,
    keySecret: parsedEnvironment.data.RAZORPAY_KEY_SECRET ?? null,
    webhookSecret: parsedEnvironment.data.RAZORPAY_WEBHOOK_SECRET ?? null,
  },
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
  whatsapp: {
    enabled: parsedEnvironment.data.WHATSAPP_ENABLED,
    provider: parsedEnvironment.data.WHATSAPP_PROVIDER,
    accessToken: parsedEnvironment.data.WHATSAPP_ACCESS_TOKEN ?? null,
    phoneNumberId: parsedEnvironment.data.WHATSAPP_PHONE_NUMBER_ID ?? null,
    graphApiVersion: parsedEnvironment.data.WHATSAPP_GRAPH_API_VERSION ?? null,
    templateName: parsedEnvironment.data.WHATSAPP_TEMPLATE_NAME ?? null,
    templateLanguage: parsedEnvironment.data.WHATSAPP_TEMPLATE_LANGUAGE ?? null,
    twilio: {
      accountSid: parsedEnvironment.data.WHATSAPP_TWILIO_ACCOUNT_SID ?? null,
      authToken: parsedEnvironment.data.WHATSAPP_TWILIO_AUTH_TOKEN ?? null,
      from: parsedEnvironment.data.WHATSAPP_TWILIO_FROM ?? null,
      contentSid: parsedEnvironment.data.WHATSAPP_TWILIO_CONTENT_SID ?? null,
    },
    reminderOffsetsHours: parsedEnvironment.data.WHATSAPP_REMINDER_OFFSETS_HOURS,
  },
  push:
    parsedEnvironment.data.PUSH_VAPID_PUBLIC_KEY &&
    parsedEnvironment.data.PUSH_VAPID_PRIVATE_KEY &&
    parsedEnvironment.data.PUSH_VAPID_SUBJECT &&
    parsedEnvironment.data.PUSH_SUBSCRIPTION_ENCRYPTION_KEY
      ? {
          vapidPublicKey: parsedEnvironment.data.PUSH_VAPID_PUBLIC_KEY,
          vapidPrivateKey: parsedEnvironment.data.PUSH_VAPID_PRIVATE_KEY,
          vapidSubject: parsedEnvironment.data.PUSH_VAPID_SUBJECT,
          subscriptionEncryptionKey: Buffer.from(
            parsedEnvironment.data.PUSH_SUBSCRIPTION_ENCRYPTION_KEY,
            "base64",
          ),
        }
      : null,
};
