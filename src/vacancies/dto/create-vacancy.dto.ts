import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxDate,
  MaxLength,
  Min,
  MinDate,
} from 'class-validator';
import {
  toTrimmedList,
  trim,
} from '../../shared/transforms/string.transforms.js';
import {
  Currency,
  EmploymentType,
  MS_PER_DAY,
  VACANCY_WINDOW_DAYS,
  WorkMode,
} from '../schema/vacancy.schema.js';

export const MAX_DEADLINE_DAYS = VACANCY_WINDOW_DAYS;
const MAX_SALARY = 1_000_000_000;

export class CreateVacancyDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  title!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  category!: string;

  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @IsEnum(WorkMode)
  workMode!: WorkMode;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(128)
  location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(MAX_SALARY)
  salaryMin?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(MAX_SALARY)
  salaryMax?: number | null;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @Transform(toTrimmedList)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  requirements?: string[];

  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date())
  @MaxDate(() => new Date(Date.now() + MAX_DEADLINE_DAYS * MS_PER_DAY))
  deadline!: Date;
}
