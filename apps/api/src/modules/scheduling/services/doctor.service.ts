import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import { SlotService } from './slot.service';
import { getIstDayBoundsUtc, getIstDateString } from '../../../common/utils/ist-time';
import { UpdateDoctorAvailabilityInput, UpdateDoctorProfileInput } from '@medibook/shared';

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
    const rawSearchQuery = params.symptomQuery?.trim();

    // 1. If symptom/search query provided, lookup matching specialties via pg_trgm similarity OR substring match
    if (rawSearchQuery) {
      const likePattern = `%${rawSearchQuery}%`;
      try {
        const trgmMatches = await this.prisma.$queryRaw<
          Array<{ specialty: string; similarity: number }>
        >`
          SELECT DISTINCT ON (specialty) specialty, similarity(symptom, ${rawSearchQuery}) AS similarity
          FROM symptom_specialty_map
          WHERE symptom % ${rawSearchQuery}
             OR symptom ILIKE ${likePattern}
             OR specialty ILIKE ${likePattern}
          ORDER BY specialty, similarity DESC
          LIMIT 5;
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
            OR: [
              { symptom: { contains: rawSearchQuery, mode: 'insensitive' } },
              { specialty: { contains: rawSearchQuery, mode: 'insensitive' } },
            ],
          },
          take: 5,
        });
        symptomSpecialties = directMatches.map((m) => m.specialty);
      }
    }

    const expandSpecialtySynonyms = (spec: string): string[] => {
      const lower = spec.toLowerCase();
      if (lower === 'general physician' || lower === 'general medicine') {
        return ['General Medicine', 'General Physician'];
      }
      return [spec];
    };

    // P1-9 (b): Enforce AND condition when both symptom and specialty are provided,
    // while allowing direct match against doctor name / specialty / clinic when searching free text
    const whereConditions: Prisma.Sql[] = [
      Prisma.sql`d.is_verified = true`,
      Prisma.sql`u.is_active = true`,
    ];

    if (params.specialty) {
      const requestedSpecs = expandSpecialtySynonyms(params.specialty);
      if (symptomSpecialties !== null) {
        // Both symptom and specialty filters supplied: enforce intersection if symptom mapped to specialties,
        // or match free-text against doctor profile within the requested specialty
        const expandedSymptomSpecs = symptomSpecialties.flatMap(expandSpecialtySynonyms);
        const matches = expandedSymptomSpecs.filter((s) =>
          requestedSpecs.some((r) => r.toLowerCase() === s.toLowerCase()),
        );
        if (symptomSpecialties.length > 0 && matches.length === 0) {
          whereConditions.push(Prisma.sql`1 = 0`);
        } else {
          whereConditions.push(
            Prisma.sql`d.specialty IN (${Prisma.join(requestedSpecs)})`,
          );
          if (symptomSpecialties.length === 0 && rawSearchQuery) {
            const likeQ = `%${rawSearchQuery}%`;
            whereConditions.push(
              Prisma.sql`(u.name ILIKE ${likeQ} OR d.specialty ILIKE ${likeQ} OR COALESCE(d.qualifications, '') ILIKE ${likeQ} OR COALESCE(d.clinic_name, '') ILIKE ${likeQ})`,
            );
          }
        }
      } else {
        whereConditions.push(
          Prisma.sql`d.specialty IN (${Prisma.join(requestedSpecs)})`,
        );
      }
    } else if (symptomSpecialties !== null && rawSearchQuery) {
      const expandedSpecs = Array.from(
        new Set(symptomSpecialties.flatMap(expandSpecialtySynonyms)),
      );
      const likeQ = `%${rawSearchQuery}%`;
      if (expandedSpecs.length > 0) {
        whereConditions.push(
          Prisma.sql`(d.specialty IN (${Prisma.join(expandedSpecs)}) OR u.name ILIKE ${likeQ} OR d.specialty ILIKE ${likeQ})`,
        );
      } else {
        whereConditions.push(
          Prisma.sql`(u.name ILIKE ${likeQ} OR d.specialty ILIKE ${likeQ} OR COALESCE(d.qualifications, '') ILIKE ${likeQ} OR COALESCE(d.clinic_name, '') ILIKE ${likeQ})`,
        );
      }
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

  async getDoctorDashboard(userId: string) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { userId },
      include: {
        user: true,
        leaves: { orderBy: { startDate: 'desc' } },
      },
    });

    if (!doctor) {
      throw new NotFoundException('Doctor profile not found');
    }

    const { start: startOfDay, end: endOfDay } = getIstDayBoundsUtc(getIstDateString(new Date()));
    const now = new Date();

    const [
      doctorLedgers,
      todayAppts,
      upcomingCount,
      completedCount,
      cancelledCount,
      recentReviews,
    ] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where: {
          accountType: 'DOCTOR_PAYABLE',
          entryType: 'CREDIT',
          payment: { appointment: { doctorId: doctor.id } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.appointment.findMany({
        where: {
          doctorId: doctor.id,
          slotTime: { gte: startOfDay, lte: endOfDay },
          status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
        },
        include: {
          patient: { select: { id: true, name: true, phone: true } },
          consultation: true,
        },
        orderBy: { slotTime: 'asc' },
      }),
      this.prisma.appointment.count({
        where: {
          doctorId: doctor.id,
          slotTime: { gt: now },
          status: 'CONFIRMED',
        },
      }),
      this.prisma.appointment.count({
        where: {
          doctorId: doctor.id,
          status: 'COMPLETED',
        },
      }),
      this.prisma.appointment.count({
        where: {
          doctorId: doctor.id,
          status: 'CANCELLED',
        },
      }),
      this.prisma.review.findMany({
        where: { doctorId: doctor.id },
        include: {
          appointment: {
            select: {
              patient: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const totalEarningsPaise = doctorLedgers.reduce((sum, e) => sum + e.amountPaise, 0);

    // Weekly earnings breakdown for chart
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyEarningsMap = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      dailyEarningsMap.set(dayNames[d.getDay()], 0);
    }
    for (const entry of doctorLedgers) {
      const diffDays = Math.floor((now.getTime() - entry.createdAt.getTime()) / (24 * 60 * 60 * 1000));
      if (diffDays >= 0 && diffDays < 7) {
        const dayStr = dayNames[entry.createdAt.getDay()];
        const current = dailyEarningsMap.get(dayStr) || 0;
        dailyEarningsMap.set(dayStr, current + Math.round(entry.amountPaise / 100));
      }
    }

    const earningsChart = Array.from(dailyEarningsMap.entries()).map(([day, earnings]) => ({
      day,
      earnings,
    }));

    return {
      doctorId: doctor.id,
      doctorName: doctor.user.name,
      specialty: doctor.specialty,
      isVerified: doctor.isVerified,
      verificationStatus: doctor.verificationStatus,
      licenseNumber: doctor.licenseNumber,
      photoUrl: doctor.photoUrl,
      stats: {
        totalEarningsPaise,
        totalConsultations: completedCount,
        todayQueueCount: todayAppts.length,
        upcomingCount,
        cancelledCount,
      },
      earningsChart,
      todayQueue: todayAppts.map((a) => ({
        id: a.id,
        bookingRef: a.bookingRef,
        patientName: a.patient.name,
        patientPhone: a.patient.phone,
        slotTime: a.slotTime.toISOString(),
        consultationMode: a.consultationMode,
        status: a.status,
        chiefComplaint: a.notes || 'General medical follow-up',
        sessionStatus: a.consultation?.status || 'SCHEDULED',
      })),
      leaves: doctor.leaves.map((l) => ({
        id: l.id,
        startDate: l.startDate.toISOString().slice(0, 10),
        endDate: l.endDate.toISOString().slice(0, 10),
        reason: l.reason,
      })),
      reviews: recentReviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        patientName: r.appointment?.patient?.name || 'Verified Patient',
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async getDoctorProfile(userId: string) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        availability: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
      },
    });

    if (!doctor) {
      throw new NotFoundException('Doctor profile not found');
    }

    return {
      id: doctor.id,
      userId: doctor.userId,
      name: doctor.user.name,
      email: doctor.user.email,
      phone: doctor.user.phone,
      specialty: doctor.specialty,
      qualifications: doctor.qualifications,
      experienceYears: doctor.experienceYears,
      clinicName: doctor.clinicName,
      clinicAddress: doctor.clinicAddress,
      consultationFeePaise: doctor.consultationFeePaise,
      licenseNumber: doctor.licenseNumber,
      isVerified: doctor.isVerified,
      verificationStatus: doctor.verificationStatus,
      photoUrl: doctor.photoUrl,
      availability: doctor.availability,
    };
  }

  async updateDoctorProfile(userId: string, input: UpdateDoctorProfileInput) {
    const doctor = await this.prisma.doctor.findUnique({ where: { userId } });
    if (!doctor) {
      throw new NotFoundException('Doctor profile not found');
    }

    return this.prisma.doctor.update({
      where: { id: doctor.id },
      data: {
        specialty: input.specialty,
        qualifications: input.qualifications,
        experienceYears: input.experienceYears,
        clinicName: input.clinicName,
        clinicAddress: input.clinicAddress,
        consultationFeePaise: input.consultationFeePaise,
        licenseNumber: input.licenseNumber,
        photoUrl: input.photoUrl,
      },
    });
  }

  async updateDoctorAvailability(userId: string, input: UpdateDoctorAvailabilityInput) {
    const doctor = await this.prisma.doctor.findUnique({ where: { userId } });
    if (!doctor) {
      throw new NotFoundException('Doctor profile not found');
    }

    const parseMins = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const byDay = new Map<number, Array<{ startMins: number; endMins: number }>>();

    for (const s of input.slots) {
      const startMins = parseMins(s.startTime);
      const endMins = parseMins(s.endTime);
      const duration = s.slotDurationMinutes || 15;
      if (startMins >= endMins) {
        throw new BadRequestException(
          `startTime ${s.startTime} must be before endTime ${s.endTime}`,
        );
      }
      if ((endMins - startMins) % duration !== 0) {
        throw new BadRequestException(
          `slotDurationMinutes ${duration} must evenly divide window ${s.startTime}-${s.endTime}`,
        );
      }
      if (!byDay.has(s.dayOfWeek)) byDay.set(s.dayOfWeek, []);
      byDay.get(s.dayOfWeek)!.push({ startMins, endMins });
    }

    for (const [, daySlots] of byDay) {
      daySlots.sort((a, b) => a.startMins - b.startMins);
      for (let j = 0; j < daySlots.length - 1; j++) {
        if (daySlots[j].endMins > daySlots[j + 1].startMins) {
          throw new BadRequestException(
            'Overlapping availability windows on the same day are not allowed',
          );
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.availability.deleteMany({
        where: { doctorId: doctor.id },
      });

      if (input.slots.length > 0) {
        await tx.availability.createMany({
          data: input.slots.map((s: { dayOfWeek: number; startTime: string; endTime: string; slotDurationMinutes?: number }) => ({
            doctorId: doctor.id,
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime.length === 5 ? `${s.startTime}:00` : s.startTime,
            endTime: s.endTime.length === 5 ? `${s.endTime}:00` : s.endTime,
            slotDurationMinutes: s.slotDurationMinutes || 15,
          })),
        });
      }

      return tx.availability.findMany({
        where: { doctorId: doctor.id },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
    });
  }
}
