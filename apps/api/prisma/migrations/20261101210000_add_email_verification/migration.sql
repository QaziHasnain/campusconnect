ALTER TABLE "User"
  ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ(3);

UPDATE "User"
SET "emailVerified" = true,
    "emailVerifiedAt" = NOW()
WHERE "emailVerified" = false;

CREATE TABLE "EmailVerificationToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailVerificationToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key"
  ON "EmailVerificationToken"("tokenHash");

CREATE INDEX "EmailVerificationToken_userId_idx"
  ON "EmailVerificationToken"("userId");

CREATE INDEX "EmailVerificationToken_expiresAt_idx"
  ON "EmailVerificationToken"("expiresAt");
