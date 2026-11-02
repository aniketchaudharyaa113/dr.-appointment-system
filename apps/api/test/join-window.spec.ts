import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { LiveKitService } from '../src/modules/consultation/services/livekit.service';

describe('Phase 5: LiveKit Join-Window Enforcement', () => {
  let livekitService: LiveKitService;

  const slotTime = new Date('2026-11-02T10:00:00.000Z');
  const appointmentId = 'appt-livekit-1';
  const patientId = 'patient-uuid-1';
  const doctorUserId = 'doctor-uuid-1';

  beforeEach(() => {
    const mockPrisma: any = {
      appointment: {
        findUnique: () => ({
          id: appointmentId,
          patientId,
          slotTime,
          doctor: { userId: doctorUserId },
          consultation: {
            id: 'sess-1',
            roomName: 'room_appt_1',
            status: 'SCHEDULED',
            patientConsentGiven: true,
          },
        }),
      },
      consultationSession: {
        create: (args: any) => ({ ...args.data, id: 'sess-1' }),
        upsert: (args: any) => ({ ...args.create, id: 'sess-1' }),
      },
    };
    livekitService = new LiveKitService(mockPrisma);
  });

  it('rejects video token requests earlier than 10 minutes before slotTime', async () => {
    // 15 minutes before slotTime
    const tooEarly = new Date(slotTime.getTime() - 15 * 60 * 1000);

    await expect(
      livekitService.mintJoinToken(appointmentId, patientId, tooEarly),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects video token requests later than 30 minutes after slotTime', async () => {
    // 35 minutes after slotTime
    const tooLate = new Date(slotTime.getTime() + 35 * 60 * 1000);

    await expect(
      livekitService.mintJoinToken(appointmentId, patientId, tooLate),
    ).rejects.toThrow(BadRequestException);
  });

  it('successfully mints short-lived join token inside the [slotTime - 10m, slotTime + 30m] window', async () => {
    // 5 minutes before slotTime
    const insideWindow = new Date(slotTime.getTime() - 5 * 60 * 1000);

    const result = await livekitService.mintJoinToken(
      appointmentId,
      patientId,
      insideWindow,
    );

    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe('string');
    expect(result.roomName).toBe('room_appt_1');
    expect(result.windowStart).toBe(
      new Date(slotTime.getTime() - 10 * 60 * 1000).toISOString(),
    );
    expect(result.windowEnd).toBe(
      new Date(slotTime.getTime() + 30 * 60 * 1000).toISOString(),
    );
  });
});
