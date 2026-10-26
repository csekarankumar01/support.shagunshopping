import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TICKET_PRIORITIES } from '../ticket.constants.js';
import type { TicketPriority } from '../ticket.constants.js';

export class CreateTicketDto {
  // Trim first, so a subject of only spaces becomes '' and fails @IsNotEmpty with a 400.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;
}
