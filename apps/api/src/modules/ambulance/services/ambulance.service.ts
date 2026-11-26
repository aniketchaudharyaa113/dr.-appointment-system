import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import { RealtimeService } from '../../platform/realtime/realtime.service';
import { env } from '../../../common/config/env.schema';

export interface HospitalInfo {
  id: string;
  name: string;
  address: string;
  phone: string;
  emergencyPhone: string;
  latitude: number;
  longitude: number;
  distanceKm?: number;
  hasTraumaCenter: boolean;
}

export const KOLKATA_HOSPITALS: HospitalInfo[] = [
  {
    id: 'hosp-1',
    name: 'SSKM Government Hospital & Trauma Centre',
    address: '244 AJC Bose Road, Bhowanipore, Kolkata',
    phone: '033-2223-1589',
    emergencyPhone: '108',
    latitude: 22.5398,
    longitude: 88.3435,
    hasTraumaCenter: true,
  },
  {
    id: 'hosp-2',
    name: 'AMRI Hospital Dhakuria',
    address: 'Block-A, Scheme-LII, P-4&5, Gariahat Rd, Kolkata',
    phone: '033-6680-0000',
    emergencyPhone: '1066',
    latitude: 22.5085,
    longitude: 88.3654,
    hasTraumaCenter: true,
  },
  {
    id: 'hosp-3',
    name: 'Apollo Gleneagles Hospital',
    address: '58 Canal Circular Rd, Kadapara, Phool Bagan, Kolkata',
    phone: '033-2320-3040',
    emergencyPhone: '1066',
    latitude: 22.5702,
    longitude: 88.3986,
    hasTraumaCenter: true,
  },
  {
    id: 'hosp-4',
    name: 'Calcutta Medical College and Hospital',
    address: '88 College Street, College Square, Kolkata',
    phone: '033-2255-1621',
    emergencyPhone: '102',
    latitude: 22.5744,
    longitude: 88.3629,
    hasTraumaCenter: true,
  },
  {
    id: 'hosp-5',
    name: 'Fortis Hospital Anandapur',
    address: '730, Anandapur, E.M. Bypass Road, Kolkata',
    phone: '033-6628-4444',
    emergencyPhone: '105010',
    latitude: 22.5186,
    longitude: 88.4022,
    hasTraumaCenter: true,
  },
];

const ALLOWED_TRIP_TRANSITIONS: Record<string, string[]> = {
  ACCEPTED: ['EN_ROUTE', 'ARRIVED', 'COMPLETED'],
  EN_ROUTE: ['ARRIVED', 'COMPLETED'],
  ARRIVED: ['COMPLETED'],
};

