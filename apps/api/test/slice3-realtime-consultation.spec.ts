import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { createConfiguredApp } from '../src/common/app.bootstrap';
import { PrismaService } from '../src/modules/platform/database/prisma.service';
import { RedisService } from '../src/modules/platform/redis/redis.service';
import { BookingService } from '../src/modules/scheduling/services/booking.service';
import { LiveKitService } from '../src/modules/consultation/services/livekit.service';
import { PrescriptionService } from '../src/modules/consultation/services/prescription.service';
import {
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  signJwtForUser,
} from './helpers/test-app';
import { istWallClockToUtcDate } from '../src/common/utils/ist-time';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { env } from '../src/common/config/env.schema';

describe('Slice 3: Cross-Instance Sockets, Room Authorization, LiveKit Join Window & Real MinIO Signed URLs', () => {
  let appA: NestFastifyApplication;
  let appB: NestFastifyApplication;
  let urlA: string;
  let urlB: string;
  let prisma: PrismaService;
  let redis: RedisService;
  let minioContainer: any;

  beforeAll(async () => {
    // Start real MinIO container so presigned S3 upload & download are verified against real object storage
    minioContainer = await new GenericContainer('bitnamilegacy/minio:latest')
      .withEnvironment({
        MINIO_ROOT_USER: env.MINIO_ACCESS_KEY,
        MINIO_ROOT_PASSWORD: env.MINIO_SECRET_KEY,
      })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    const minioHost = minioContainer.getHost();
    const minioPort = minioContainer.getMappedPort(9000);
    process.env.MINIO_ENDPOINT = minioHost;
    process.env.MINIO_PORT = String(minioPort);
    process.env.MINIO_PUBLIC_URL = `http://${minioHost}:${minioPort}`;
    // Update already-parsed env object for AttachmentService
    (env as any).MINIO_ENDPOINT = minioHost;
    (env as any).MINIO_PORT = minioPort;
    (env as any).MINIO_PUBLIC_URL = `http://${minioHost}:${minioPort}`;

    appA = await createConfiguredApp();
    await appA.listen(0, '127.0.0.1');
    urlA = await appA.getUrl();

    appB = await createConfiguredApp();
    await appB.listen(0, '127.0.0.1');
    urlB = await appB.getUrl();

    prisma = appA.get(PrismaService);
    redis = appA.get(RedisService);
  });

  afterAll(async () => {
    await Promise.allSettled([appA?.close(), appB?.close(), minioContainer?.stop()]);
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(prisma, redis.getClient());
  });

  function connectSocket(baseUrl: string, namespace: string, token: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const sock = ioClient(`${baseUrl}${namespace}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      sock.on('connect', () => resolve(sock));
      sock.on('connect_error', (err) => reject(err));
    });
  }

  it('Booking on API instance A reaches User A on API instance B via Redis adapter, and User B never receives it', async () => {
    const { doctor } = await seedVerifiedDoctor(prisma);
    const userA = await seedPatient(prisma, 'userA');
    const userB = await seedPatient(prisma, 'userB');

    const tokenA = signJwtForUser(userA);
    const tokenB = signJwtForUser(userB);

    const sockA = await connectSocket(urlB, '/consultation', tokenA);
    const sockB = await connectSocket(urlB, '/consultation', tokenB);

    const receivedByA: any[] = [];
    const receivedByB: any[] = [];
    sockA.on('booking_updated', (p) => receivedByA.push(p));
    sockB.on('booking_updated', (p) => receivedByB.push(p));

    // Allow Redis pub/sub subscription propagation
    await new Promise((r) => setTimeout(r, 150));

    // Book on Instance A
    const dateStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slotIso = istWallClockToUtcDate(dateStr, '11:00').toISOString();

    const holdRes = await appA.inject({
      method: 'POST',
      url: '/api/appointments/hold',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { doctorId: doctor.id, slotTime: slotIso, consultationMode: 'VIDEO' },
    });
    expect(holdRes.statusCode).toBe(201);

    const bookRes = await appA.inject({
      method: 'POST',
      url: '/api/appointments/book',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        doctorId: doctor.id,
        slotTime: slotIso,
        holdToken: holdRes.json().holdToken,
        consultationMode: 'VIDEO',
      },
    });
    expect(bookRes.statusCode).toBe(201);

    await new Promise((r) => setTimeout(r, 400));

    expect(receivedByA.length).toBeGreaterThanOrEqual(1);
    expect(receivedByA[0].appointmentId).toBe(bookRes.json().id);
    expect(receivedByB).toHaveLength(0);

    sockA.disconnect();
    sockB.disconnect();
  });

  it('Socket rejects bad JWT, enforces DB participation on join_room, and relays chat across instances with persistence', async () => {
    const { user: doctorUser, doctor } = await seedVerifiedDoctor(prisma);
    const patient = await seedPatient(prisma, 'chatPatient');
    const intruder = await seedPatient(prisma, 'intruder');

    const bookingService = appA.get(BookingService);
    const dateStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slotIso = istWallClockToUtcDate(dateStr, '12:00').toISOString();
    const hold = await bookingService.holdSlot(doctor.id, slotIso, patient.id);
    const appt = await bookingService.bookAppointment(
      doctor.id,
      slotIso,
      patient.id,
      hold.holdToken,
    );

    // Invalid JWT secret must be disconnected
    const badToken = jwt.sign(
      { sub: intruder.id, email: intruder.email, role: 'PATIENT' },
      'wrong-secret-that-must-be-rejected-123456',
    );
    const badSock = ioClient(`${urlA}/consultation`, {
      auth: { token: badToken },
      transports: ['websocket'],
      reconnection: false,
    });
    await new Promise<void>((resolve) => {
      badSock.on('disconnect', () => resolve());
      setTimeout(resolve, 1000);
    });
    expect(badSock.connected).toBe(false);
    badSock.disconnect();

    const patientSock = await connectSocket(urlA, '/consultation', signJwtForUser(patient));
    const doctorSock = await connectSocket(urlB, '/consultation', signJwtForUser(doctorUser));
    const intruderSock = await connectSocket(urlB, '/consultation', signJwtForUser(intruder));

    // Intruder join_room denied by DB check
    const intruderJoin = await new Promise<any>((resolve) =>
      intruderSock.emit('join_room', { appointmentId: appt.id }, resolve),
    );
    expect(intruderJoin.error).toContain('Forbidden');

    // Patient & Doctor join room
    const pJoin = await new Promise<any>((resolve) =>
      patientSock.emit('join_room', { appointmentId: appt.id }, resolve),
    );
    const dJoin = await new Promise<any>((resolve) =>
      doctorSock.emit('join_room', { appointmentId: appt.id }, resolve),
    );
    expect(pJoin.joined).toBe(`consult:${appt.id}`);
    expect(dJoin.joined).toBe(`consult:${appt.id}`);

    const doctorReceived: any[] = [];
    const intruderReceived: any[] = [];
    doctorSock.on('new_message', (msg) => doctorReceived.push(msg));
    intruderSock.on('new_message', (msg) => intruderReceived.push(msg));

    await new Promise((r) => setTimeout(r, 150));

    // Patient sends message on Instance A -> Doctor on Instance B receives it, Intruder does not
    const sendAck = await new Promise<any>((resolve) =>
      patientSock.emit(
        'send_message',
        { appointmentId: appt.id, content: 'Doctor, my BP is 138/88' },
        resolve,
      ),
    );
    expect(sendAck.success).toBe(true);

    await new Promise((r) => setTimeout(r, 400));

    expect(doctorReceived).toHaveLength(1);
    expect(doctorReceived[0].content).toBe('Doctor, my BP is 138/88');
    expect(intruderReceived).toHaveLength(0);

    // Persisted in Postgres
    const historyRes = await appB.inject({
      method: 'GET',
      url: `/api/consultations/${appt.id}/messages`,
      headers: { authorization: `Bearer ${signJwtForUser(doctorUser)}` },
    });
    expect(historyRes.statusCode).toBe(200);
    expect(historyRes.json()).toHaveLength(1);

    patientSock.disconnect();
    doctorSock.disconnect();
    intruderSock.disconnect();
  });

  it('LiveKit join window enforcement, consent requirement, and immutable prescription versioning', async () => {
    const { user: doctorUser, doctor } = await seedVerifiedDoctor(prisma);
    const patient = await seedPatient(prisma, 'lkPatient');
    const stranger = await seedPatient(prisma, 'lkStranger');

    const slotTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const appt = await prisma.appointment.create({
      data: {
        bookingRef: 'MB-20261125-901',
        patientId: patient.id,
        doctorId: doctor.id,
        slotTime,
        status: 'CONFIRMED',
      },
    });

    const livekit = appA.get(LiveKitService);

    // Outside window (-15m) -> rejected
    await expect(
      livekit.mintJoinToken(appt.id, patient.id, new Date(slotTime.getTime() - 15 * 60 * 1000)),
    ).rejects.toThrow(/10 minutes before/);

    // Non-participant -> Forbidden
    await expect(
      livekit.mintJoinToken(appt.id, stranger.id, slotTime),
    ).rejects.toThrow(/not an authorized participant/);

    // Without consent -> BadRequest
    await expect(
      livekit.mintJoinToken(appt.id, patient.id, slotTime),
    ).rejects.toThrow(/telemedicine consent/);

    // Record consent and mint within window -> succeeds
    await livekit.recordConsent(appt.id, patient.id);
    const minted = await livekit.mintJoinToken(appt.id, patient.id, slotTime);
    expect(minted.token).toBeTruthy();
    expect(minted.livekitUrl).toBe(env.LIVEKIT_URL);

    // Immutable prescription versioning on COMPLETED appointment
    await prisma.appointment.update({ where: { id: appt.id }, data: { status: 'COMPLETED' } });
    const rxService = appA.get(PrescriptionService);
    const v1 = await rxService.createPrescription(appt.id, doctorUser.id, {
      diagnosis: 'Essential Hypertension',
      medicines: [{ name: 'Telmisartan', dosage: '40mg', frequency: 'OD', durationDays: 30 }],
    });
    expect(v1.currentVersion).toBe(1);

    const v2 = await rxService.updatePrescription(appt.id, doctorUser.id, {
      diagnosis: 'Essential Hypertension (Controlled)',
      medicines: [{ name: 'Telmisartan', dosage: '20mg', frequency: 'OD', durationDays: 30 }],
    });
    expect(v2.currentVersion).toBe(2);

    const readRx = await rxService.getPrescription(appt.id, patient.id);
    expect(readRx.versions).toHaveLength(2);
    expect(readRx.versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it('Real MinIO presigned PUT upload and GET download with strict participant and file validation', async () => {
    const { doctor } = await seedVerifiedDoctor(prisma);
    const patient = await seedPatient(prisma, 'minioPatient');
    const stranger = await seedPatient(prisma, 'minioStranger');

    const appt = await prisma.appointment.create({
      data: {
        bookingRef: 'MB-20261125-902',
        patientId: patient.id,
        doctorId: doctor.id,
        slotTime: new Date(Date.now() + 60 * 60 * 1000),
        status: 'CONFIRMED',
      },
    });

    const patientToken = signJwtForUser(patient);
    const strangerToken = signJwtForUser(stranger);

    // Disallowed .exe rejected
    const exeRes = await appA.inject({
      method: 'POST',
      url: `/api/consultations/${appt.id}/attachments/upload-url`,
      headers: { authorization: `Bearer ${patientToken}` },
      payload: { fileName: 'virus.exe', mimeType: 'application/x-msdownload', sizeBytes: 512 },
    });
    expect(exeRes.statusCode).toBe(400);

    // Stranger rejected
    const strangerRes = await appA.inject({
      method: 'POST',
      url: `/api/consultations/${appt.id}/attachments/upload-url`,
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { fileName: 'lab.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
    });
    expect(strangerRes.statusCode).toBe(403);

    // Valid patient gets real MinIO S3 presigned URL
    const upRes = await appA.inject({
      method: 'POST',
      url: `/api/consultations/${appt.id}/attachments/upload-url`,
      headers: { authorization: `Bearer ${patientToken}` },
      payload: { fileName: 'cbc_report.pdf', mimeType: 'application/pdf', sizeBytes: 15 },
    });
    expect(upRes.statusCode).toBe(201);
    const { uploadUrl, fileKey } = upRes.json();
    expect(fileKey).toMatch(new RegExp(`^appointments/${appt.id}/.*\\.pdf$`));

    // Upload real bytes to MinIO via presigned PUT URL
    const pdfBytes = Buffer.from('%PDF-1.4-REAL!!');
    const putResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: pdfBytes,
    });
    expect(putResp.ok).toBe(true);

    // Get presigned download URL and fetch bytes back
    const dlUrlRes = await appB.inject({
      method: 'GET',
      url: `/api/consultations/${appt.id}/attachments/download-url?fileKey=${encodeURIComponent(fileKey)}`,
      headers: { authorization: `Bearer ${patientToken}` },
    });
    expect(dlUrlRes.statusCode).toBe(200);

    const dlResp = await fetch(dlUrlRes.json().downloadUrl);
    expect(dlResp.ok).toBe(true);
    const downloaded = Buffer.from(await dlResp.arrayBuffer());
    expect(downloaded.toString()).toBe('%PDF-1.4-REAL!!');
  });
});
