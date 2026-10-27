import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { IsNormalizedEmail } from './email.js';

export class ForgotPasswordDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  orgSlug!: string;

  @IsNormalizedEmail()
  email!: string;
}
