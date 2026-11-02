import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting MediBook database seeding...');

  const passwordHash = await argon2.hash('Password123!', {
    type: argon2.argon2id,
  });

  // 1. Seed Admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@medibook.test' },
    update: {},
    create: {
      email: 'admin@medibook.test',
      passwordHash,
      name: 'System Administrator',
      phone: '+919876543210',
      role: 'ADMIN',
    },
  });
  console.log('✓ Admin seeded:', admin.email);

  // 2. Seed Verified Doctor
  const doctorUser = await prisma.user.upsert({
    where: { email: 'doctor@medibook.test' },
    update: {},
    create: {
      email: 'doctor@medibook.test',
      passwordHash,
      name: 'Dr. Subhash Chandra',
      phone: '+919876543211',
      role: 'DOCTOR',
    },
  });

  const doctor = await prisma.doctor.upsert({
    where: { userId: doctorUser.id },
    update: { isVerified: true, verificationStatus: 'APPROVED' },
    create: {
      userId: doctorUser.id,
      specialty: 'Cardiology',
      qualifications: 'MBBS, MD, DM (Cardiology)',
      experienceYears: 18,
      clinicName: 'Kolkata Heart Institute',
      clinicAddress: '12/A Park Circus, Kolkata, West Bengal 700017',
      clinicLat: 22.5411,
      clinicLng: 88.3653,
      consultationFeePaise: 80000, // 800 INR
      licenseNumber: 'WMC-CARDIO-44912',
      isVerified: true,
      verificationStatus: 'APPROVED',
    },
  });

  // Availability: Mon-Sat 09:00 - 17:00, 15 min slots
  for (let day = 1; day <= 6; day++) {
    const existingAvail = await prisma.availability.findFirst({
      where: { doctorId: doctor.id, dayOfWeek: day },
    });
    if (!existingAvail) {
      await prisma.availability.create({
        data: {
          doctorId: doctor.id,
          dayOfWeek: day,
          startTime: '09:00:00',
          endTime: '17:00:00',
          slotDurationMinutes: 15,
        },
      });
    }
  }
  console.log('✓ Doctor seeded with availability:', doctorUser.email);

  // 3. Seed Patient
  const patient = await prisma.user.upsert({
    where: { email: 'patient@medibook.test' },
    update: {},
    create: {
      email: 'patient@medibook.test',
      passwordHash,
      name: 'Anita Roy',
      phone: '+919876543212',
      role: 'PATIENT',
    },
  });
  console.log('✓ Patient seeded:', patient.email);

  // 4. Seed Ambulance Driver
  const driverUser = await prisma.user.upsert({
    where: { email: 'driver@medibook.test' },
    update: {},
    create: {
      email: 'driver@medibook.test',
      passwordHash,
      name: 'Vikram Singh',
      phone: '+919876543213',
      role: 'DRIVER',
    },
  });

  await prisma.ambulanceDriverProfile.upsert({
    where: { userId: driverUser.id },
    update: { isOnline: true },
    create: {
      userId: driverUser.id,
      vehicleNumber: 'WB-01-AMB-112',
      isOnline: true,
      lastLat: 22.5726,
      lastLng: 88.3639,
    },
  });
  console.log('✓ Ambulance Driver seeded:', driverUser.email);

  // 5. Seed Common Symptoms
  const symptoms = [
    { symptom: 'chest pain', specialty: 'Cardiology' },
    { symptom: 'shortness of breath', specialty: 'Cardiology' },
    { symptom: 'high blood pressure', specialty: 'Cardiology' },
    { symptom: 'skin rash', specialty: 'Dermatology' },
    { symptom: 'acne', specialty: 'Dermatology' },
    { symptom: 'fever and chills', specialty: 'General Medicine' },
    { symptom: 'cough', specialty: 'General Medicine' },
    { symptom: 'toothache', specialty: 'Dentistry' },
    { symptom: 'blurry vision', specialty: 'Ophthalmology' },
    { symptom: 'child fever', specialty: 'Pediatrics' },
  ];

  for (const s of symptoms) {
    const existing = await prisma.symptomSpecialty.findFirst({
      where: { symptom: s.symptom },
    });
    if (!existing) {
      await prisma.symptomSpecialty.create({ data: s });
    }
  }
  console.log('✓ Symptoms mapped to specialties seeded');

  console.log('✅ Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
