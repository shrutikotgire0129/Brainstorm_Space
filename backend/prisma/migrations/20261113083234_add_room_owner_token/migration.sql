/*
  Warnings:

  - A unique constraint covering the columns `[ownerTokenHash]` on the table `Room` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "ownerTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Room_ownerTokenHash_key" ON "Room"("ownerTokenHash");
