import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { trim } from '../../shared/transforms/string.transforms.js';
import { PHONE_PATTERN, PHONE_MESSAGE } from '../../shared/validation/phone.js';

export class DirectorDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  fullName!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string;
}
