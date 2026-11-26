import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../platform/database/prisma.service';
import { RedisService } from '../platform/redis/redis.service';
import { AuditService } from '../platform/audit/audit.service';
import { env } from '../../common/config/env.schema';
import {
  RegisterUserInput,
  LoginInput,
  JwtPayload,
  UserRole,
} from '@medibook/shared';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
  }

  async verifyPassword(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  generateTokens(user: { id: string; email: string; role: UserRole }) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
      algorithm: 'HS256',
    });

    const rawRefreshToken = randomBytes(32).toString('hex');
    const hashedRefreshToken = this.hashToken(rawRefreshToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + env.REFRESH_TOKEN_EXPIRES_DAYS);

    return {
      accessToken,
      rawRefreshToken,
      hashedRefreshToken,
      expiresAt,
    };
  }

  async register(
    input: RegisterUserInput,
    ipAddress?: string,
    userAgent?: string,
  ) {
    if (input.role !== 'PATIENT' && input.role !== 'DOCTOR') {
      throw new ForbiddenException(
        'Public registration is restricted to PATIENT or DOCTOR roles',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await this.hashPassword(input.password);

    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email: input.email.toLowerCase(),
            passwordHash,
            name: input.name,
            phone: input.phone,
            role: input.role,
          },
        });

        if (input.role === 'DOCTOR') {
          await tx.doctor.create({
            data: {
              userId: newUser.id,
              specialty: input.specialty || 'General Medicine',
              qualifications: input.qualifications,
              experienceYears: input.experienceYears ?? 0,
              clinicName: input.clinicName,
              clinicAddress: input.clinicAddress,
              clinicLat: input.clinicLat,
              clinicLng: input.clinicLng,
              consultationFeePaise: input.consultationFeePaise || 50000,
              licenseNumber: input.licenseNumber,
              isVerified: false,
              verificationStatus: 'PENDING',
            },
          });
        }

        return newUser;
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('A user with this email already exists');
      }
      throw err;
    }

    const tokens = this.generateTokens(user);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: tokens.hashedRefreshToken,
        expiresAt: tokens.expiresAt,
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'USER_REGISTERED',
      resource: 'USER',
      resourceId: user.id,
      details: { role: user.role },
      ipAddress,
      userAgent,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.rawRefreshToken,
    };
  }

  async login(input: LoginInput, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      include: { doctorProfile: true },
    });

    if (!user || !user.isActive) {
      await this.verifyPassword(DUMMY_PASSWORD_HASH, input.password);
      throw new UnauthorizedException('Invalid email or password');
    }

    const isValid = await this.verifyPassword(user.passwordHash, input.password);
    if (!isValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = this.generateTokens(user);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: tokens.hashedRefreshToken,
        expiresAt: tokens.expiresAt,
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'USER_LOGGED_IN',
      resource: 'USER',
      resourceId: user.id,
      ipAddress,
      userAgent,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.doctorProfile?.isVerified ?? true,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.rawRefreshToken,
    };
  }

  async rotateRefreshToken(
    rawRefreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }

    const hashed = this.hashToken(rawRefreshToken);

    const rotationOutcome = await this.prisma.$transaction(async (tx) => {
      const stored = await tx.refreshToken.findFirst({
        where: { tokenHash: hashed },
        include: { user: true },
      });

      if (!stored) {
        return { status: 'NOT_FOUND' as const };
      }

      if (!stored.user.isActive) {
        return { status: 'INACTIVE' as const };
      }

      // Atomic compare-and-set rotation inside transaction
      const updated = await tx.refreshToken.updateMany({
        where: { id: stored.id, isRevoked: false },
        data: { isRevoked: true },
      });

      if (updated.count === 0) {
        return {
          status: 'ALREADY_REVOKED' as const,
          tokenId: stored.id,
          userId: stored.userId,
        };
      }

      if (new Date() > stored.expiresAt) {
        return { status: 'EXPIRED' as const };
      }

      const tokens = this.generateTokens(stored.user);
      await tx.refreshToken.create({
        data: {
          userId: stored.user.id,
          tokenHash: tokens.hashedRefreshToken,
          expiresAt: tokens.expiresAt,
        },
      });

      return {
        status: 'ROTATED' as const,
        tokenId: stored.id,
        accessToken: tokens.accessToken,
        refreshToken: tokens.rawRefreshToken,
      };
    });

    if (rotationOutcome.status === 'NOT_FOUND') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (rotationOutcome.status === 'INACTIVE') {
      throw new UnauthorizedException('User account is inactive');
    }
    if (rotationOutcome.status === 'EXPIRED') {
      throw new UnauthorizedException('Refresh token has expired');
    }
    if (rotationOutcome.status === 'ALREADY_REVOKED') {
      const client = this.redis.getClient();
      const inGraceWindow = client
        ? Boolean(await client.get(`refresh_grace:${rotationOutcome.tokenId}`))
        : false;

      if (inGraceWindow) {
        throw new UnauthorizedException('Refresh token already rotated');
      }

      // Outside grace window: treat as token reuse / theft -> revoke all user sessions
      await this.prisma.refreshToken.updateMany({
        where: { userId: rotationOutcome.userId },
        data: { isRevoked: true },
      });

      await this.audit.log({
        userId: rotationOutcome.userId,
        action: 'SECURITY_ALERT_REFRESH_TOKEN_REUSE',
        resource: 'REFRESH_TOKEN',
        resourceId: rotationOutcome.tokenId,
        details: { alert: 'Compromised token family invalidated' },
        ipAddress,
        userAgent,
      });

      throw new UnauthorizedException(
        'Security alert: Refresh token reuse detected. All sessions revoked.',
      );
    }

    const client = this.redis.getClient();
    if (client) {
      await client
        .set(`refresh_grace:${rotationOutcome.tokenId}`, '1', 'EX', 10)
        .catch(() => {});
    }

    return {
      accessToken: rotationOutcome.accessToken,
      refreshToken: rotationOutcome.refreshToken,
    };
  }

  async logout(rawRefreshToken?: string) {
    if (rawRefreshToken) {
      const hashed = this.hashToken(rawRefreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: hashed, isRevoked: false },
        data: { isRevoked: true },
      });
    }
    return { success: true };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { doctorProfile: true, driverProfile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      doctorProfile: user.doctorProfile,
      driverProfile: user.driverProfile,
    };
  }
}
