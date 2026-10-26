import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class ForgotPasswordDto {
  @IsString()
  @IsNotEmpty()
  orgSlug!: string;

  @IsEmail()
  email!: string;
}
