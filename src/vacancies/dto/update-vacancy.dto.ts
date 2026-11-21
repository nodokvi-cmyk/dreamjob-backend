import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, MinDate } from 'class-validator';
import { CreateVacancyDto } from './create-vacancy.dto.js';

export class UpdateVacancyDto extends PartialType(
  OmitType(CreateVacancyDto, ['deadline'] as const),
) {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date())
  deadline?: Date;
}
