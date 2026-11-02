import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./env.js";
import { getPaymentConfiguration } from "./payments.js";

const requiredEnvironment = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/campusconnect",
  SESSION_SECRET: "test-session-secret-that-is-long-enough",
};

function paymentConfiguration(environment: ReturnType<typeof parseEnvironment>) {
  if (!environment.success) throw new Error("Test environment should be valid");
  return getPaymentConfiguration({
    mode: environment.data.RAZORPAY_MODE,
    keyId: environment.data.RAZORPAY_KEY_ID ?? null,
    keySecret: environment.data.RAZORPAY_KEY_SECRET ?? null,
    webhookSecret: environment.data.RAZORPAY_WEBHOOK_SECRET ?? null,
  });
}

describe("Razorpay environment validation", () => {
  it("allows the API to start when Razorpay credentials are absent", () => {
    const parsed = parseEnvironment(requiredEnvironment);

    expect(parsed.success).toBe(true);
    expect(paymentConfiguration(parsed).enabled).toBe(false);
  });

  it("accepts configured test credentials and enables test checkout", () => {
    const parsed = parseEnvironment({
      ...requiredEnvironment,
      RAZORPAY_MODE: "test",
      RAZORPAY_KEY_ID: "rzp_test_regression_key_id",
      RAZORPAY_KEY_SECRET: "regression-test-secret",
      RAZORPAY_WEBHOOK_SECRET: "regression-webhook-secret",
    });

    expect(parsed.success).toBe(true);
    expect(paymentConfiguration(parsed)).toMatchObject({
      enabled: true,
      keyId: "rzp_test_regression_key_id",
      mode: "test",
    });
  });
});
