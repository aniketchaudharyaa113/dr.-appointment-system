import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  UsePipes,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginRateLimitGuard } from './rate-limit/login-rate-limit.guard';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import {
  RegisterUserSchema,
  RegisterUserInput,
  LoginSchema,
  LoginInput,
  RefreshTokenBodySchema,
  ChangePasswordSchema,
  ChangePasswordInput,
  ForgotPasswordSchema,
  ForgotPasswordInput,
  ResetPasswordSchema,
  ResetPasswordInput,
  VerifyEmailSchema,
  VerifyEmailInput,
  JwtPayload,
} from '@medibook/shared';
import { env } from '../../common/config/env.schema';

@ApiTags('Identity')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit({ keyPrefix: 'register', limit: 5, windowSeconds: 60 })
  @UsePipes(new ZodValidationPipe(RegisterUserSchema))
  @ApiOperation({ summary: 'Register a new patient or doctor account' })
  @ApiResponse({ status: 201, description: 'Account registered successfully' })
  async register(
    @Body() body: RegisterUserInput,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];

    const result = await this.authService.register(body, ip, userAgent);

    if ('pendingVerification' in result && result.pendingVerification) {
      return res.status(HttpStatus.ACCEPTED).send({
        pendingVerification: true,
        message: result.message,
      });
    }

    const regSuccess = result as {
      user: { id: string; email: string; name: string; role: string };
      accessToken: string;
      refreshToken: string;
    };

    res.setCookie('refreshToken', regSuccess.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60,
    });

    return res.status(HttpStatus.CREATED).send({
      user: regSuccess.user,
      accessToken: regSuccess.accessToken,
    });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LoginRateLimitGuard)
  @UsePipes(new ZodValidationPipe(LoginSchema))
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  async login(
    @Body() body: LoginInput,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];

    const result = await this.authService.login(body, ip, userAgent);

    res.setCookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60,
    });

    return res.status(HttpStatus.OK).send({
      user: result.user,
      accessToken: result.accessToken,
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate and exchange refresh token for new access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  async refresh(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @Body(new ZodValidationPipe(RefreshTokenBodySchema.optional()))
    body?: { refreshToken?: string },
  ) {
    const cookies = (req as any).cookies || {};
    const token = cookies.refreshToken || body?.refreshToken;

    const ip = req.ip;
    const userAgent = req.headers['user-agent'];

    const result = await this.authService.rotateRefreshToken(token, ip, userAgent);

    res.setCookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60,
    });

    return res.status(HttpStatus.OK).send({
      accessToken: result.accessToken,
    });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  async logout(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @Body(new ZodValidationPipe(RefreshTokenBodySchema.optional()))
    body?: { refreshToken?: string },
  ) {
    const cookies = (req as any).cookies || {};
    const token = cookies.refreshToken || body?.refreshToken;

    await this.authService.logout(token);
    res.clearCookie('refreshToken', { path: '/' });

    return res.status(HttpStatus.OK).send({ success: true });
  }

  @Get('session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check quietly whether a refresh session cookie is present' })
  getSessionStatus(@Req() req: FastifyRequest) {
    const cookies = (req as any).cookies || {};
    return { hasSession: Boolean(cookies.refreshToken) };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change authenticated user password and revoke active refresh tokens' })
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(ChangePasswordSchema)) body: ChangePasswordInput,
    @Req() req: FastifyRequest,
  ) {
    return this.authService.changePassword(
      user.sub,
      body.currentPassword,
      body.newPassword,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ keyPrefix: 'forgot_pw', limit: 5, windowSeconds: 60 })
  @ApiOperation({ summary: 'Request password reset link/token without user enumeration' })
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordSchema)) body: ForgotPasswordInput,
    @Req() req: FastifyRequest,
  ) {
    return this.authService.requestPasswordReset(
      body.email,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ keyPrefix: 'reset_pw', limit: 10, windowSeconds: 60 })
  @ApiOperation({ summary: 'Reset password using a valid single-use reset token' })
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordSchema)) body: ResetPasswordInput,
    @Req() req: FastifyRequest,
  ) {
    return this.authService.resetPassword(
      body.token,
      body.newPassword,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify user email address using verification token' })
  async verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailSchema)) body: VerifyEmailInput,
  ) {
    return this.authService.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ keyPrefix: 'resend_verify', limit: 3, windowSeconds: 60 })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend email verification message to signed-in user' })
  async resendVerification(@CurrentUser() user: JwtPayload) {
    return this.authService.resendVerification(user.sub);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get profile of current authenticated user' })
  async getMe(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user.sub);
  }
}
