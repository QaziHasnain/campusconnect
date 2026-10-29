import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { pool } from "./db.js";

export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
