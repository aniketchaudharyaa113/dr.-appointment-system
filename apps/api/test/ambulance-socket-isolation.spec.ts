import { describe, it, expect, beforeEach } from 'vitest';
import { AmbulanceGateway } from '../src/modules/ambulance/gateways/ambulance.gateway';

describe('Phase 6: Ambulance Socket Room Isolation', () => {
  let gateway: AmbulanceGateway;

  const requestA = {
    id: 'req-A',
    patientId: 'patient-A',
    driver: { userId: 'driver-user-A' },
  };

  beforeEach(() => {
    const mockPrisma: any = {
      ambulanceRequest: {
        findUnique: ({ where }: any) => {
          if (where.id === 'req-A') return requestA;
          return null;
        },
      },
    };

    gateway = new AmbulanceGateway(mockPrisma);
  });

  it('prohibits unauthorized Patient B from joining tracking room for Request A', async () => {
    let joinedRoom: string | null = null;
    const mockClient: any = {
      user: { userId: 'patient-B', role: 'PATIENT' },
      join: async (room: string) => {
        joinedRoom = room;
      },
    };

    const result = await gateway.handleJoinTracking(mockClient, { requestId: 'req-A' });

    expect(result.error).toContain('Forbidden');
    expect(joinedRoom).toBeNull(); // Client was NOT joined into room
  });

  it('prohibits unauthorized Driver C from joining tracking room for Request A', async () => {
    let joinedRoom: string | null = null;
    const mockClient: any = {
      user: { userId: 'driver-user-C', role: 'DRIVER' },
      join: async (room: string) => {
        joinedRoom = room;
      },
    };

    const result = await gateway.handleJoinTracking(mockClient, { requestId: 'req-A' });

    expect(result.error).toContain('Forbidden');
    expect(joinedRoom).toBeNull();
  });

  it('allows authorized Patient A to join their own ambulance tracking room', async () => {
    let joinedRoom: string | null = null;
    const mockClient: any = {
      user: { userId: 'patient-A', role: 'PATIENT' },
      join: async (room: string) => {
        joinedRoom = room;
      },
    };

    const result = await gateway.handleJoinTracking(mockClient, { requestId: 'req-A' });

    expect(result.joined).toBe('ambulance:req-A');
    expect(joinedRoom).toBe('ambulance:req-A');
  });
});
