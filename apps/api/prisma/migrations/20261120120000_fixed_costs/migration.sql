-- CreateEnum
CREATE TYPE "FixedCostKind" AS ENUM ('monthly', 'weekly', 'oneTime');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "expectedCupsEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "expectedCupsPerMonth" INTEGER;

-- CreateTable
CREATE TABLE "FixedCost" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "kind" "FixedCostKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "months" INTEGER,
    "nameEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kindEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amountEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monthsEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FixedCost_projectId_createdAt_idx" ON "FixedCost"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FixedCost_projectId_nameKey_key" ON "FixedCost"("projectId", "nameKey");

-- AddForeignKey
ALTER TABLE "FixedCost" ADD CONSTRAINT "FixedCost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
