import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Password rules in one place. At most 72 bytes because bcrypt silently ignores everything after that, which would
 * make a longer password weaker than it looks.
 */
export const IsPassword = () =>
  applyDecorators(
    IsString(),
    MinLength(8, { message: 'password must be at least 8 characters' }),
    MaxLength(72, { message: 'password must be at most 72 characters' }),
  );
