import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CommentsService } from './comments.service.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';

@Controller('api/v1/tickets/:ticketId/comments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'AGENT', 'CUSTOMER')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.comments.list(user, ticketId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(user, ticketId, dto);
  }
}
