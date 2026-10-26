import { IsNotEmpty, IsString } from 'class-validator';
import { IsPassword } from './password.js';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsPassword()
  newPassword!: string;
}
