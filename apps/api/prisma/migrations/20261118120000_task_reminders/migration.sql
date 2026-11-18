-- CreateEnum
CREATE TYPE "ReminderRepeat" AS ENUM ('once', 'daily', 'weekly', 'monthly');

-- CreateTable
CREATE TABLE "TaskReminder" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "time" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "repeat" "ReminderRepeat" NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "endDate" DATE,
    "scheduleEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientsEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskReminderRecipient" (
    "reminderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TaskReminderRecipient_pkey" PRIMARY KEY ("reminderId","userId")
);

-- CreateTable
CREATE TABLE "DevicePushToken" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevicePushToken_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "ReminderPushSent" (
    "reminderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "occurrenceAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderPushSent_pkey" PRIMARY KEY ("reminderId","userId","occurrenceAt")
);

-- CreateIndex
CREATE INDEX "TaskReminder_taskId_idx" ON "TaskReminder"("taskId");

-- CreateIndex
CREATE INDEX "TaskReminderRecipient_userId_idx" ON "TaskReminderRecipient"("userId");

-- CreateIndex
CREATE INDEX "DevicePushToken_userId_idx" ON "DevicePushToken"("userId");

-- AddForeignKey
ALTER TABLE "TaskReminder" ADD CONSTRAINT "TaskReminder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReminder" ADD CONSTRAINT "TaskReminder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReminderRecipient" ADD CONSTRAINT "TaskReminderRecipient_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "TaskReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReminderRecipient" ADD CONSTRAINT "TaskReminderRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevicePushToken" ADD CONSTRAINT "DevicePushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderPushSent" ADD CONSTRAINT "ReminderPushSent_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "TaskReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderPushSent" ADD CONSTRAINT "ReminderPushSent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

