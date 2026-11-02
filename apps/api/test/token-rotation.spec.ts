import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService } from '../src/modules/identity/auth.service';
import { PrismaService } from '../src/modules/platform/database/prisma.service';
import { AuditService } from '../src/modules/platform/audit/audit.service';
import { UnauthorizedException } from '@nestjs/common';

describe('AuthService - Refresh Token Rotation & Reuse Detection', () => {
  let authService: AuthService;
  let mockPrisma: any;
  let mockAudit: any;
  let refreshTokensStore: Array<any> = [];

  beforeEach(() => {
    refreshTokensStore = [];

    mockPrisma = {
      refreshToken: {
        create: async ({ data }: any) => {
          const item = { id: 'rt-' + Math.random(), isRevoked: false, ...data };
          refreshTokensStore.push(item);
          return item;
        },
        findFirst: async ({ where }: any) => {
          const found = refreshTokensStore.find((t) => t.tokenHash === where.tokenHash);
          if (found) {
            return {
              ...found,
              user: { id: found.userId, email: 'test@medibook.test', role: 'PATIENT' },
            };
          }
          return null;
        },
        update: async ({ where, data }: any) => {
          const item = refreshTokensStore.find((t) => t.id === where.id);
          if (item) Object.assign(item, data);
          return item;
        },
        updateMany: async ({ where, data }: any) => {
          let count = 0;
          for (const item of refreshTokensStore) {
            if (item.userId === where.userId) {
              Object.assign(item, data);
              count++;
            }
          }
          return { count };
        },
      },
    };

    mockAudit = {
      log: async () => {},
    };

    authService = new AuthService(mockPrisma as PrismaService, mockAudit as AuditService);
  });

  it('rotates a valid refresh token and issues a new pair', async () => {
    const user = { id: 'user-123', email: 'test@medibook.test', role: 'PATIENT' as const };
    const initialTokens = authService.generateTokens(user);

    await mockPrisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: initialTokens.hashedRefreshToken,
        expiresAt: initialTokens.expiresAt,
        isRevoked: false,
      },
    });

    const rotated = await authService.rotateRefreshToken(initialTokens.rawRefreshToken);

    expect(rotated).toHaveProperty('accessToken');
    expect(rotated).toHaveProperty('refreshToken');
    expect(rotated.refreshToken).not.toBe(initialTokens.rawRefreshToken);

    // Old token must be marked as revoked
    const oldRecord = refreshTokensStore.find((t) => t.tokenHash === initialTokens.hashedRefreshToken);
    expect(oldRecord.isRevoked).toBe(true);

    // New token must be present and active
    const newHash = authService.hashToken(rotated.refreshToken);
    const newRecord = refreshTokensStore.find((t) => t.tokenHash === newHash);
    expect(newRecord).toBeDefined();
    expect(newRecord.isRevoked).toBe(false);
  });

  it('detects refresh token reuse, revokes entire token family, and blocks access', async () => {
    const user = { id: 'user-compromised', email: 'compromised@medibook.test', role: 'PATIENT' as const };
    const token1 = authService.generateTokens(user);

    await mockPrisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: token1.hashedRefreshToken,
        expiresAt: token1.expiresAt,
        isRevoked: false,
      },
    });

    // Legitimate rotation (Token 1 -> Token 2)
    const token2 = await authService.rotateRefreshToken(token1.rawRefreshToken);
    expect(token2).toBeDefined();

    // Attacker now replays the ALREADY USED Token 1
    await expect(
      authService.rotateRefreshToken(token1.rawRefreshToken),
    ).rejects.toThrow(UnauthorizedException);

    // VERIFY SECURITY MITIGATION: All tokens for this user must now be revoked!
    const activeTokens = refreshTokensStore.filter(
      (t) => t.userId === user.id && !t.isRevoked,
    );
    expect(activeTokens.length).toBe(0);

    // Even Token 2 (the legitimate active token) must now be invalidated
    await expect(
      authService.rotateRefreshToken(token2.refreshToken),
    ).rejects.toThrow(UnauthorizedException);
  });
});
