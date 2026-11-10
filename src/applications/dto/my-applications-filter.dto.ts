import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../shared/dto/pagination.dto.js';
import { trim } from '../../shared/transforms/string.transforms.js';
import { ApplicationStatus } from '../schema/application.schema.js';

export const MY_APPLICATION_SORTS = ['date', '-date'] as const;

export type MyApplicationSort = (typeof MY_APPLICATION_SORTS)[number];

export class MyApplicationsFilterDto extends PaginationDto {
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  q?: string;

  @IsOptional()
  @IsIn(MY_APPLICATION_SORTS)
  sort?: MyApplicationSort;
}
