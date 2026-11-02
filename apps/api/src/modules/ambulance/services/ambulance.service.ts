import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';

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

@Injectable()
export class AmbulanceService {
  private readonly logger = new Logger(AmbulanceService.name);
  private readonly geoKey = 'ambulance:drivers:geo';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * Emergency SOS info and nearby hospitals. Works even if 0 drivers are online.
   */
  getEmergencyInfo(lat?: number, lng?: number) {
    let hospitals = [...KOLKATA_HOSPITALS];

    if (lat !== undefined && lng !== undefined) {
      hospitals = hospitals
        .map((h) => ({
          ...h,
          distanceKm: this.calculateHaversineDistanceKm(lat, lng, h.latitude, h.longitude),
        }))
        .sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
    }

    return {
      emergencyHotlines: [
        { name: 'National Emergency', number: '112', description: 'Police, Fire, Ambulance' },
        { name: 'Medical & Ambulance Hotline', number: '108', description: 'Direct 24/7 Ambulance Hotline' },
        { name: 'Emergency Disaster Control', number: '1070', description: 'State Disaster Management' },
      ],
      hospitals,
    };
  }

  /**
   * Driver streams location and heartbeat.
   * Heartbeat TTL is 30s. If driver stops pinging, they are omitted from dispatch.
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
      // Redis GEOADD: longitude latitude member
      await client.geoadd(this.geoKey, lng, lat, driver.id);
      // Heartbeat with 30-second TTL
      await client.setex(`ambulance:driver:heartbeat:${driver.id}`, 30, '1');
    } else {
      await client.zrem(this.geoKey, driver.id);
      await client.del(`ambulance:driver:heartbeat:${driver.id}`);
    }

    return { success: true, driverId: driver.id, isOnline };
  }

  /**
   * Patient creates emergency ambulance request.
   * Queries Redis GEO for available drivers, filters stale ones, and offers to nearest.
   */
  async createRequest(
    patientId: string,
    pickupLat: number,
    pickupLng: number,
    pickupAddress: string,
  ) {
    const client = this.redis.getClient();

    // 1. Find nearest online drivers within 15 km
    let nearestDrivers: { driverId: string; distanceKm: number }[] = [];
    try {
      // Redis georadius command returns [member, distance]
      const results = (await client.georadius(
        this.geoKey,
        pickupLng,
        pickupLat,
        15,
        'km',
        'WITHDIST',
        'ASC',
      )) as [string, string][];

      if (results && results.length > 0) {
        for (const [id, distStr] of results) {
          // Check heartbeat TTL to evict stale drivers
          const hasHeartbeat = await client.exists(`ambulance:driver:heartbeat:${id}`);
          if (hasHeartbeat) {
            nearestDrivers.push({
              driverId: id,
              distanceKm: parseFloat(distStr),
            });
          } else {
            // Lazy purge stale driver from GEO set
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
      // Assume 30 km/h average urban speed in Kolkata: (dist / 30) * 3600 seconds
      etaSeconds = Math.round((matchedDriver.distanceKm / 30) * 3600);
      if (etaSeconds < 120) etaSeconds = 120; // Minimum 2 minutes
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
            user: { select: { name: true, phone: true } },
          },
        },
      },
    });

    if (matchedDriver) {
      // Set 20-second offer timeout in Redis
      await client.setex(`ambulance:offer:${request.id}`, 20, matchedDriver.driverId);
    }

    return {
      request,
      matchedDriver: matchedDriver ? { driverId: matchedDriver.driverId, etaSeconds } : null,
    };
  }

  /**
   * Driver accepts offer.
   * ATOMIC CLAIM: conditional update where status = 'OFFERED'.
   * Exactly 1 winner; concurrent attempts conflict.
   */
  async acceptRequest(requestId: string, driverUserId: string) {
    const driver = await this.prisma.ambulanceDriverProfile.findUnique({
      where: { userId: driverUserId },
    });

    if (!driver) throw new NotFoundException('Driver profile not found');

    // Atomic conditional DB update
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

    // Clear offer key
    await this.redis.getClient().del(`ambulance:offer:${requestId}`);

    return { success: true, status: 'ACCEPTED', driverId: driver.id };
  }

  /**
   * Handles timeout or rejection of a 20s offer, cascading to next nearest driver.
   */
  async handleOfferTimeout(requestId: string, timedOutDriverId: string) {
    const request = await this.prisma.ambulanceRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.status !== 'OFFERED' || request.driverId !== timedOutDriverId) {
      return null;
    }

    const client = this.redis.getClient();

    // Query next nearest drivers
    const results = (await client.georadius(
      this.geoKey,
      Number(request.pickupLng),
      Number(request.pickupLat),
      20,
      'km',
      'WITHDIST',
      'ASC',
    )) as [string, string][];

    let nextDriverId: string | null = null;
    let nextEta: number | null = null;

    if (results) {
      for (const [id, distStr] of results) {
        if (id !== timedOutDriverId) {
          const hasHeartbeat = await client.exists(`ambulance:driver:heartbeat:${id}`);
          if (hasHeartbeat) {
            nextDriverId = id;
            const dist = parseFloat(distStr);
            nextEta = Math.round((dist / 30) * 3600);
            break;
          }
        }
      }
    }

    if (nextDriverId) {
      await this.prisma.ambulanceRequest.update({
        where: { id: requestId },
        data: {
          driverId: nextDriverId,
          etaSeconds: nextEta,
          status: 'OFFERED',
        },
      });
      await client.setex(`ambulance:offer:${requestId}`, 20, nextDriverId);
      return { reassigned: true, nextDriverId };
    } else {
      await this.prisma.ambulanceRequest.update({
        where: { id: requestId },
        data: { status: 'EXPIRED' },
      });
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
      throw new ForbiddenException('You are not the assigned driver for this trip');
    }

    return this.prisma.ambulanceRequest.update({
      where: { id: requestId },
      data: { status: newStatus },
    });
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
    return parseFloat((R * c).toFixed(2));
  }
}
