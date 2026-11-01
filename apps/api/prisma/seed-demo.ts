import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import argon2 from "argon2";
import { EventCategory, EventStatus, UserRole } from "../src/generated/prisma/client.js";
import { getSafeDemoDatabaseName } from "../src/demoSeedSafety.js";

const credentialsPath = resolve(import.meta.dirname, "../../../.demo-credentials.local.json");
const organizerEmail = "demo.organizer@campusconnect.test";
const studentAccounts = [
  { name: "Demo Student One", email: "demo.student.one@campusconnect.test" },
  { name: "Demo Student Two", email: "demo.student.two@campusconnect.test" },
];

function getDemoPassword(credentials: { password: string } | null) {
  if (credentials) return credentials.password;

  const password = randomBytes(24).toString("base64url");
  return password;
}

async function loadCredentials() {
  try {
    const raw = await readFile(credentialsPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("password" in parsed) ||
      typeof parsed.password !== "string" ||
      parsed.password.length < 24
    ) {
      throw new Error("Local demo credential file is invalid; move it aside before reseeding");
    }
    return { password: parsed.password };
  } catch (error) {
    if (isFileNotFound(error)) return null;
    throw error;
  }
}

async function saveCredentials(password: string) {
  const contents = JSON.stringify(
    {
      warning: "Local demo credentials. Do not share or commit this file.",
      password,
      accounts: [
        { role: "ORGANIZER", email: organizerEmail },
        ...studentAccounts.map((account) => ({ role: "STUDENT", email: account.email })),
      ],
    },
    null,
    2,
  );
  await writeFile(credentialsPath, `${contents}\n`, { flag: "wx", mode: 0o600 });
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function futureEventDate(daysFromNow: number, hour: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

const demoEventDefinitions = [
  {
    id: "campusconnect-demo-ai-forum",
    title: "Campus AI Forum: Building with Responsible AI",
    description:
      "Students and faculty explore practical AI projects, responsible design, and the questions shaping technology on campus.",
    category: EventCategory.TECHNOLOGY,
    venue: "Innovation Hub, Lecture Theatre",
    daysFromNow: 7,
    hour: 16,
    durationHours: 2,
    capacity: 80,
    status: EventStatus.PUBLISHED,
  },
  {
    id: "campusconnect-demo-global-food-fair",
    title: "Global Table: Campus Food Fair",
    description:
      "Share favorite dishes, hear the stories behind them, and meet student groups from across campus.",
    category: EventCategory.CULTURAL,
    venue: "Student Union, Main Hall",
    daysFromNow: 14,
    hour: 12,
    durationHours: 4,
    capacity: null,
    status: EventStatus.PUBLISHED,
  },
  {
    id: "campusconnect-demo-five-a-side",
    title: "Inter-Department Five-a-Side",
    description:
      "Join a friendly tournament for all skill levels, with teams organized on the day.",
    category: EventCategory.SPORTS,
    venue: "North Campus Sports Ground",
    daysFromNow: 21,
    hour: 10,
    durationHours: 3,
    capacity: 40,
    status: EventStatus.PUBLISHED,
  },
  {
    id: "campusconnect-demo-accessible-web-workshop",
    title: "Designing a More Accessible Web",
    description:
      "Explore inclusive interaction patterns and test everyday web experiences with accessibility tools.",
    category: EventCategory.WORKSHOPS,
    venue: "Digital Learning Studio",
    daysFromNow: 28,
    hour: 14,
    durationHours: 2,
    capacity: 30,
    status: EventStatus.PUBLISHED,
  },
  {
    id: "campusconnect-demo-student-hackathon",
    title: "Campus Solutions Hackathon",
    description:
      "Form a team and prototype a thoughtful solution to a challenge faced by students on campus.",
    category: EventCategory.HACKATHONS,
    venue: "Computing Centre, Collaboration Lab",
    daysFromNow: 35,
    hour: 9,
    durationHours: 8,
    capacity: null,
    status: EventStatus.PUBLISHED,
  },
  {
    id: "campusconnect-demo-autumn-arts-draft",
    title: "Autumn Arts Showcase (Planning Draft)",
    description:
      "A draft event for an evening of short performances, visual art, poetry, and student music.",
    category: EventCategory.CULTURAL,
    venue: "Grand Auditorium",
    daysFromNow: 42,
    hour: 18,
    durationHours: 3,
    capacity: 200,
    status: EventStatus.DRAFT,
  },
] as const;

async function seedDemoData() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo seeding is disabled when NODE_ENV=production");
  }

  const { env } = await import("../src/env.js");
  const expectedDatabaseName = getSafeDemoDatabaseName(
    env.databaseUrl,
    process.env.DEMO_SEED_ENABLED,
    process.env.DEMO_SEED_DATABASE_NAME,
  );
  const [{ pool }, { prisma }] = await Promise.all([
    import("../src/db.js"),
    import("../src/prisma.js"),
  ]);

  try {
    const identity = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    if (identity.rows[0]?.database_name !== expectedDatabaseName) {
      throw new Error("Connected database does not match the explicitly approved demo target");
    }

    let credentials = await loadCredentials();
    const password = getDemoPassword(credentials);
    if (!credentials) {
      await saveCredentials(password);
      credentials = { password };
    }

    const passwordHash = await argon2.hash(password);
    const organizer = await prisma.user.upsert({
      where: { email: organizerEmail },
      create: {
        name: "CampusConnect Demo Organizer",
        email: organizerEmail,
        passwordHash,
        role: UserRole.ORGANIZER,
      },
      update: {
        name: "CampusConnect Demo Organizer",
        passwordHash,
        role: UserRole.ORGANIZER,
      },
      select: { id: true },
    });

    const students = [];
    for (const account of studentAccounts) {
      const student = await prisma.user.upsert({
        where: { email: account.email },
        create: {
          ...account,
          passwordHash,
          role: UserRole.STUDENT,
        },
        update: {
          name: account.name,
          passwordHash,
          role: UserRole.STUDENT,
        },
        select: { id: true },
      });
      students.push(student);
    }

    const events = [];
    for (const definition of demoEventDefinitions) {
      const startAt = futureEventDate(definition.daysFromNow, definition.hour);
      const endAt = new Date(startAt.getTime() + definition.durationHours * 60 * 60 * 1000);
      const event = await prisma.event.upsert({
        where: { id: definition.id },
        create: {
          id: definition.id,
          title: definition.title,
          description: definition.description,
          category: definition.category,
          venue: definition.venue,
          startAt,
          endAt,
          organizerId: organizer.id,
          status: definition.status,
          capacity: definition.capacity,
        },
        update: {
          title: definition.title,
          description: definition.description,
          category: definition.category,
          venue: definition.venue,
          startAt,
          endAt,
          organizerId: organizer.id,
          status: definition.status,
          capacity: definition.capacity,
        },
        select: { id: true, title: true },
      });
      events.push(event);
    }

    const registrations = [
      { student: students[0], event: events[0] },
      { student: students[0], event: events[1] },
      { student: students[1], event: events[0] },
      { student: students[1], event: events[3] },
    ];
    for (const registration of registrations) {
      await prisma.registration.upsert({
        where: {
          userId_eventId: {
            userId: registration.student.id,
            eventId: registration.event.id,
          },
        },
        create: {
          userId: registration.student.id,
          eventId: registration.event.id,
        },
        update: {},
      });
    }

    console.log(
      `Demo data is ready in the approved local database: ${events.length} events, ${students.length} students, and ${registrations.length} demo registrations.`,
    );
    console.log(`Local credentials were written to ${credentialsPath}; do not commit or share the file.`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

seedDemoData().catch((error: unknown) => {
  console.error("Demo data seeding failed", error);
  process.exitCode = 1;
});
