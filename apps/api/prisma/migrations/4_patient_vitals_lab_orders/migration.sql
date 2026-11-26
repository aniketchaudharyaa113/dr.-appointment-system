-- CreateTable patient_vitals
CREATE TABLE "patient_vitals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "systolic_bp" INTEGER,
    "diastolic_bp" INTEGER,
    "heart_rate" INTEGER,
    "spO2" DECIMAL(5,2),
    "temperature_f" DECIMAL(4,1),
    "weight_kg" DECIMAL(5,2),
    "blood_glucose" DECIMAL(5,1),
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_vitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable lab_orders
CREATE TABLE "lab_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "test_name" VARCHAR(120) NOT NULL,
    "test_code" VARCHAR(30) NOT NULL,
    "urgency" VARCHAR(20) NOT NULL DEFAULT 'ROUTINE',
    "instructions" VARCHAR(500),
    "status" VARCHAR(30) NOT NULL DEFAULT 'ORDERED',
    "results_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_vitals_patient_id_recorded_at_idx" ON "patient_vitals"("patient_id", "recorded_at");
CREATE INDEX "patient_vitals_appointment_id_idx" ON "patient_vitals"("appointment_id");

-- CreateIndex
CREATE INDEX "lab_orders_patient_id_created_at_idx" ON "lab_orders"("patient_id", "created_at");
CREATE INDEX "lab_orders_appointment_id_idx" ON "lab_orders"("appointment_id");

-- AddForeignKey
ALTER TABLE "patient_vitals" ADD CONSTRAINT "patient_vitals_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_vitals" ADD CONSTRAINT "patient_vitals_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
