import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxDate,
  MaxLength,
} from 'class-validator';
import {
  trim,
  trimLowercase,
} from '../../shared/transforms/string.transforms.js';

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

  @Transform(trimLowercase)
  @IsEmail()
  @MaxLength(128)
  email!: string;

  @Type(() => Date)
  @IsDate()
  @MaxDate(() => new Date())
  birthDate!: Date;

  @IsString()
  @Length(8, 64)
  @Matches(/^[\x20-\x7E]+$/, {
    message:
      'password may contain only English letters, digits, spaces and standard symbols',
  })
  password!: string;
}
