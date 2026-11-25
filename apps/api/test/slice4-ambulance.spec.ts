import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import { io as ioClient, Socket } from 'socket.io-client';
import * as argon2 from 'argon2';
import { AmbulanceService } from '../src/modules/ambulance/services/ambulance.service';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedPatient,
  signJwtForUser,
  TestContext,
} from './helpers/test-app';

async function seedDriver(
  ctx: TestContext,
  email: string,
  name: string,
  vehicleNumber: string,
) {
  const passwordHash = await argon2.hash('DriverPass123!', {
    type: argon2.argon2id,
  });
  const user = await ctx.prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      phone: `+9198765${Math.floor(10000 + Math.random() * 89999)}`,
      role: 'DRIVER',
    },
  });
  const profile = await ctx.prisma.ambulanceDriverProfile.create({
    data: {
      userId: user.id,
      vehicleNumber,
      isOnline: true,
      lastLat: 22.55,
      lastLng: 88.35,
    },
  });
  return { user, profile };
}

function connectAmbulanceSocket(baseUrl: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`${baseUrl}/ambulance`, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
    });
    const t = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Socket connect timeout'));
    }, 5000);
    socket.on('connect', () => {
      clearTimeout(t);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

describe('Slice 4: Real Ambulance Dispatch, 20s Timeout Reassignment, Atomic Accept, Heartbeat Eviction & Live Socket Tracking', () => {
  let ctx: TestContext;
  let baseUrl: string;
  let ambulanceService: AmbulanceService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = await ctx.app.getUrl();
    ambulanceService = ctx.app.get(AmbulanceService);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
  });

  it('offers to nearest live driver (sets 20s Redis TTL), evicts stale driver without heartbeat, and cancels cleanly', async () => {
    const patient = await seedPatient(ctx.prisma, 'sos.patient@test.com');
    const driverStale = await seedDriver(
      ctx,
      'stale@test.com',
      'Stale Driver',
      'WB-01-STALE',
    );
    const driverFresh = await seedDriver(
      ctx,
      'fresh@test.com',
      'Fresh Driver',
      'WB-01-FRESH',
    );

    // Pickup Park Street: (22.5512, 88.3524)
    // Put stale driver closer in GEO set, WITHOUT a Redis heartbeat key
    await ctx.redisClient.geoadd(
      'ambulance:drivers:geo',
      88.3525,
      22.5513,
      driverStale.profile.id,
    );

    // Put fresh driver online via real telemetry endpoint (sets GEO + 30s heartbeat)
    const freshToken = signJwtForUser(driverFresh.user);
    const telemetryRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/ambulance/driver/telemetry',
      headers: { Authorization: `Bearer ${freshToken}` },
      payload: { latitude: 22.5645, longitude: 88.3516, isOnline: true },
    });
    expect(telemetryRes.statusCode).toBe(201);

    // Patient dispatches SOS via real HTTP endpoint
    const patientToken = signJwtForUser(patient);
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/ambulance/requests',
      headers: { Authorization: `Bearer ${patientToken}` },
      payload: {
        pickupLat: 22.5512,
        pickupLng: 88.3524,
        pickupAddress: 'Park Street Crossing, Kolkata',
      },
    });

    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.request.status).toBe('OFFERED');
    expect(created.matchedDriver.driverId).toBe(driverFresh.profile.id);

    // Stale driver was lazily purged from GEO set
    const stalePos = await ctx.redisClient.geopos(
      'ambulance:drivers:geo',
      driverStale.profile.id,
    );
    expect(stalePos[0]).toBeNull();

    // Redis 20-second offer key exists with ~20s TTL
    const ttl = await ctx.redisClient.ttl(
      `ambulance:offer:${created.request.id}`,
    );
    expect(ttl).toBeGreaterThan(10);
    expect(ttl).toBeLessThanOrEqual(20);

    // Cancel clears the request cleanly
    const cancelRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/ambulance/requests/${created.request.id}/cancel`,
      headers: { Authorization: `Bearer ${patientToken}` },
    });
    expect(cancelRes.statusCode).toBe(201);
    expect(cancelRes.json().status).toBe('CANCELLED');
  });

  it('automatically cascades offer on timeout from Driver 1 -> Driver 2 -> EXPIRED without revisiting Driver 1', async () => {
    const patient = await seedPatient(ctx.prisma, 'cascade.patient@test.com');
    const driver1 = await seedDriver(
      ctx,
      'd1@test.com',
      'Unit 1',
      'WB-01-AAA-001',
    );
    const driver2 = await seedDriver(
      ctx,
      'd2@test.com',
      'Unit 2',
      'WB-01-BBB-002',
    );

    // Driver 1 closer (Esplanade) than Driver 2 (Salt Lake)
    await ambulanceService.updateDriverLocation(
      driver1.user.id,
      22.5645,
      88.3516,
      true,
    );
    await ambulanceService.updateDriverLocation(
      driver2.user.id,
      22.5804,
      88.4378,
      true,
    );

    // Create request with short 350ms timeout window for deterministic automatic cascade test
    const { request } = await ambulanceService.createRequest(
      patient.id,
      22.5512,
      88.3524,
      'Park Street, Kolkata',
      350,
    );
    expect(request.status).toBe('OFFERED');
    expect(request.driverId).toBe(driver1.profile.id);

    // Wait >350ms for automatic timer cascade to Driver 2
    await new Promise((r) => setTimeout(r, 550));
    const afterFirstTimeout = await ctx.prisma.ambulanceRequest.findUnique({
      where: { id: request.id },
    });
    expect(afterFirstTimeout?.status).toBe('OFFERED');
    expect(afterFirstTimeout?.driverId).toBe(driver2.profile.id);

    // Wait >350ms again; no untried third driver exists -> automatically EXPIRED (never loops back to Driver 1)
    await new Promise((r) => setTimeout(r, 550));
    const afterSecondTimeout = await ctx.prisma.ambulanceRequest.findUnique({
      where: { id: request.id },
    });
    expect(afterSecondTimeout?.status).toBe('EXPIRED');
  });

  it('guarantees atomic single winner across 10 parallel acceptRequest attempts', async () => {
    const patient = await seedPatient(ctx.prisma, 'race.patient@test.com');
    const driver1 = await seedDriver(
      ctx,
      'winner@test.com',
      'Winner Unit',
      'WB-01-WIN-1',
    );
    const driver2 = await seedDriver(
      ctx,
      'other@test.com',
      'Other Unit',
      'WB-01-OTH-2',
    );

    await ambulanceService.updateDriverLocation(
      driver1.user.id,
      22.5515,
      88.3526,
      true,
    );

    const { request } = await ambulanceService.createRequest(
      patient.id,
      22.5512,
      88.3524,
      'Park Street, Kolkata',
      15000,
    );
    expect(request.driverId).toBe(driver1.profile.id);

    const token1 = signJwtForUser(driver1.user);
    const token2 = signJwtForUser(driver2.user);

    // Fire 10 parallel HTTP accepts for offered driver1 + 2 attempts by unoffered driver2
    const responses = await Promise.all([
      ...Array.from({ length: 10 }, () =>
        ctx.app.inject({
          method: 'POST',
          url: `/api/ambulance/requests/${request.id}/accept`,
          headers: { Authorization: `Bearer ${token1}` },
        }),
      ),
      ctx.app.inject({
        method: 'POST',
        url: `/api/ambulance/requests/${request.id}/accept`,
        headers: { Authorization: `Bearer ${token2}` },
      }),
    ]);

    const accepted = responses.filter((r) => r.statusCode === 201);
    const conflicts = responses.filter((r) => r.statusCode === 409);

    expect(accepted).toHaveLength(1);
    expect(conflicts).toHaveLength(10);

    const dbReq = await ctx.prisma.ambulanceRequest.findUnique({
      where: { id: request.id },
    });
    expect(dbReq?.status).toBe('ACCEPTED');
  });

  it('streams live ambulance_location updates to authorized patient on /ambulance socket while blocking intruder', async () => {
    const patientA = await seedPatient(ctx.prisma, 'patientA.amb@test.com');
    const patientB = await seedPatient(ctx.prisma, 'patientB.amb@test.com');
    const driver = await seedDriver(
      ctx,
      'stream.driver@test.com',
      'Live Driver',
      'WB-01-LIVE-9',
    );

    await ambulanceService.updateDriverLocation(
      driver.user.id,
      22.56,
      88.36,
      true,
    );

    const { request } = await ambulanceService.createRequest(
      patientA.id,
      22.5512,
      88.3524,
      'Park Street, Kolkata',
      20000,
    );
    await ambulanceService.acceptRequest(request.id, driver.user.id);

    const tokenA = signJwtForUser(patientA);
    const tokenB = signJwtForUser(patientB);
    const driverToken = signJwtForUser(driver.user);

    const sockA = await connectAmbulanceSocket(baseUrl, tokenA);
    const sockB = await connectAmbulanceSocket(baseUrl, tokenB);

    const joinA: any = await new Promise((resolve) =>
      sockA.emit('join_tracking', { requestId: request.id }, resolve),
    );
    const joinB: any = await new Promise((resolve) =>
      sockB.emit('join_tracking', { requestId: request.id }, resolve),
    );

    expect(joinA.joined).toBe(`ambulance:${request.id}`);
    expect(joinB.error).toContain('Forbidden');

    let intruderReceived = false;
    sockB.on('ambulance_location', () => {
      intruderReceived = true;
    });

    const locationReceived = new Promise<any>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('Did not receive live ambulance_location')),
        3000,
      );
      sockA.on('ambulance_location', (payload) => {
        clearTimeout(t);
        resolve(payload);
      });
    });

    // Driver moves via HTTP telemetry endpoint; server pushes live coordinate over /ambulance socket
    await ctx.app.inject({
      method: 'POST',
      url: '/api/ambulance/driver/telemetry',
      headers: { Authorization: `Bearer ${driverToken}` },
      payload: { latitude: 22.554, longitude: 88.355, isOnline: true },
    });

    const received = await locationReceived;
    expect(received.requestId).toBe(request.id);
    expect(received.latitude).toBeCloseTo(22.554, 4);
    expect(received.longitude).toBeCloseTo(88.355, 4);

    // Trigger Fake-mode driver trip transition EN_ROUTE -> ARRIVED
    const simRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/ambulance/dev/requests/${request.id}/simulate-trip`,
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(simRes.statusCode).toBe(201);
    expect(simRes.json().started).toBe(true);

    await new Promise((r) => setTimeout(r, 200));
    expect(intruderReceived).toBe(false);

    sockA.disconnect();
    sockB.disconnect();
  });
});
