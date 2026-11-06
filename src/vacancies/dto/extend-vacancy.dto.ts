import { Type } from 'class-transformer';
import { IsDate, MinDate } from 'class-validator';

export class ExtendVacancyDto {
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date())
  deadline!: Date;
}
