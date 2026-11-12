-- DropIndex
DROP INDEX "Invite_projectId_idx";

-- CreateIndex
CREATE INDEX "Invite_projectId_createdAt_idx" ON "Invite"("projectId", "createdAt");
