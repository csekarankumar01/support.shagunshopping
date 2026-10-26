import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { AuthModule } from '../auth/auth.module.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';
import type { Role } from '../auth/role.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { DatabaseModule } from '../database/database.module.js';
import { TeamService } from './team.service.js';

export class UpdateMemberDto {
  @IsOptional()
  @IsIn(['AGENT', 'CUSTOMER'])
  role?: Role;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@Controller('api/v1/team')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @Roles('ADMIN', 'AGENT')
  members(@CurrentUser() user: AuthenticatedUser) {
    return this.team.list(user);
  }

  @Patch(':userId')
  @Roles('ADMIN')
  update(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.team.update(admin, userId, dto);
  }
}

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [TeamController],
  providers: [TeamService],
})
export class TeamModule {}
