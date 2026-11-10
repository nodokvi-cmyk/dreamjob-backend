import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../shared/dto/pagination.dto.js';
import { ApplicationStatus } from '../schema/application.schema.js';

export class MyApplicationsFilterDto extends PaginationDto {
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;
}
