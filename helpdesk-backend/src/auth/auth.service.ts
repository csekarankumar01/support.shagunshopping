import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service.js';
import { MailerService } from '../mail/mailer.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { InviteDto } from './dto/invite.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterOrgDto } from './dto/register-org.dto.js';
import { ResendCodeDto, VerifyRegistrationDto } from './dto/verify-registration.dto.js';
import { RegistrationService } from './registration.service.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import type { Role } from './role.js';
import {
  newOpaqueToken,
  parseOpaqueToken,
  SessionService,
} from './session.service.js';
import type { Tokens } from './session.service.js';
import { SOCKET_TOKEN_TTL_SECONDS } from './verify-token.js';
import type { AuthenticatedUser } from './verify-token.js';

const BCRYPT_COST = 10;
const PG_UNIQUE_VIOLATION = '23505';
const RESET_LINK_HOURS = 1;
const INVITE_LINK_HOURS = 72;

const isUniqueViolation = (err: unknown, constraint: string) =>
  (err as { code?: string; constraint?: string }).code ===
    PG_UNIQUE_VIOLATION &&
  (err as { constraint?: string }).constraint === constraint;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly frontendUrl: string;
  private readonly registrationOpen: boolean;
  /** REQUIRE_EMAIL_VERIFICATION=false creates the organisation at once (used by tests and quick local demos). */
  private readonly requireVerification: boolean;
  /** A real bcrypt hash of nothing in particular, compared against when the account does not exist (see login). */
  private decoyHash = '';

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly mailer: MailerService,
    private readonly registration: RegistrationService,
    config: ConfigService,
  ) {
    // A private deployment sets ALLOW_REGISTRATION=false so that nobody else can create organisations on it.
    this.registrationOpen = config.get<string>('ALLOW_REGISTRATION', 'true') !== 'false';
    this.requireVerification =
      config.get<string>('REQUIRE_EMAIL_VERIFICATION', 'true') !== 'false';
    this.frontendUrl = config
      .get<string>('FRONTEND_ORIGIN', 'http://localhost:4311')
      .split(',')[0]
      .trim();
  }

  async onModuleInit() {
    this.decoyHash = await bcrypt.hash(
      randomBytes(16).toString('hex'),
      BCRYPT_COST,
    );
  }

  /**
   * Starts creating an organisation. With email verification on (the default) nothing is created yet: a 6-digit
   * code is emailed and verifyRegistration() creates the organisation when it is entered.
   */
  async registerOrg(dto: RegisterOrgDto) {
    if (!this.registrationOpen) {
      throw new ForbiddenException('Registration is closed on this server');
    }
    if (this.requireVerification) return this.registration.start(dto);
    return this.createOrganization({
      orgName: dto.orgName,
      orgSlug: dto.orgSlug,
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_COST),
    });
  }

  /** The admin typed the emailed code: create the organisation and its first admin. */
  async verifyRegistration(dto: VerifyRegistrationDto) {
    if (!this.registrationOpen) {
      throw new ForbiddenException('Registration is closed on this server');
    }
    return this.createOrganization(await this.registration.verify(dto));
  }

  resendRegistrationCode(dto: ResendCodeDto) {
    return this.registration.resend(dto);
  }

  /** Creates the tenant and its first ADMIN atomically: both rows are saved or neither is. */
  private async createOrganization({
    orgName,
    orgSlug,
    email,
    passwordHash,
  }: {
    orgName: string;
    orgSlug: string;
    email: string;
    passwordHash: string;
  }) {
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

  async login({ orgSlug, email, password }: LoginDto): Promise<Tokens> {
    const { rows } = await this.db.query<{
      id: string;
      org_id: string;
      role: Role;
      password_hash: string;
      is_active: boolean;
      org_suspended: boolean;
    }>(
      // Login runs before any tenant is known, so it uses the one narrow SECURITY DEFINER lookup (migration 011).
      'SELECT id, org_id, role, password_hash, is_active, org_suspended FROM auth_lookup_user($1, $2)',
      [orgSlug, email],
    );
    const user = rows[0];
    // Always run one bcrypt comparison, even for an account that does not exist, so how long the answer takes
    // does not reveal whether the account exists. Same message for every failure.
    const passwordOk = await bcrypt.compare(
      password,
      user?.password_hash ?? this.decoyHash,
    );
    if (!user || !passwordOk || !user.is_active) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // Only said after the password was right, so it does not reveal which organisations exist.
    if (user.org_suspended) {
      throw new ForbiddenException(
        'This organisation has been suspended. Please contact support.',
      );
    }
    return this.db.tenantTransaction(user.org_id, (q) =>
      this.sessions.start(q, {
        id: user.id,
        orgId: user.org_id,
        role: user.role,
      }),
    );
  }

  refresh(refreshToken: string) {
    return this.sessions.refresh(refreshToken);
  }

  async logout(refreshToken: string) {
    await this.sessions.logout(refreshToken);
    return { ok: true };
  }

  /** Signs the user out of every device (including this one). */
  async logoutEverywhere(user: AuthenticatedUser) {
    await this.sessions.revokeUserSessions(user.orgId, user.userId);
    return { ok: true };
  }

  /**
   * A 60-second token for the WebSocket handshake only. The browser cannot read the httpOnly login cookie, so the
   * Next.js server calls this with it and hands the result to the page. It carries the end of the login session
   * and its session id, so the socket is dropped when that session ends.
   */
  async issueSocketToken(
    user: AuthenticatedUser,
    sid: string,
    sessionExp: number,
  ) {
    const token = await this.jwt.signAsync(
      {
        sub: user.userId,
        orgId: user.orgId,
        role: user.role,
        sid,
        purpose: 'socket',
        sessionExp,
      },
      { expiresIn: SOCKET_TOKEN_TTL_SECONDS },
    );
    return { token, expiresIn: SOCKET_TOKEN_TTL_SECONDS };
  }

  /** Changing the password signs out every other device; this one stays signed in. */
  async changePassword(
    user: AuthenticatedUser,
    sid: string,
    dto: ChangePasswordDto,
  ) {
    const { rows } = await this.db.tenantQuery<{ passwordHash: string }>(
      user.orgId,
      `SELECT password_hash AS "passwordHash" FROM users WHERE org_id = $1 AND id = $2 AND is_active`,
      [user.userId],
    );
    if (
      !rows[0] ||
      !(await bcrypt.compare(dto.currentPassword, rows[0].passwordHash))
    ) {
      // 400, not 401: the person IS logged in. A 401 here would be read by the web app as "your session ended".
      throw new BadRequestException('Current password is wrong');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_COST);
    const sids = await this.db.tenantTransaction(user.orgId, async (q) => {
      await q(
        `UPDATE users SET password_hash = $3, password_changed_at = now() WHERE org_id = $1 AND id = $2`,
        [user.userId, passwordHash],
      );
      return this.sessions.revokeAllOf(q, user.userId, sid);
    });
    await this.sessions.announce(sids);
    return { ok: true };
  }

  /**
   * "I forgot my password". Always answers the same way whether or not the account exists, and does the work after
   * answering, so neither the reply nor its timing reveals who has an account.
   */
  async forgotPassword({ orgSlug, email }: ForgotPasswordDto) {
    void this.sendLinkIfAccountExists(orgSlug, email).catch((err: Error) =>
      this.logger.error(`password reset email failed: ${err.message}`),
    );
    return { ok: true };
  }

  private async sendLinkIfAccountExists(orgSlug: string, email: string) {
    const { rows } = await this.db.query<{
      id: string;
      org_id: string;
      is_active: boolean;
    }>('SELECT id, org_id, is_active FROM auth_lookup_user($1, $2)', [
      orgSlug,
      email,
    ]);
    const user = rows[0];
    if (!user?.is_active) return;
    const link = await this.createResetLink(
      user.org_id,
      user.id,
      RESET_LINK_HOURS,
    );
    await this.mailer.send(
      email,
      'Reset your password',
      `Someone (hopefully you) asked to reset the password for this account.\n\n` +
        `Choose a new password here (the link works once and expires in ${RESET_LINK_HOURS} hour):\n${link}\n\n` +
        `If you did not ask for this, ignore this email: your password has not changed.\n`,
    );
  }

  /** Stores a single-use reset token (hash only) and returns the link to email. Older unused links stop working. */
  private async createResetLink(
    orgId: string,
    userId: string,
    validHours: number,
  ) {
    const token = newOpaqueToken(orgId);
    await this.db.tenantTransaction(orgId, async (q) => {
      await q(
        `UPDATE password_resets SET used_at = now() WHERE org_id = $1 AND user_id = $2 AND used_at IS NULL`,
        [userId],
      );
      await q(
        `INSERT INTO password_resets (org_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(hours => $4::int))`,
        [userId, token.hash, validHours],
      );
    });
    return `${this.frontendUrl}/reset-password?token=${encodeURIComponent(token.raw)}`;
  }

  async resetPassword({ token, newPassword }: ResetPasswordDto) {
    const parsed = parseOpaqueToken(token);
    const invalid = new BadRequestException(
      'This link is invalid or has expired',
    );
    if (!parsed) throw invalid;
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    const sids = await this.db.tenantTransaction(parsed.orgId, async (q) => {
      const { rows } = await q<{ userId: string }>(
        `SELECT r.user_id AS "userId" FROM password_resets r
           JOIN users u ON u.org_id = r.org_id AND u.id = r.user_id
          WHERE r.org_id = $1 AND r.token_hash = $2 AND r.used_at IS NULL AND r.expires_at > now() AND u.is_active
            FOR UPDATE OF r`,
        [parsed.hash],
      );
      if (!rows[0]) return null;
      await q(
        `UPDATE password_resets SET used_at = now() WHERE org_id = $1 AND token_hash = $2`,
        [parsed.hash],
      );
      await q(
        `UPDATE users SET password_hash = $3, password_changed_at = now() WHERE org_id = $1 AND id = $2`,
        [rows[0].userId, passwordHash],
      );
      return this.sessions.revokeAllOf(q, rows[0].userId); // whoever knew the old password is signed out everywhere
    });
    if (!sids) throw invalid;
    await this.sessions.announce(sids);
    return { ok: true };
  }

  /**
   * orgId must be the caller's own org taken from their verified token, never from the request body.
   * Without a password the person is emailed a link to choose their own (the usual way: the admin never sees it).
   */
  async invite(orgId: string, { email, password, role }: InviteDto) {
    const initial = password ?? randomBytes(24).toString('base64url');
    const passwordHash = await bcrypt.hash(initial, BCRYPT_COST);
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
      const user = rows[0];
      if (password) return user;
      const link = await this.createResetLink(
        orgId,
        user.id,
        INVITE_LINK_HOURS,
      );
      await this.mailer.send(
        email,
        'You have been invited to the help desk',
        `You have been added as ${role === 'AGENT' ? 'an agent' : 'a customer'}.\n\n` +
          `Choose your password here (the link works once and expires in ${INVITE_LINK_HOURS / 24} days):\n\n${link}\n\n` +
          `If you were not expecting this, you can safely ignore this email.\n`,
      );
      return { ...user, invitationSent: true };
    } catch (err) {
      if (isUniqueViolation(err, 'users_org_email_key')) {
        if (!password) {
          // Re-send invite link to existing user
          const { rows } = await this.db.tenantQuery<{
            id: string;
            email: string;
            role: Role;
          }>(
            orgId,
            'SELECT id, email, role FROM users WHERE org_id = $1 AND email = $2',
            [email],
          );
          const existing = rows[0];
          if (existing) {
            const link = await this.createResetLink(
              orgId,
              existing.id,
              INVITE_LINK_HOURS,
            );
            await this.mailer.send(
              email,
              'You have been invited to the help desk',
              `You have been added as ${existing.role === 'AGENT' ? 'an agent' : 'a customer'}.\n\n` +
                `Choose your password here (the link works once and expires in ${INVITE_LINK_HOURS / 24} days):\n\n${link}\n\n` +
                `If you were not expecting this, you can safely ignore this email.\n`,
            );
            return { ...existing, invitationSent: true };
          }
        }
        throw new ConflictException(
          'Email already registered in this organization',
        );
      }
      throw err;
    }
  }
}
