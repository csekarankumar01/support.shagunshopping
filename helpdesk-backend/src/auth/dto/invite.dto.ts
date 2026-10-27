import { IsIn, IsOptional } from 'class-validator';
import type { Role } from '../role.js';
import { IsNormalizedEmail } from './email.js';
import { IsPassword } from './password.js';

// ADMIN is deliberately not invitable: admins only come from /register-org.
export const INVITABLE_ROLES: Role[] = ['AGENT', 'CUSTOMER'];

export class InviteDto {
  @IsNormalizedEmail()
  email!: string;

  /** Leave it out and the person gets an email with a link to choose their own password (the normal way). */
  @IsOptional()
  @IsPassword()
  password?: string;

  @IsIn(INVITABLE_ROLES)
  role!: Role;
}
