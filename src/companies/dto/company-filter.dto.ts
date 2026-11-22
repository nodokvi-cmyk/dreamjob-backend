import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../shared/dto/pagination.dto.js';
import { trim } from '../../shared/transforms/string.transforms.js';

export const COMPANY_SORTS = [
  'vacancies',
  'fewest',
  'newest',
  'oldest',
  'rating',
] as const;

export type CompanySort = (typeof COMPANY_SORTS)[number];

export class CompanyFilterDto extends PaginationDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  q?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(128)
  location?: string;

  @IsOptional()
  @IsIn(COMPANY_SORTS)
  sort?: CompanySort;
}
