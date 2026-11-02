import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { SlotService } from './slot.service';

export interface DoctorSearchParams {
  symptomQuery?: string;
  specialty?: string;
  maxFeePaise?: number;
  minRating?: number;
  availableToday?: boolean;
  userLat?: number;
  userLng?: number;
  maxDistanceKm?: number;
  sortBy?: 'FEE_ASC' | 'RATING_DESC' | 'DISTANCE_ASC' | 'EXPERIENCE_DESC';
  page?: number;
  limit?: number;
}

@Injectable()
export class DoctorService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SlotService) private readonly slotService: SlotService,
  ) {}

  /**
   * Calculates Haversine distance in kilometers between two geo coordinates
   */
  calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async searchDoctors(params: DoctorSearchParams) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(50, Math.max(1, params.limit || 10));
    const skip = (page - 1) * limit;

    let targetSpecialties: string[] = [];

    // 1. If symptom query provided, lookup top-3 matching specialties via pg_trgm similarity
    if (params.symptomQuery) {
      try {
        const trgmMatches = await this.prisma.$queryRaw<
          Array<{ specialty: string; similarity: number }>
        >`
          SELECT specialty, similarity(symptom, ${params.symptomQuery}) AS similarity
          FROM symptom_specialty_map
          WHERE symptom % ${params.symptomQuery}
          ORDER BY similarity DESC
          LIMIT 3;
        `;

        if (trgmMatches && trgmMatches.length > 0) {
          targetSpecialties = trgmMatches.map((m) => m.specialty);
        }
      } catch {
        // Fallback to substring query if pg_trgm extension isn't in test memory
        const directMatches = await this.prisma.symptomSpecialty.findMany({
          where: {
            symptom: { contains: params.symptomQuery, mode: 'insensitive' },
          },
          take: 3,
        });
        targetSpecialties = directMatches.map((m) => m.specialty);
      }
    }

    if (params.specialty) {
      targetSpecialties.push(params.specialty);
    }

    const whereClause: any = {
      isVerified: true,
      user: { isActive: true },
    };

    if (targetSpecialties.length > 0) {
      whereClause.specialty = { in: targetSpecialties };
    }

    if (params.maxFeePaise) {
      whereClause.consultationFeePaise = { lte: params.maxFeePaise };
    }

    // Fetch doctors
    const doctors = await this.prisma.doctor.findMany({
      where: whereClause,
      include: {
        user: { select: { id: true, name: true, email: true } },
        reviews: { select: { rating: true } },
      },
      skip,
      take: limit,
      orderBy:
        params.sortBy === 'FEE_ASC'
          ? { consultationFeePaise: 'asc' }
          : params.sortBy === 'EXPERIENCE_DESC'
            ? { experienceYears: 'desc' }
            : { user: { createdAt: 'desc' } },
    });

    const totalCount = await this.prisma.doctor.count({ where: whereClause });

    // Compute average ratings, distance, and next available slots

    const mapped = await Promise.all(
      doctors.map(async (doc) => {
        const ratingCount = doc.reviews.length;
        const avgRating =
          ratingCount > 0
            ? doc.reviews.reduce((acc, r) => acc + r.rating, 0) / ratingCount
            : 0;

        let distanceKm: number | null = null;
        if (
          params.userLat &&
          params.userLng &&
          doc.clinicLat &&
          doc.clinicLng
        ) {
          distanceKm = this.calculateDistance(
            params.userLat,
            params.userLng,
            Number(doc.clinicLat),
            Number(doc.clinicLng),
          );
        }

        const nextSlot = await this.slotService.getNextAvailableSlot(doc.id);

        return {
          id: doc.id,
          name: doc.user.name,
          email: doc.user.email,
          specialty: doc.specialty,
          qualifications: doc.qualifications,
          experienceYears: doc.experienceYears,
          clinicName: doc.clinicName,
          clinicAddress: doc.clinicAddress,
          consultationFeePaise: doc.consultationFeePaise,
          averageRating: Math.round(avgRating * 10) / 10,
          reviewCount: ratingCount,
          distanceKm: distanceKm ? Math.round(distanceKm * 10) / 10 : null,
          nextAvailableSlot: nextSlot,
          photoUrl: doc.photoUrl,
        };
      }),
    );

    // Apply post-filters if distance or rating requested
    let results = mapped;
    if (params.minRating) {
      results = results.filter((d) => d.averageRating >= params.minRating!);
    }
    if (params.maxDistanceKm) {
      results = results.filter(
        (d) => d.distanceKm !== null && d.distanceKm <= params.maxDistanceKm!,
      );
    }
    if (params.sortBy === 'RATING_DESC') {
      results.sort((a, b) => b.averageRating - a.averageRating);
    }
    if (params.sortBy === 'DISTANCE_ASC') {
      results.sort((a, b) => (a.distanceKm || 9999) - (b.distanceKm || 9999));
    }

    return {
      data: results,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }

  async getDoctorById(doctorId: string) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        availability: true,
        reviews: {
          include: { patient: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!doctor) {
      throw new NotFoundException('Doctor not found');
    }

    const ratingCount = doctor.reviews.length;
    const avgRating =
      ratingCount > 0
        ? doctor.reviews.reduce((acc, r) => acc + r.rating, 0) / ratingCount
        : 0;

    return {
      ...doctor,
      averageRating: Math.round(avgRating * 10) / 10,
      reviewCount: ratingCount,
    };
  }
}
