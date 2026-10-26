import { IsIn } from 'class-validator';
import { TICKET_STATUSES } from '../ticket.constants.js';
import type { TicketStatus } from '../ticket.constants.js';

export class UpdateStatusDto {
  @IsIn(TICKET_STATUSES)
  status!: TicketStatus;
}
