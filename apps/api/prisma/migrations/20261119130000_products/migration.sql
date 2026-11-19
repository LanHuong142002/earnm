-- CreateEnum
CREATE TYPE "ProductSize" AS ENUM ('S', 'M', 'L');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "targetMargin" INTEGER NOT NULL DEFAULT 65,
ADD COLUMN     "targetMarginEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "nameEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sizesEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSizeRow" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "size" "ProductSize" NOT NULL,
    "sellingPrice" INTEGER,
    "priceEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linesEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSizeRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "id" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "amount" DECIMAL(12,3) NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SizeExtra" (
    "id" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "extraCostId" TEXT,

    CONSTRAINT "SizeExtra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtraCost" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "nameEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amountEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "defaultEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtraCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_projectId_createdAt_idx" ON "Product"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_projectId_nameKey_key" ON "Product"("projectId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSizeRow_productId_size_key" ON "ProductSizeRow"("productId", "size");

-- CreateIndex
CREATE INDEX "RecipeLine_ingredientId_idx" ON "RecipeLine"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeLine_sizeId_ingredientId_key" ON "RecipeLine"("sizeId", "ingredientId");

-- CreateIndex
CREATE INDEX "SizeExtra_sizeId_idx" ON "SizeExtra"("sizeId");

-- CreateIndex
CREATE INDEX "SizeExtra_extraCostId_idx" ON "SizeExtra"("extraCostId");

-- CreateIndex
CREATE INDEX "ExtraCost_projectId_createdAt_idx" ON "ExtraCost"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSizeRow" ADD CONSTRAINT "ProductSizeRow_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "ProductSizeRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SizeExtra" ADD CONSTRAINT "SizeExtra_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "ProductSizeRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SizeExtra" ADD CONSTRAINT "SizeExtra_extraCostId_fkey" FOREIGN KEY ("extraCostId") REFERENCES "ExtraCost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraCost" ADD CONSTRAINT "ExtraCost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
