import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RateLimit, RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AuthService } from './auth.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { InviteDto } from './dto/invite.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterOrgDto } from './dto/register-org.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { ResendCodeDto, VerifyRegistrationDto } from './dto/verify-registration.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register-org')
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'register-org', limit: 20, windowSeconds: 3600, by: 'ip' })
  registerOrg(@Body() dto: RegisterOrgDto) {
    return this.authService.registerOrg(dto);
  }

  /** Step 2 of sign-up: the 6-digit code from the email creates the organisation and its admin. */
  @Post('verify-registration')
  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: 'verify-registration',
    limit: 10,
    windowSeconds: 600,
    by: 'login-account',
  })
  verifyRegistration(@Body() dto: VerifyRegistrationDto) {
    return this.authService.verifyRegistration(dto);
  }

  @Post('resend-registration-code')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: 'resend-registration-code',
    limit: 5,
    windowSeconds: 3600,
    by: 'login-account',
  })
  resendRegistrationCode(@Body() dto: ResendCodeDto) {
    return this.authService.resendRegistrationCode(dto);
  }

  /** Returns a short-lived access token and a rotating refresh token. */
  @Post('login')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: 'login',
    limit: 10,
    windowSeconds: 60,
    by: 'login-account',
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'refresh', limit: 120, windowSeconds: 60, by: 'ip' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'logout', limit: 60, windowSeconds: 60, by: 'ip' })
  logout(@Body() dto: RefreshDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  logoutAll(@Req() req: AuthenticatedRequest) {
    return this.authService.logoutEverywhere(req.user);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({
    name: 'change-password',
    limit: 5,
    windowSeconds: 60,
    by: 'user',
  })
  changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(req.user, req.sid, dto);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: 'forgot-password',
    limit: 3,
    windowSeconds: 3600,
    by: 'login-account',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: 'reset-password',
    limit: 20,
    windowSeconds: 3600,
    by: 'ip',
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('invite')
  @UseGuards(JwtAuthGuard, RolesGuard, RateLimitGuard)
  @RateLimit({ name: 'invite', limit: 30, windowSeconds: 60, by: 'user' })
  @Roles('ADMIN')
  invite(@Req() req: AuthenticatedRequest, @Body() dto: InviteDto) {
    return this.authService.invite(req.user.orgId, dto);
  }

  @Post('socket-token')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ name: 'socket-token', limit: 30, windowSeconds: 60, by: 'user' })
  socketToken(@Req() req: AuthenticatedRequest) {
    return this.authService.issueSocketToken(req.user, req.sid, req.sessionExp);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthenticatedRequest) {
    return req.user;
  }
}
