CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'ORGANIZER');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "User_email_normalized_check" CHECK ("email" = LOWER(BTRIM("email")))
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
