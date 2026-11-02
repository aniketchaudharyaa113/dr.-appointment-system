import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ChatService } from '../src/modules/consultation/services/chat.service';

describe('Phase 5: Message Persistence and 7-Day Follow-Up Window', () => {
  let chatService: ChatService;

  const appointmentId = 'appt-chat-order';
  const patientId = 'patient-uuid-1';
  const doctorUserId = 'doctor-uuid-1';
  let chatMessages: any[];

  beforeEach(() => {
    chatMessages = [];
    const completionDate = new Date('2026-11-01T12:00:00.000Z');

    const mockPrisma: any = {
      appointment: {
        findUnique: () => ({
          id: appointmentId,
          patientId,
          status: 'COMPLETED',
          updatedAt: completionDate,
          doctor: { userId: doctorUserId },
        }),
      },
      chatMessage: {
        create: ({ data }: any) => {
          const msg = {
            ...data,
            id: `msg-${chatMessages.length + 1}`,
            createdAt: new Date(),
          };
          chatMessages.push(msg);
          return msg;
        },
        findMany: () => [...chatMessages].reverse(),
      },
    };

    chatService = new ChatService(mockPrisma);
  });

  it('persists messages with sender role and maintains chronological order', async () => {
    await chatService.sendMessage({
      appointmentId,
      senderId: patientId,
      content: 'Hello doctor, feeling better today.',
    });

    await chatService.sendMessage({
      appointmentId,
      senderId: doctorUserId,
      content: 'Glad to hear that. Continue the medication for 3 days.',
    });

    expect(chatMessages.length).toBe(2);
    expect(chatMessages[0].senderRole).toBe('PATIENT');
    expect(chatMessages[1].senderRole).toBe('DOCTOR');

    const history = await chatService.getMessages(appointmentId, patientId);
    expect(history.length).toBe(2);
    expect(history[0].content).toContain('feeling better');
    expect(history[1].content).toContain('Continue the medication');
  });

  it('allows follow-up messages within 7 days of completed appointment', async () => {
    // 3 days after completion
    const day3 = new Date('2026-11-04T12:00:00.000Z');

    const msg = await chatService.sendMessage({
      appointmentId,
      senderId: patientId,
      content: 'Day 3 check-in message',
      now: day3,
    });

    expect(msg).toBeDefined();
    expect(msg.content).toBe('Day 3 check-in message');
  });

  it('rejects follow-up messages after 7-day post-consultation window expires', async () => {
    // 8 days after completion
    const day8 = new Date('2026-11-09T12:00:00.000Z');

    await expect(
      chatService.sendMessage({
        appointmentId,
        senderId: patientId,
        content: 'Late follow-up message after 8 days',
        now: day8,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