@Injectable()
export class AmbulanceService implements OnModuleDestroy {
  private readonly logger = new Logger(AmbulanceService.name);
  private readonly geoKey = 'ambulance:drivers:geo';
  private readonly offerTimers = new Map<string, NodeJS.Timeout>();
  private readonly simulationIntervals = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) { }

  onModuleDestroy() {
    for (const timer of this.offerTimers.values()) {
      clearTimeout(timer);
    }
    this.offerTimers.clear();
    for (const interval of this.simulationIntervals.values()) {
      clearInterval(interval);
    }
    this.simulationIntervals.clear();
  }

  private clearOfferTimer(requestId: string) {
    const existing = this.offerTimers.get(requestId);
    if (existing) {
      clearTimeout(existing);
      this.offerTimers.delete(requestId);
    }
  }

  private scheduleOfferTimeout(
    requestId: string,
    driverId: string,
    timeoutMs: number,
  ) {
    this.clearOfferTimer(requestId);
    const timer = setTimeout(() => {
      this.offerTimers.delete(requestId);
      this.handleOfferTimeout(requestId, driverId, timeoutMs).catch((err) => {
        this.logger.error(`Offer timeout error for ${requestId}: ${err}`);
      });
    }, timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.offerTimers.set(requestId, timer);
  }

  /**
   * Emergency SOS info and nearby hospitals. Works even if 0 drivers are online.
   */
  getEmergencyInfo(lat?: number, lng?: number) {
    let hospitals = [...KOLKATA_HOSPITALS];

    if (lat !== undefined && lng !== undefined) {
      hospitals = hospitals
        .map((h) => ({
          ...h,
          distanceKm: this.calculateHaversineDistanceKm(
            lat,
            lng,
            h.latitude,
            h.longitude,
          ),
        }))
        .sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
    }

    return {
      emergencyHotlines: [
        {
          name: 'National Emergency',
          number: '112',
          description: 'Police, Fire, Ambulance',
        },
        {
          name: 'Medical & Ambulance Hotline',
          number: '108',
          description: 'Direct 24/7 Ambulance Hotline',
        },
        {
          name: 'Emergency Disaster Control',
          number: '1070',
          description: 'State Disaster Management',
        },
      ],
      hospitals,
    };
  }

  /**
   * Lists online drivers with active Redis heartbeats and their live GEO coordinates.
   */
  async getOnlineDrivers(lat = 22.5726, lng = 88.3639) {
    const client = this.redis.getClient();
    const results = (await client.georadius(
      this.geoKey,
      lng,
      lat,
      50,
      'km',
      'WITHDIST',
      'WITHCOORD',
      'ASC',
    )) as Array<[string, string, [string, string]]>;

    const activeIds: string[] = [];
    const coordMap = new Map<
      string,
      { distanceKm: number; longitude: number; latitude: number }
    >();

    for (const [id, distStr, [lonStr, latStr]] of results || []) {
      const alive = await client.exists(`ambulance:driver:heartbeat:${id}`);
      if (alive) {
        activeIds.push(id);
        coordMap.set(id, {
          distanceKm: parseFloat(distStr),
          longitude: parseFloat(lonStr),
          latitude: parseFloat(latStr),
        });
      } else {
        await client.zrem(this.geoKey, id);
      }
    }

    if (activeIds.length === 0) return [];

    const profiles = await this.prisma.ambulanceDriverProfile.findMany({
      where: { id: { in: activeIds } },
      include: { user: { select: { name: true, phone: true } } },
    });

    return profiles
      .map((p) => {
        const coords = coordMap.get(p.id);
        return {
          driverId: p.id,
          vehicleNumber: p.vehicleNumber,
          driverName: p.user.name,
          latitude: coords?.latitude ?? (p.lastLat ? Number(p.lastLat) : null),
          longitude:
            coords?.longitude ?? (p.lastLng ? Number(p.lastLng) : null),
          distanceKm: coords?.distanceKm ?? null,
        };
      })
      .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  }

  /**
   * Driver streams location and heartbeat.
   * Heartbeat TTL is 30s. If driver stops pinging, they are omitted from dispatch.
   * If driver has an active trip, live coordinates also push via /ambulance Socket.IO.
   */
  async updateDriverLocation(
    driverUserId: string,
    lat: number,
    lng: number,
    isOnline: boolean,
  ) {
    const driver = await this.prisma.ambulanceDriverProfile.findUnique({
      where: { userId: driverUserId },
    });

    if (!driver) {
      throw new NotFoundException('Ambulance driver profile not found');
    }

    await this.prisma.ambulanceDriverProfile.update({
      where: { id: driver.id },
      data: {
        lastLat: lat,
        lastLng: lng,
        isOnline,
        lastHeartbeatAt: new Date(),
      },
    });

    const client = this.redis.getClient();

    if (isOnline) {
      await client.geoadd(this.geoKey, lng, lat, driver.id);
      await client.setex(`ambulance:driver:heartbeat:${driver.id}`, 30, '1');
    } else {
      await client.zrem(this.geoKey, driver.id);
      await client.del(`ambulance:driver:heartbeat:${driver.id}`);
    }

    // Broadcast live location to any active assigned trip room + patient personal room
    const activeTrips = await this.prisma.ambulanceRequest.findMany({
      where: {
        driverId: driver.id,
        status: { in: ['OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'] },
      },
      select: { id: true, patientId: true, pickupLat: true, pickupLng: true },
    });

    for (const trip of activeTrips) {
      const remainingKm = this.calculateHaversineDistanceKm(
        lat,
        lng,
        Number(trip.pickupLat),
        Number(trip.pickupLng),
      );
      const etaSeconds = Math.max(
        30,
        Math.round((remainingKm / 30) * 3600),
      );
      const payload = {
        requestId: trip.id,
        driverId: driver.id,
        latitude: lat,
        longitude: lng,
        etaSeconds,
        distanceKm: remainingKm,
        timestamp: new Date().toISOString(),
      };
      this.realtime.emitToAmbulanceRoom(trip.id, 'ambulance_location', payload);
      this.realtime.emitToUser(trip.patientId, 'ambulance_location', payload);
    }

    return { success: true, driverId: driver.id, isOnline, lat, lng };
  }

  /**
   * Patient creates emergency ambulance request.
   * Queries Redis GEO for available drivers, filters stale ones, offers to nearest,
   * and schedules 20s timeout reassignment.
   */
  async createRequest(
    patientId: string,
    pickupLat: number,
    pickupLng: number,
    pickupAddress: string,
    offerTimeoutMs = Number(process.env.AMBULANCE_OFFER_TIMEOUT_MS || 20000),
  ) {
    // 1. Service area validation (Kolkata Metropolitan Area, max 60km from city center)
    const kolkataCenterLat = 22.5726;
    const kolkataCenterLng = 88.3639;
    const distanceKm = this.calculateHaversineDistanceKm(
      pickupLat,
      pickupLng,
      kolkataCenterLat,
      kolkataCenterLng,
    );
    if (distanceKm > 60) {
      throw new BadRequestException(
        `Pickup location (${pickupLat.toFixed(4)}, ${pickupLng.toFixed(4)}) is outside the active emergency ambulance service area (Kolkata Metropolitan Area, max 60km). Please dial 112 / 108 directly for national emergency dispatch.`,
      );
    }

    // 2. Active request cap: prevent prank / duplicate spam dispatches
    const activeExisting = await this.prisma.ambulanceRequest.findFirst({
      where: {
        patientId,
        status: { in: ['REQUESTED', 'OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'] },
      },
    });
    if (activeExisting) {
      throw new ConflictException(
        'You already have an active emergency ambulance request in progress',
      );
    }

    const client = this.redis.getClient();

    // If no live drivers in Redis GEO, double check any seeded online drivers wouldn't be falsely claimed unless heartbeating
    const nearestDrivers: { driverId: string; distanceKm: number }[] = [];
    try {
      const results = (await client.georadius(
        this.geoKey,
        pickupLng,
        pickupLat,
        25,
        'km',
        'WITHDIST',
        'ASC',
      )) as [string, string][];

      if (results && results.length > 0) {
        for (const [id, distStr] of results) {
          const hasHeartbeat = await client.exists(
            `ambulance:driver:heartbeat:${id}`,
          );
          if (hasHeartbeat) {
            nearestDrivers.push({
              driverId: id,
              distanceKm: parseFloat(distStr),
            });
          } else {
            await client.zrem(this.geoKey, id);
          }
        }
      }
    } catch (err) {
      this.logger.error(`Redis GEO lookup error: ${err}`);
    }

    const matchedDriver = nearestDrivers[0];
    let etaSeconds: number | null = null;
    let initialStatus: 'REQUESTED' | 'OFFERED' = 'REQUESTED';

    if (matchedDriver) {
      initialStatus = 'OFFERED';
      etaSeconds = Math.max(
        120,
        Math.round((matchedDriver.distanceKm / 30) * 3600),
      );
    }

    const request = await this.prisma.ambulanceRequest.create({
      data: {
        patientId,
        driverId: matchedDriver ? matchedDriver.driverId : null,
        pickupLat,
        pickupLng,
        pickupAddress,
        status: initialStatus,
        etaSeconds,
      },
      include: {
        driver: {
          include: {
            user: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    });

    if (matchedDriver) {
      const ttlSec = Math.max(1, Math.ceil(offerTimeoutMs / 1000));
      await client.setex(
        `ambulance:offer:${request.id}`,
        ttlSec,
        matchedDriver.driverId,
      );
      await client.sadd(
        `ambulance:tried:${request.id}`,
        matchedDriver.driverId,
      );
      await client.expire(`ambulance:tried:${request.id}`, 600);

      if (request.driver?.userId) {
        this.realtime.emitToUser(request.driver.userId, 'ambulance_offer', {
          requestId: request.id,
          pickupLat,
          pickupLng,
          pickupAddress,
          etaSeconds,
          expiresInMs: offerTimeoutMs,
        });
      }

      this.scheduleOfferTimeout(
        request.id,
        matchedDriver.driverId,
        offerTimeoutMs,
      );
    }

    this.realtime.emitToUser(patientId, 'ambulance_status', {
      requestId: request.id,
      status: request.status,
      etaSeconds: request.etaSeconds,
      driver: request.driver,
    });

    return {
      request,
      matchedDriver: matchedDriver
        ? { driverId: matchedDriver.driverId, etaSeconds }
        : null,
    };
  }

  /**
   * Lists pending or active requests for the authenticated driver.
   */
  async getDriverOffers(driverUserId: string) {
    const driver = await this.prisma.ambulanceDriverProfile.findUnique({
      where: { userId: driverUserId },
    });
    if (!driver) throw new NotFoundException('Driver profile not found');

    return this.prisma.ambulanceRequest.findMany({
      where: {
        driverId: driver.id,
        status: { in: ['OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'] },
      },
      include: {
        patient: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Returns current active request for the patient or driver (used for page reloads).
   */
  async getActiveRequest(userId: string) {
    const driver = await this.prisma.ambulanceDriverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    return this.prisma.ambulanceRequest.findFirst({
      where: {
        status: {
          in: ['REQUESTED', 'OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'],
        },
        OR: [
          { patientId: userId },
          ...(driver ? [{ driverId: driver.id }] : []),
        ],
      },
      include: {
        driver: {
          include: {
            user: { select: { id: true, name: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Fetches a single ambulance request with owner/driver/admin authorization.
   */
  async getRequestById(requestId: string, userId: string, role: string) {
    const request = await this.prisma.ambulanceRequest.findUnique({
      where: { id: requestId },
      include: {
        driver: {
          include: {
            user: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Ambulance request not found');
    }

    const isPatient = request.patientId === userId;
    const isDriver = request.driver?.userId === userId;
    if (!isPatient && !isDriver && role !== 'ADMIN') {
      throw new ForbiddenException(
        'Not authorized to view this ambulance request',
      );
    }

    return request;
  }

  /**
   * Patient or Admin cancels an active request.
   */
  async cancelRequest(requestId: string, userId: string, role: string) {
    const request = await this.prisma.ambulanceRequest.findUnique({
      where: { id: requestId },
      include: { driver: true },
    });
    if (!request) throw new NotFoundException('Ambulance request not found');

    if (request.patientId !== userId && role !== 'ADMIN') {
      throw new ForbiddenException(
        'Only the requesting patient or admin can cancel this request',
      );
    }

    if (['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(request.status)) {
      throw new BadRequestException(
        `Request cannot be cancelled in status ${request.status}`,
      );
    }

    this.clearOfferTimer(requestId);
    const interval = this.simulationIntervals.get(requestId);
    if (interval) {
      clearInterval(interval);
      this.simulationIntervals.delete(requestId);
    }
    await this.redis.getClient().del(`ambulance:offer:${requestId}`);

    const updated = await this.prisma.ambulanceRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED' },
    });

    const payload = { requestId, status: 'CANCELLED' };
    this.realtime.emitToUser(request.patientId, 'ambulance_status', payload);
    this.realtime.emitToAmbulanceRoom(requestId, 'ambulance_status', payload);
    if (request.driver?.userId) {
      this.realtime.emitToUser(
        request.driver.userId,
        'ambulance_status',
        payload,
      );
    }

    return updated;
  }

  /**
   * Driver accepts offer.
   * ATOMIC CLAIM: conditional updateMany where status = 'OFFERED' AND driverId = driver.id.
   * Guarantees exactly 1 winner; concurrent attempts conflict.
   */
  async acceptRequest(requestId: string, driverUserId: string) {
    const driver = await this.prisma.ambulanceDriverProfile.findUnique({
      where: { userId: driverUserId },
      include: { user: { select: { id: true, name: true, phone: true } } },
    });

    if (!driver) throw new NotFoundException('Driver profile not found');

    const result = await this.prisma.ambulanceRequest.updateMany({
      where: {
        id: requestId,
        status: 'OFFERED',
        driverId: driver.id,
      },
      data: {
        status: 'ACCEPTED',
      },
    });

    if (result.count === 0) {
      throw new ConflictException(
        'Request offer has already expired, been cancelled, or claimed by another driver',
      );
    }

    this.clearOfferTimer(requestId);
    await this.redis.getClient().del(`ambulance:offer:${requestId}`);

    const updated = await this.prisma.ambulanceRequest.findUnique({
      where: { id: requestId },
      include: {
        driver: {
          include: {
            user: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    });

    if (updated) {
      const payload = {
        requestId: updated.id,
        status: updated.status,
        etaSeconds: updated.etaSeconds,
        driver: updated.driver,
      };
      this.realtime.emitToUser(
        updated.patientId,
        'ambulance_status',
        payload,
      );
      this.realtime.emitToAmbulanceRoom(
        updated.id,
        'ambulance_status',
        payload,
      );
    }

    return {
      success: true,
      status: 'ACCEPTED',
      driverId: driver.id,
      request: updated,
    };
  }

  /**
   * Handles timeout or rejection of a 20s offer, cascading to next nearest untried driver.
   * Uses a Redis lock so concurrent timer/manual calls cannot double-reassign.
   */
  async handleOfferTimeout(
    requestId: string,
    timedOutDriverId: string,
    offerTimeoutMs = Number(process.env.AMBULANCE_OFFER_TIMEOUT_MS || 20000),
  ) {
    const client = this.redis.getClient();
    const lockKey = `ambulance:timeout-lock:${requestId}:${timedOutDriverId}`;
    const lockAcquired = await client.set(lockKey, '1', 'EX', 30, 'NX');
    if (!lockAcquired) {
      return null;
    }

    const request = await this.prisma.ambulanceRequest.findUnique({
      where: { id: requestId },
    });

    if (
      !request ||
      request.status !== 'OFFERED' ||
      request.driverId !== timedOutDriverId
    ) {
      return null;
    }

    await client.sadd(`ambulance:tried:${requestId}`, timedOutDriverId);
    await client.expire(`ambulance:tried:${requestId}`, 600);
    const triedDrivers = new Set(
      await client.smembers(`ambulance:tried:${requestId}`),
    );
    triedDrivers.add(timedOutDriverId);

    const results = (await client.georadius(
      this.geoKey,
      Number(request.pickupLng),
      Number(request.pickupLat),
      25,
      'km',
      'WITHDIST',
      'ASC',
    )) as [string, string][];

    let nextDriverId: string | null = null;
    let nextEta: number | null = null;

    if (results) {
      for (const [id, distStr] of results) {
        if (!triedDrivers.has(id)) {
          const hasHeartbeat = await client.exists(
            `ambulance:driver:heartbeat:${id}`,
          );
          if (hasHeartbeat) {
            nextDriverId = id;
            const dist = parseFloat(distStr);
            nextEta = Math.max(120, Math.round((dist / 30) * 3600));
            break;
          }
        }
      }
    }

    if (nextDriverId) {
      const updatedCount = await this.prisma.ambulanceRequest.updateMany({
        where: {
          id: requestId,
          status: 'OFFERED',
          driverId: timedOutDriverId,
        },
        data: {
          driverId: nextDriverId,
          etaSeconds: nextEta,
          status: 'OFFERED',
        },
      });

      if (updatedCount.count === 0) {
        return null;
      }

      const ttlSec = Math.max(1, Math.ceil(offerTimeoutMs / 1000));
      await client.setex(`ambulance:offer:${requestId}`, ttlSec, nextDriverId);
      await client.sadd(`ambulance:tried:${requestId}`, nextDriverId);

      const nextRequest = await this.prisma.ambulanceRequest.findUnique({
        where: { id: requestId },
        include: {
          driver: {
            include: {
              user: { select: { id: true, name: true, phone: true } },
            },
          },
        },
      });

      if (nextRequest?.driver?.userId) {
        this.realtime.emitToUser(
          nextRequest.driver.userId,
          'ambulance_offer',
          {
            requestId,
            pickupLat: Number(nextRequest.pickupLat),
            pickupLng: Number(nextRequest.pickupLng),
            pickupAddress: nextRequest.pickupAddress,
            etaSeconds: nextEta,
            expiresInMs: offerTimeoutMs,
          },
        );
      }

      const statusPayload = {
        requestId,
        status: 'OFFERED',
        reassigned: true,
        etaSeconds: nextEta,
        driver: nextRequest?.driver ?? null,
      };
      this.realtime.emitToUser(
        request.patientId,
        'ambulance_status',
        statusPayload,
      );
      this.realtime.emitToAmbulanceRoom(
        requestId,
        'ambulance_status',
        statusPayload,
      );

      this.scheduleOfferTimeout(requestId, nextDriverId, offerTimeoutMs);
      return { reassigned: true, nextDriverId, etaSeconds: nextEta };
    } else {
      const updatedCount = await this.prisma.ambulanceRequest.updateMany({
        where: {
          id: requestId,
          status: 'OFFERED',
          driverId: timedOutDriverId,
        },
        data: { status: 'EXPIRED' },
      });
      if (updatedCount.count === 0) return null;

      await client.del(`ambulance:offer:${requestId}`);
      const expiredPayload = {
        requestId,
        status: 'EXPIRED',
        reassigned: false,
      };
      this.realtime.emitToUser(
        request.patientId,
        'ambulance_status',
        expiredPayload,
      );
      this.realtime.emitToAmbulanceRoom(
        requestId,
        'ambulance_status',
        expiredPayload,
      );
      return { reassigned: false, status: 'EXPIRED' };
    }
  }

  /**
   * Driver updates trip status (ACCEPTED -> EN_ROUTE -> ARRIVED -> COMPLETED)
   */
  async updateTripStatus(
    requestId: string,
    driverUserId: string,
    newStatus: 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED',
  ) {
    const driver = await this.prisma.ambulanceDriverProfile.findUnique({
      where: { userId: driverUserId },
    });

    if (!driver) throw new NotFoundException('Driver profile not found');

    const request = await this.prisma.ambulanceRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) throw new NotFoundException('Ambulance request not found');

    if (request.driverId !== driver.id) {
      throw new ForbiddenException(
        'You are not the assigned driver for this trip',
      );
    }

    const allowedNext = ALLOWED_TRIP_TRANSITIONS[request.status] || [];
    if (!allowedNext.includes(newStatus)) {
      throw new ConflictException(
        `Invalid trip status transition from ${request.status} to ${newStatus}`,
      );
    }

    const updated = await this.prisma.ambulanceRequest.update({
      where: { id: requestId },
      data: { status: newStatus },
      include: {
        driver: {
          include: {
            user: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    });

    const payload = {
      requestId: updated.id,
      status: updated.status,
      etaSeconds: newStatus === 'ARRIVED' || newStatus === 'COMPLETED' ? 0 : updated.etaSeconds,
      driver: updated.driver,
    };
    this.realtime.emitToUser(updated.patientId, 'ambulance_status', payload);
    this.realtime.emitToAmbulanceRoom(updated.id, 'ambulance_status', payload);

    return updated;
  }

  /**
   * Dev/Demo simulator helper (only available when PAYMENT_PROVIDER === 'FAKE').
   * Drives a real driver through Redis GEO telemetry -> acceptRequest -> EN_ROUTE -> live interpolated steps -> ARRIVED.
   */
  async simulateDriverTrip(requestId: string) {
    if (env.PAYMENT_PROVIDER !== 'FAKE') {
      throw new ForbiddenException(
        'Driver simulator endpoint is disabled in non-FAKE environments',
      );
    }

    const request = await this.prisma.ambulanceRequest.findUnique({
      where: { id: requestId },
      include: {
        driver: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });
    if (!request) throw new NotFoundException('Ambulance request not found');

    // If request had no driver yet (because drivers hadn't heartbeated yet), wake seeded drivers and offer to nearest
    let activeDriver = request.driver;
    if (!activeDriver) {
      const seededDrivers = await this.prisma.ambulanceDriverProfile.findMany({
        where: { isOnline: true },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { id: 'asc' },
      });
      if (seededDrivers.length === 0) {
        throw new BadRequestException('No ambulance driver profiles exist in DB');
      }
      for (const sd of seededDrivers) {
        await this.updateDriverLocation(
          sd.userId,
          sd.lastLat ? Number(sd.lastLat) : 22.5726,
          sd.lastLng ? Number(sd.lastLng) : 88.3639,
          true,
        );
      }
      // Assign nearest seeded driver to OFFERED
      activeDriver = seededDrivers[0];
      await this.prisma.ambulanceRequest.update({
        where: { id: requestId },
        data: {
          driverId: activeDriver.id,
          status: 'OFFERED',
          etaSeconds: 240,
        },
      });
    }

    const driverRef = activeDriver;
    const startLat = driverRef.lastLat ? Number(driverRef.lastLat) : 22.5626;
    const startLng = driverRef.lastLng ? Number(driverRef.lastLng) : 88.3539;
    const destLat = Number(request.pickupLat);
    const destLng = Number(request.pickupLng);

    // Accept if currently OFFERED
    const latest = await this.prisma.ambulanceRequest.findUnique({
      where: { id: requestId },
    });
    if (latest?.status === 'OFFERED') {
      await this.acceptRequest(requestId, driverRef.userId);
      await this.updateTripStatus(requestId, driverRef.userId, 'EN_ROUTE');
    } else if (latest?.status === 'ACCEPTED') {
      await this.updateTripStatus(requestId, driverRef.userId, 'EN_ROUTE');
    }

    // Stream 6 smooth location updates every 600ms toward pickup, ending at ARRIVED
    const prevInterval = this.simulationIntervals.get(requestId);
    if (prevInterval) clearInterval(prevInterval);

    let step = 1;
    const totalSteps = 6;
    const interval = setInterval(() => {
      const progress = Math.min(1, step / totalSteps);
      const lat = startLat + (destLat - startLat) * progress;
      const lng = startLng + (destLng - startLng) * progress;

      void (async () => {
        try {
          await this.updateDriverLocation(driverRef.userId, lat, lng, true);
          if (step >= totalSteps) {
            clearInterval(interval);
            this.simulationIntervals.delete(requestId);
            const curr = await this.prisma.ambulanceRequest.findUnique({
              where: { id: requestId },
            });
            if (curr && curr.status === 'EN_ROUTE') {
              await this.updateTripStatus(requestId, driverRef.userId, 'ARRIVED');
            }
          }
          step++;
        } catch (err) {
          this.logger.warn(`Simulator step error for ${requestId}: ${err}`);
          clearInterval(interval);
          this.simulationIntervals.delete(requestId);
        }
      })();
    }, 600);

    if (typeof interval.unref === 'function') {
      interval.unref();
    }
    this.simulationIntervals.set(requestId, interval);

    return {
      started: true,
      requestId,
      driverId: driverRef.id,
      steps: totalSteps,
    };
  }

  /**
   * Haversine formula distance calculation in kilometers.
   */
  calculateHaversineDistanceKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
  }
}
