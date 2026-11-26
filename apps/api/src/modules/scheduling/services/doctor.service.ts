import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
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
    @Inject(RedisService) private readonly redis: RedisService,
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

    let symptomSpecialties: string[] | null = null;

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
          symptomSpecialties = trgmMatches.map((m) => m.specialty);
        } else {
          symptomSpecialties = [];
        }
      } catch {
        // Fallback to substring query if pg_trgm extension isn't in test memory
        const directMatches = await this.prisma.symptomSpecialty.findMany({
          where: {
            symptom: { contains: params.symptomQuery, mode: 'insensitive' },
          },
          take: 3,
        });
        symptomSpecialties = directMatches.map((m) => m.specialty);
      }
    }

    // P1-9 (b): Enforce AND condition when both symptom and specialty are provided
    let targetSpecialties: string[] = [];
    if (symptomSpecialties !== null && params.specialty) {
      const matches = symptomSpecialties.filter(
        (s) => s.toLowerCase() === params.specialty!.toLowerCase(),
      );
      targetSpecialties = matches.length > 0 ? matches : ['__NO_MATCH__'];
    } else if (symptomSpecialties !== null) {
      targetSpecialties = symptomSpecialties.length > 0 ? symptomSpecialties : ['__NO_MATCH__'];
    } else if (params.specialty) {
      targetSpecialties = [params.specialty];
    }

    // P1-9 (a): Push filters, distance (Haversine formula in SQL), and pagination to database
    const whereConditions: Prisma.Sql[] = [
      Prisma.sql`d.is_verified = true`,
      Prisma.sql`u.is_active = true`,
    ];

    if (targetSpecialties.length > 0) {
      whereConditions.push(
        Prisma.sql`d.specialty IN (${Prisma.join(targetSpecialties)})`,
      );
    }

    if (params.maxFeePaise !== undefined) {
      whereConditions.push(
        Prisma.sql`d.consultation_fee_paise <= ${params.maxFeePaise}`,
      );
    }

    if (params.minRating !== undefined && params.minRating > 0) {
      whereConditions.push(
        Prisma.sql`d.rating_avg >= ${params.minRating}`,
      );
    }

    const hasGeo =
      params.userLat !== undefined &&
      params.userLng !== undefined &&
      !isNaN(params.userLat) &&
      !isNaN(params.userLng);

    const distanceExpr = hasGeo
      ? Prisma.sql`
        CASE
          WHEN d.clinic_lat IS NOT NULL AND d.clinic_lng IS NOT NULL THEN
            6371 * acos(
              LEAST(1.0, GREATEST(-1.0,
                cos(radians(${params.userLat!})) * cos(radians(d.clinic_lat::double precision)) *
                cos(radians(d.clinic_lng::double precision) - radians(${params.userLng!})) +
                sin(radians(${params.userLat!})) * sin(radians(d.clinic_lat::double precision))
              ))
            )
          ELSE NULL
        END
      `
      : Prisma.sql`NULL::double precision`;

    if (hasGeo && params.maxDistanceKm !== undefined && params.maxDistanceKm > 0) {
      whereConditions.push(
        Prisma.sql`d.clinic_lat IS NOT NULL AND d.clinic_lng IS NOT NULL AND ${distanceExpr} <= ${params.maxDistanceKm}`,
      );
    }

    const whereSql = Prisma.sql`WHERE ${Prisma.join(whereConditions, ' AND ')}`;

    // Order By
    let orderBySql = Prisma.sql`ORDER BY u.created_at DESC, d.id ASC`;
    if (params.sortBy === 'FEE_ASC') {
      orderBySql = Prisma.sql`ORDER BY d.consultation_fee_paise ASC, d.id ASC`;
    } else if (params.sortBy === 'RATING_DESC') {
      orderBySql = Prisma.sql`ORDER BY d.rating_avg DESC, d.rating_count DESC, d.id ASC`;
    } else if (params.sortBy === 'DISTANCE_ASC' && hasGeo) {
      orderBySql = Prisma.sql`ORDER BY (CASE WHEN d.clinic_lat IS NOT NULL AND d.clinic_lng IS NOT NULL THEN ${distanceExpr} ELSE 999999 END) ASC, d.id ASC`;
    } else if (params.sortBy === 'EXPERIENCE_DESC') {
      orderBySql = Prisma.sql`ORDER BY d.experience_years DESC, d.id ASC`;
    }

    // Total Count in SQL
    const countResult = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      ${whereSql};
    `;
    const totalCount = Number(countResult[0]?.count || 0);

    // Paginated Doctors Query in SQL
    const doctors = await this.prisma.$queryRaw<
      Array<{
        id: string;
        userId: string;
        userName: string;
        userEmail: string;
        specialty: string;
        qualifications: string | null;
        experienceYears: number;
        clinicName: string | null;
        clinicAddress: string | null;
        consultationFeePaise: number;
        ratingAvg: number;
        ratingCount: number;
        photoUrl: string | null;
        distanceKm: number | null;
      }>
    >`
      SELECT
        d.id,
        d.user_id AS "userId",
        u.name AS "userName",
        u.email AS "userEmail",
        d.specialty,
        d.qualifications,
        d.experience_years AS "experienceYears",
        d.clinic_name AS "clinicName",
        d.clinic_address AS "clinicAddress",
        d.consultation_fee_paise AS "consultationFeePaise",
        d.rating_avg AS "ratingAvg",
        d.rating_count AS "ratingCount",
        d.photo_url AS "photoUrl",
        ${distanceExpr} AS "distanceKm"
      FROM doctors d
      JOIN users u ON d.user_id = u.id
      ${whereSql}
      ${orderBySql}
      LIMIT ${limit} OFFSET ${skip};
    `;

    // P1-9 (c): Batch next available slot via Redis MGET for current page only
    const client = this.redis.getClient();
    const slotMap = new Map<string, string | null>();

    if (client && doctors.length > 0) {
      try {
        const keys = doctors.map((d) => `cache:next_slot:${d.id}`);
        const cached = await client.mget(...keys);
        for (let i = 0; i < doctors.length; i++) {
          if (cached && cached[i]) {
            slotMap.set(doctors[i].id, cached[i]);
          }
        }
      } catch {
        // Ignore Redis error
      }
    }

    await Promise.all(
      doctors.map(async (doc) => {
        if (!slotMap.has(doc.id)) {
          const slot = await this.slotService.getNextAvailableSlot(doc.id);
          slotMap.set(doc.id, slot);
        }
      }),
    );

    const mapped = doctors.map((doc) => ({
      id: doc.id,
      name: doc.userName,
      email: doc.userEmail,
      specialty: doc.specialty,
      qualifications: doc.qualifications,
      experienceYears: doc.experienceYears,
      clinicName: doc.clinicName,
      clinicAddress: doc.clinicAddress,
      consultationFeePaise: doc.consultationFeePaise,
      averageRating: Math.round(Number(doc.ratingAvg) * 10) / 10,
      reviewCount: doc.ratingCount,
      distanceKm: doc.distanceKm !== null ? Math.round(Number(doc.distanceKm) * 10) / 10 : null,
      nextAvailableSlot: slotMap.get(doc.id) ?? null,
      photoUrl: doc.photoUrl,
    }));

    return {
      data: mapped,
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
        user: { select: { id: true, name: true, isActive: true } },
        availability: true,
        reviews: {
          include: { patient: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!doctor || !doctor.isVerified || !doctor.user.isActive) {
      throw new NotFoundException('Doctor not found');
    }

    return {
      id: doctor.id,
      userId: doctor.userId,
      specialty: doctor.specialty,
      qualifications: doctor.qualifications,
      experienceYears: doctor.experienceYears,
      clinicName: doctor.clinicName,
      clinicAddress: doctor.clinicAddress,
      clinicLat: doctor.clinicLat,
      clinicLng: doctor.clinicLng,
      consultationFeePaise: doctor.consultationFeePaise,
      photoUrl: doctor.photoUrl,
      isVerified: doctor.isVerified,
      user: {
        id: doctor.user.id,
        name: doctor.user.name,
      },
      availability: doctor.availability,
      reviews: doctor.reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        patientName: r.patient.name,
        createdAt: r.createdAt.toISOString(),
      })),
      averageRating: Math.round(doctor.ratingAvg * 10) / 10,
      reviewCount: doctor.ratingCount,
    };
  }
}
