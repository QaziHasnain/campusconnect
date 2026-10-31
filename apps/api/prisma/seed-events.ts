import { EventStatus, UserRole } from "../src/generated/prisma/client.js";
import { pool } from "../src/db.js";
import { prisma } from "../src/prisma.js";
import { campusEvents } from "../src/campusEvents.js";

async function seedEvents() {
  const organizer = await prisma.user.findFirst({
    where: { role: UserRole.ORGANIZER },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  if (!organizer) {
    throw new Error(
      "Create an organizer account before seeding campus events; the seed does not create users.",
    );
  }

  const expiredEvents = campusEvents.filter(
    (event) => new Date(event.startAt).getTime() <= Date.now(),
  );
  if (expiredEvents.length > 0) {
    throw new Error(
      `Update the event dates before seeding; these start dates are not in the future: ${expiredEvents
        .map((event) => event.title)
        .join(", ")}`,
    );
  }

  await prisma.$transaction(
    campusEvents.map((event) =>
      prisma.event.upsert({
        where: { id: event.id },
        create: {
          ...event,
          startAt: new Date(event.startAt),
          endAt: new Date(event.endAt),
          organizerId: organizer.id,
          status: EventStatus.PUBLISHED,
        },
        update: {
          title: event.title,
          description: event.description,
          category: event.category,
          venue: event.venue,
          startAt: new Date(event.startAt),
          endAt: new Date(event.endAt),
          organizerId: organizer.id,
          status: EventStatus.PUBLISHED,
          capacity: event.capacity,
        },
      }),
    ),
  );

  console.log(
    `Seeded ${campusEvents.length} published campus events using organizer "${organizer.name}".`,
  );
}

seedEvents()
  .catch((error: unknown) => {
    console.error("Campus event seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
