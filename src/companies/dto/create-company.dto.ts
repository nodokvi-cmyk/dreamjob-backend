import { PickType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { trim, trimEach } from '../../shared/transforms/string.transforms.js';
import { CreateUserDto } from '../../users/dto/create-user.dto.js';
import { DirectorDto } from './director.dto.js';

export class CreateCompanyDto extends PickType(CreateUserDto, [
  'email',
  'password',
  'confirmPassword',
  'phone',
]) {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  companyName!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(128)
  location?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @ValidateIf((_: unknown, value: unknown) => value !== '')
  @Transform(trim)
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(256)
  website?: string;

  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(64, { each: true })
  operatingCities?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DirectorDto)
  director?: DirectorDto | null;
}
