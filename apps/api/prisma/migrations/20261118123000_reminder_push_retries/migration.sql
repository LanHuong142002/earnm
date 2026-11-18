-- A claim is not yet a delivery: sentAt is null until the push service accepted it, so a failed
-- or interrupted send can be retried. Existing rows were claimed and sent under the old rule.
ALTER TABLE "ReminderPushSent" ALTER COLUMN "sentAt" DROP NOT NULL;
ALTER TABLE "ReminderPushSent" ALTER COLUMN "sentAt" DROP DEFAULT;
ALTER TABLE "ReminderPushSent" ADD COLUMN "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ReminderPushSent" ADD COLUMN "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ReminderPushSent" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1;
UPDATE "ReminderPushSent" SET "claimedAt" = "sentAt", "lastAttemptAt" = "sentAt";

-- CreateIndex
CREATE INDEX "ReminderPushSent_sentAt_claimedAt_idx" ON "ReminderPushSent"("sentAt", "claimedAt");
