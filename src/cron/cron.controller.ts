import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CronSecretGuard } from './cron-secret.guard.js';
import { CronService } from './cron.service.js';
import type { CleanupResult } from './cron.service.js';
import { S3SweepQueryDto } from './dto/s3-sweep-query.dto.js';
import { S3SweepService } from './s3-sweep.service.js';
import type { S3SweepResult } from './s3-sweep.service.js';

@Controller('cron')
export class CronController {
  constructor(
    private readonly cronService: CronService,
    private readonly s3SweepService: S3SweepService,
  ) {}

  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CronSecretGuard)
  cleanup(): Promise<CleanupResult> {
    return this.cronService.cleanup();
  }

  @Post('s3-sweep')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CronSecretGuard)
  s3Sweep(@Query() query: S3SweepQueryDto): Promise<S3SweepResult> {
    return this.s3SweepService.sweep(query.dryRun === true);
  }
}
