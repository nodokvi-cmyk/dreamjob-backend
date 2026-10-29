import { IntersectionType, PickType } from '@nestjs/mapped-types';
import { ChangePasswordDto } from '../../shared/dto/change-password.dto.js';
import { CodeDto } from '../../shared/dto/code.dto.js';
import { EmailDto } from './email.dto.js';

export class ResetPasswordDto extends IntersectionType(
  EmailDto,
  CodeDto,
  PickType(ChangePasswordDto, ['newPassword', 'confirmNewPassword'] as const),
) {}
