/*
  Warnings:

  - A unique constraint covering the columns `[requestTokenHash]` on the table `BoardAccessRequest` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `requestTokenHash` to the `BoardAccessRequest` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BoardAccessRequest" ADD COLUMN     "requestTokenHash" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "BoardAccessRequest_requestTokenHash_key" ON "BoardAccessRequest"("requestTokenHash");
