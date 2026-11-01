import { prisma } from "./prisma.js";
import { runWhatsAppReminderCycle, startWhatsAppReminderWorker } from "./whatsappReminderWorker.js";

await startWhatsAppReminderWorker((now) => runWhatsAppReminderCycle(prisma, now));
await prisma.$disconnect();
