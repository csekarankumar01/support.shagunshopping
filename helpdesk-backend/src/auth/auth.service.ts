import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service.js';
import { InviteDto } from './dto/invite.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterOrgDto } from './dto/register-org.dto.js';
import type { Role } from './role.js';

const BCRYPT_COST = 10;
const PG_UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (err: unknown, constraint: string) =>
  (err as { code?: string; constraint?: string }).code ===
    PG_UNIQUE_VIOLATION &&
  (err as { constraint?: string }).constraint === constraint;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  /** Creates the tenant and its first ADMIN atomically: both rows are saved or neither is. */
  async registerOrg({ orgName, orgSlug, email, password }: RegisterOrgDto) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    // Row-Level Security only lets us write rows of the "current" org, so the new org's id is generated
    // here and set as the tenant context before inserting.
    const orgId = randomUUID();
    try {
      return await this.db.tenantContextTransaction(orgId, async (client) => {
        const org = await client.query<{
          id: string;
          slug: string;
          name: string;
        }>(
          'INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3) RETURNING id, slug, name',
          [orgId, orgSlug, orgName],
        );
        const user = await client.query<{
          id: string;
          email: string;
          role: Role;
        }>(
          `INSERT INTO users (org_id, email, password_hash, role)
           VALUES ($1, $2, $3, 'ADMIN') RETURNING id, email, role`,
          [orgId, email, passwordHash],
        );
        return { organization: org.rows[0], user: user.rows[0] };
      });
    } catch (err) {
      if (isUniqueViolation(err, 'organizations_slug_key')) {
        throw new ConflictException('Organization slug already taken');
      }
      throw err;
    }
  }

  async login({ orgSlug, email, password }: LoginDto) {
    const { rows } = await this.db.query<{
      id: string;
      org_id: string;
      role: Role;
      password_hash: string;
    }>(
      // Login runs before any tenant is known, so it uses the one narrow SECURITY DEFINER lookup (migration 008).
      'SELECT id, org_id, role, password_hash FROM auth_lookup_user($1, $2)',
      [orgSlug, email],
    );
    const user = rows[0];
    // Same error for "no such org/email" and "wrong password" so attackers can't probe what exists.
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      orgId: user.org_id,
      role: user.role,
    });
    return { accessToken };
  }

  /** orgId must be the caller's own org taken from their verified token, never from the request body. */
  async invite(orgId: string, { email, password, role }: InviteDto) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    try {
      const { rows } = await this.db.tenantQuery<{
        id: string;
        email: string;
        role: Role;
      }>(
        orgId,
        `INSERT INTO users (org_id, email, password_hash, role)
         VALUES ($1, $2, $3, $4) RETURNING id, email, role`,
        [email, passwordHash, role],
      );
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err, 'users_org_email_key')) {
        throw new ConflictException(
          'Email already registered in this organization',
        );
      }
      throw err;
    }
  }
}
