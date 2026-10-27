import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service.js';
import { MailerService } from '../mail/mailer.service.js';
import type { RegisterOrgDto } from './dto/register-org.dto.js';
import type { ResendCodeDto } from './dto/verify-registration.dto.js';
import type { VerifyRegistrationDto } from './dto/verify-registration.dto.js';

const BCRYPT_COST = 10;
export const CODE_MINUTES = 10;
const MAX_WRONG_CODES = 5;
const MAX_SENDS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

interface Pending {
  org_name: string;
  password_hash: string;
  code_hash: string;
  attempts: number;
  sends: number;
  expired: boolean;
  seconds_since_send: number;
}

export interface VerifiedRegistration {
  orgName: string;
  orgSlug: string;
  email: string;
  passwordHash: string;
}

/**
 * Email verification for sign-up with a one-time code.
 *  - A registration is parked in pending_registrations; nothing is created yet.
 *  - A random 6-digit code is emailed. Only a keyed hash of it is stored.
 *  - The code works for 10 minutes, at most 5 wrong tries (then the sign-up is thrown away), and once.
 *  - A new code can be requested after a minute, at most 5 per sign-up.
 * AuthService creates the organisation once verify() returns the stored details.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);
  private readonly secret: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly mailer: MailerService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('JWT_SECRET');
  }

  private hashCode(orgSlug: string, email: string, code: string) {
    return createHmac('sha256', this.secret)
      .update(`registration:${orgSlug}:${email}:${code}`)
      .digest('hex');
  }

  private newCode() {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private async sendCode(email: string, orgName: string, code: string) {
    try {
      await this.mailer.send(
        email,
        `Your verification code: ${code}`,
        `Your code to create the organisation "${orgName}" is:\n\n    ${code}\n\n` +
          `It works for ${CODE_MINUTES} minutes. If you did not ask for this, ignore this email: nothing was created.\n`,
      );
    } catch (err) {
      this.logger.error(`verification email failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        'We could not send the verification email. Please try again in a moment.',
      );
    }
  }

  private tooSoon() {
    return new HttpException(
      'Please wait a minute before asking for another code.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Parks the sign-up and emails the code. A repeat by the same person replaces the old one (and counts as a resend). */
  async start({ orgName, orgSlug, email, password }: RegisterOrgDto) {
    await this.db.query(
      'DELETE FROM pending_registrations WHERE expires_at < now()',
    );
    const taken = await this.db.query<{ taken: boolean }>(
      'SELECT org_slug_taken($1) AS taken',
      [orgSlug],
    );
    if (taken.rows[0].taken) {
      throw new ConflictException('Organization slug already taken');
    }
    const existing = await this.db.query<{
      email: string;
      sends: number;
      seconds_since_send: number;
    }>(
      `SELECT email, sends, extract(epoch FROM now() - last_sent_at)::float8 AS seconds_since_send
         FROM pending_registrations WHERE org_slug = $1`,
      [orgSlug],
    );
    const other = existing.rows[0];
    // Someone else is part-way through registering this name: it is held for them until their code expires.
    if (other && other.email !== email) {
      throw new ConflictException('Organization slug already taken');
    }
    if (other) {
      if (other.seconds_since_send < RESEND_COOLDOWN_SECONDS || other.sends >= MAX_SENDS) {
        throw this.tooSoon();
      }
    }

    const code = this.newCode();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await this.db.query(
      `INSERT INTO pending_registrations (org_slug, org_name, email, password_hash, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6::int))
       ON CONFLICT (org_slug) DO UPDATE
          SET org_name = EXCLUDED.org_name, password_hash = EXCLUDED.password_hash, code_hash = EXCLUDED.code_hash,
              attempts = 0, sends = pending_registrations.sends + 1, last_sent_at = now(), expires_at = EXCLUDED.expires_at
        WHERE pending_registrations.email = EXCLUDED.email`,
      [orgSlug, orgName, email, passwordHash, this.hashCode(orgSlug, email, code), CODE_MINUTES],
    );
    await this.sendCode(email, orgName, code);
    return { verificationRequired: true, email, expiresInMinutes: CODE_MINUTES };
  }

  /** Same answer for every failure: no code, wrong code, expired, too many tries. */
  private invalid() {
    return new BadRequestException('This code is invalid or has expired.');
  }

  /**
   * Checks the code. On success the pending sign-up is removed (so the code cannot be used twice) and its details
   * are returned for the caller to create the organisation.
   */
  async verify({ orgSlug, email, code }: VerifyRegistrationDto): Promise<VerifiedRegistration> {
    const verified = await this.db.transaction<VerifiedRegistration | null>(async (client) => {
      const { rows } = await client.query<Pending>(
        `SELECT org_name, password_hash, code_hash, attempts, sends, expires_at < now() AS expired,
                extract(epoch FROM now() - last_sent_at)::float8 AS seconds_since_send
           FROM pending_registrations WHERE org_slug = $1 AND email = $2 FOR UPDATE`,
        [orgSlug, email],
      );
      const pending = rows[0];
      if (!pending || pending.expired) return null;

      const given = Buffer.from(this.hashCode(orgSlug, email, code));
      const stored = Buffer.from(pending.code_hash);
      if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
        // The wrong guess is counted and committed (we return, not throw), then answered with an error below.
        const attempts = pending.attempts + 1;
        if (attempts >= MAX_WRONG_CODES) {
          await client.query('DELETE FROM pending_registrations WHERE org_slug = $1', [orgSlug]);
        } else {
          await client.query('UPDATE pending_registrations SET attempts = $2 WHERE org_slug = $1', [orgSlug, attempts]);
        }
        return null;
      }
      await client.query('DELETE FROM pending_registrations WHERE org_slug = $1', [orgSlug]);
      return { orgName: pending.org_name, orgSlug, email, passwordHash: pending.password_hash };
    });
    if (!verified) throw this.invalid();
    return verified;
  }

  /** "Send me a new code". Always answers the same, so it cannot be used to find out who is registering. */
  async resend({ orgSlug, email }: ResendCodeDto) {
    const { rows } = await this.db.query<Pending>(
      `SELECT org_name, sends, expires_at < now() AS expired,
              extract(epoch FROM now() - last_sent_at)::float8 AS seconds_since_send
         FROM pending_registrations WHERE org_slug = $1 AND email = $2`,
      [orgSlug, email],
    );
    const pending = rows[0];
    if (!pending || pending.expired) return { ok: true };
    if (pending.seconds_since_send < RESEND_COOLDOWN_SECONDS) throw this.tooSoon();
    if (pending.sends >= MAX_SENDS) return { ok: true };

    const code = this.newCode();
    await this.db.query(
      `UPDATE pending_registrations
          SET code_hash = $3, attempts = 0, sends = sends + 1, last_sent_at = now(),
              expires_at = now() + make_interval(mins => $4::int)
        WHERE org_slug = $1 AND email = $2`,
      [orgSlug, email, this.hashCode(orgSlug, email, code), CODE_MINUTES],
    );
    await this.sendCode(email, pending.org_name, code);
    return { ok: true };
  }
}
