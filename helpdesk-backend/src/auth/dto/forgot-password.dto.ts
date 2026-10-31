import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { IsNormalizedEmail } from './email.js';

export class ForgotPasswordDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'shagun',
  )
  @IsString()
  @IsOptional()
  orgSlug?: string = 'shagun';

  @IsNormalizedEmail()
  email!: string;
}
