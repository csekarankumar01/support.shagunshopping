import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * Email rules in one place. Addresses are trimmed and lowercased before validation, so "Ann@Example.com" and
 * "ann@example.com" are the same account (otherwise login depends on typing the capitals exactly, and one person
 * could hold two accounts). The length cap is the SMTP limit.
 */
export const IsNormalizedEmail = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim().toLowerCase() : value,
    ),
    IsEmail(),
    MaxLength(254),
  );
