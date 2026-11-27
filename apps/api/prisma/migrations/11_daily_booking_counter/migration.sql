-- CreateTable
CREATE TABLE "daily_booking_counters" (
    "booking_date" DATE NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_booking_counters_pkey" PRIMARY KEY ("booking_date")
);
