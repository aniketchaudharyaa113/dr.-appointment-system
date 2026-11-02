import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { LiveKitService } from '../src/modules/consultation/services/livekit.service';
import { ChatService } from '../src/modules/consultation/services/chat.service';

describe('Phase 5: Non-Participant Authorization Enforcement', () => {
  let livekitService: LiveKitService;
  let chatService: ChatService;

  const appointmentId = 'appt-security-1';
  const legitimatePatientId = 'patient-uuid-1';
  const legitimateDoctorUserId = 'doctor-uuid-1';
  const maliciousAttackerId = 'unauthorized-user-999';

  beforeEach(() => {
    const mockPrisma: any = {
      appointment: {
        findUnique: () => ({
          id: appointmentId,
          patientId: legitimatePatientId,
          slotTime: new Date(),
          status: 'CONFIRMED',
          doctor: { userId: legitimateDoctorUserId },
          consultation: {
            id: 'sess-1',
            roomName: 'room_sec_1',
            status: 'SCHEDULED',
            patientConsentGiven: true,
          },
        }),
      },
    };

    livekitService = new LiveKitService(mockPrisma);
    chatService = new ChatService(mockPrisma);
  });

  it('denies video token minting for non-participants with 403 Forbidden', async () => {
    await expect(
      livekitService.mintJoinToken(appointmentId, maliciousAttackerId),
    ).rejects.toThrow(ForbiddenException);
  });

  it('denies chat message sending for non-participants with 403 Forbidden', async () => {
    await expect(
      chatService.sendMessage({
        appointmentId,
        senderId: maliciousAttackerId,
        content: 'Hello doctor, eavesdropping!',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('denies reading chat messages for non-participants with 403 Forbidden', async () => {
    await expect(
      chatService.getMessages(appointmentId, maliciousAttackerId),
    ).rejects.toThrow(ForbiddenException);
  });
});
