-- CreateTable
CREATE TABLE "PaymentAlertSent" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAlertSent_pkey" PRIMARY KEY ("key")
);

-- Deny-all over Supabase's REST API, like every other public table.
ALTER TABLE "PaymentAlertSent" ENABLE ROW LEVEL SECURITY;
