import { IsInt, Max, Min } from 'class-validator';

export class RateCompanyDto {
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;
}
