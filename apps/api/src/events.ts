import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  EventCategory,
  EventPaymentStatus,
  EventStatus,
  UserRole,
  type Prisma,
  type PrismaClient,
} from "./generated/prisma/client.js";
import { queueEventUpdateNotifications } from "./notifications.js";

const eventSelect = {
  id: true,
  title: true,
  description: true,
  category: true,
  venue: true,
  startAt: true,
  endAt: true,
  organizerId: true,
  status: true,
  capacity: true,
  venueAddress: true,
  latitude: true,
  longitude: true,
  ticketPricePaise: true,
  createdAt: true,
  updatedAt: true,
  organizer: { select: { name: true } },
} satisfies Prisma.EventSelect;

export type EventRecord = Prisma.EventGetPayload<{ select: typeof eventSelect }>;
export type PublicEvent = Omit<EventRecord, "organizerId">;

const registrationSelect = {
  id: true,
  userId: true,
  eventId: true,
  createdAt: true,
} satisfies Prisma.RegistrationSelect;

export type RegistrationRecord = Prisma.RegistrationGetPayload<{
  select: typeof registrationSelect;
}>;
const registrationWithEventSelect = {
  id: true,
  eventId: true,
  createdAt: true,
  event: { select: eventSelect },
} satisfies Prisma.RegistrationSelect;

export type RegistrationWithEventRecord = Prisma.RegistrationGetPayload<{
  select: typeof registrationWithEventSelect;
}>;
export type RegistrationResult =
  | { status: "created"; registration: RegistrationRecord }
  | { status: "not_found" }
  | { status: "duplicate" }
  | { status: "capacity_reached" }
  | { status: "paid_event" };

export interface EventCreateData {
  title: string;
  description: string;
  category: EventCategory;
  venue: string;
  startAt: Date;
  endAt: Date | null;
  organizerId: string;
  status: EventStatus;
  capacity: number | null;
  venueAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  ticketPricePaise: number | null;
}

export type EventUpdateData = Partial<
  Pick<
    EventCreateData,
    | "title"
    | "description"
    | "category"
    | "venue"
    | "venueAddress"
    | "latitude"
    | "longitude"
    | "ticketPricePaise"
    | "startAt"
    | "endAt"
    | "status"
    | "capacity"
  >
>;

interface EventFilters {
  category?: EventCategory;
  search?: string;
}

export interface EventRepository {
  listPublished(filters: EventFilters): Promise<EventRecord[]>;
  listOwned(organizerId: string): Promise<EventRecord[]>;
  findPublishedById(id: string): Promise<EventRecord | null>;
  findById(id: string): Promise<EventRecord | null>;
  findUserRole(userId: string): Promise<UserRole | null>;
  registerForEvent(eventId: string, userId: string): Promise<RegistrationResult>;
  findRegistrationStatus(eventId: string, userId: string): Promise<boolean | null>;
  listUserRegistrations(userId: string): Promise<RegistrationWithEventRecord[]>;
  create(data: EventCreateData): Promise<EventRecord>;
  updateOwned(id: string, organizerId: string, data: EventUpdateData): Promise<EventRecord | null>;
  deleteOwned(id: string, organizerId: string): Promise<boolean>;
}

