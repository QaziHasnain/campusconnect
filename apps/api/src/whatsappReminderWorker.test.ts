import { describe, expect, it, vi } from "vitest";
import { EventStatus } from "./generated/prisma/client.js";
import type {
  ReminderDeliveryContext,
  WhatsAppReminderRepository,
  WhatsAppTemplateProvider,
} from "./whatsappReminderWorker.js";
import type { WhatsAppTemplateMessage } from "./whatsappProvider.js";

process.env.WHATSAPP_ENABLED = "false";
const {
  claimDueReminders,
  deliverClaimedReminders,
  getRetryTime,
  planReminderTimes,
  processDueReminders,
  reconcileScheduledReminders,
  runWhatsAppReminderCycle,
} = await import("./whatsappReminderWorker.js");
const { WhatsAppDeliveryError } = await import("./whatsappProvider.js");

const now = new Date("2026-11-01T10:00:00.000Z");
const eventStartAt = new Date("2026-11-02T10:00:00.000Z");

function eligibleContext(
  overrides: Partial<ReminderDeliveryContext> = {},
): ReminderDeliveryContext {
  return {
    studentName: "Campus Student",
    phoneNumber: "+14155550132",
    consent: true,
    consentGrantedAt: new Date("2026-10-30T12:00:00.000Z"),
    consentWithdrawnAt: null,
    eventName: "Campus Event",
    eventVenue: "Student Hall",
    eventStartAt,
    eventStatus: EventStatus.PUBLISHED,
    eventId: "event-1",
    ...overrides,
  };
}

function createRepository(context: ReminderDeliveryContext | null = eligibleContext()) {
  return {
    loadClaimedReminder: vi.fn(async () => context),
    markReminderSent: vi.fn(async () => undefined),
    markReminderCancelled: vi.fn(async () => undefined),
    scheduleReminderRetry: vi.fn(async () => undefined),
    markReminderFailed: vi.fn(async () => undefined),
  } satisfies WhatsAppReminderRepository;
}

const provider: WhatsAppTemplateProvider = {
  sendTemplate: vi.fn(async () => "wamid.test"),
};

describe("WhatsApp reminder scheduling", () => {
  it("schedules future 24-hour and 1-hour reminders from the event start", () => {
    expect(planReminderTimes(eventStartAt, now, [24, 1])).toEqual([
      { offsetHours: 24, scheduledAt: new Date("2026-11-01T10:00:00.000Z") },
      { offsetHours: 1, scheduledAt: new Date("2026-11-02T09:00:00.000Z") },
    ]);
  });

  it("omits a passed reminder interval when an event starts soon", () => {
    expect(
      planReminderTimes(new Date("2026-11-01T11:30:00.000Z"), now, [24, 1]),
    ).toEqual([{ offsetHours: 1, scheduledAt: new Date("2026-11-01T10:30:00.000Z") }]);
    expect(
      planReminderTimes(new Date("2026-11-01T10:30:00.000Z"), now, [24, 1]),
    ).toEqual([]);
  });

  it("does not schedule reminders for an event that has already started", () => {
    expect(
      planReminderTimes(new Date("2026-11-01T09:59:59.000Z"), now, [24, 1]),
    ).toEqual([]);
  });

  it("reconciles without duplicating registration-offset reminders", async () => {
    const records = new Map<string, { registrationId: string; offsetHours: number }>();
    const prisma = {
      $executeRaw: async () => 0,
      registration: {
        findMany: async () => [{
          id: "registration-1",
          event: { startAt: eventStartAt },
        }],
      },
      whatsAppReminder: {
        createMany: async ({ data, skipDuplicates }: {
          data: Array<{ registrationId: string; offsetHours: number }>;
          skipDuplicates: boolean;
        }) => {
          for (const reminder of data) {
            const key = `${reminder.registrationId}:${reminder.offsetHours}`;
            if (!records.has(key) || !skipDuplicates) records.set(key, reminder);
          }
          return { count: data.length };
        },
        updateMany: async () => ({ count: 0 }),
      },
    };

    await reconcileScheduledReminders(prisma as never, [24, 1], now);
    await reconcileScheduledReminders(prisma as never, [24, 1], now);

    expect([...records.keys()].sort()).toEqual(["registration-1:1", "registration-1:24"]);
  });

  it("uses a bounded retry delay and stops retrying after three attempts", () => {
    expect(getRetryTime(1, now)?.toISOString()).toBe("2026-11-01T10:01:00.000Z");
    expect(getRetryTime(2, now)?.toISOString()).toBe("2026-11-01T10:05:00.000Z");
    expect(getRetryTime(1, now, 30)?.toISOString()).toBe("2026-11-01T10:01:00.000Z");
    expect(getRetryTime(3, now)).toBeNull();
  });
});

