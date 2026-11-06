import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../shared/dto/pagination.dto.js';
import { trim } from '../../shared/transforms/string.transforms.js';
import {
  ADMIN_VACANCY_VIEW_STATUSES,
  Currency,
  EmploymentType,
  VACANCY_VIEW_STATUSES,
  WorkMode,
} from '../schema/vacancy.schema.js';
import type {
  AdminVacancyViewStatus,
  VacancyViewStatus,
} from '../schema/vacancy.schema.js';

export const VACANCY_SORTS = [
  'date',
  '-date',
  'salary',
  '-salary',
  'deadline',
  '-deadline',
] as const;

export type VacancySort = (typeof VACANCY_SORTS)[number];

export class VacancyFilterDto extends PaginationDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  q?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  category?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(128)
  location?: string;

  @IsOptional()
  @IsEnum(WorkMode)
  workMode?: WorkMode;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  salaryMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  salaryMax?: number;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @IsIn(VACANCY_SORTS)
  sort?: VacancySort;
}

export class OwnVacanciesFilterDto extends VacancyFilterDto {
  @IsOptional()
  @IsIn(VACANCY_VIEW_STATUSES)
  status?: VacancyViewStatus;
}

export class AdminVacanciesFilterDto extends VacancyFilterDto {
  @IsOptional()
  @IsIn(ADMIN_VACANCY_VIEW_STATUSES)
  status?: AdminVacancyViewStatus;

  @IsOptional()
  @IsMongoId()
  companyId?: string;
}
