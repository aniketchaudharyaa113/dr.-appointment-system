-- AlterTable lab_orders
ALTER TABLE "lab_orders" ADD COLUMN IF NOT EXISTS "result_notes" VARCHAR(1000);
ALTER TABLE "lab_orders" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3);
