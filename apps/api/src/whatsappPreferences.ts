import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { UserRole, type PrismaClient } from "./generated/prisma/client.js";
import { env } from "./env.js";
import { normalizeWhatsAppPhoneNumber } from "./whatsappPhone.js";

export interface WhatsAppPreferences {
  phoneNumber: string | null;
  consent: boolean;
  consentGrantedAt: Date | null;
}

export interface WhatsAppPreferencesRepository {
  findStudentPreferences(userId: string): Promise<
    | { role: UserRole; preferences: WhatsAppPreferences }
    | { role: UserRole }
    | null
  >;
  updateStudentPreferences(
    userId: string,
    preferences: { phoneNumber: string | null; consent: boolean },
  ): Promise<WhatsAppPreferences | null>;
}

export function createPrismaWhatsAppPreferencesRepository(
  prisma: PrismaClient,
): WhatsAppPreferencesRepository {
  return {
    async findStudentPreferences(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          whatsAppPhoneNumber: true,
          whatsAppConsent: true,
          whatsAppConsentAt: true,
        },
      });
      if (!user) return null;
      return {
        role: user.role,
        preferences: {
          phoneNumber: user.whatsAppPhoneNumber,
          consent: user.whatsAppConsent,
          consentGrantedAt: user.whatsAppConsentAt,
        },
      };
    },
    async updateStudentPreferences(userId, preferences) {
      const current = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, whatsAppConsent: true },
      });
      if (!current || current.role !== UserRole.STUDENT) return null;

      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          whatsAppPhoneNumber: preferences.phoneNumber,
          whatsAppConsent: preferences.consent,
          ...(preferences.consent
            ? {
                ...(current.whatsAppConsent ? {} : { whatsAppConsentAt: new Date() }),
                whatsAppWithdrawnAt: null,
              }
            : current.whatsAppConsent
              ? { whatsAppWithdrawnAt: new Date() }
              : {}),
        },
        select: {
          whatsAppPhoneNumber: true,
          whatsAppConsent: true,
          whatsAppConsentAt: true,
        },
      });

      return {
        phoneNumber: updated.whatsAppPhoneNumber,
        consent: updated.whatsAppConsent,
        consentGrantedAt: updated.whatsAppConsentAt,
      };
    },
  };
}

const updatePreferencesSchema = z.object({
  phoneNumber: z.string().trim().max(40),
  consent: z.boolean(),
}).strict();

function sendServerError(response: Response, _error: unknown) {
  console.error("WhatsApp preference request failed");
  return response.status(500).json({ error: "WhatsApp preferences are unavailable" });
}

function toResponse(preferences: WhatsAppPreferences) {
  return {
    enabled: env.whatsapp.enabled,
    phoneNumber: preferences.phoneNumber,
    consent: preferences.consent,
    consentGrantedAt: preferences.consentGrantedAt,
  };
}

export function createWhatsAppPreferencesRouter(repository: WhatsAppPreferencesRepository) {
  const router = Router();

  router.get("/", async (request: Request, response: Response) => {
    const userId = request.session.userId;
    if (!userId) return response.status(401).json({ error: "Authentication required" });

    try {
      const result = await repository.findStudentPreferences(userId);
      if (!result) return response.status(401).json({ error: "Authentication required" });
      if (result.role !== UserRole.STUDENT) {
        return response.status(403).json({ error: "Student role required" });
      }
      if (!("preferences" in result)) {
        return response.status(500).json({ error: "WhatsApp preferences are unavailable" });
      }
      return response.json(toResponse(result.preferences));
    } catch (error) {
      return sendServerError(response, error);
    }
  });

  router.put("/", async (request: Request, response: Response) => {
    const userId = request.session.userId;
    if (!userId) return response.status(401).json({ error: "Authentication required" });

    const parsed = updatePreferencesSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: "Invalid WhatsApp preferences",
        details: z.treeifyError(parsed.error),
      });
    }

    const phoneNumber = normalizeWhatsAppPhoneNumber(parsed.data.phoneNumber);
    if (parsed.data.phoneNumber && !phoneNumber) {
      return response.status(400).json({ error: "Enter a valid international phone number" });
    }
    if (parsed.data.consent && !phoneNumber) {
      return response.status(400).json({ error: "A valid phone number is required to opt in" });
    }

    try {
      const result = await repository.updateStudentPreferences(userId, {
        phoneNumber,
        consent: parsed.data.consent,
      });
      if (!result) return response.status(403).json({ error: "Student role required" });
      return response.json(toResponse(result));
    } catch (error) {
      return sendServerError(response, error);
    }
  });

  return router;
}
