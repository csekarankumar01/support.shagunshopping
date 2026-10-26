import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { RateLimit, RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { AssignTicketDto } from './dto/assign-ticket.dto.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto.js';
import { UpdateStatusDto } from './dto/update-status.dto.js';
import { TicketsService } from './tickets.service.js';

@Controller('api/v1/tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  @Roles('ADMIN', 'AGENT', 'CUSTOMER')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTicketsQueryDto,
  ) {
    return this.tickets.list(user, query);
  }

  /** Dashboard numbers. Declared before ':id' so "stats" is not mistaken for a ticket id. */
  @Get('stats')
  @Roles('ADMIN', 'AGENT')
  stats(@CurrentUser() user: AuthenticatedUser) {
    return this.tickets.stats(user);
  }

  @Get(':id')
  @Roles('ADMIN', 'AGENT', 'CUSTOMER')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tickets.get(user, id);
  }

  @Post()
  @Roles('CUSTOMER')
  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: 'ticket-create',
    limit: 30,
    windowSeconds: 60,
    by: 'user',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTicketDto) {
    return this.tickets.create(user, dto);
  }

  @Patch(':id/assign')
  @Roles('ADMIN', 'AGENT')
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
  ) {
    return this.tickets.assign(user, id, dto.agentId);
  }

  @Patch(':id/status')
  @Roles('ADMIN', 'AGENT')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.tickets.updateStatus(user, id, dto.status);
  }
}
