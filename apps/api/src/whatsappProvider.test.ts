import { describe, expect, it, vi } from "vitest";
import {
  createTwilioWhatsAppProvider,
  createWhatsAppProvider,
  WhatsAppDeliveryError,
} from "./whatsappProvider.js";

const configuration = {
  accessToken: "private-token-for-test",
  phoneNumberId: "123456789",
  graphApiVersion: "v99.0",
  templateName: "campus_event_reminder",
  templateLanguage: "en",
};

const template = {
  studentName: "A student",
  eventName: "A campus event",
  eventDate: "November 10, 2026",
  eventTime: "10:00 AM UTC",
  venue: "Campus Hall",
  eventDetailsUrl: "https://campus.example/events/event-1",
};

const twilioConfiguration = {
  accountSid: `AC${"0".repeat(32)}`,
  authToken: "test-auth-token",
  from: "+14155238886",
  contentSid: `HX${"1".repeat(32)}`,
};

describe("Meta WhatsApp Cloud API provider", () => {
  it("uses the configured HTTPS Graph API version and approved template parameters", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(new URL(String(input)).protocol).toBe("https:");
      expect(String(input)).toBe("https://graph.facebook.com/v99.0/123456789/messages");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${configuration.accessToken}`,
      );
      const body = JSON.parse(String(init?.body)) as {
        type: string;
        template: { name: string; language: { code: string }; components: Array<{ parameters: Array<{ text: string }> }> };
      };
      expect(body.type).toBe("template");
      expect(body.template.name).toBe("campus_event_reminder");
      expect(body.template.language.code).toBe("en");
      expect(body.template.components[0].parameters.map(({ text }) => text)).toEqual([
        template.studentName,
        template.eventName,
        template.eventDate,
        template.eventTime,
        template.venue,
        template.eventDetailsUrl,
      ]);
      return new Response(JSON.stringify({ messages: [{ id: "wamid.test-message" }] }), {
        status: 200,
      });
    });

    await expect(
      createWhatsAppProvider(configuration, fetchMock).sendTemplate("+14155550132", template),
    ).resolves.toBe("wamid.test-message");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.signal).toBeDefined();
  });

  it("classifies rate limits as temporary without retaining provider response details", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ error: { message: "private provider detail" } }),
      { status: 429, headers: { "Retry-After": "30" } },
    ));

    let deliveryError: unknown;
    try {
      await createWhatsAppProvider(configuration, fetchMock).sendTemplate("+14155550132", template);
    } catch (error) {
      deliveryError = error;
    }

    expect(deliveryError).toBeInstanceOf(WhatsAppDeliveryError);
    expect(deliveryError).toMatchObject({
      code: "PROVIDER_HTTP_429",
      temporary: true,
      retryAfterSeconds: 30,
    });
    expect(String(deliveryError)).not.toContain("private provider detail");
    expect(String(deliveryError)).not.toContain(configuration.accessToken);
  });

  it("treats a permanent provider rejection as non-retryable", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("no details", { status: 400 }));
    await expect(
      createWhatsAppProvider(configuration, fetchMock).sendTemplate("+14155550132", template),
    ).rejects.toMatchObject({ code: "PROVIDER_HTTP_400", temporary: false });
  });
});

describe("Twilio WhatsApp provider", () => {
  it("posts the approved Sandbox template using the two appointment variables", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(new URL(String(input)).protocol).toBe("https:");
      expect(String(input)).toBe(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioConfiguration.accountSid}/Messages.json`,
      );
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Basic ${Buffer.from(
          `${twilioConfiguration.accountSid}:${twilioConfiguration.authToken}`,
        ).toString("base64")}`,
      );
      expect(new Headers(init?.headers).get("Content-Type")).toBe(
        "application/x-www-form-urlencoded",
      );
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("From")).toBe("whatsapp:+14155238886");
      expect(body.get("To")).toBe("whatsapp:+14155550132");
      expect(body.get("ContentSid")).toBe(twilioConfiguration.contentSid);
      expect(JSON.parse(body.get("ContentVariables") ?? "{}")).toEqual({
        "1": template.eventDate,
        "2": template.eventTime,
      });
      return new Response(JSON.stringify({ sid: "SMtest-message" }), { status: 201 });
    });

    await expect(
      createTwilioWhatsAppProvider(twilioConfiguration, fetchMock).sendTemplate(
        "+14155550132",
        template,
      ),
    ).resolves.toBe("SMtest-message");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.signal).toBeDefined();
  });

  it("sanitizes Twilio rejections and applies retry metadata", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ message: "private provider detail" }),
      { status: 429, headers: { "Retry-After": "30" } },
    ));

    let deliveryError: unknown;
    try {
      await createTwilioWhatsAppProvider(twilioConfiguration, fetchMock).sendTemplate(
        "+14155550132",
        template,
      );
    } catch (error) {
      deliveryError = error;
    }

    expect(deliveryError).toBeInstanceOf(WhatsAppDeliveryError);
    expect(deliveryError).toMatchObject({
      code: "PROVIDER_HTTP_429",
      temporary: true,
      retryAfterSeconds: 30,
    });
    expect(String(deliveryError)).not.toContain("private provider detail");
    expect(String(deliveryError)).not.toContain(twilioConfiguration.authToken);
  });
});
