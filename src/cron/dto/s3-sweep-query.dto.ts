import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { toBoolean } from '../../shared/transforms/string.transforms.js';

export class S3SweepQueryDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  dryRun?: boolean;
}
