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
import {
  RegisterUserSchema,
  RegisterUserInput,
  LoginSchema,
  LoginInput,
  JwtPayload,
} from '@medibook/shared';
import { env } from '../../common/config/env.schema';

@ApiTags('Identity')
@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('register')
  @UsePipes(new ZodValidationPipe(RegisterUserSchema))
  @ApiOperation({ summary: 'Register a new patient or doctor account' })
  @ApiResponse({ status: 201, description: 'Account registered successfully' })
  async register(
    @Body() body: RegisterUserInput,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.ip;
    const userAgent = req.headers['user-agent'];

    const result = await this.authService.register(body, ip, userAgent);

    res.setCookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60,
    });

    return res.status(HttpStatus.CREATED).send({
      user: result.user,
      accessToken: result.accessToken,
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
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.ip;
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
    @Body() body: { refreshToken?: string },
  ) {
    const cookies = (req as any).cookies || {};
    const token = cookies.refreshToken || body?.refreshToken;

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.ip;
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
    @Body() body: { refreshToken?: string },
  ) {
    const cookies = (req as any).cookies || {};
    const token = cookies.refreshToken || body?.refreshToken;

    await this.authService.logout(token);
    res.clearCookie('refreshToken', { path: '/' });

    return res.status(HttpStatus.OK).send({ success: true });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get profile of current authenticated user' })
  async getMe(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user.sub);
  }
}
