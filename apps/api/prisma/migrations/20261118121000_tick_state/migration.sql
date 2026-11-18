-- CreateTable
CREATE TABLE "TickState" (
    "id" TEXT NOT NULL DEFAULT 'tick',
    "lastTickAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TickState_pkey" PRIMARY KEY ("id")
);
