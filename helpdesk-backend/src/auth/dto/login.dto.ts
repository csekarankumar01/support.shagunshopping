import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsNormalizedEmail } from './email.js';

export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'shagun',
  )
  @IsString()
  @IsOptional()
  orgSlug?: string = 'shagun';

  @IsNormalizedEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}
