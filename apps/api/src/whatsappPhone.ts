import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export function normalizeWhatsAppPhoneNumber(value: string): string | null {
  const input = value.trim();
  if (!input) return null;
  if (!input.startsWith("+") && !input.startsWith("00")) return null;
  if (!/^\+?[\d\s().-]+$/.test(input)) return null;

  const internationalInput = input.startsWith("00")
    ? `+${input.slice(2)}`
    : input;
  const parsed = parsePhoneNumberFromString(internationalInput);
  if (!parsed?.isValid()) return null;

  return parsed.number;
}