describe("WhatsApp reminder delivery", () => {
  it("does not send without current consent or a valid phone number", async () => {
    for (const context of [
      eligibleContext({ consent: false }),
      eligibleContext({ consentGrantedAt: null }),
      eligibleContext({ consentWithdrawnAt: now }),
      eligibleContext({ phoneNumber: null }),
    ]) {
      const repository = createRepository(context);
      const send = vi.fn(async (_recipient: string, _message: WhatsAppTemplateMessage) => "wamid.test");
      await deliverClaimedReminders(repository, { sendTemplate: send }, [{ id: "reminder", attemptCount: 1 }], now, "https://campus.example");
      expect(send).not.toHaveBeenCalled();
      expect(repository.markReminderCancelled).toHaveBeenCalledOnce();
    }
  });

  it("cancels reminders for unpublished or already-started events", async () => {
    const contexts = [
      eligibleContext({ eventStatus: EventStatus.DRAFT }),
      eligibleContext({ eventStartAt: now }),
    ];
    for (const context of contexts) {
      const repository = createRepository(context);
      const send = vi.fn(async (_recipient: string, _message: WhatsAppTemplateMessage) => "wamid.test");
      await deliverClaimedReminders(repository, { sendTemplate: send }, [{ id: "reminder", attemptCount: 1 }], now, "https://campus.example");
      expect(send).not.toHaveBeenCalled();
      expect(repository.markReminderCancelled).toHaveBeenCalledOnce();
    }
  });

  it("sends a template and records the provider message ID", async () => {
    const repository = createRepository();
    const send = vi.fn(async (_recipient: string, _message: WhatsAppTemplateMessage) => "wamid.saved");
    await deliverClaimedReminders(repository, { sendTemplate: send }, [{ id: "reminder", attemptCount: 1 }], now, "https://campus.example");
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toBe("+14155550132");
    expect(send.mock.calls[0][1].eventDetailsUrl).toBe("https://campus.example/events/event-1");
    expect(repository.markReminderSent).toHaveBeenCalledWith(
      "reminder",
      "wamid.saved",
      expect.any(Date),
    );
  });

  it("retries temporary provider failures but marks permanent and exhausted failures", async () => {
    const retryRepository = createRepository();
    const temporaryProvider: WhatsAppTemplateProvider = {
      sendTemplate: vi.fn(async () => {
        throw new WhatsAppDeliveryError("PROVIDER_HTTP_429", true, 30);
      }),
    };
    await deliverClaimedReminders(
      retryRepository,
      temporaryProvider,
      [{ id: "retry", attemptCount: 1 }],
      now,
      "https://campus.example",
    );
    expect(retryRepository.scheduleReminderRetry).toHaveBeenCalledWith(
      "retry",
      "PROVIDER_HTTP_429",
      expect.any(Date),
    );

    const permanentRepository = createRepository();
    const permanentProvider: WhatsAppTemplateProvider = {
      sendTemplate: vi.fn(async () => {
        throw new WhatsAppDeliveryError("PROVIDER_HTTP_400", false);
      }),
    };
    await deliverClaimedReminders(
      permanentRepository,
      permanentProvider,
      [{ id: "permanent", attemptCount: 1 }],
      now,
      "https://campus.example",
    );
    expect(permanentRepository.markReminderFailed).toHaveBeenCalledWith(
      "permanent",
      "PROVIDER_HTTP_400",
    );

    const exhaustedRepository = createRepository();
    await deliverClaimedReminders(
      exhaustedRepository,
      temporaryProvider,
      [{ id: "exhausted", attemptCount: 3 }],
      now,
      "https://campus.example",
    );
    expect(exhaustedRepository.markReminderFailed).toHaveBeenCalledWith(
      "exhausted",
      "PROVIDER_HTTP_429",
    );
  });

  it("sends a claimed reminder only once across concurrent and repeated processing", async () => {
    let status: "PENDING" | "PROCESSING" | "SENT" = "PENDING";
    const repository = createRepository();
    repository.markReminderSent = vi.fn(async () => {
      status = "SENT";
    });
    const send = vi.fn(async (_recipient: string, _message: WhatsAppTemplateMessage) => "wamid.once");
    const claim = async () => {
      if (status !== "PENDING") return [];
      status = "PROCESSING";
      return [{ id: "once", attemptCount: 1 }];
    };

    await Promise.all([
      processDueReminders(claim, repository, { sendTemplate: send }, now, "https://campus.example"),
      processDueReminders(claim, repository, { sendTemplate: send }, now, "https://campus.example"),
    ]);
    await processDueReminders(claim, repository, { sendTemplate: send }, now, "https://campus.example");

    expect(send).toHaveBeenCalledOnce();
    expect(status).toBe("SENT");
  });

  it("claims due rows with PostgreSQL SKIP LOCKED", async () => {
    const queries: string[] = [];
    let claimed = false;
    const prisma = {
      $transaction: async <T>(callback: (transaction: { $queryRaw: <R>(query: TemplateStringsArray, ...values: unknown[]) => Promise<R> }) => Promise<T>) =>
        callback({
          $queryRaw: async <R>(query: TemplateStringsArray) => {
            queries.push(query.join(" "));
            if (claimed) return [] as R;
            claimed = true;
            return [{ id: "locked-reminder", attemptCount: 1 }] as R;
          },
        }),
    };

    const [first, second] = await Promise.all([
      claimDueReminders(prisma as never, now),
      claimDueReminders(prisma as never, now),
    ]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(queries.join(" ")).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("does not access the database while WhatsApp delivery is disabled", async () => {
    await runWhatsAppReminderCycle({} as never, now, false);
  });
});
