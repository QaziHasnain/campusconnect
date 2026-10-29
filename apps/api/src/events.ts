import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  EventCategory,
  EventStatus,
  UserRole,
  type Prisma,
  type PrismaClient,
} from "./generated/prisma/client.js";

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
  createdAt: true,
  updatedAt: true,
  organizer: { select: { name: true } },
} satisfies Prisma.EventSelect;

export type EventRecord = Prisma.EventGetPayload<{ select: typeof eventSelect }>;
export type PublicEvent = Omit<EventRecord, "organizerId">;

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
}

export type EventUpdateData = Partial<
  Pick<
    EventCreateData,
    "title" | "description" | "category" | "venue" | "startAt" | "endAt" | "status" | "capacity"
  >
>;

interface EventFilters {
  category?: EventCategory;
  search?: string;
}

export interface EventRepository {
  listPublished(filters: EventFilters): Promise<EventRecord[]>;
  findPublishedById(id: string): Promise<EventRecord | null>;
  findById(id: string): Promise<EventRecord | null>;
  findUserRole(userId: string): Promise<UserRole | null>;
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
    findPublishedById: (id) =>
      prisma.event.findFirst({
        where: { id, status: EventStatus.PUBLISHED },
        select: eventSelect,
      }),
    findById: (id) => prisma.event.findUnique({ where: { id }, select: eventSelect }),
    findUserRole: async (userId) =>
      (await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role ?? null,
    create: (data) => prisma.event.create({ data, select: eventSelect }),
    updateOwned: async (id, organizerId, data) => {
      const result = await prisma.event.updateMany({
        where: { id, organizerId },
        data,
      });
      if (result.count === 0) return null;

      return prisma.event.findUnique({ where: { id }, select: eventSelect });
    },
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
    startAt: eventFieldsSchema.startAt,
    endAt: eventFieldsSchema.endAt.optional(),
    capacity: eventFieldsSchema.capacity.optional(),
  })
  .strict()
  .superRefine((event, context) => {
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

async function requireOrganizer(
  request: Request,
  response: Response,
  repository: EventRepository,
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
  if (role !== UserRole.ORGANIZER) {
    response.status(403).json({ error: "Organizer role required" });
    return null;
  }

  return userId;
}

export function createEventRouter(repository: EventRepository) {
  const router = Router();

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

  router.post("/", async (request, response) => {
    const organizerId = await requireOrganizer(request, response, repository);
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
      };
      const event = await repository.create(data);
      return response.status(201).json({ event: toPublicEvent(event) });
    } catch (error) {
      return sendServerError(response, "creation", error);
    }
  });

  router.patch("/:id", async (request, response) => {
    const organizerId = await requireOrganizer(request, response, repository);
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
    const organizerId = await requireOrganizer(request, response, repository);
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
      return sendServerError(response, "deletion", error);
    }
  });

  return router;
}
