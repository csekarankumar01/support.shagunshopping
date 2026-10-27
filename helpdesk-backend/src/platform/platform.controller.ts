import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RateLimit, RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import {
  OrgTicketsQueryDto,
  PlatformLoginDto,
  SearchQueryDto,
  SuspendDto,
  UpdateOrganizationDto,
  UpdateUserDto,
} from './platform.dto.js';
import { PlatformAuthGuard } from './platform-auth.guard.js';
import type { PlatformRequest } from './platform-auth.guard.js';
import { PlatformService } from './platform.service.js';

/** The super admin console API. Entirely separate from the tenant API: its own login and its own kind of token. */
@Controller('api/v1/platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'platform-login', limit: 10, windowSeconds: 60, by: 'ip' })
  login(@Body() dto: PlatformLoginDto) {
    return this.platform.login(dto.email, dto.password, dto.code);
  }

  @Get('me')
  @UseGuards(PlatformAuthGuard)
  me(@Req() req: PlatformRequest) {
    return req.admin;
  }

  @Get('overview')
  @UseGuards(PlatformAuthGuard)
  overview() {
    return this.platform.overview();
  }

  @Get('organizations')
  @UseGuards(PlatformAuthGuard)
  organizations(@Query() query: SearchQueryDto) {
    return this.platform.listOrganizations(query.q);
  }

  @Get('organizations/:id')
  @UseGuards(PlatformAuthGuard)
  organization(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.getOrganization(id);
  }

  @Patch('organizations/:id')
  @UseGuards(PlatformAuthGuard)
  updateOrganization(
    @Req() req: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.platform.updateOrganization(req.admin, id, dto);
  }

  @Post('organizations/:id/suspend')
  @HttpCode(200)
  @UseGuards(PlatformAuthGuard)
  suspend(
    @Req() req: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendDto,
  ) {
    return this.platform.suspend(req.admin, id, dto.reason);
  }

  @Post('organizations/:id/activate')
  @HttpCode(200)
  @UseGuards(PlatformAuthGuard)
  activate(
    @Req() req: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.platform.activate(req.admin, id);
  }

  @Get('organizations/:id/users')
  @UseGuards(PlatformAuthGuard)
  users(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.listUsers(id);
  }

  @Get('organizations/:id/tickets')
  @UseGuards(PlatformAuthGuard)
  tickets(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: OrgTicketsQueryDto,
  ) {
    return this.platform.listTickets(id, query.page, query.limit, query.status);
  }

  @Patch('users/:id')
  @UseGuards(PlatformAuthGuard)
  updateUser(
    @Req() req: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.platform.updateUser(req.admin, id, dto);
  }

  @Get('tickets/:id')
  @UseGuards(PlatformAuthGuard)
  ticket(@Req() req: PlatformRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.getTicket(req.admin, id);
  }

  @Get('audit')
  @UseGuards(PlatformAuthGuard)
  audit(@Query('orgId') orgId?: string) {
    return this.platform.auditLog(
      orgId && /^[0-9a-f-]{36}$/i.test(orgId) ? orgId : undefined,
    );
  }
}

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAuthGuard],
})
export class PlatformModule {}
