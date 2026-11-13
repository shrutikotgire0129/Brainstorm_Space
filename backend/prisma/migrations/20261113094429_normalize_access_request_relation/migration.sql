/*
  Warnings:

  - You are about to drop the column `roomId` on the `BoardAccessRequest` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "BoardAccessRequest" DROP CONSTRAINT "BoardAccessRequest_roomId_fkey";

-- DropIndex
DROP INDEX "BoardAccessRequest_roomId_status_createdAt_idx";

-- AlterTable
ALTER TABLE "BoardAccessRequest" DROP COLUMN "roomId";

-- CreateIndex
CREATE INDEX "BoardAccessRequest_shareSettingsId_status_createdAt_idx" ON "BoardAccessRequest"("shareSettingsId", "status", "createdAt");
