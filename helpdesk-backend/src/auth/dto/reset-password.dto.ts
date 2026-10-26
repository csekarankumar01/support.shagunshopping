import { IsString, Length } from 'class-validator';
import { IsPassword } from './password.js';

export class ResetPasswordDto {
  @IsString()
  @Length(1, 200)
  token!: string;

  @IsPassword()
  newPassword!: string;
}
