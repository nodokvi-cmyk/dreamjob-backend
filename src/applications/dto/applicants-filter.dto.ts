import { IsEnum, IsIn, IsMongoId, IsOptional } from 'class-validator';
import { PaginationDto } from '../../shared/dto/pagination.dto.js';
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
  @IsIn(APPLICANT_SORTS)
  sort?: ApplicantSort;

  @IsOptional()
  @IsMongoId()
  focus?: string;
}
