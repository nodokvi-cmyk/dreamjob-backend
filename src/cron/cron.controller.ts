import { Controller, Get, UseGuards } from '@nestjs/common';
import { CronSecretGuard } from './cron-secret.guard.js';
import { CronService } from './cron.service.js';
import type { CleanupResult } from './cron.service.js';

@Controller('cron')
export class CronController {
  constructor(private readonly cronService: CronService) {}

  @Get('cleanup')
  @UseGuards(CronSecretGuard)
  cleanup(): Promise<CleanupResult> {
    return this.cronService.cleanup();
  }
}
