import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import type { Role } from '../role.js';

// ADMIN is deliberately not invitable: admins only come from /register-org.
export const INVITABLE_ROLES: Role[] = ['AGENT', 'CUSTOMER'];

export class InviteDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsIn(INVITABLE_ROLES)
  role!: Role;
}
