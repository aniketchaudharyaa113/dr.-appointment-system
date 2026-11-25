import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function seedDoctor(params: {
  email: string;
  passwordHash: string;
  name: string;
  phone: string;
  specialty: string;
  qualifications: string;
  experienceYears: number;
  clinicName: string;
  clinicAddress: string;
  clinicLat: number;
  clinicLng: number;
  consultationFeePaise: number;
  licenseNumber: string;
}) {
  const user = await prisma.user.upsert({
    where: { email: params.email },
    update: {},
    create: {
      email: params.email,
      passwordHash: params.passwordHash,
      name: params.name,
      phone: params.phone,
      role: 'DOCTOR',
    },
  });

  const doctor = await prisma.doctor.upsert({
    where: { userId: user.id },
    update: { isVerified: true, verificationStatus: 'APPROVED' },
    create: {
      userId: user.id,
      specialty: params.specialty,
      qualifications: params.qualifications,
      experienceYears: params.experienceYears,
      clinicName: params.clinicName,
      clinicAddress: params.clinicAddress,
      clinicLat: params.clinicLat,
      clinicLng: params.clinicLng,
      consultationFeePaise: params.consultationFeePaise,
      licenseNumber: params.licenseNumber,
      isVerified: true,
      verificationStatus: 'APPROVED',
    },
  });

  // Availability: Sun-Sat (0..6) 09:00 - 20:00, 15 min slots
  for (let day = 0; day <= 6; day++) {
    const existingAvail = await prisma.availability.findFirst({
      where: { doctorId: doctor.id, dayOfWeek: day },
    });
    if (!existingAvail) {
      await prisma.availability.create({
        data: {
          doctorId: doctor.id,
          dayOfWeek: day,
          startTime: '09:00:00',
          endTime: '20:00:00',
          slotDurationMinutes: 15,
        },
      });
    }
  }

  return { user, doctor };
}

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

  // 2. Seed Verified Doctors
  await seedDoctor({
    email: 'doctor@medibook.test',
    passwordHash,
    name: 'Dr. Subhash Chandra',
    phone: '+919876543211',
    specialty: 'Cardiology',
    qualifications: 'MBBS, MD, DM (Cardiology)',
    experienceYears: 18,
    clinicName: 'Kolkata Heart Institute',
    clinicAddress: '12/A Park Circus, Kolkata, West Bengal 700017',
    clinicLat: 22.5411,
    clinicLng: 88.3653,
    consultationFeePaise: 80000,
    licenseNumber: 'WMC-CARDIO-44912',
  });

  await seedDoctor({
    email: 'dermatologist@medibook.test',
    passwordHash,
    name: 'Dr. Debolina Sen',
    phone: '+919876543214',
    specialty: 'Dermatology',
    qualifications: 'MBBS, MD (Dermatology)',
    experienceYears: 11,
    clinicName: 'Salt Lake Skin Care Centre',
    clinicAddress: 'Sector V, Salt Lake, Kolkata, West Bengal 700091',
    clinicLat: 22.5797,
    clinicLng: 88.4342,
    consultationFeePaise: 60000,
    licenseNumber: 'WMC-DERM-33184',
  });

  await seedDoctor({
    email: 'physician@medibook.test',
    passwordHash,
    name: 'Dr. Saptarshi Banerjee',
    phone: '+919876543215',
    specialty: 'General Medicine',
    qualifications: 'MBBS, MD (Internal Medicine)',
    experienceYears: 14,
    clinicName: 'South City Medical Chambers',
    clinicAddress: 'Prince Anwar Shah Rd, Kolkata, West Bengal 700068',
    clinicLat: 22.5015,
    clinicLng: 88.3612,
    consultationFeePaise: 50000,
    licenseNumber: 'WMC-GEN-28190',
  });

  await seedDoctor({
    email: 'pediatrician@medibook.test',
    passwordHash,
    name: 'Dr. Priyanka Chatterjee',
    phone: '+919876543216',
    specialty: 'Pediatrics',
    qualifications: 'MBBS, MD (Pediatrics)',
    experienceYears: 9,
    clinicName: 'New Town Child Wellness Clinic',
    clinicAddress: 'Action Area II, New Town, Kolkata 700161',
    clinicLat: 22.5867,
    clinicLng: 88.4754,
    consultationFeePaise: 70000,
    licenseNumber: 'WMC-PED-51029',
  });
  console.log('✓ 4 Verified Doctors seeded with daily availability');

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
    update: { isOnline: true, lastLat: 22.5512, lastLng: 88.3524 },
    create: {
      userId: driverUser.id,
      vehicleNumber: 'WB-01-AMB-112',
      isOnline: true,
      lastLat: 22.5512,
      lastLng: 88.3524,
    },
  });
  console.log('✓ Ambulance Driver 1 seeded:', driverUser.email);

  const driverUser2 = await prisma.user.upsert({
    where: { email: 'driver2@medibook.test' },
    update: {},
    create: {
      email: 'driver2@medibook.test',
      passwordHash,
      name: 'Rajib Das',
      phone: '+919876543214',
      role: 'DRIVER',
    },
  });

  await prisma.ambulanceDriverProfile.upsert({
    where: { userId: driverUser2.id },
    update: { isOnline: true, lastLat: 22.5804, lastLng: 88.4378 },
    create: {
      userId: driverUser2.id,
      vehicleNumber: 'WB-02-AMB-204',
      isOnline: true,
      lastLat: 22.5804,
      lastLng: 88.4378,
    },
  });
  console.log('✓ Ambulance Driver 2 seeded:', driverUser2.email);

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
