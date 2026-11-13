-- CreateEnum
CREATE TYPE "SharePermission" AS ENUM ('VIEWER', 'EDITOR');

-- CreateEnum
CREATE TYPE "ShareAccessMode" AS ENUM ('INSTANT', 'APPROVAL');

-- CreateEnum
CREATE TYPE "BoardAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "BoardShareSettings" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tokenHash" TEXT,
    "permission" "SharePermission" NOT NULL DEFAULT 'VIEWER',
    "accessMode" "ShareAccessMode" NOT NULL DEFAULT 'INSTANT',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardShareSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardInvite" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL DEFAULT 'VIEWER',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardAccessRequest" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "shareSettingsId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "participantName" TEXT NOT NULL,
    "status" "BoardAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "BoardAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardGuestAccess" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "participantName" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL,
    "sourceShareSettingsId" TEXT,
    "sourceInviteId" TEXT,
    "sourceRequestId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardGuestAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardShareSettings_roomId_key" ON "BoardShareSettings"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardShareSettings_tokenHash_key" ON "BoardShareSettings"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "BoardInvite_tokenHash_key" ON "BoardInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "BoardInvite_roomId_revokedAt_idx" ON "BoardInvite"("roomId", "revokedAt");

-- CreateIndex
CREATE INDEX "BoardAccessRequest_roomId_status_createdAt_idx" ON "BoardAccessRequest"("roomId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BoardAccessRequest_shareSettingsId_participantId_idx" ON "BoardAccessRequest"("shareSettingsId", "participantId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardGuestAccess_credentialHash_key" ON "BoardGuestAccess"("credentialHash");

-- CreateIndex
CREATE UNIQUE INDEX "BoardGuestAccess_sourceRequestId_key" ON "BoardGuestAccess"("sourceRequestId");

-- CreateIndex
CREATE INDEX "BoardGuestAccess_roomId_revokedAt_expiresAt_idx" ON "BoardGuestAccess"("roomId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "BoardGuestAccess_participantId_roomId_idx" ON "BoardGuestAccess"("participantId", "roomId");

-- AddForeignKey
ALTER TABLE "BoardShareSettings" ADD CONSTRAINT "BoardShareSettings_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardInvite" ADD CONSTRAINT "BoardInvite_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardAccessRequest" ADD CONSTRAINT "BoardAccessRequest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardAccessRequest" ADD CONSTRAINT "BoardAccessRequest_shareSettingsId_fkey" FOREIGN KEY ("shareSettingsId") REFERENCES "BoardShareSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardGuestAccess" ADD CONSTRAINT "BoardGuestAccess_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardGuestAccess" ADD CONSTRAINT "BoardGuestAccess_sourceShareSettingsId_fkey" FOREIGN KEY ("sourceShareSettingsId") REFERENCES "BoardShareSettings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardGuestAccess" ADD CONSTRAINT "BoardGuestAccess_sourceInviteId_fkey" FOREIGN KEY ("sourceInviteId") REFERENCES "BoardInvite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardGuestAccess" ADD CONSTRAINT "BoardGuestAccess_sourceRequestId_fkey" FOREIGN KEY ("sourceRequestId") REFERENCES "BoardAccessRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