export function createPrismaEventRepository(prisma: PrismaClient): EventRepository {
  return {
    listPublished: (filters) =>
      prisma.event.findMany({
        where: {
          status: EventStatus.PUBLISHED,
          ...(filters.category ? { category: filters.category } : {}),
          ...(filters.search
            ? {
                OR: [
                  { title: { contains: filters.search, mode: "insensitive" } },
                  { description: { contains: filters.search, mode: "insensitive" } },
                  { venue: { contains: filters.search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { startAt: "asc" },
        select: eventSelect,
      }),
    listOwned: (organizerId) =>
      prisma.event.findMany({
        where: { organizerId },
        orderBy: { startAt: "asc" },
        select: eventSelect,
      }),
    findPublishedById: (id) =>
      prisma.event.findFirst({
        where: { id, status: EventStatus.PUBLISHED },
        select: eventSelect,
      }),
    findById: (id) => prisma.event.findUnique({ where: { id }, select: eventSelect }),
    findUserRole: async (userId) =>
      (await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role ?? null,
    registerForEvent: (eventId, userId) =>
      prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE
        `;

        const event = await transaction.event.findUnique({
          where: { id: eventId },
          select: { status: true, capacity: true, ticketPricePaise: true },
        });
        if (!event || event.status !== EventStatus.PUBLISHED) return { status: "not_found" };
        if (event.ticketPricePaise !== null) return { status: "paid_event" };

        const existing = await transaction.registration.findUnique({
          where: { userId_eventId: { userId, eventId } },
          select: { id: true },
        });
        if (existing) return { status: "duplicate" };

        const registrationCount = await transaction.registration.count({ where: { eventId } });
        const activePaymentReservations = await transaction.eventPaymentAttempt.count({
          where: {
            eventId,
            status: { in: [EventPaymentStatus.PENDING, EventPaymentStatus.CANCELLED] },
            expiresAt: { gt: new Date() },
          },
        });
        if (
          event.capacity !== null &&
          registrationCount + activePaymentReservations >= event.capacity
        ) {
          return { status: "capacity_reached" };
        }

        const registration = await transaction.registration.create({
          data: { userId, eventId },
          select: registrationSelect,
        });
        return { status: "created", registration };
      }),
    findRegistrationStatus: async (eventId, userId) => {
      const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
      if (!event) return null;

      const registration = await prisma.registration.findUnique({
        where: { userId_eventId: { userId, eventId } },
        select: { id: true },
      });
      return registration !== null;
    },
    listUserRegistrations: (userId) =>
      prisma.registration.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: registrationWithEventSelect,
      }),
    create: (data) => prisma.event.create({ data, select: eventSelect }),
    updateOwned: (id, organizerId, data) =>
      prisma.$transaction(async (transaction) => {
        const existing = await transaction.event.findFirst({
          where: { id, organizerId },
          select: { id: true },
        });
        if (!existing) return null;

        const result = await transaction.event.updateMany({
          where: { id, organizerId },
          data,
        });
        if (result.count === 0) return null;

        const event = await transaction.event.findUnique({ where: { id }, select: eventSelect });
        if (event) await queueEventUpdateNotifications(transaction, id);
        return event;
      }),
    deleteOwned: async (id, organizerId) => {
      const result = await prisma.event.deleteMany({ where: { id, organizerId } });
      return result.count > 0;
    },
  };
}

const dateTimeSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const eventFieldsSchema = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  category: z.enum(EventCategory),
  venue: z.string().trim().min(1).max(200),
  venueAddress: z.string().trim().min(1).max(300).nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  ticketPricePaise: z.number().int().positive().nullable(),
  startAt: dateTimeSchema,
  endAt: dateTimeSchema.nullable(),
  capacity: z.number().int().positive().nullable(),
};

const createEventSchema = z
  .object({
    title: eventFieldsSchema.title,
    description: eventFieldsSchema.description,
    category: eventFieldsSchema.category,
    venue: eventFieldsSchema.venue,
    venueAddress: eventFieldsSchema.venueAddress.optional(),
    latitude: eventFieldsSchema.latitude.optional(),
    longitude: eventFieldsSchema.longitude.optional(),
    ticketPricePaise: eventFieldsSchema.ticketPricePaise.optional(),
    startAt: eventFieldsSchema.startAt,
    endAt: eventFieldsSchema.endAt.optional(),
    capacity: eventFieldsSchema.capacity.optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (!areCoordinatesValid(event.latitude ?? null, event.longitude ?? null)) {
      context.addIssue({
        code: "custom",
        path: ["latitude"],
        message: "Latitude and longitude must both be provided or both be empty",
      });
    }
    if (event.endAt && event.endAt < event.startAt) {
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "End date must be on or after the start date",
      });
    }
  });

const updateEventSchema = z
  .object({
    title: eventFieldsSchema.title.optional(),
    description: eventFieldsSchema.description.optional(),
    category: eventFieldsSchema.category.optional(),
    venue: eventFieldsSchema.venue.optional(),
    venueAddress: eventFieldsSchema.venueAddress.optional(),
    latitude: eventFieldsSchema.latitude.optional(),
    longitude: eventFieldsSchema.longitude.optional(),
    ticketPricePaise: eventFieldsSchema.ticketPricePaise.optional(),
    startAt: eventFieldsSchema.startAt.optional(),
    endAt: eventFieldsSchema.endAt.optional(),
    status: z.enum(EventStatus).optional(),
    capacity: eventFieldsSchema.capacity.optional(),
  })
  .strict()
  .refine((event) => Object.keys(event).length > 0, {
    message: "Provide at least one event field to update",
  })
  .superRefine((event, context) => {
    if (event.startAt && event.endAt && event.endAt < event.startAt) {
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "End date must be on or after the start date",
      });
    }
  });

export function areCoordinatesValid(latitude: number | null, longitude: number | null): boolean {
  if (latitude === null || longitude === null) return latitude === null && longitude === null;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

const listEventsQuerySchema = z
  .object({
    category: z.enum(EventCategory).optional(),
    search: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const eventIdSchema = z.string().min(1).max(128);

function toPublicEvent(event: EventRecord): PublicEvent {
  const { organizerId: _organizerId, ...publicEvent } = event;
  return publicEvent;
}

function sendValidationError(response: Response, message: string, error: z.ZodError) {
  return response.status(400).json({ error: message, details: z.treeifyError(error) });
}

function sendServerError(response: Response, action: string, error: unknown) {
  console.error(`Event ${action} failed`, error);
  return response.status(500).json({ error: "Event service unavailable" });
}

async function requireRole(
  request: Request,
  response: Response,
  repository: EventRepository,
  requiredRole: UserRole,
): Promise<string | null> {
  const userId = request.session.userId;
  if (!userId) {
    response.status(401).json({ error: "Authentication required" });
    return null;
  }

  let role: UserRole | null;
  try {
    role = await repository.findUserRole(userId);
  } catch (error) {
    sendServerError(response, "authorization", error);
    return null;
  }

  if (!role) {
    response.status(401).json({ error: "Authentication required" });
    return null;
  }
  if (role !== requiredRole) {
    response.status(403).json({
      error: requiredRole === UserRole.ORGANIZER ? "Organizer role required" : "Student role required",
    });
    return null;
  }

  return userId;
}

function toPublicRegistration(registration: RegistrationRecord) {
  return {
    id: registration.id,
    eventId: registration.eventId,
    createdAt: registration.createdAt,
  };
}

export function createEventRouter(repository: EventRepository) {
  const router = Router();

  router.get("/mine", async (request, response) => {
    const organizerId = await requireRole(request, response, repository, UserRole.ORGANIZER);
    if (!organizerId) return;

    try {
      const events = await repository.listOwned(organizerId);
      return response.json({ events: events.map(toPublicEvent) });
    } catch (error) {
      return sendServerError(response, "organizer event listing", error);
    }
  });

  router.get("/", async (request, response) => {
    const parsed = listEventsQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendValidationError(response, "Invalid event filters", parsed.error);

    try {
      const events = await repository.listPublished(parsed.data);
      return response.json({ events: events.map(toPublicEvent) });
    } catch (error) {
      return sendServerError(response, "listing", error);
    }
  });

  router.get("/:id", async (request, response) => {
    const parsedId = eventIdSchema.safeParse(request.params.id);
    if (!parsedId.success) return sendValidationError(response, "Invalid event ID", parsedId.error);

    try {
      const event = await repository.findPublishedById(parsedId.data);
      if (!event) return response.status(404).json({ error: "Event not found" });
      return response.json({ event: toPublicEvent(event) });
    } catch (error) {
      return sendServerError(response, "lookup", error);
    }
  });

  router.post("/:id/register", async (request, response) => {
    const userId = await requireRole(request, response, repository, UserRole.STUDENT);
    if (!userId) return;

    const parsedId = eventIdSchema.safeParse(request.params.id);
    if (!parsedId.success) return sendValidationError(response, "Invalid event ID", parsedId.error);

    const parsedBody = z.object({}).strict().safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return sendValidationError(response, "Invalid registration request", parsedBody.error);
    }

    try {
      const result = await repository.registerForEvent(parsedId.data, userId);
      if (result.status === "not_found") {
        return response.status(404).json({ error: "Event not found" });
      }
      if (result.status === "duplicate") {
        return response.status(409).json({ error: "Already registered for this event" });
      }
      if (result.status === "capacity_reached") {
        return response.status(409).json({ error: "Event is full" });
      }
      if (result.status === "paid_event") {
        return response.status(409).json({ error: "Payment is required for this event" });
      }
      return response.status(201).json({
        registration: toPublicRegistration(result.registration),
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return response.status(409).json({ error: "Already registered for this event" });
      }
      return sendServerError(response, "registration", error);
    }
  });

  router.get("/:id/registration", async (request, response) => {
    const userId = await requireRole(request, response, repository, UserRole.STUDENT);
    if (!userId) return;

    const parsedId = eventIdSchema.safeParse(request.params.id);
    if (!parsedId.success) return sendValidationError(response, "Invalid event ID", parsedId.error);

    try {
      const registered = await repository.findRegistrationStatus(parsedId.data, userId);
      if (registered === null) return response.status(404).json({ error: "Event not found" });
      return response.json({ registered });
    } catch (error) {
      return sendServerError(response, "registration status lookup", error);
    }
  });

  router.post("/", async (request, response) => {
    const organizerId = await requireRole(request, response, repository, UserRole.ORGANIZER);
    if (!organizerId) return;

    const parsed = createEventSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, "Invalid event details", parsed.error);

    try {
      const data: EventCreateData = {
        ...parsed.data,
        endAt: parsed.data.endAt ?? null,
        organizerId,
        status: EventStatus.DRAFT,
        capacity: parsed.data.capacity ?? null,
        venueAddress: parsed.data.venueAddress ?? null,
        latitude: parsed.data.latitude ?? null,
        longitude: parsed.data.longitude ?? null,
        ticketPricePaise: parsed.data.ticketPricePaise ?? null,
      };
      const event = await repository.create(data);
      return response.status(201).json({ event: toPublicEvent(event) });
    } catch (error) {
      return sendServerError(response, "creation", error);
    }
  });

  router.patch("/:id", async (request, response) => {
    const organizerId = await requireRole(request, response, repository, UserRole.ORGANIZER);
    if (!organizerId) return;

    const parsedId = eventIdSchema.safeParse(request.params.id);
    if (!parsedId.success) return sendValidationError(response, "Invalid event ID", parsedId.error);

    const parsed = updateEventSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, "Invalid event details", parsed.error);

    try {
      const existing = await repository.findById(parsedId.data);
      if (!existing) return response.status(404).json({ error: "Event not found" });
      if (existing.organizerId !== organizerId) {
        return response.status(403).json({ error: "You may only modify your own events" });
      }

      const nextStartAt = parsed.data.startAt ?? existing.startAt;
      const nextEndAt =
        parsed.data.endAt === undefined ? existing.endAt : parsed.data.endAt;
      const nextLatitude =
        parsed.data.latitude === undefined ? existing.latitude : parsed.data.latitude;
      const nextLongitude =
        parsed.data.longitude === undefined ? existing.longitude : parsed.data.longitude;
      if (!areCoordinatesValid(nextLatitude, nextLongitude)) {
        return response.status(400).json({
          error: "Invalid event details",
          details: { latitude: ["Latitude and longitude must both be provided or both be empty"] },
        });
      }
      if (nextEndAt && nextEndAt < nextStartAt) {
        return response.status(400).json({
          error: "Invalid event details",
          details: { endAt: ["End date must be on or after the start date"] },
        });
      }

      const event = await repository.updateOwned(parsedId.data, organizerId, parsed.data);
      if (!event) return response.status(404).json({ error: "Event not found" });
      return response.json({ event: toPublicEvent(event) });
    } catch (error) {
      return sendServerError(response, "update", error);
    }
  });

  router.delete("/:id", async (request, response) => {
    const organizerId = await requireRole(request, response, repository, UserRole.ORGANIZER);
    if (!organizerId) return;

    const parsedId = eventIdSchema.safeParse(request.params.id);
    if (!parsedId.success) return sendValidationError(response, "Invalid event ID", parsedId.error);

    try {
      const existing = await repository.findById(parsedId.data);
      if (!existing) return response.status(404).json({ error: "Event not found" });
      if (existing.organizerId !== organizerId) {
        return response.status(403).json({ error: "You may only modify your own events" });
      }

      const deleted = await repository.deleteOwned(parsedId.data, organizerId);
      if (!deleted) return response.status(404).json({ error: "Event not found" });
      return response.status(204).end();
    } catch (error) {
      if (isForeignKeyConstraintError(error)) {
        return response.status(409).json({
          error: "Events with registrations or payment attempts cannot be deleted",
        });
      }
      return sendServerError(response, "deletion", error);
    }
  });

  return router;
}

export function createMeRouter(repository: EventRepository) {
  const router = Router();

  router.get("/registrations", async (request, response) => {
    const userId = await requireRole(request, response, repository, UserRole.STUDENT);
    if (!userId) return;

    try {
      const registrations = await repository.listUserRegistrations(userId);
      return response.json({
        registrations: registrations.map(({ event, ...registration }) => ({
          ...registration,
          event: toPublicEvent(event),
        })),
      });
    } catch (error) {
      return sendServerError(response, "student registrations lookup", error);
    }
  });

  return router;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function isForeignKeyConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2003"
  );
}
