import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../shared/dto/pagination.dto.js';
import { trim } from '../../shared/transforms/string.transforms.js';
import { ApplicationStatus } from '../schema/application.schema.js';

export const APPLICANT_SORTS = [
  'date',
  '-date',
  'name',
  '-name',
  'age',
  '-age',
] as const;

export type ApplicantSort = (typeof APPLICANT_SORTS)[number];

export class ApplicantsFilterDto extends PaginationDto {
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  q?: string;

  @IsOptional()
  @IsIn(APPLICANT_SORTS)
  sort?: ApplicantSort;

  @IsOptional()
  @IsMongoId()
  focus?: string;
}
