-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('working', 'done');

-- CreateEnum
CREATE TYPE "DraftLineKind" AS ENUM ('existing', 'new');

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sizes" "ProductSize"[],
    "expectedPrice" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "DraftStatus" NOT NULL DEFAULT 'working',
    "productId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "nameEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sizesEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedPriceEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "noteEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftLine" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "kind" "DraftLineKind" NOT NULL,
    "ingredientId" TEXT,
    "newName" TEXT,
    "newNameKey" TEXT,
    "newKind" "IngredientMode",
    "purchaseQty" DECIMAL(12,3),
    "purchasePrice" INTEGER,
    "amount" DECIMAL(12,3) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "newNameEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "newKindEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchaseQtyEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchasePriceEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amountEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Draft_productId_key" ON "Draft"("productId");

-- CreateIndex
CREATE INDEX "Draft_projectId_createdAt_idx" ON "Draft"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "DraftLine_ingredientId_idx" ON "DraftLine"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftLine_draftId_ingredientId_key" ON "DraftLine"("draftId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftLine_draftId_newNameKey_key" ON "DraftLine"("draftId", "newNameKey");

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftLine" ADD CONSTRAINT "DraftLine_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftLine" ADD CONSTRAINT "DraftLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

