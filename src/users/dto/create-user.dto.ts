import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxDate,
  MaxLength,
} from 'class-validator';
import { trim } from '../../shared/transforms/string.transforms.js';
import { AccountEmail } from '../../shared/validation/account-email.js';
import {
  OPTIONAL_PHONE_PATTERN,
  PHONE_MESSAGE,
} from '../../shared/validation/phone.js';
import { StrongPassword } from '../../shared/validation/strong-password.js';

export class CreateUserDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  firstName!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  lastName!: string;

  @AccountEmail()
  email!: string;

  @Type(() => Date)
  @IsDate()
  @MaxDate(() => new Date())
  birthDate!: Date;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(OPTIONAL_PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string;

  @StrongPassword()
  password!: string;
}
