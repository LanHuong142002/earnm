-- CreateTable
CREATE TABLE "DeviceProjectSync" (
    "token" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceProjectSync_pkey" PRIMARY KEY ("token","projectId")
);

-- CreateIndex
CREATE INDEX "DeviceProjectSync_projectId_idx" ON "DeviceProjectSync"("projectId");

-- AddForeignKey
ALTER TABLE "DeviceProjectSync" ADD CONSTRAINT "DeviceProjectSync_token_fkey" FOREIGN KEY ("token") REFERENCES "DevicePushToken"("token") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceProjectSync" ADD CONSTRAINT "DeviceProjectSync_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
