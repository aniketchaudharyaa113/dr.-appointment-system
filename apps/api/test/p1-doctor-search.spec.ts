import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  TestContext,
} from './helpers/test-app';
import { DoctorService } from '../src/modules/scheduling/services/doctor.service';

describe('P1-9: Scalable Doctor Search with SQL Haversine, Pagination, Rating, and Symptom AND Specialty', () => {
  let ctx: TestContext;
  let doctorService: DoctorService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
    doctorService = ctx.app.get(DoctorService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('filters doctors using SQL pagination, minRating, and Haversine distance', async () => {
    // Seed 3 doctors with varying coordinates, ratings, and fees
    // Doc 1: Bangalore center (12.9716, 77.5946), rating: 4.8, fee: 50000
    const { doctor: doc1 } = await seedVerifiedDoctor(ctx.prisma, { email: 'cardio-blr@medibook.test' });
    await ctx.prisma.doctor.update({
      where: { id: doc1.id },
      data: {
        specialty: 'Cardiology',
        clinicLat: 12.9716,
        clinicLng: 77.5946,
        ratingAvg: 4.8,
        ratingCount: 15,
        consultationFeePaise: 50000,
      },
    });

    // Doc 2: Indiranagar, Bangalore (~5km away, 12.9784, 77.6408), rating: 3.5, fee: 80000
    const { doctor: doc2 } = await seedVerifiedDoctor(ctx.prisma, { email: 'cardio-indiranagar@medibook.test' });
    await ctx.prisma.doctor.update({
      where: { id: doc2.id },
      data: {
        specialty: 'Cardiology',
        clinicLat: 12.9784,
        clinicLng: 77.6408,
        ratingAvg: 3.5,
        ratingCount: 4,
        consultationFeePaise: 80000,
      },
    });

    // Doc 3: Delhi (~1740km away, 28.6139, 77.2090), rating: 4.9, fee: 30000
    const { doctor: doc3 } = await seedVerifiedDoctor(ctx.prisma, { email: 'peds-delhi@medibook.test' });
    await ctx.prisma.doctor.update({
      where: { id: doc3.id },
      data: {
        specialty: 'Pediatrics',
        clinicLat: 28.6139,
        clinicLng: 77.2090,
        ratingAvg: 4.9,
        ratingCount: 20,
        consultationFeePaise: 30000,
      },
    });

    // 1. Pagination check: limit: 2
    const page1 = await doctorService.searchDoctors({ page: 1, limit: 2 });
    expect(page1.data.length).toBe(2);
    expect(page1.pagination.total).toBe(3);
    expect(page1.pagination.totalPages).toBe(2);

    // 2. Rating filter in SQL: minRating: 4.0 (excludes doc2 with 3.5)
    const highRated = await doctorService.searchDoctors({ minRating: 4.0 });
    const ids = highRated.data.map((d) => d.id);
    expect(ids).toContain(doc1.id);
    expect(ids).toContain(doc3.id);
    expect(ids).not.toContain(doc2.id);

    // 3. Haversine distance filter in SQL: user at Bangalore (12.9716, 77.5946), maxDistanceKm: 15
    const nearby = await doctorService.searchDoctors({
      userLat: 12.9716,
      userLng: 77.5946,
      maxDistanceKm: 15,
      sortBy: 'DISTANCE_ASC',
    });
    expect(nearby.data.length).toBe(2);
    expect(nearby.data[0].id).toBe(doc1.id); // 0 km
    expect(nearby.data[1].id).toBe(doc2.id); // ~5 km
    expect(nearby.data.map((d) => d.id)).not.toContain(doc3.id); // Delhi is excluded
  });

  it('enforces AND condition when both symptom and specialty are provided', async () => {
    // Seed Symptom to Specialty mapping: "chest pain" -> "Cardiology"
    await ctx.prisma.symptomSpecialty.create({
      data: {
        symptom: 'severe chest pain',
        specialty: 'Cardiology',
      },
    });

    // Matching symptom ("chest pain") AND matching specialty ("Cardiology")
    const match = await doctorService.searchDoctors({
      symptomQuery: 'chest pain',
      specialty: 'Cardiology',
    });
    expect(match.data.length).toBeGreaterThanOrEqual(1);
    expect(match.data.every((d) => d.specialty === 'Cardiology')).toBe(true);

    // Matching symptom ("chest pain") AND non-matching specialty ("Pediatrics")
    const mismatch = await doctorService.searchDoctors({
      symptomQuery: 'chest pain',
      specialty: 'Pediatrics',
    });
    // Should return 0 since intersection of Cardiology and Pediatrics is empty!
    expect(mismatch.data.length).toBe(0);
    expect(mismatch.pagination.total).toBe(0);
  });
});
