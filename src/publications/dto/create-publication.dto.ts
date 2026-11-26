import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { JobCategory } from '../../shared/categories/job-category.js';
import {
  toTrimmedList,
  trim,
} from '../../shared/transforms/string.transforms.js';
import { MaxWords } from '../../shared/validation/max-words.js';
import {
  Currency,
  EmploymentType,
  WorkMode,
} from '../../vacancies/schema/vacancy.schema.js';

const MAX_SALARY = 1_000_000_000;

export class CreatePublicationDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  title!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  @MaxWords(500)
  about!: string;

  @IsEnum(JobCategory)
  category!: JobCategory;

  @IsOptional()
  @Transform(toTrimmedList)
  @IsArray()
  @ArrayUnique()
  @IsEnum(EmploymentType, { each: true })
  employmentTypes?: EmploymentType[];

  @IsOptional()
  @Transform(toTrimmedList)
  @IsArray()
  @ArrayUnique()
  @IsEnum(WorkMode, { each: true })
  workModes?: WorkMode[];

  @IsOptional()
  @Transform(toTrimmedList)
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(128, { each: true })
  locations?: string[];

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
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(50, { each: true })
  skills?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  experienceYears?: number | null;
}
