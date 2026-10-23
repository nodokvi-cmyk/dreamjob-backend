import { Matches } from 'class-validator';
import { EmailDto } from './email.dto.js';

export class VerifyEmailDto extends EmailDto {
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;
}
