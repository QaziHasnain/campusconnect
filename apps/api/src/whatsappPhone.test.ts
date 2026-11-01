import { describe, expect, it } from "vitest";
import { normalizeWhatsAppPhoneNumber } from "./whatsappPhone.js";

describe("WhatsApp phone number normalization", () => {
  it("normalizes formatted international numbers to E.164", () => {
    expect(normalizeWhatsAppPhoneNumber("+1 (415) 555-0132")).toBe("+14155550132");
    expect(normalizeWhatsAppPhoneNumber("0044 20 7946 0958")).toBe("+442079460958");
    expect(normalizeWhatsAppPhoneNumber("+919876543210")).toBe("+919876543210");
  });

  it("allows an empty optional number and rejects invalid or local-only numbers", () => {
    expect(normalizeWhatsAppPhoneNumber("")).toBeNull();
    expect(normalizeWhatsAppPhoneNumber("415-555-0132")).toBeNull();
    expect(normalizeWhatsAppPhoneNumber("+0123456789")).toBeNull();
    expect(normalizeWhatsAppPhoneNumber("+1234567")).toBeNull();
    expect(normalizeWhatsAppPhoneNumber("+1234567890123456")).toBeNull();
    expect(normalizeWhatsAppPhoneNumber("+1 415 ext. 32")).toBeNull();
  });
});
