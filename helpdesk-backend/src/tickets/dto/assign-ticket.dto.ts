import { IsUUID, ValidateIf } from 'class-validator';

export class AssignTicketDto {
  /** The agent or admin to assign, or null to unassign. */
  @ValidateIf((dto: AssignTicketDto) => dto.agentId !== null)
  @IsUUID()
  agentId!: string | null;
}
