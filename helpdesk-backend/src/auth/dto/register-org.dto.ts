import {
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsNormalizedEmail } from './email.js';
import { IsPassword } from './password.js';

export class RegisterOrgDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  orgName!: string;

  @IsString()
  @Length(3, 40)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'orgSlug must be lowercase letters, numbers and single hyphens',
  })
  orgSlug!: string;

  @IsNormalizedEmail()
  email!: string;

  @IsPassword()
  password!: string;
}
