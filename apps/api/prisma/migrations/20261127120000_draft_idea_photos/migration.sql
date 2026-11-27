-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "ideaId" TEXT;

-- CreateTable
CREATE TABLE "DraftPhoto" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "addedById" TEXT,
    "publicId" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "captionEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DraftPhoto_publicId_key" ON "DraftPhoto"("publicId");

-- CreateIndex
CREATE INDEX "DraftPhoto_draftId_createdAt_id_idx" ON "DraftPhoto"("draftId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Draft_ideaId_key" ON "Draft"("ideaId");

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPhoto" ADD CONSTRAINT "DraftPhoto_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPhoto" ADD CONSTRAINT "DraftPhoto_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
