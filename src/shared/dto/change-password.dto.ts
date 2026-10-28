import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { MatchesField } from '../validation/matches-field.js';
import { StrongPassword } from '../validation/strong-password.js';

export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  currentPassword?: string;

  @StrongPassword()
  newPassword!: string;

  @MatchesField('newPassword', {
    message: 'confirmNewPassword must match newPassword',
  })
  confirmNewPassword!: string;
}
