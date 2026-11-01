import { prisma } from "./prisma.js";
import {
  runNotificationWorkerCycle,
  startNotificationWorker,
} from "./notificationWorker.js";

await startNotificationWorker((now) => runNotificationWorkerCycle(prisma, now));
await prisma.$disconnect();
