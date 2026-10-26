import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

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

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
