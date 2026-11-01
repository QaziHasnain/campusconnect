export interface WhatsAppTemplateMessage {
  studentName: string;
  eventName: string;
  eventDate: string;
  eventTime: string;
  venue: string;
  eventDetailsUrl: string;
}

export interface WhatsAppProviderConfiguration {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  templateName: string;
  templateLanguage: string;
}

export interface TwilioWhatsAppProviderConfiguration {
  accountSid: string;
  authToken: string;
  from: string;
  contentSid: string;
}

export class WhatsAppDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly temporary: boolean,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = "WhatsAppDeliveryError";
  }
}

interface WhatsAppProviderResponse {
  messages?: Array<{ id?: string }>;
}

interface TwilioWhatsAppProviderResponse {
  sid?: string;
}

function getRetryAfterSeconds(response: Response): number | null {
  const retryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter, 3600)
    : null;
}

function normalizeWhatsAppAddress(address: string): string {
  return address.startsWith("whatsapp:") ? address : `whatsapp:${address}`;
}

export function createWhatsAppProvider(
  configuration: WhatsAppProviderConfiguration,
  fetchImplementation: typeof fetch = fetch,
) {
  return {
    async sendTemplate(
      recipient: string,
      message: WhatsAppTemplateMessage,
    ): Promise<string> {
      const endpoint = new URL(
        `https://graph.facebook.com/${configuration.graphApiVersion}/${encodeURIComponent(configuration.phoneNumberId)}/messages`,
      );
      let response: Response;
      try {
        response = await fetchImplementation(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: {
            Authorization: `Bearer ${configuration.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipient,
            type: "template",
            template: {
              name: configuration.templateName,
              language: { code: configuration.templateLanguage },
              components: [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: message.studentName },
                    { type: "text", text: message.eventName },
                    { type: "text", text: message.eventDate },
                    { type: "text", text: message.eventTime },
                    { type: "text", text: message.venue },
                    { type: "text", text: message.eventDetailsUrl },
                  ],
                },
              ],
            },
          }),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") {
          throw new WhatsAppDeliveryError("PROVIDER_TIMEOUT", true);
        }
        throw new WhatsAppDeliveryError("PROVIDER_NETWORK_ERROR", true);
      }

      if (!response.ok) {
        const temporary = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new WhatsAppDeliveryError(
          `PROVIDER_HTTP_${response.status}`,
          temporary,
          temporary ? getRetryAfterSeconds(response) : null,
        );
      }

      let result: WhatsAppProviderResponse;
      try {
        result = await response.json() as WhatsAppProviderResponse;
      } catch {
        throw new WhatsAppDeliveryError("PROVIDER_RESPONSE_INVALID", false);
      }
      const messageId = result.messages?.[0]?.id;
      if (!messageId) {
        throw new WhatsAppDeliveryError("PROVIDER_MESSAGE_ID_MISSING", false);
      }
      return messageId;
    },
  };
}

export function createTwilioWhatsAppProvider(
  configuration: TwilioWhatsAppProviderConfiguration,
  fetchImplementation: typeof fetch = fetch,
) {
  return {
    async sendTemplate(
      recipient: string,
      message: WhatsAppTemplateMessage,
    ): Promise<string> {
      const endpoint = new URL(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(configuration.accountSid)}/Messages.json`,
      );
      const body = new URLSearchParams({
        From: normalizeWhatsAppAddress(configuration.from),
        To: normalizeWhatsAppAddress(recipient),
        ContentSid: configuration.contentSid,
        ContentVariables: JSON.stringify({
          "1": message.eventDate,
          "2": message.eventTime,
        }),
      });

      let response: Response;
      try {
        response = await fetchImplementation(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${configuration.accountSid}:${configuration.authToken}`,
            ).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") {
          throw new WhatsAppDeliveryError("PROVIDER_TIMEOUT", true);
        }
        throw new WhatsAppDeliveryError("PROVIDER_NETWORK_ERROR", true);
      }

      if (!response.ok) {
        const temporary = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new WhatsAppDeliveryError(
          `PROVIDER_HTTP_${response.status}`,
          temporary,
          temporary ? getRetryAfterSeconds(response) : null,
        );
      }

      let result: TwilioWhatsAppProviderResponse;
      try {
        result = await response.json() as TwilioWhatsAppProviderResponse;
      } catch {
        throw new WhatsAppDeliveryError("PROVIDER_RESPONSE_INVALID", false);
      }
      if (!result.sid) {
        throw new WhatsAppDeliveryError("PROVIDER_MESSAGE_ID_MISSING", false);
      }
      return result.sid;
    },
  };
}
