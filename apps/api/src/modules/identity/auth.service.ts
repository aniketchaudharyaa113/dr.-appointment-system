import {
  Injectable,
  BadRequestException,
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

    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      // Equalize timing without disclosing whether the email already belongs to an account
      await this.hashPassword(input.password);
      return {
        pendingVerification: true,
        message: 'If this email is eligible, confirmation instructions have been sent.',
      };
    }

    const passwordHash = await this.hashPassword(input.password);
    const rawVerifyToken = randomBytes(32).toString('hex');
    const verifyTokenHash = this.hashToken(rawVerifyToken);
    const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email,
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

        await tx.userSecurityToken.create({
          data: {
            userId: newUser.id,
            type: 'EMAIL_VERIFY',
            tokenHash: verifyTokenHash,
            expiresAt: verifyExpiresAt,
          },
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: 'USER',
            aggregateId: newUser.id,
            eventType: 'EMAIL_VERIFICATION_REQUESTED',
            payload: {
              userId: newUser.id,
              email: newUser.email,
              name: newUser.name,
              token: rawVerifyToken,
            },
          },
        });

        return newUser;
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return {
          pendingVerification: true,
          message: 'If this email is eligible, confirmation instructions have been sent.',
        };
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
        data: { isRevoked: true, revokedReason: 'ROTATED' },
      });

      if (updated.count === 0) {
        return {
          status: 'ALREADY_REVOKED' as const,
          tokenId: stored.id,
          userId: stored.userId,
          revokedReason: stored.revokedReason,
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
      // Logged-out or administratively invalidated tokens fail without nuking other sessions
      if (
        rotationOutcome.revokedReason === 'LOGOUT' ||
        rotationOutcome.revokedReason === 'ACCOUNT_REVOKED' ||
        rotationOutcome.revokedReason === 'PASSWORD_CHANGED' ||
        rotationOutcome.revokedReason === 'PASSWORD_RESET'
      ) {
        throw new UnauthorizedException('Refresh token has been revoked');
      }

      const client = this.redis.getClient();
      const inGraceWindow = client
        ? Boolean(await client.get(`refresh_grace:${rotationOutcome.tokenId}`))
        : false;

      if (inGraceWindow) {
        throw new UnauthorizedException('Refresh token already rotated');
      }

      // Outside grace window for ROTATED token: treat as token theft -> revoke all user sessions
      await this.prisma.refreshToken.updateMany({
        where: { userId: rotationOutcome.userId, isRevoked: false },
        data: { isRevoked: true, revokedReason: 'REUSE_THEFT' },
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
        data: { isRevoked: true, revokedReason: 'LOGOUT' },
      });
    }
    return { success: true };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account not active');
    }

    const valid = await this.verifyPassword(user.passwordHash, currentPassword);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await this.hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      });
      await tx.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true, revokedReason: 'PASSWORD_CHANGED' },
      });
      await this.audit.log(
        {
          userId,
          action: 'USER_PASSWORD_CHANGED',
          resource: 'USER',
          resourceId: userId,
          ipAddress,
          userAgent,
        },
        tx,
      );
    });

    return { success: true, message: 'Password updated successfully' };
  }

  async requestPasswordReset(email: string, ipAddress?: string, userAgent?: string) {
    const normalizedEmail = email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (user && user.isActive) {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = this.hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await this.prisma.$transaction(async (tx) => {
        await tx.userSecurityToken.create({
          data: {
            userId: user.id,
            type: 'PASSWORD_RESET',
            tokenHash,
            expiresAt,
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'USER',
            aggregateId: user.id,
            eventType: 'PASSWORD_RESET_REQUESTED',
            payload: {
              userId: user.id,
              email: user.email,
              name: user.name,
              token: rawToken,
            },
          },
        });
        await this.audit.log(
          {
            userId: user.id,
            action: 'PASSWORD_RESET_REQUESTED',
            resource: 'USER',
            resourceId: user.id,
            ipAddress,
            userAgent,
          },
          tx,
        );
      });
    }

    return {
      success: true,
      message: 'If an account exists for that email, password reset instructions have been sent.',
    };
  }

  async resetPassword(
    rawToken: string,
    newPassword: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const tokenHash = this.hashToken(rawToken);
    const now = new Date();
    const newHash = await this.hashPassword(newPassword);

    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.userSecurityToken.updateMany({
        where: {
          tokenHash,
          type: 'PASSWORD_RESET',
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (claim.count === 0) {
        throw new BadRequestException('Password reset token is invalid or expired');
      }

      const tokenRow = await tx.userSecurityToken.findUniqueOrThrow({
        where: { tokenHash },
      });

      await tx.user.update({
        where: { id: tokenRow.userId },
        data: { passwordHash: newHash },
      });

      await tx.refreshToken.updateMany({
        where: { userId: tokenRow.userId, isRevoked: false },
        data: { isRevoked: true, revokedReason: 'PASSWORD_RESET' },
      });

      await this.audit.log(
        {
          userId: tokenRow.userId,
          action: 'USER_PASSWORD_RESET',
          resource: 'USER',
          resourceId: tokenRow.userId,
          ipAddress,
          userAgent,
        },
        tx,
      );
    });

    return { success: true, message: 'Password has been reset successfully' };
  }

  async verifyEmail(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.userSecurityToken.updateMany({
        where: {
          tokenHash,
          type: 'EMAIL_VERIFY',
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (claim.count === 0) {
        throw new BadRequestException('Email verification token is invalid or expired');
      }

      const tokenRow = await tx.userSecurityToken.findUniqueOrThrow({
        where: { tokenHash },
      });

      await tx.user.update({
        where: { id: tokenRow.userId },
        data: { emailVerified: true, emailVerifiedAt: now },
      });
    });

    return { success: true, verified: true };
  }

  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new NotFoundException('User not found');
    }
    if (user.emailVerified) {
      return { success: true, alreadyVerified: true };
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.userSecurityToken.create({
        data: {
          userId: user.id,
          type: 'EMAIL_VERIFY',
          tokenHash,
          expiresAt,
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'USER',
          aggregateId: user.id,
          eventType: 'EMAIL_VERIFICATION_REQUESTED',
          payload: {
            userId: user.id,
            email: user.email,
            name: user.name,
            token: rawToken,
          },
        },
      });
    });

    return { success: true, message: 'Verification email sent' };
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
      emailVerified: user.emailVerified,
      doctorProfile: user.doctorProfile,
      driverProfile: user.driverProfile,
    };
  }
}
