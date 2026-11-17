-- CreateTable
CREATE TABLE "TaskPhoto" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "addedById" TEXT,
    "publicId" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "captionEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskPhoto_publicId_key" ON "TaskPhoto"("publicId");

-- CreateIndex
CREATE INDEX "TaskPhoto_taskId_createdAt_id_idx" ON "TaskPhoto"("taskId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "TaskPhoto" ADD CONSTRAINT "TaskPhoto_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPhoto" ADD CONSTRAINT "TaskPhoto_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
