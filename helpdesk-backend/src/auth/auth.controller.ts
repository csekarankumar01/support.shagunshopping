import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { InviteDto } from './dto/invite.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RateLimit, RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { RegisterOrgDto } from './dto/register-org.dto.js';
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
    return this.authService.issueSocketToken(req.user, req.sessionExp);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthenticatedRequest) {
    return req.user;
  }
}
