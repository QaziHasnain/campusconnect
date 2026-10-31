import { EventCategory } from "./generated/prisma/client.js";
import { campusEvents } from "./campusEvents.js";
import { describe, expect, it } from "vitest";

describe("campus event seed data", () => {
  it("contains 25 distinct events across every supported category", () => {
    const categoryCounts = new Map<EventCategory, number>();
    for (const event of campusEvents) {
      categoryCounts.set(event.category, (categoryCounts.get(event.category) ?? 0) + 1);
    }

    expect(campusEvents).toHaveLength(25);
    expect(new Set(campusEvents.map((event) => event.id)).size).toBe(25);
    expect(Object.values(EventCategory).sort()).toEqual([...categoryCounts.keys()].sort());
    expect(Object.fromEntries(categoryCounts)).toEqual({
      TECHNOLOGY: 5,
      CULTURAL: 5,
      SPORTS: 5,
      WORKSHOPS: 5,
      HACKATHONS: 5,
    });
  });

  it("uses future event dates with end times after start times", () => {
    for (const event of campusEvents) {
      const startAt = new Date(event.startAt).getTime();
      const endAt = new Date(event.endAt).getTime();

      expect(Number.isFinite(startAt), event.title).toBe(true);
      expect(Number.isFinite(endAt), event.title).toBe(true);
      expect(startAt, event.title).toBeGreaterThan(Date.now());
      expect(endAt, event.title).toBeGreaterThan(startAt);
    }
  });
});
