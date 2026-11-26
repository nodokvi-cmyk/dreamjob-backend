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
import { JobCategory } from '../../shared/categories/job-category.js';
import { PaginationDto } from '../../shared/dto/pagination.dto.js';
import {
  emptyToUndefined,
  trim,
} from '../../shared/transforms/string.transforms.js';
import {
  Currency,
  EmploymentType,
  WorkMode,
} from '../../vacancies/schema/vacancy.schema.js';
import {
  PUBLICATION_VIEW_STATUSES,
  type PublicationViewStatus,
} from '../schema/publication.schema.js';

export const PUBLICATION_LIST_SORTS = ['date', '-date'] as const;

export type PublicationListSort = (typeof PUBLICATION_LIST_SORTS)[number];

export const PUBLICATION_BOARD_SORTS = [
  ...PUBLICATION_LIST_SORTS,
  'salary',
  '-salary',
  'experience',
  '-experience',
] as const;

export type PublicationBoardSort = (typeof PUBLICATION_BOARD_SORTS)[number];

export class PublicationStatusFilterDto extends PaginationDto {
  @IsOptional()
  @IsIn(PUBLICATION_VIEW_STATUSES)
  status?: PublicationViewStatus;

  @IsOptional()
  @IsIn(PUBLICATION_LIST_SORTS)
  sort?: PublicationListSort;
}

export class AdminPublicationsFilterDto extends PublicationStatusFilterDto {
  @IsOptional()
  @IsMongoId()
  userId?: string;
}

export class PublicationBoardFilterDto extends PaginationDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  q?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(JobCategory)
  category?: JobCategory;

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
  @IsIn(PUBLICATION_BOARD_SORTS)
  sort?: PublicationBoardSort;
}
