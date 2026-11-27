import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'node:http';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  TestContext,
} from './helpers/test-app';
import { AiClientService } from '../src/modules/ai-gateway/services/ai-client.service';
import { ChatService } from '../src/modules/consultation/services/chat.service';
import { BadRequestException } from '@nestjs/common';

describe('WS5: AI Gateway Security, Circuit Breaker & Chat Attachment Verification (B4, B27, B28)', () => {
  let ctx: TestContext;
  let chatService: ChatService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    chatService = ctx.app.get(ChatService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
  });

  it('B4: summarizeNote sends internal auth headers, anonymizes patientName, and scrubs PII from transcript & history', async () => {
    let seenHeaders: http.IncomingHttpHeaders = {};
    let seenBody: any;

    const server = http.createServer((req, res) => {
      seenHeaders = req.headers;
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        seenBody = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            appointment_id: seenBody.appointment_id,
            soap_note: {
              subjective: 'Fever x2 days',
              objective: 'Video consultation',
              assessment: 'Viral syndrome',
              plan: 'Rest',
              watermark: 'DRAFT',
            },
          }),
        );
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const prevUrl = process.env.AI_SERVICE_URL;
    const prevToken = process.env.AI_INTERNAL_TOKEN;
    process.env.AI_SERVICE_URL = `http://127.0.0.1:${port}`;
    process.env.AI_INTERNAL_TOKEN = 'secret-internal-token-ws5';

    try {
      const client = new AiClientService();
      await client.summarizeNote('appt-123', 'doc-456', 'Rohan Private Name', [
        {
          sender: 'patient',
          content: 'Reach me at rohan@secret.org or 9876543210, Aadhaar 1234-5678-9012',
        },
      ]);

      expect(seenHeaders['x-internal-token']).toBe('secret-internal-token-ws5');
      expect(seenHeaders['x-caller-role']).toBe('DOCTOR');
      expect(seenBody.patient_name).not.toContain('Rohan Private Name');
      expect(seenBody.messages[0].content).not.toContain('rohan@secret.org');
      expect(seenBody.messages[0].content).not.toContain('9876543210');
      expect(seenBody.messages[0].content).not.toContain('1234-5678-9012');
    } finally {
      server.close();
      if (prevUrl !== undefined) process.env.AI_SERVICE_URL = prevUrl;
      else delete process.env.AI_SERVICE_URL;
      if (prevToken !== undefined) process.env.AI_INTERNAL_TOKEN = prevToken;
      else delete process.env.AI_INTERNAL_TOKEN;
    }
  });

  it('B27: phone regex avoids corrupting longer numbers/IDs and circuit breaker fast-fails after upstream failure', async () => {
    const client = new AiClientService();
    const mixed = 'Order 987654321012 and Aadhaar 123456789012 vs phone 9876543210';
    const redacted = client.redactPii(mixed);

    expect(redacted).not.toContain('9876543210 ');
    expect(redacted).toContain('[REDACTED_PHONE]');
    expect(redacted).not.toContain('123456789012');
    expect(redacted).toContain('[REDACTED_ID]');
    expect(redacted).not.toContain('[REDACTED_PHONE]12');

    // Circuit breaker test against hanging upstream socket
    let callCount = 0;
    const hangingServer = http.createServer((_req, _res) => {
      callCount++;
      // Intentionally hang until caller timeout
    });
    await new Promise<void>((resolve) => hangingServer.listen(0, '127.0.0.1', resolve));
    const port = (hangingServer.address() as { port: number }).port;
    const prevUrl = process.env.AI_SERVICE_URL;
    process.env.AI_SERVICE_URL = `http://127.0.0.1:${port}`;

    try {
      const cbClient = new AiClientService();
      cbClient.configure({ timeoutMs: 250, circuitOpenMs: 5000 });
      // First call times out (~250ms) and opens circuit
      await cbClient.triage('Mild cough');
      expect(callCount).toBe(1);

      // Second call while circuit is open MUST fail fast (< 50ms) without hitting server
      const start = Date.now();
      const fastFallback = await cbClient.triage('Mild headache');
      const elapsed = Date.now() - start;

      expect(fastFallback.recommendedSpecialty).toBe('General Physician');
      expect(callCount).toBe(1);
      expect(elapsed).toBeLessThan(100);
    } finally {
      hangingServer.closeAllConnections?.();
      hangingServer.close();
      if (prevUrl !== undefined) process.env.AI_SERVICE_URL = prevUrl;
      else delete process.env.AI_SERVICE_URL;
    }
  });

  it('B28: rejects chat messages referencing unverified ConsultationAttachment records', async () => {
    const { doctor } = await seedVerifiedDoctor(ctx.prisma);
    const patient = await seedPatient(ctx.prisma, 'b28-patient');

    const appt = await ctx.prisma.appointment.create({
      data: {
        bookingRef: `MB-B28-${Date.now().toString(36)}`,
        doctorId: doctor.id,
        patientId: patient.id,
        slotTime: new Date(),
        status: 'CONFIRMED',
        consultationMode: 'VIDEO',
      },
    });

    const unverifiedKey = `appointments/${appt.id}/unverified-report.pdf`;
    await ctx.prisma.consultationAttachment.create({
      data: {
        appointmentId: appt.id,
        uploaderId: patient.id,
        fileKey: unverifiedKey,
        fileName: 'unverified-report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        isVerified: false,
      },
    });

    await expect(
      chatService.sendMessage({
        appointmentId: appt.id,
        senderId: patient.id,
        content: 'See attached report',
        attachmentUrl: unverifiedKey,
        attachmentType: 'application/pdf',
      }),
    ).rejects.toThrow(BadRequestException);

    // Once verified, sending message with attachmentUrl succeeds
    await ctx.prisma.consultationAttachment.update({
      where: { fileKey: unverifiedKey },
      data: { isVerified: true, verifiedAt: new Date() },
    });

    const msg = await chatService.sendMessage({
      appointmentId: appt.id,
      senderId: patient.id,
      content: 'See attached report',
      attachmentUrl: unverifiedKey,
      attachmentType: 'application/pdf',
    });
    expect(msg.attachmentUrl).toBe(unverifiedKey);
  });
});
