import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { IsNormalizedEmail } from './email.js';

const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class ResendCodeDto {
  @Transform(lowerTrim)
  @IsString()
  @IsNotEmpty()
  orgSlug!: string;

  @IsNormalizedEmail()
  email!: string;
}

export class VerifyRegistrationDto extends ResendCodeDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s/g, '') : value,
  )
  @Matches(/^\d{6}$/, { message: 'code must be the 6 digits from the email' })
  code!: string;
}
